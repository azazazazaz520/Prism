<script setup lang="ts">
/**
 * 笔记文件树面板（展示组件）。
 *
 * 仅负责文件树的展示与交互事件转发，所有业务逻辑（打开、创建、重命名、
 * 删除、工作区切换）由父组件 NoteEditor 持有并通过事件驱动。
 */
import { computed } from 'vue';
import type { FileEntry, FileTreeContextTarget } from '../../types';
import { compactFileTree } from '../../utils/note-tree';
import { filterFileTree, normalizeWorkspacePath } from '../../utils/note-editor';
import TreeNode from './TreeNode.vue';

const props = defineProps<{
  tree: FileEntry[];
  expanded: Set<string>;
  selectedPath: string | null;
  search: string;
  notesDir: string;
  recentWorkspaces: string[];
  workspaceMenuOpen: boolean;
}>();

const emit = defineEmits<{
  'update:search': [value: string];
  'toggle-expand': [dirPath: string];
  'collapse-all': [];
  'new-note': [];
  'new-folder': [];
  select: [path: string];
  'create-file': [parentDir: string];
  'create-folder': [parentDir: string];
  rename: [path: string, isDir: boolean];
  delete: [path: string];
  'context-menu': [event: MouseEvent, target: FileTreeContextTarget];
  'toggle-workspace-menu': [];
  'switch-workspace': [path: string];
  'open-workspace': [];
  'remove-workspace': [path: string];
  'toggle-sidebar': [];
}>();

/** 文件树展示数据，保留 tree 中的真实路径用于文件操作 */
const displayTree = computed(() => compactFileTree(props.tree));

const filteredDisplayTree = computed(() => filterFileTree(displayTree.value, props.search));

const notesDirShort = computed(() => {
  const dir = props.notesDir;
  if (!dir) return '';
  const parts = dir.replace(/\\/g, '/').split('/');
  if (parts.length <= 2) return dir;
  return '...' + '/' + parts.slice(-2).join('/');
});

function isActiveWorkspace(path: string): boolean {
  return normalizeWorkspacePath(path) === normalizeWorkspacePath(props.notesDir);
}
</script>

<template>
  <aside class="file-tree" @contextmenu.stop.prevent>
    <div class="tree-header">
      <div class="tree-header-actions">
        <button
          class="tree-header-btn"
          title="新建笔记"
          aria-label="新建笔记"
          @click="emit('new-note')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          class="tree-header-btn"
          title="新建文件夹"
          aria-label="新建文件夹"
          @click="emit('new-folder')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M12 10v6M9 13h6" />
          </svg>
        </button>
        <button
          class="tree-header-btn"
          title="全部折叠"
          aria-label="全部折叠"
          @click="emit('collapse-all')"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M7 3l6 6 6-6M7 13l6 6 6-6" />
          </svg>
        </button>
        <button
          class="tree-header-btn"
          title="收起文件树"
          aria-label="收起文件树"
          @click="emit('toggle-sidebar')"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M17 4l-8 8 8 8" />
          </svg>
        </button>
      </div>
    </div>
    <div class="tree-search">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </svg>
      <input
        :value="search"
        type="search"
        placeholder="过滤文件树"
        aria-label="过滤文件树"
        @input="emit('update:search', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <div class="tree-list">
      <TreeNode
        v-for="entry in filteredDisplayTree"
        :key="entry.path"
        :entry="entry"
        :expanded="expanded"
        :selected-path="selectedPath"
        :depth="0"
        @toggle-expand="emit('toggle-expand', $event)"
        @select="emit('select', $event)"
        @create-file="emit('create-file', $event)"
        @create-folder="emit('create-folder', $event)"
        @context-menu="(event, target) => emit('context-menu', event, target)"
        @rename="(path, isDir) => emit('rename', path, isDir)"
        @delete="emit('delete', $event)"
      />
    </div>

    <!-- 笔记目录设置 -->
    <div class="tree-footer" @click.stop>
      <button class="dir-info" :title="notesDir" @click="emit('toggle-workspace-menu')">
        <span class="dir-label">目录:</span>
        <span class="dir-path">{{ notesDirShort }}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 10 5 5 5-5" />
        </svg>
      </button>
      <div v-if="workspaceMenuOpen" class="workspace-menu" role="menu">
        <div v-for="workspace in recentWorkspaces" :key="workspace" class="workspace-menu-entry">
          <button
            type="button"
            class="workspace-menu-item"
            :class="{ active: isActiveWorkspace(workspace) }"
            role="menuitem"
            @click="emit('switch-workspace', workspace)"
          >
            <span class="workspace-menu-name">{{ workspace.split(/[\\/]/).pop() }}</span>
            <span class="workspace-menu-path">{{ workspace }}</span>
            <span v-if="isActiveWorkspace(workspace)" class="workspace-menu-check">✓</span>
          </button>
          <button
            type="button"
            class="workspace-menu-remove"
            title="从工作区列表移除"
            aria-label="从工作区列表移除"
            @click="emit('remove-workspace', workspace)"
          >
            ×
          </button>
        </div>
        <div class="workspace-menu-divider" />
        <button
          type="button"
          class="workspace-menu-item workspace-menu-open"
          role="menuitem"
          @click="emit('open-workspace')"
        >
          <span class="workspace-menu-name">打开笔记工作区…</span>
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* ═══ 文件树 ═══ */

