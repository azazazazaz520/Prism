<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { marked } from 'marked';
import type { FileEntry } from '../types';
import InputDialog from './InputDialog.vue';

// ── 状态 ──────────────────────────────

const tree = ref<FileEntry[]>([]);
const selectedPath = ref<string | null>(null);
const content = ref('');
const viewMode = ref<'edit' | 'split' | 'preview'>('split');
const saving = ref(false);

/** 文件树中展开的文件夹路径集合 */
const expanded = ref<Set<string>>(new Set(['inbox']));

/** 当前选中文件的名称 */
const selectedName = computed(() => {
  if (!selectedPath.value) return '';
  return selectedPath.value.split('/').pop() || '';
});

/** 渲染后的 Markdown HTML */
const renderedHtml = computed(() => {
  if (!content.value) return '';
  return marked.parse(content.value) as string;
});

// ── 自定义对话框状态 ──────────────────────────────

const dialogVisible = ref(false);
const dialogTitle = ref('');
const dialogLabel = ref('');
const dialogPlaceholder = ref('');
const dialogDefault = ref('');
let dialogCallback: ((value: string | null) => void) | null = null;

// ── 加载 ──────────────────────────────

async function loadTree() {
  try {
    tree.value = await invoke<FileEntry[]>('list_note_tree');
  } catch (e) {
    console.error('加载文件树失败:', e);
  }
}

async function openFile(path: string) {
  try {
    content.value = await invoke<string>('read_note', { path });
    selectedPath.value = path;
  } catch (e) {
    console.error('读取文件失败:', e);
  }
}

// ── 自动保存（500ms 防抖） ──────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;

watch(content, (val) => {
  if (!selectedPath.value) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saving.value = true;
    try {
      await invoke('write_note', { path: selectedPath.value, content: val });
    } catch (e) {
      console.error('保存失败:', e);
    } finally {
      saving.value = false;
    }
  }, 500);
});

// initially load tree
loadTree();

// ── 自定义对话框 ──────────────────────────────

/**
 * 显示输入对话框，替代原生 prompt()
 * @param title 对话框标题
 * @param label 输入框标签
 * @param placeholder 占位符文本
 * @param defaultValue 默认值
 * @returns Promise<string | null>
 */
function showDialog(
  title: string,
  label: string,
  placeholder?: string,
  defaultValue?: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    dialogTitle.value = title;
    dialogLabel.value = label;
    dialogPlaceholder.value = placeholder || '';
    dialogDefault.value = defaultValue || '';
    dialogCallback = resolve;
    dialogVisible.value = true;
  });
}

function handleDialogConfirm(value: string) {
  dialogVisible.value = false;
  if (dialogCallback) {
    dialogCallback(value);
    dialogCallback = null;
  }
}

function handleDialogCancel() {
  dialogVisible.value = false;
  if (dialogCallback) {
    dialogCallback(null);
    dialogCallback = null;
  }
}

// ── 文件树操作 ──────────────────────────────

function toggleExpand(dirPath: string) {
  const next = new Set(expanded.value);
  if (next.has(dirPath)) {
    next.delete(dirPath);
  } else {
    next.add(dirPath);
  }
  expanded.value = next;
}

async function createFile(parentDir: string) {
  const name = await showDialog('新建文件', '文件名称（不含扩展名）：', '例如：我的笔记', '');
  if (!name) return;
  const fileName = name.endsWith('.md') ? name : `${name}.md`;
  const path = parentDir ? `${parentDir}/${fileName}` : fileName;
  try {
    await invoke('write_note', { path, content: '' });
    await loadTree();
    openFile(path);
  } catch (e) {
    console.error('创建文件失败:', e);
  }
}

async function createFolder(parentDir: string) {
  const name = await showDialog('新建文件夹', '文件夹名称：', '例如：工作文档', '');
  if (!name) return;
  const path = parentDir ? `${parentDir}/${name}` : name;
  try {
    await invoke('create_note_dir', { path });
    await loadTree();
    const next = new Set(expanded.value);
    next.add(path);
    expanded.value = next;
  } catch (e) {
    console.error('创建文件夹失败:', e);
  }
}

async function renameEntry(path: string, isDir: boolean) {
  const oldName = path.split('/').pop() || '';
  const newName = await showDialog('重命名', '新名称：', '', oldName);
  if (!newName || newName === oldName) return;
  try {
    await invoke('rename_note_entry', { path, newName });
    if (selectedPath.value === path) {
      selectedPath.value = null;
      content.value = '';
    }
    await loadTree();
  } catch (e) {
    console.error('重命名失败:', e);
  }
}

