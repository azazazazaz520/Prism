<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue';
import type { NoteDocumentState } from '../../composables/useNoteDocumentStore';
import type { WorkspaceDropZone, WorkspaceLeaf } from '../../domain/note-workspace';
import { NOTE_FILE_DRAG_EVENT, type NoteFileDragDetail } from './file-drag';
import { getTabDropPosition } from './tab-drop-indicator';

const MarkdownEditor = defineAsyncComponent({
  loader: () => import('./MarkdownEditor.vue'),
  suspensible: false,
});

interface MarkdownEditorApi {
  wrapSelection: (before: string, after: string) => void;
  insertText: (text: string) => void;
  prependToLine: (text: string) => void;
  focus: () => void;
  getSelection: () => string;
  replaceSelection: (text: string) => void;
  selectAll: () => void;
}

const editorRef = ref<MarkdownEditorApi | null>(null);
const suppressNextTabClick = ref(false);
const pointerDragging = ref(false);
const dragGhostPosition = ref({ left: 0, top: 0 });
const tabDropIndicator = ref<{ left: number; top: number; height: number } | null>(null);
const fileDropTarget = ref<'tabs' | 'editor' | null>(null);
let pointerDrag: {
  leafId: string;
  tabId: string;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
} | null = null;

const props = defineProps<{
  leaf: WorkspaceLeaf;
  documents: Map<string, NoteDocumentState>;
  draggingTabId?: string | null;
  draggingTabLabel?: string;
  dropZone?: WorkspaceDropZone | null;
}>();

const emit = defineEmits<{
  'activate-tab': [leafId: string, tabId: string];
  'close-tab': [leafId: string, tabId: string];
  'close-leaf': [leafId: string];
  'split-leaf': [leafId: string, direction: 'horizontal' | 'vertical'];
  'update-content': [path: string, content: string];
  'save-path': [path: string];
  'rename-path': [path: string, title: string];
  'drag-start': [leafId: string, tabId: string];
  'drag-end': [];
  'drag-over': [leafId: string, zone: WorkspaceDropZone | null];
  'drop-edge': [leafId: string, zone: WorkspaceDropZone];
  'drop-tab': [leafId: string, tabId: string, targetIndex: number];
  'file-drop': [path: string];
  'create-note': [leafId: string];
  'open-workspace': [];
  'open-menu': [event: MouseEvent];
  'open-context-menu': [event: MouseEvent];
}>();

const activeTab = computed(
  () => props.leaf.tabs.find((tab) => tab.id === props.leaf.activeTabId) ?? null,
);
const activeDocument = computed(() =>
  activeTab.value ? (props.documents.get(activeTab.value.path) ?? null) : null,
);

function tabName(path: string) {
  return path.split('/').pop() || path;
}

function edgeZoneAt(
  element: HTMLElement,
  clientX: number,
  clientY: number,
): WorkspaceDropZone | null {
  const rect = element.getBoundingClientRect();
  const horizontal = Math.min(0.25 * rect.width, 180);
  const vertical = Math.min(0.25 * rect.height, 180);
  if (clientX <= rect.left + horizontal) return 'left';
  if (clientX >= rect.right - horizontal) return 'right';
  if (clientY <= rect.top + vertical) return 'top';
  if (clientY >= rect.bottom - vertical) return 'bottom';
  return null;
}

function leafElementAt(clientX: number, clientY: number) {
  const hit = (
    document.elementFromPoint(clientX, clientY) as HTMLElement | null
  )?.closest<HTMLElement>('[data-workspace-leaf]');
  if (hit) {
    const rect = hit.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      return hit;
    }
  }

  return (
    [...document.querySelectorAll<HTMLElement>('[data-workspace-leaf]')].find((element) => {
      const rect = element.getBoundingClientRect();
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    }) ?? null
  );
}

function childAtPoint(leaf: HTMLElement, selector: string, clientX: number, clientY: number) {
  const hit = (
    document.elementFromPoint(clientX, clientY) as HTMLElement | null
  )?.closest<HTMLElement>(selector);
  if (hit && leaf.contains(hit)) {
    const rect = hit.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      return hit;
    }
  }

  return (
    [...leaf.querySelectorAll<HTMLElement>(selector)].find((element) => {
      const rect = element.getBoundingClientRect();
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    }) ?? null
  );
}

