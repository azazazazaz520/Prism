<script setup lang="ts">
/**
 * 文件树节点组件。
 *
 * 递归渲染目录和文件节点，支持展开/折叠、选中、键盘导航和无障碍属性。
 * 采用统一 paddingLeft 缩进（12 + depth * 14），操作按钮通过透明度切换
 * 避免布局跳动。
 */
import type { FileEntry, FileTreeContextTarget } from '../types';

defineProps<{
  entry: FileEntry;
  expanded: Set<string>;
  selectedPath: string | null;
  depth?: number;
}>();

const emit = defineEmits<{
  'toggle-expand': [path: string];
  select: [path: string];
  'create-file': [parentDir: string];
  'create-folder': [parentDir: string];
  'context-menu': [event: MouseEvent, target: FileTreeContextTarget];
  rename: [path: string, isDir: boolean];
  delete: [path: string];
}>();

/** 展开箭头 SVG path（向右三角 → 向下三角） */
const CHEVRON_PATH = 'M6 9l6 6 6-6';

/** 文件夹图标 SVG path */
const FOLDER_ICON = 'M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z';

/** 文件图标 SVG path */
const FILE_ICON = 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6';

/** 每级缩进像素 */
const INDENT_PER_LEVEL = 14;
/** 根级基础左内边距 */
const BASE_PADDING = 12;

defineOptions({ name: 'TreeNode' });
</script>

<template>
  <!-- ═══ 目录节点 ═══ -->
  <template v-if="entry.isDir">
    <div
      class="tree-row tree-row-dir"
      role="treeitem"
      :aria-expanded="expanded.has(entry.path)"
      :aria-label="entry.displayName ?? entry.name"
      :tabindex="0"
      :style="{ paddingLeft: `${BASE_PADDING + (depth || 0) * INDENT_PER_LEVEL}px` }"
      @click="emit('toggle-expand', entry.path)"
      @contextmenu.prevent.stop="
        emit('context-menu', $event, { name: entry.name, path: entry.path, kind: 'directory' })
      "
      @keydown.enter.prevent="emit('toggle-expand', entry.path)"
      @keydown.space.prevent="emit('toggle-expand', entry.path)"
    >
      <!-- 展开/折叠箭头，始终占位避免文本跳动 -->
      <svg
        class="tree-chevron"
        :class="{ open: expanded.has(entry.path) }"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path :d="CHEVRON_PATH" />
      </svg>
      <!-- 文件夹图标 -->
      <svg
        class="tree-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path :d="FOLDER_ICON" />
      </svg>
      <!-- 名称（超长省略号 + title 显示完整路径） -->
      <span class="tree-name" :title="entry.displayPath ?? entry.path">
        <template
          v-for="(segment, index) in entry.segments ?? [{ name: entry.name, path: entry.path }]"
          :key="segment.path"
        >
          <span v-if="index > 0" class="tree-segment-separator" aria-hidden="true">\\</span>
          <span
            class="tree-segment"
            :title="segment.path"
            @contextmenu.stop.prevent="
              emit('context-menu', $event, {
                name: segment.name,
                path: segment.path,
                kind: 'directory',
              })
            "
          >
            {{ segment.name }}
          </span>
        </template>
      </span>
      <!-- 快捷新建按钮 -->
      <button
        class="tree-add-btn"
        :title="`在 ${entry.name} 中新建文件`"
        :aria-label="`在 ${entry.name} 中新建文件`"
        @click.stop="emit('create-file', entry.createPath ?? entry.path)"
      >
        +
      </button>
      <!-- 操作按钮（透明度切换，始终占位） -->
      <div class="tree-node-actions">
        <button
          class="node-btn"
          title="重命名"
          aria-label="重命名"
          @click.stop="emit('rename', entry.path, true)"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path
              d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
            />
          </svg>
        </button>
        <button
          class="node-btn node-btn-danger"
          title="删除"
          aria-label="删除"
          @click.stop="emit('delete', entry.path)"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path
              d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
            />
          </svg>
        </button>
      </div>
    </div>

    <!-- 子节点（递归），移除横向偏移，仅保留层级辅助线 -->
    <div v-if="expanded.has(entry.path) && entry.children" class="tree-children" role="group">
      <TreeNode
        v-for="child in entry.children"
        :key="child.path"
        :entry="child"
        :expanded="expanded"
        :selected-path="selectedPath"
        :depth="(depth || 0) + 1"
        @toggle-expand="(p: string) => emit('toggle-expand', p)"
        @select="(p: string) => emit('select', p)"
        @create-file="(p: string) => emit('create-file', p)"
        @create-folder="(p: string) => emit('create-folder', p)"
        @context-menu="
          (event: MouseEvent, target: FileTreeContextTarget) => emit('context-menu', event, target)
        "
        @rename="(p: string, d: boolean) => emit('rename', p, d)"
        @delete="(p: string) => emit('delete', p)"
      />
    </div>
  </template>

  <!-- ═══ 文件节点 ═══ -->
  <div
    v-else
    role="treeitem"
    :aria-selected="selectedPath === entry.path"
    :aria-label="entry.displayName ?? entry.name"
    :tabindex="0"
    :class="['tree-row', 'tree-row-file', { active: selectedPath === entry.path }]"
    :style="{ paddingLeft: `${BASE_PADDING + (depth || 0) * INDENT_PER_LEVEL + 14 + 4}px` }"
    @click="emit('select', entry.path)"
    @contextmenu.prevent.stop="
      emit('context-menu', $event, { name: entry.name, path: entry.path, kind: 'file' })
    "
    @keydown.enter.prevent="emit('select', entry.path)"
    @keydown.space.prevent="emit('select', entry.path)"
  >
    <svg
      class="tree-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path :d="FILE_ICON" />
    </svg>
    <span class="tree-name" :title="entry.displayPath ?? entry.path">
      {{ entry.displayName ?? entry.name }}
    </span>
    <div class="tree-node-actions">
      <button
        class="node-btn"
        title="重命名"
        aria-label="重命名"
        @click.stop="emit('rename', entry.path, false)"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <path
            d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
          />
        </svg>
      </button>
      <button
        class="node-btn node-btn-danger"
        title="删除"
        aria-label="删除"
        @click.stop="emit('delete', entry.path)"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <path
            d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
          />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ═══ 行基础 ═══ */