async function deleteEntry(path: string) {
  const name = path.split('/').pop() || '';
  if (!confirm(`确定删除「${name}」？`)) return;
  try {
    await invoke('delete_note_entry', { path });
    if (selectedPath.value === path) {
      selectedPath.value = null;
      content.value = '';
    }
    await loadTree();
  } catch (e) {
    console.error('删除失败:', e);
  }
}

// ── 渲染树节点（递归） ──────────────────────────────

function getIcon(isDir: boolean) {
  return isDir
    ? 'M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z'
    : 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6';
}
</script>

<template>
  <div class="note-editor">
    <!-- 左侧文件树 -->
    <aside class="file-tree">
      <div class="tree-header">
        <span class="tree-title">笔记</span>
      </div>
      <div class="tree-list">
        <!-- 递归渲染每层 -->
        <template v-for="entry in tree" :key="entry.path">
          <!-- 目录 -->
          <template v-if="entry.isDir">
            <div class="tree-row" @click="toggleExpand(entry.path)">
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
            </div>
            <div v-if="expanded.has(entry.path) && entry.children" class="tree-children">
              <div class="tree-row tree-row-child">
                <button class="tree-inline-btn" @click.stop="createFile(entry.path)">+ 文件</button>
                <button class="tree-inline-btn" @click.stop="createFolder(entry.path)">
                  + 文件夹
                </button>
              </div>
              <template v-for="child in entry.children" :key="child.path">
                <!-- 子目录 -->
                <template v-if="child.isDir">
                  <div class="tree-row tree-row-child" @click="toggleExpand(child.path)">
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
                    <span class="tree-name">{{ child.name }}</span>
                    <svg
                      class="tree-chevron"
                      :class="{ open: expanded.has(child.path) }"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                    <div class="tree-node-actions">
                      <button
                        class="node-btn"
                        title="重命名"
                        @click.stop="renameEntry(child.path, true)"
                      >
                        R
                      </button>
                      <button
                        class="node-btn node-btn-danger"
                        title="删除"
                        @click.stop="deleteEntry(child.path)"
                      >
                        D
                      </button>
                    </div>
                  </div>
                  <div v-if="expanded.has(child.path) && child.children" class="tree-children">
                    <div class="tree-row tree-row-child">
                      <button class="tree-inline-btn" @click.stop="createFile(child.path)">
                        + 文件
                      </button>
                      <button class="tree-inline-btn" @click.stop="createFolder(child.path)">
                        + 文件夹
                      </button>
                    </div>
                    <div
                      v-for="sub in child.children.filter((c) => !c.isDir)"
                      :key="sub.path"
                      :class="['tree-row', 'tree-row-file', { active: selectedPath === sub.path }]"
                      @click="openFile(sub.path)"
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
                      <span class="tree-name">{{ sub.name }}</span>
                      <div class="tree-node-actions">
                        <button
                          class="node-btn"
                          title="重命名"
                          @click.stop="renameEntry(sub.path, false)"
                        >
                          R
                        </button>
                        <button
                          class="node-btn node-btn-danger"
                          title="删除"
                          @click.stop="deleteEntry(sub.path)"
                        >
                          D
                        </button>
                      </div>
                    </div>
                  </div>
                </template>
                <!-- 子文件 -->
                <div
                  v-else
                  :class="['tree-row', 'tree-row-file', { active: selectedPath === child.path }]"
                  @click="openFile(child.path)"
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
                  <span class="tree-name">{{ child.name }}</span>
                  <div class="tree-node-actions">
                    <button
                      class="node-btn"
                      title="重命名"
                      @click.stop="renameEntry(child.path, false)"
                    >
                      R
                    </button>
                    <button
                      class="node-btn node-btn-danger"
                      title="删除"
                      @click.stop="deleteEntry(child.path)"
                    >
                      D
                    </button>
                  </div>
                </div>
              </template>
            </div>
          </template>
          <!-- 根级文件 -->
          <div
            v-else
            :class="['tree-row', 'tree-row-file', { active: selectedPath === entry.path }]"
            @click="openFile(entry.path)"
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
              <button class="node-btn" title="重命名" @click.stop="renameEntry(entry.path, false)">
                R
              </button>
              <button
                class="node-btn node-btn-danger"
                title="删除"
                @click.stop="deleteEntry(entry.path)"
              >
                D
              </button>
            </div>
          </div>
        </template>
      </div>
    </aside>

    <!-- 右侧编辑区 -->
    <div class="editor-area">
      <template v-if="selectedPath">
        <div class="editor-header">
          <span class="editor-filename">{{ selectedName }}</span>
          <span v-if="saving" class="editor-status">保存中...</span>
          <div class="editor-modes">
            <button
              :class="['mode-btn', { active: viewMode === 'edit' }]"
              @click="viewMode = 'edit'"
            >
              编辑
            </button>
            <button
              :class="['mode-btn', { active: viewMode === 'split' }]"
              @click="viewMode = 'split'"
            >
              并排
            </button>
            <button
              :class="['mode-btn', { active: viewMode === 'preview' }]"
              @click="viewMode = 'preview'"
            >
              预览
            </button>
          </div>
        </div>
        <div class="editor-panes">
          <textarea
            v-show="viewMode !== 'preview'"
            v-model="content"
            :class="['editor-textarea', { full: viewMode === 'edit' }]"
            placeholder="开始编写 Markdown..."
          />
          <div
            v-show="viewMode !== 'edit'"
            :class="['editor-preview', { full: viewMode === 'preview' }]"
            v-html="renderedHtml"
          />
        </div>
      </template>
      <div v-else class="editor-empty">
        <p>从左侧文件树选择或新建一个笔记</p>
      </div>
    </div>

    <!-- 自定义输入对话框 -->
    <InputDialog
      :visible="dialogVisible"
      :title="dialogTitle"
      :label="dialogLabel"
      :placeholder="dialogPlaceholder"
      :default-value="dialogDefault"
      @confirm="handleDialogConfirm"
      @cancel="handleDialogCancel"
    />
  </div>