/** 更新标签插入位置的竖线提示。 */
function updateTabDropIndicator(clientX: number, clientY: number) {
  if (!pointerDrag?.active) {
    tabDropIndicator.value = null;
    return;
  }

  const targetLeaf = leafElementAt(clientX, clientY);
  if (!targetLeaf) {
    tabDropIndicator.value = null;
    return;
  }

  const targetStrip = childAtPoint(targetLeaf, '.workspace-tabs', clientX, clientY);
  if (!targetStrip) {
    tabDropIndicator.value = null;
    return;
  }

  const stripRect = targetStrip.getBoundingClientRect();
  const tabRects = [...targetLeaf.querySelectorAll<HTMLElement>('[data-workspace-tab]')].map(
    (tab) => {
      const rect = tab.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    },
  );
  const { left } = getTabDropPosition(clientX, tabRects, stripRect.left);

  tabDropIndicator.value = {
    left,
    top: stripRect.top + 5,
    height: Math.max(20, stripRect.height - 10),
  };
}

function handlePointerDown(event: PointerEvent, leafId: string, tabId: string) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('.workspace-tab-close')) return;
  pointerDrag = {
    leafId,
    tabId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
  };
  window.addEventListener('pointermove', handlePointerMove, { passive: false });
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerCancel);
}

function handlePointerMove(event: PointerEvent) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const distance = Math.hypot(
    event.clientX - pointerDrag.startX,
    event.clientY - pointerDrag.startY,
  );
  if (!pointerDrag.active && distance < 6) return;

  if (!pointerDrag.active) {
    pointerDrag.active = true;
    pointerDragging.value = true;
    suppressNextTabClick.value = true;
    emit('drag-start', pointerDrag.leafId, pointerDrag.tabId);
  }

  dragGhostPosition.value = { left: event.clientX + 14, top: event.clientY + 14 };
  const targetElement = document.elementFromPoint(
    event.clientX,
    event.clientY,
  ) as HTMLElement | null;
  const targetLeaf = leafElementAt(event.clientX, event.clientY);
  const targetTabStrip = targetLeaf
    ? childAtPoint(targetLeaf, '.workspace-tabs', event.clientX, event.clientY)
    : targetElement?.closest('.workspace-tabs');
  emit(
    'drag-over',
    targetLeaf?.dataset.workspaceLeaf ?? props.leaf.id,
    targetLeaf && !targetTabStrip ? edgeZoneAt(targetLeaf, event.clientX, event.clientY) : null,
  );
  updateTabDropIndicator(event.clientX, event.clientY);
  event.preventDefault();
}

