<script setup lang="ts">
import { onUnmounted } from 'vue';
import type { WorkspaceLeaf, WorkspaceNode, WorkspaceSplit } from '../../domain/note-workspace';

defineOptions({ name: 'WorkspaceRenderer' });

defineProps<{
  node: WorkspaceNode;
  activeLeafId: string;
}>();

const emit = defineEmits<{
  'activate-leaf': [leafId: string];
  'resize-split': [splitId: string, dividerIndex: number, position: number];
}>();

defineSlots<{
  leaf(props: { leaf: WorkspaceLeaf }): unknown;
}>();

function splitStyle(split: WorkspaceSplit, index: number) {
  const size = split.sizes[index] ?? 1 / split.children.length;
  return split.direction === 'horizontal'
    ? { width: `${size * 100}%` }
    : { height: `${size * 100}%` };
}

function resizerStyle(split: WorkspaceSplit, index: number) {
  const position = split.sizes.slice(0, index + 1).reduce((sum, size) => sum + size, 0) * 100;
  return split.direction === 'horizontal' ? { left: `${position}%` } : { top: `${position}%` };
}

function leafKey(leaf: WorkspaceLeaf) {
  return `workspace-leaf-${leaf.id}`;
}

let resizeState: {
  splitId: string;
  dividerIndex: number;
  direction: WorkspaceSplit['direction'];
  rect: DOMRect;
  pointerId: number;
} | null = null;

function startResize(event: PointerEvent, split: WorkspaceSplit, dividerIndex: number) {
  if (event.button !== 0) return;
  const target = event.currentTarget as HTMLElement;
  const rect = target.parentElement?.getBoundingClientRect();
  if (!rect) return;

  resizeState = {
    splitId: split.id,
    dividerIndex,
    direction: split.direction,
    rect,
    pointerId: event.pointerId,
  };
  target.setPointerCapture?.(event.pointerId);
  document.body.classList.add('workspace-resizing');
  window.addEventListener('pointermove', handleResizeMove);
  window.addEventListener('pointerup', finishResize);
  window.addEventListener('pointercancel', finishResize);
  event.preventDefault();
}

function handleResizeMove(event: PointerEvent) {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return;
  const { rect, direction } = resizeState;
  const position =
    direction === 'horizontal'
      ? (event.clientX - rect.left) / rect.width
      : (event.clientY - rect.top) / rect.height;
  emit('resize-split', resizeState.splitId, resizeState.dividerIndex, position);
  event.preventDefault();
}

function finishResize(event: PointerEvent) {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return;
  resizeState = null;
  document.body.classList.remove('workspace-resizing');
  window.removeEventListener('pointermove', handleResizeMove);
  window.removeEventListener('pointerup', finishResize);
  window.removeEventListener('pointercancel', finishResize);
}

function relayResize(splitId: string, dividerIndex: number, position: number) {
  emit('resize-split', splitId, dividerIndex, position);
}

onUnmounted(() => {
  if (!resizeState) return;
  resizeState = null;
  document.body.classList.remove('workspace-resizing');
  window.removeEventListener('pointermove', handleResizeMove);
  window.removeEventListener('pointerup', finishResize);
  window.removeEventListener('pointercancel', finishResize);
});
</script>

<template>
  <div
    v-if="node.type === 'split'"
    class="workspace-renderer workspace-renderer-split"
    :class="`workspace-renderer-${node.direction}`"
  >
    <template v-for="(child, index) in node.children" :key="child.id">
      <div class="workspace-renderer-child" :style="splitStyle(node, index)">
        <WorkspaceRenderer
          :node="child"
          :active-leaf-id="activeLeafId"
          @activate-leaf="emit('activate-leaf', $event)"
          @resize-split="relayResize"
        >
          <template #leaf="slotProps">
            <slot name="leaf" :leaf="slotProps.leaf" />
          </template>
        </WorkspaceRenderer>
      </div>
      <div
        v-if="index < node.children.length - 1"
        class="workspace-split-resizer"
        :class="`workspace-split-resizer-${node.direction}`"
        :style="resizerStyle(node, index)"
        role="separator"
        :aria-orientation="node.direction === 'horizontal' ? 'vertical' : 'horizontal'"
        :aria-label="node.direction === 'horizontal' ? '调整左右分栏宽度' : '调整上下分栏高度'"
        @pointerdown.stop="startResize($event, node, index)"
      />
    </template>
  </div>
  <div
    v-else
    :key="leafKey(node)"
    class="workspace-renderer workspace-renderer-leaf"
    :class="{ 'is-active': node.id === activeLeafId }"
    @pointerdown="emit('activate-leaf', node.id)"
  >
    <slot name="leaf" :leaf="node" />
  </div>
</template>

<style scoped>
.workspace-renderer {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.workspace-renderer-split {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
}

.workspace-renderer-horizontal {
  flex-direction: row;
}

.workspace-renderer-vertical {
  flex-direction: column;
}

.workspace-renderer-child {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  flex: 0 0 auto;
}

.workspace-split-resizer {
  position: absolute;
  z-index: 2;
  pointer-events: auto;
  touch-action: none;
  user-select: none;
  background: var(--border-subtle);
  transition: background-color 140ms ease;
}

.workspace-split-resizer::after {
  content: '';
  position: absolute;
  inset: 0;
  background: transparent;
  transition:
    background-color 140ms ease,
    box-shadow 140ms ease;
}

.workspace-split-resizer:hover::after,
.workspace-split-resizer:focus-visible::after {
  background: color-mix(in srgb, var(--accent) 42%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent);
}

.workspace-split-resizer-horizontal {
  top: 0;
  width: 5px;
  height: 100%;
  transform: translateX(-50%);
  cursor: col-resize;
}

.workspace-split-resizer-vertical {
  left: 0;
  width: 100%;
  height: 5px;
  transform: translateY(-50%);
  cursor: row-resize;
}

:global(body.workspace-resizing),
:global(body.workspace-resizing *) {
  user-select: none;
}

:global(body.workspace-resizing .workspace-split-resizer-horizontal),
:global(body.workspace-resizing .workspace-split-resizer-horizontal *) {
  cursor: col-resize;
}

:global(body.workspace-resizing .workspace-split-resizer-vertical),
:global(body.workspace-resizing .workspace-split-resizer-vertical *) {
  cursor: row-resize;
}

.workspace-renderer-leaf {
  width: 100%;
  height: 100%;
}
</style>
