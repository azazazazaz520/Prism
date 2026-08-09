<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import WorkspaceRenderer from './WorkspaceRenderer.vue';
import WorkspaceLeafView from './WorkspaceLeafView.vue';
import { NOTE_FILE_DRAG_EVENT, type NoteFileDragDetail } from './file-drag';
import {
  activateTab,
  closeLeaf,
  closeTab,
  createWorkspaceState,
  moveTab,
  openTab,
  resizeSplit,
  splitLeaf,
  splitLeafWithTab,
  type NoteWorkspaceState,
  type WorkspaceDirection,
  type WorkspaceLeaf,
  type WorkspaceDropZone,
} from '../../domain/note-workspace';
import type { NoteDocumentState } from '../../composables/useNoteDocumentStore';

const props = withDefaults(
  defineProps<{
    documents: Map<string, NoteDocumentState>;
    initialState?: NoteWorkspaceState;
  }>(),
  {
    initialState: undefined,
  },
);

const emit = defineEmits<{
  'open-path': [path: string, leafId: string];
  'update-content': [path: string, content: string];
  'save-path': [path: string];
  'rename-path': [path: string, title: string];
  'create-note': [leafId: string];
  'open-workspace': [];
  'open-menu': [event: MouseEvent];
  'open-context-menu': [event: MouseEvent];
  'state-change': [state: NoteWorkspaceState];
}>();

defineSlots<{
  'leaf-tools'(props: { leaf: WorkspaceLeaf }): unknown;
}>();

const state = ref<NoteWorkspaceState>(props.initialState ?? createWorkspaceState());
const draggingTabId = ref<string | null>(null);
const draggingLeafId = ref<string | null>(null);
const dropTarget = ref<{ leafId: string; zone: WorkspaceDropZone } | null>(null);
const fileDragGhost = ref<{ left: number; top: number; label: string } | null>(null);
const draggingTabLabel = computed(() => {
  if (!draggingTabId.value) return '';
  const tab = findTabInTree(state.value.root, draggingTabId.value);
  return tab?.path.split('/').pop() ?? draggingTabId.value;
});