function handlePointerUp(event: PointerEvent) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const drag = pointerDrag;
  if (drag.active) {
    const targetElement = document.elementFromPoint(
      event.clientX,
      event.clientY,
    ) as HTMLElement | null;
    const targetLeaf = leafElementAt(event.clientX, event.clientY);
    const targetTab = targetLeaf
      ? childAtPoint(targetLeaf, '[data-workspace-tab]', event.clientX, event.clientY)
      : targetElement?.closest<HTMLElement>('[data-workspace-tab]');
    const targetTabStrip = targetLeaf
      ? childAtPoint(targetLeaf, '.workspace-tabs', event.clientX, event.clientY)
      : targetElement?.closest('.workspace-tabs');
    if (targetLeaf && targetTabStrip) {
      const targetTabRects = [
        ...targetLeaf.querySelectorAll<HTMLElement>('[data-workspace-tab]'),
      ].map((tab) => {
        const rect = tab.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
      const { targetIndex } = getTabDropPosition(
        event.clientX,
        targetTabRects,
        targetTabStrip.getBoundingClientRect().left,
      );
      emit(
        'drop-tab',
        targetLeaf.dataset.workspaceLeaf ?? props.leaf.id,
        targetTab?.dataset.workspaceTab ?? '',
        targetIndex,
      );
    } else if (targetLeaf) {
      const targetLeafId = targetLeaf.dataset.workspaceLeaf ?? props.leaf.id;
      const zone = edgeZoneAt(targetLeaf, event.clientX, event.clientY);
      if (zone) {
        emit('drop-edge', targetLeafId, zone);
      } else {
        // 落在目标编辑区的空白区域时，加入该分栏末尾，而不是取消投放。
        const targetTabs = targetLeaf.querySelectorAll('[data-workspace-tab]').length;
        emit('drop-tab', targetLeafId, '', targetTabs);
      }
    }
    emit('drag-end');
  }
  cleanupPointerDrag();
}

function handlePointerCancel() {
  if (pointerDrag?.active) emit('drag-end');
  cleanupPointerDrag();
}

function cleanupPointerDrag() {
  pointerDrag = null;
  pointerDragging.value = false;
  tabDropIndicator.value = null;
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', handlePointerUp);
  window.removeEventListener('pointercancel', handlePointerCancel);
}

function getFileDropTarget(target: EventTarget | null): 'tabs' | 'editor' | null {
  if (!(target instanceof Element)) return null;
  if (target.closest('.workspace-tabs')) return 'tabs';
  if (target.closest('.editor-document-body')) return 'editor';
  return null;
}

function getFileDropTargetAt(clientX: number, clientY: number) {
  const target = document.elementFromPoint(clientX, clientY);
  const leaf = leafElementAt(clientX, clientY);
  const zone = getFileDropTarget(target);
  if (!leaf || !zone) return null;
  return { leaf, zone };
}

function handleFilePointerDrag(event: Event) {
  const detail = (event as CustomEvent<NoteFileDragDetail>).detail;
  if (!detail) return;

  const target =
    detail.phase === 'cancel' ? null : getFileDropTargetAt(detail.clientX, detail.clientY);
  const targetLeafId = target?.leaf.dataset.workspaceLeaf;
  fileDropTarget.value = targetLeafId === props.leaf.id ? (target?.zone ?? null) : null;

  if (detail.phase === 'end') {
    if (targetLeafId === props.leaf.id && target) emit('file-drop', detail.path);
    fileDropTarget.value = null;
  }
}

function handleTabClick(leafId: string, tabId: string) {
  if (suppressNextTabClick.value) {
    suppressNextTabClick.value = false;
    return;
  }
  emit('activate-tab', leafId, tabId);
}

onMounted(() => window.addEventListener(NOTE_FILE_DRAG_EVENT, handleFilePointerDrag));
onUnmounted(() => {
  cleanupPointerDrag();
  window.removeEventListener(NOTE_FILE_DRAG_EVENT, handleFilePointerDrag);
});

defineExpose({
  wrapSelection: (before: string, after: string) => editorRef.value?.wrapSelection(before, after),
  insertText: (text: string) => editorRef.value?.insertText(text),
  prependToLine: (text: string) => editorRef.value?.prependToLine(text),
  focusEditor: () => editorRef.value?.focus(),
  getSelection: () => editorRef.value?.getSelection() ?? '',
  replaceSelection: (text: string) => editorRef.value?.replaceSelection(text),
  selectAll: () => editorRef.value?.selectAll(),
});
</script>

<template>
  <section
    class="workspace-leaf-view"
    :class="dropZone ? `is-drop-target is-drop-${dropZone}` : ''"
    :data-workspace-leaf="leaf.id"
  >
    <div
      v-if="dropZone"
      class="workspace-drop-preview"
      :class="`workspace-drop-preview-${dropZone}`"
      aria-hidden="true"
    />
    <div
      v-if="tabDropIndicator"
      class="workspace-tab-drop-indicator"
      :style="{
        left: `${tabDropIndicator.left}px`,
        top: `${tabDropIndicator.top}px`,
        height: `${tabDropIndicator.height}px`,
      }"
      aria-hidden="true"
    />
    <div
      v-if="pointerDragging"
      class="workspace-drag-ghost"
      :style="{ left: `${dragGhostPosition.left}px`, top: `${dragGhostPosition.top}px` }"
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24">
        <path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4" />
      </svg>
      <span>{{ draggingTabLabel || '移动标签页' }}</span>
    </div>
    <div
      class="workspace-tabs editor-tabs split-pane-tabs"
      :class="{ 'is-file-drop-target': fileDropTarget === 'tabs' }"
      role="tablist"
    >
      <div
        v-for="tab in leaf.tabs"
        :key="tab.id"
        class="workspace-tab split-pane-tab"
        :class="{
          active: leaf.activeTabId === tab.id,
          'is-pointer-dragging': draggingTabId === tab.id,
        }"
        role="tab"
        tabindex="0"
        :aria-selected="leaf.activeTabId === tab.id"
        :data-workspace-tab="tab.id"
        :data-workspace-pane="leaf.id"
        :data-workspace-path="tab.path"
        @pointerdown="handlePointerDown($event, leaf.id, tab.id)"
        @click="handleTabClick(leaf.id, tab.id)"
        @keydown.enter="emit('activate-tab', leaf.id, tab.id)"
      >
        <span class="workspace-tab-name">{{ tabName(tab.path) }}</span>
        <span v-if="documents.get(tab.path)?.dirty" class="workspace-tab-dirty" aria-label="未保存"
          >•</span
        >
        <button
          type="button"
          class="workspace-tab-close"
          aria-label="关闭笔记标签"
          title="关闭"
          @click.stop="emit('close-tab', leaf.id, tab.id)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div
        v-if="leaf.tabs.length === 0"
        class="workspace-tab split-pane-tab split-pane-empty-tab active"
      >
        <span class="workspace-tab-name">新标签页</span>
        <button
          type="button"
          class="workspace-tab-close"
          aria-label="关闭此编辑区"
          title="关闭"
          @click.stop="emit('close-leaf', leaf.id)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <button
        type="button"
        class="workspace-tab-new"
        aria-label="新建笔记"
        @click="emit('create-note', leaf.id)"
      >
        +
      </button>
    </div>

    <div class="split-pane-document-header">
      <div class="split-pane-header-side">
        <button type="button" class="split-pane-nav-btn" disabled aria-label="后退">‹</button>
        <button type="button" class="split-pane-nav-btn" disabled aria-label="前进">›</button>
      </div>
      <input
        v-if="activeTab"
        class="split-pane-document-title split-pane-document-title-input"
        :value="tabName(activeTab.path).replace(/\.md$/i, '')"
        aria-label="笔记标题"
        @blur="emit('rename-path', activeTab.path, ($event.target as HTMLInputElement).value)"
        @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
      />
      <span v-else class="split-pane-document-title">新标签页</span>
      <div class="split-pane-header-side split-pane-header-actions">
        <button
          type="button"
          class="split-pane-nav-btn"
          aria-label="更多操作"
          title="更多操作"
          @click.stop="emit('open-menu', $event)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
          </svg>
        </button>
        <button
          type="button"
          class="split-pane-nav-btn"
          aria-label="关闭此编辑区"
          title="关闭此编辑区"
          @click="emit('close-leaf', leaf.id)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 7l10 10M17 7 7 17" />
          </svg>
        </button>
      </div>
    </div>

    <slot name="leaf-tools" :leaf="leaf" />

    <div
      class="editor-document-body"
      :class="{ 'is-file-drop-target': fileDropTarget === 'editor' }"
    >
      <MarkdownEditor
        v-if="activeTab"
        ref="editorRef"
        :key="activeTab.path"
        :model-value="activeDocument?.content ?? ''"
        placeholder="开始编写 Markdown..."
        @update:model-value="emit('update-content', activeTab.path, $event)"
        @save="emit('save-path', activeTab.path)"
        @contextmenu="emit('open-context-menu', $event)"
      />
      <div v-else class="split-pane-empty">
        <div class="split-pane-welcome">
          <button class="split-pane-welcome-btn" @click="emit('create-note', leaf.id)">
            新建笔记 <span>(Ctrl + N)</span>
          </button>
          <button class="split-pane-welcome-btn" @click="emit('open-workspace')">
            打开工作区 <span>(Ctrl + O)</span>
          </button>
          <button class="split-pane-welcome-btn" @click="emit('close-leaf', leaf.id)">
            关闭标签页
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.workspace-leaf-view {
  display: flex;
  flex-direction: column;
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.workspace-drop-preview {
  position: absolute;
  z-index: 4;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--accent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent) 42%, transparent);
}