.tree-row {
  display: flex;
  position: relative;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  border-radius: var(--radius-full);
  cursor: pointer;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  transition: background-color var(--transition-fast);
  /* 防止 flex 子项撑破布局 */
  min-width: 0;
}

.tree-row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

/* ═══ 紧凑行高 ═══ */

.tree-row-dir {
  min-height: 28px;
}

.tree-row-file {
  min-height: 26px;
}

.tree-row:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tree-row.active {
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 500;
}

/* ═══ 图标（14px 紧凑尺寸） ═══ */

.tree-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  stroke-width: 1.5;
}

/* ═══ 文件名（省略号 + min-width 防溢出） ═══ */

.tree-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-segment {
  border-bottom: 1px solid transparent;
  transition:
    color var(--transition-fast),
    border-color var(--transition-fast),
    background-color var(--transition-fast);
}

.tree-segment:hover,
.tree-segment:focus-visible {
  border-bottom-color: currentColor;
  color: var(--accent);
  outline: none;
}

.tree-segment-separator {
  color: var(--text-muted);
  white-space: pre;
}

/* ═══ 展开箭头（固定占位，14px） ═══ */

.tree-chevron {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  transition: transform 0.15s;
  transform: rotate(-90deg);
}

.tree-chevron.open {
  transform: rotate(0deg);
}

/* ═══ 快捷新建按钮 ═══ */

.tree-add-btn {
  position: absolute;
  right: 48px;
  opacity: 0;
  pointer-events: none;
  background: none;
  border: none;
  font-size: 16px;
  font-weight: 400;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0 4px;
  border-radius: var(--radius-sm);
  line-height: 1;
  flex-shrink: 0;
  transition: opacity var(--transition-fast);
}

.tree-row:hover .tree-add-btn,
.tree-row:focus-within .tree-add-btn {
  opacity: 1;
  pointer-events: auto;
}

.tree-add-btn:hover {
  background: var(--bg-hover);
  color: var(--accent);
}

/* ═══ 子节点容器（仅辅助线，无横向偏移） ═══ */

.tree-children {
  border-left: 1px solid var(--border-subtle);
}

/* ═══ 操作按钮（透明度切换，不改变布局） ═══ */

.tree-node-actions {
  display: flex;
  position: absolute;
  right: 4px;
  padding-left: 4px;
  background: var(--bg-secondary);
  gap: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--transition-fast);
  flex-shrink: 0;
}

.tree-row:hover .tree-node-actions,
.tree-row:focus-within .tree-node-actions {
  opacity: 1;
  pointer-events: auto;
}

.node-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 3px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  transition: all var(--transition-fast);
}

.node-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.node-btn-danger:hover {
  color: #e74c3c;
}

/* ═══ 减少动画 ═══ */

@media (prefers-reduced-motion: reduce) {
  .tree-row,
  .tree-add-btn,
  .tree-node-actions,
  .tree-chevron {
    transition: none;
  }
}

/* ═══ HUD 主题 ═══ */

[data-theme='hud'] .tree-row:hover {
  background: var(--bg-panel-hover);
}

[data-theme='hud'] .tree-row.active {
  background: var(--accent-glow);
  color: var(--accent);
}

[data-theme='hud'] .tree-children {
  border-left-color: var(--border-subtle);
}

[data-theme='hud'] .node-btn:hover {
  background: var(--bg-panel-hover);
}
</style>