function fileDragLabel(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function handleFileDragGhost(event: Event) {
  const detail = (event as CustomEvent<NoteFileDragDetail>).detail;
  if (!detail) return;

  if (detail.phase === 'end' || detail.phase === 'cancel') {
    fileDragGhost.value = null;
    return;
  }

  fileDragGhost.value = {
    left: detail.clientX + 14,
    top: detail.clientY + 14,
    label: fileDragLabel(detail.path),
  };
}

onMounted(() => window.addEventListener(NOTE_FILE_DRAG_EVENT, handleFileDragGhost));
onUnmounted(() => window.removeEventListener(NOTE_FILE_DRAG_EVENT, handleFileDragGhost));
type WorkspaceLeafApi = {
  wrapSelection: (before: string, after: string) => void;
  insertText: (text: string) => void;
  prependToLine: (text: string) => void;
  focusEditor: () => void;
  getSelection: () => string;
  replaceSelection: (text: string) => void;
  selectAll: () => void;
};
const leafRefs = new Map<string, WorkspaceLeafApi>();

watch(
  () => props.initialState,
  (next) => {
    if (next && next !== state.value) state.value = next;
  },
);

function handleActivateLeaf(leafId: string) {
  state.value = { ...state.value, activeLeafId: leafId };
  emit('state-change', state.value);
}

function handleActivateTab(leafId: string, tabId: string) {
  state.value = activateTab(state.value, leafId, tabId);
  emit('state-change', state.value);
  const leaf = findLeafInTree(state.value.root, leafId);
  const tab = leaf?.tabs.find((item) => item.id === tabId);
  if (tab) emit('open-path', tab.path, leafId);
}

function handleCloseTab(leafId: string, tabId: string) {
  state.value = closeTab(state.value, leafId, tabId);
  emit('state-change', state.value);
}

function handleCloseLeaf(leafId: string) {
  state.value = closeLeaf(state.value, leafId);
  emit('state-change', state.value);
}

function handleSplitLeaf(leafId: string, direction: WorkspaceDirection) {
  state.value = splitLeaf(state.value, leafId, direction);
  emit('state-change', state.value);
}

function handleOpenPath(path: string, leafId = state.value.activeLeafId) {
  state.value = openTab(state.value, leafId, path);
  emit('state-change', state.value);
  const active = findLeafInTree(state.value.root, state.value.activeLeafId);
  const tab = active?.tabs.find((item) => item.path === path);
  if (tab) emit('open-path', tab.path, active.id);
}

function handleUpdateContent(path: string, content: string) {
  emit('update-content', path, content);
}

function handleSavePath(path: string) {
  emit('save-path', path);
}

function handleDragStart(leafId: string, tabId: string) {
  draggingLeafId.value = leafId;
  draggingTabId.value = tabId;
}

function handleDragEnd() {
  draggingLeafId.value = null;
  draggingTabId.value = null;
  dropTarget.value = null;
}

function handleDragOver(leafId: string, zone: WorkspaceDropZone | null) {
  dropTarget.value = zone ? { leafId, zone } : null;
}

function handleDropEdge(leafId: string, zone: WorkspaceDropZone) {
  if (!draggingLeafId.value || !draggingTabId.value) {
    handleDragEnd();
    return;
  }

  state.value = splitLeafWithTab(
    state.value,
    leafId,
    draggingLeafId.value,
    draggingTabId.value,
    zone,
  );
  emit('state-change', state.value);
  handleDragEnd();
}

function handleDropTab(leafId: string, tabId: string, targetIndex: number) {
  if (draggingLeafId.value && draggingTabId.value) {
    state.value = moveTab(
      state.value,
      draggingLeafId.value,
      leafId,
      draggingTabId.value,
      targetIndex,
    );
    emit('state-change', state.value);
  }
  handleDragEnd();
}

function findLeafWithPath(node: NoteWorkspaceState['root'], path: string): WorkspaceLeaf | null {
  if (node.type === 'leaf') {
    return node.tabs.some((tab) => tab.path === path) ? node : null;
  }
  for (const child of node.children) {
    const leaf = findLeafWithPath(child, path);
    if (leaf) return leaf;
  }
  return null;
}

function handleFileDrop(leafId: string, path: string) {
  const existingLeaf = findLeafWithPath(state.value.root, path);
  let nextState = openTab(state.value, leafId, path);
  if (!existingLeaf) {
    nextState = { ...nextState, activeLeafId: leafId };
  }

  state.value = nextState;
  emit('state-change', state.value);

  const activeLeaf = findLeafInTree(state.value.root, state.value.activeLeafId);
  const tab = activeLeaf.tabs.find((item) => item.path === path);
  if (tab) emit('open-path', tab.path, activeLeaf.id);
}

function handleResizeSplit(splitId: string, dividerIndex: number, position: number) {
  state.value = resizeSplit(state.value, splitId, dividerIndex, position);
  emit('state-change', state.value);
}

function handleCreateNote(leafId: string) {
  handleActivateLeaf(leafId);
  emit('create-note', leafId);
}

function setLeafRef(leafId: string, instance: unknown) {
  if (instance) leafRefs.set(leafId, instance as WorkspaceLeafApi);
  else leafRefs.delete(leafId);
}

function findLeafInTree(node: NoteWorkspaceState['root'], leafId: string): WorkspaceLeaf {
  if (node.type === 'leaf') return node;
  for (const child of node.children) {
    const leaf = findLeafInTree(child, leafId);
    if (leaf.id === leafId) return leaf;
  }
  return node.children[0].type === 'leaf'
    ? node.children[0]
    : findLeafInTree(node.children[0], leafId);
}

function findTabInTree(node: NoteWorkspaceState['root'], tabId: string): { path: string } | null {
  if (node.type === 'leaf') return node.tabs.find((tab) => tab.id === tabId) ?? null;
  for (const child of node.children) {
    const tab = findTabInTree(child, tabId);
    if (tab) return tab;
  }
  return null;
}

defineExpose({
  openPath: (path: string, leafId = state.value.activeLeafId) => {
    state.value = openTab(state.value, leafId, path);
    emit('state-change', state.value);
  },
  setState: (next: NoteWorkspaceState) => {
    state.value = next;
    emit('state-change', state.value);
  },
  splitActiveLeaf: (direction: WorkspaceDirection) => {
    state.value = splitLeaf(state.value, state.value.activeLeafId, direction);
    emit('state-change', state.value);
  },
  closeActiveLeaf: () => {
    state.value = closeLeaf(state.value, state.value.activeLeafId);
    emit('state-change', state.value);
  },
  insertText: (text: string) => leafRefs.get(state.value.activeLeafId)?.insertText(text),
  wrapSelection: (before: string, after: string) =>
    leafRefs.get(state.value.activeLeafId)?.wrapSelection(before, after),
  prependToLine: (text: string) => leafRefs.get(state.value.activeLeafId)?.prependToLine(text),
  focusActiveEditor: () => leafRefs.get(state.value.activeLeafId)?.focusEditor(),
  getSelection: () => leafRefs.get(state.value.activeLeafId)?.getSelection() ?? '',
  replaceSelection: (text: string) =>
    leafRefs.get(state.value.activeLeafId)?.replaceSelection(text),
  selectAll: () => leafRefs.get(state.value.activeLeafId)?.selectAll(),
});
</script>

<template>
  <div class="note-workspace-board">
    <div
      v-if="fileDragGhost"
      class="note-workspace-file-drag-ghost"
      :style="{ left: `${fileDragGhost.left}px`, top: `${fileDragGhost.top}px` }"
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24">
        <path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4" />
      </svg>
      <span>{{ fileDragGhost.label }}</span>
    </div>
    <WorkspaceRenderer
      :node="state.root"
      :active-leaf-id="state.activeLeafId"
      @activate-leaf="handleActivateLeaf"
      @resize-split="handleResizeSplit"
    >
      <template #leaf="{ leaf }">
        <WorkspaceLeafView
          :ref="(instance) => setLeafRef(leaf.id, instance)"
          :leaf="leaf"
          :documents="documents"
          :dragging-tab-id="draggingTabId"
          :dragging-tab-label="draggingTabLabel"
          :drop-zone="dropTarget?.leafId === leaf.id ? dropTarget.zone : null"
          @activate-tab="handleActivateTab"
          @close-tab="handleCloseTab"
          @close-leaf="handleCloseLeaf"
          @split-leaf="handleSplitLeaf"
          @update-content="handleUpdateContent"
          @save-path="handleSavePath"
          @rename-path="(path, title) => emit('rename-path', path, title)"
          @drag-start="handleDragStart"
          @drag-end="handleDragEnd"
          @drag-over="handleDragOver"
          @drop-edge="handleDropEdge"
          @drop-tab="handleDropTab"
          @file-drop="(path) => handleFileDrop(leaf.id, path)"
          @create-note="handleCreateNote"
          @open-workspace="emit('open-workspace')"
          @open-menu="emit('open-menu', $event)"
          @open-context-menu="emit('open-context-menu', $event)"
        >
          <template #leaf-tools="{ leaf }">
            <slot name="leaf-tools" :leaf="leaf" />
          </template>
        </WorkspaceLeafView>
      </template>
    </WorkspaceRenderer>
  </div>
</template>

<style scoped>
.note-workspace-board {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.note-workspace-file-drag-ghost {
  position: fixed;
  z-index: 80;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: min(320px, calc(100vw - 32px));
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
}

.note-workspace-file-drag-ghost::before {
  width: 3px;
  align-self: stretch;
  margin: -7px 1px -7px -10px;
  border-radius: 3px 0 0 3px;
  background: var(--accent);
  content: '';
}

.note-workspace-file-drag-ghost svg {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.note-workspace-file-drag-ghost span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