.workspace-drop-preview-left,
.workspace-drop-preview-right {
  top: 4px;
  bottom: 4px;
  width: calc(50% - 6px);
}

.workspace-drop-preview-left {
  left: 4px;
}
.workspace-drop-preview-right {
  right: 4px;
}

.workspace-drop-preview-top,
.workspace-drop-preview-bottom {
  left: 4px;
  right: 4px;
  height: calc(50% - 6px);
}

.workspace-drop-preview-top {
  top: 4px;
}
.workspace-drop-preview-bottom {
  bottom: 4px;
}

.workspace-tab-drop-indicator {
  position: fixed;
  z-index: 70;
  width: 2px;
  border-radius: 999px;
  background: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 16%, transparent);
  pointer-events: none;
}

.workspace-tabs.is-file-drop-target {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-secondary));
  box-shadow: inset 0 -2px 0 var(--accent);
}

.editor-document-body.is-file-drop-target {
  outline: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
  outline-offset: -2px;
  background: color-mix(in srgb, var(--accent) 5%, transparent);
}

.workspace-drag-ghost {
  position: fixed;
  z-index: 60;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100% - 32px);
  min-width: 132px;
  min-height: 34px;
  padding: 7px 12px 7px 10px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  box-shadow:
    0 12px 24px color-mix(in srgb, #000 16%, transparent),
    0 3px 8px color-mix(in srgb, #000 12%, transparent);
  font-size: var(--text-sm);
  font-weight: 600;
  pointer-events: none;
  white-space: nowrap;
  transform-origin: top left;
  transition: box-shadow 160ms ease;
}

.workspace-drag-ghost svg {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.workspace-drag-ghost::before {
  width: 3px;
  align-self: stretch;
  margin: -7px 1px -7px -10px;
  border-radius: 3px 0 0 3px;
  background: var(--accent);
  content: '';
}

.workspace-drag-ghost span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-leaf-view :deep(.editor-document-body) {
  flex: 1;
  min-height: 0;
}

.workspace-leaf-view :deep(.workspace-tabs) {
  flex: 0 0 auto;
}

.workspace-leaf-view :deep(.split-pane-document-header) {
  flex: 0 0 auto;
}
</style>

<style>
.workspace-leaf-view .workspace-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 40px;
  flex: 0 0 auto;
  overflow-x: auto;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
  scrollbar-width: none;
}

.workspace-leaf-view .workspace-tabs::-webkit-scrollbar {
  display: none;
}

.workspace-leaf-view .workspace-tab,
.workspace-leaf-view .workspace-tab-new {
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-muted);
  cursor: default;
  font: inherit;
}

