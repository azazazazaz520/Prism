<script setup lang="ts">
import type { FileEntry } from '../types';

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
  rename: [path: string, isDir: boolean];
  delete: [path: string];
}>();

function getIcon(isDir: boolean) {
  return isDir
    ? 'M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z'
    : 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6';
}

defineOptions({ name: 'TreeNode' });
</script>

<template>
  <!-- 目录节点 -->
  <template v-if="entry.isDir">
    <div
      class="tree-row tree-row-dir"
      :style="{ paddingLeft: (depth || 0) * 16 + 'px' }"
      @click="emit('toggle-expand', entry.path)"
    >
      <svg
        class="tree-chevron"
        :class="{ open: expanded.has(entry.path) }"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
      <svg
        class="tree-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path :d="getIcon(true)" />
      </svg>
      <span class="tree-name">{{ entry.name }}</span>
      <button class="tree-add-btn" title="新建文件" @click.stop="emit('create-file', entry.path)">
        +
      </button>
      <div class="tree-node-actions">
        <button class="node-btn" title="重命名" @click.stop="emit('rename', entry.path, true)">
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

    <!-- 子节点（递归） -->
    <div
      v-if="expanded.has(entry.path) && entry.children"
      class="tree-children"
      :style="{ marginLeft: (depth || 0) * 16 + 'px' }"
    >
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
        @rename="(p: string, d: boolean) => emit('rename', p, d)"
        @delete="(p: string) => emit('delete', p)"
      />
    </div>
  </template>

  <!-- 文件节点 -->
  <div
    v-else
    :class="['tree-row', 'tree-row-file', { active: selectedPath === entry.path }]"
    :style="{ paddingLeft: (depth || 0) * 16 + 28 + 'px' }"
    @click="emit('select', entry.path)"
  >
    <svg
      class="tree-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path :d="getIcon(false)" />
    </svg>
    <span class="tree-name">{{ entry.name }}</span>
    <div class="tree-node-actions">
      <button class="node-btn" title="重命名" @click.stop="emit('rename', entry.path, false)">
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
.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 var(--space-sm);
  border-radius: var(--radius-full);
  cursor: pointer;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  transition: all var(--transition-fast);
}

.tree-row-dir {
  min-height: 40px;
}

.tree-row-file {
  min-height: 30px;
}

.tree-row:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  transform: translateX(2px);
}

.tree-row.active {
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 500;
}

.tree-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  stroke-width: 1.5;
}

.tree-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

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

.tree-add-btn {
  display: none;
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
  transition: all var(--transition-fast);
}

.tree-row:hover .tree-add-btn {
  display: block;
}

.tree-add-btn:hover {
  background: var(--bg-hover);
  color: var(--accent);
}

.tree-children {
  border-left: 1px solid var(--border-subtle);
}

.tree-node-actions {
  display: none;
  gap: 2px;
}

.tree-row:hover .tree-node-actions {
  display: flex;
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

[data-theme='hud'] .tree-row:hover,
[data-theme='hud'] .tree-row:hover {
  background: var(--bg-panel-hover);
}

[data-theme='hud'] .tree-row.active,
[data-theme='hud'] .tree-row.active {
  background: var(--accent-glow);
  color: var(--accent);
}

[data-theme='hud'] .tree-children,
[data-theme='hud'] .tree-children {
  border-left-color: var(--border-subtle);
}

[data-theme='hud'] .node-btn:hover,
[data-theme='hud'] .node-btn:hover {
  background: var(--bg-panel-hover);
}
</style>