.file-tree {
  flex-shrink: 0;
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-secondary);
  transition: width 0.15s ease;
}

.file-tree.collapsed {
  width: 0 !important;
  border-right: none;
  overflow: hidden;
}

/* ═══ 文件树头部 ═══ */

.tree-header {
  padding: var(--space-md) var(--space-md) var(--space-sm);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tree-title {
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--text-primary);
  letter-spacing: 0.01em;
}

.tree-header-actions {
  display: flex;
  gap: 2px;
}

.tree-header-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color var(--transition-fast) var(--easing-standard),
    color var(--transition-fast) var(--easing-standard);
}

.tree-header-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tree-header-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tree-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 var(--space-md) var(--space-sm);
  padding: 6px 8px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-muted);
}

.tree-search:focus-within {
  border-color: var(--accent-muted);
  box-shadow: 0 0 0 2px var(--accent-light);
}

.tree-search svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
}

.tree-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-xs);
}

.tree-search input::placeholder {
  color: var(--text-muted);
}

.tree-search kbd {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 10px;
}

/* ═══ 文件树列表 ═══ */

.tree-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 var(--space-xs) var(--space-md);
}

/* ═══ 文件树底部 ═══ */

.tree-footer {
  position: relative;
  border-top: 1px solid var(--border-light);
  padding: var(--space-sm) var(--space-md);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-shrink: 0;
}

.dir-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs);
  color: var(--text-muted);
  overflow: hidden;
  min-width: 0;
  border: 0;
  padding: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.dir-info:hover {
  color: var(--text-primary);
}

.dir-info svg {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.workspace-menu {
  position: absolute;
  left: var(--space-sm);
  bottom: calc(100% - 2px);
  width: min(340px, calc(100% - var(--space-md)));
  padding: 6px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  box-shadow: var(--shadow-md);
  z-index: 30;
}

.workspace-menu-item {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 28px 8px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.workspace-menu-entry {
  display: flex;
  align-items: stretch;
}

.workspace-menu-remove {
  width: 28px;
  flex: 0 0 28px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  opacity: 0;
}

.workspace-menu-entry:hover .workspace-menu-remove,
.workspace-menu-remove:focus-visible {
  opacity: 1;
}

.workspace-menu-remove:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.workspace-menu-item:hover,
.workspace-menu-item.active {
  background: var(--bg-hover);
}

.workspace-menu-name {
  font-size: var(--text-sm);
}

.workspace-menu-path {
  max-width: 100%;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-menu-check {
  position: absolute;
  top: 10px;
  right: 10px;
  color: var(--accent);
}

.workspace-menu-divider {
  height: 1px;
  margin: 5px 2px;
  background: var(--border-light);
}

.workspace-menu-open .workspace-menu-name {
  color: var(--accent);
}

.dir-label {
  flex-shrink: 0;
}

.dir-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dir-change-btn {
  background: none;
  border: 1px solid var(--border-light);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  cursor: pointer;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
  white-space: nowrap;
  transition:
    background-color var(--transition-fast) var(--easing-standard),
    color var(--transition-fast) var(--easing-standard);
}

.dir-change-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* ═══ 笔记工作区正式布局覆盖 ═══ */

.file-tree {
  background: var(--bg-secondary);
}

.tree-header {
  min-height: 64px;
  padding: 0 16px;
}

.tree-title {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.tree-search {
  margin: 0 14px 14px;
  min-height: 38px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
}

.tree-list {
  padding: 0 10px 12px;
}

/* 顶层标签栏不再横跨文件栏；编辑区内的副本承担实际显示。 */
.tree-title {
  display: none;
}

.tree-header {
  min-height: 42px;
  padding: 0 14px;
  justify-content: flex-end;
}

.tree-header-actions {
  gap: 6px;
}

.tree-header-btn {
  width: 28px;
  height: 28px;
  padding: 0;
}

/* ═══ HUD 主题适配 ═══ */

[data-theme='hud'] .file-tree {
  background: var(--bg-tertiary);
  border-color: var(--border-subtle);
}

[data-theme='hud'] .tree-title {
  font-family: var(--font-heading);
  letter-spacing: 2px;
  text-transform: uppercase;
}

/* ═══ 减少动画 ═══ */

@media (prefers-reduced-motion: reduce) {
  .file-tree {
    transition: none;
  }
}
</style>