.workspace-leaf-view .workspace-tab {
  min-width: 128px;
  max-width: 220px;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px;
  border: 1px solid transparent;
  font-size: var(--text-xs);
  user-select: none;
  touch-action: none;
  transition:
    background-color 140ms ease,
    border-color 140ms ease,
    color 140ms ease,
    opacity 140ms ease,
    transform 160ms ease;
}

.workspace-leaf-view .workspace-tab.is-pointer-dragging {
  position: relative;
  z-index: 1;
  border: 1px dashed color-mix(in srgb, var(--accent) 60%, var(--border-subtle));
  background: color-mix(in srgb, var(--accent) 6%, var(--bg-secondary));
  color: var(--text-primary);
  opacity: 0.7;
}

.workspace-leaf-view .workspace-tab:hover,
.workspace-leaf-view .workspace-tab.active {
  color: var(--text-primary);
  background: var(--bg-primary);
}

.workspace-leaf-view .workspace-tab.active {
  border-color: var(--border-subtle);
  box-shadow: inset 0 -2px 0 var(--accent);
}

.workspace-leaf-view .workspace-tab-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-leaf-view .workspace-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background-color 160ms ease,
    box-shadow 160ms ease,
    color 160ms ease;
}

.workspace-leaf-view .workspace-tab-close:hover,
.workspace-leaf-view .workspace-tab-close:focus-visible {
  background: var(--bg-active);
  color: var(--text-primary);
  box-shadow: var(--shadow-md);
}

.workspace-leaf-view .workspace-tab-close svg {
  display: block;
  width: 14px;
  height: 14px;
  transform: translateX(-0.6px);
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.workspace-leaf-view .workspace-tab-dirty {
  margin-left: auto;
  color: var(--accent);
}

.workspace-leaf-view .workspace-tab-new {
  min-width: 40px;
  min-height: 32px;
  font-size: 18px;
  cursor: pointer;
}

.workspace-leaf-view .workspace-tab-new:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.workspace-leaf-view .split-pane-document-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 38px;
  flex: 0 0 auto;
  padding: 0 10px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.workspace-leaf-view .split-pane-header-side {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 72px;
}

.workspace-leaf-view .split-pane-header-actions {
  justify-content: flex-end;
}

.workspace-leaf-view .split-pane-nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.workspace-leaf-view .split-pane-nav-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.workspace-leaf-view .split-pane-nav-btn:disabled {
  opacity: 0.42;
  cursor: default;
}

.workspace-leaf-view .split-pane-nav-btn svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.workspace-leaf-view .split-pane-document-title {
  min-width: 0;
  max-width: 60%;
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-sm);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-leaf-view .split-pane-document-title-input {
  width: min(60%, 520px);
  padding: 3px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: center;
  text-overflow: ellipsis;
}

.workspace-leaf-view .split-pane-document-title-input:hover,
.workspace-leaf-view .split-pane-document-title-input:focus {
  border-color: var(--border-default);
  background: var(--bg-secondary);
  outline: none;
}

.workspace-leaf-view .editor-document-body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.workspace-leaf-view .editor-document-body > :first-child {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.workspace-leaf-view .editor-document-body .codemirror-wrapper {
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.workspace-leaf-view .editor-document-body .cm-editor {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.workspace-leaf-view .split-pane-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 260px;
  padding: 32px 24px;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.workspace-leaf-view .split-pane-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.workspace-leaf-view .split-pane-welcome-btn {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.workspace-leaf-view .split-pane-welcome-btn:hover {
  color: var(--accent-hover);
  text-decoration: underline;
  text-underline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .workspace-drag-ghost,
  .workspace-leaf-view .workspace-tab {
    transition: none;
  }
}
</style>