</template>

<style scoped>
.note-editor {
  flex: 1;
  display: flex;
  overflow: hidden;
  background: var(--bg-primary);
}

/* ── 文件树 ────────────────────── */

.file-tree {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
}

.tree-header {
  padding: var(--space-md) var(--space-md) var(--space-sm);
}

.tree-title {
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.tree-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--space-xs) var(--space-md);
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px var(--space-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  min-height: 28px;
}

.tree-row:hover {
  background: var(--bg-hover);
}

.tree-row.active {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-weight: 500;
}

.tree-row-child {
  padding-left: 20px;
}

.tree-row-file {
  padding-left: 28px;
}

.tree-icon {
  width: 14px;
  height: 14px;
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
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  transition: transform 0.15s;
}

.tree-chevron.open {
  transform: rotate(180deg);
}

.tree-children {
  border-left: 1px solid var(--border-subtle);
  margin-left: 10px;
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
  font-size: 10px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0 3px;
  border-radius: 2px;
}

.node-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.node-btn-danger:hover {
  color: #e74c3c;
}

.tree-inline-btn {
  background: none;
  border: none;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 2px;
  margin: 0 2px;
}

.tree-inline-btn:hover {
  background: var(--bg-hover);
  color: var(--accent);
}

/* ── 编辑区 ────────────────────── */

.editor-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-header {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
}

.editor-filename {
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.editor-status {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.editor-modes {
  margin-left: auto;
  display: flex;
  gap: 2px;
}

.mode-btn {
  background: none;
  border: 1px solid var(--border-light);
  padding: 2px 10px;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
}

.mode-btn:hover {
  background: var(--bg-hover);
}

.mode-btn.active {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-weight: 500;
  border-color: var(--border-default);
}

.editor-panes {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.editor-textarea {
  flex: 1;
  border: none;
  padding: var(--space-lg);
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--text-primary);
  background: var(--bg-primary);
  resize: none;
  outline: none;
}

.editor-textarea.full {
  flex: 1;
}

.editor-preview {
  flex: 1;
  padding: var(--space-lg);
  overflow-y: auto;
  line-height: 1.7;
  border-left: 1px solid var(--border-subtle);
}

.editor-preview.full {
  border-left: none;
}

.editor-preview :deep(h1) {
  font-size: 1.5em;
  margin: 1em 0 0.5em;
}
.editor-preview :deep(h2) {
  font-size: 1.25em;
  margin: 1em 0 0.5em;
}
.editor-preview :deep(p) {
  margin: 0.5em 0;
}
.editor-preview :deep(code) {
  background: var(--bg-tertiary);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 0.9em;
}
.editor-preview :deep(pre) {
  background: var(--bg-secondary);
  padding: var(--space-md);
  border-radius: var(--radius-md);
  overflow-x: auto;
}
.editor-preview :deep(pre code) {
  background: none;
  padding: 0;
}
.editor-preview :deep(blockquote) {
  border-left: 3px solid var(--border-default);
  padding-left: var(--space-md);
  color: var(--text-muted);
  margin-left: 0;
}
.editor-preview :deep(ul),
.editor-preview :deep(ol) {
  padding-left: 1.5em;
}

.editor-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-disabled);
  font-size: var(--text-base);
}
</style>
