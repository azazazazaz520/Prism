<script setup lang="ts">
/**
 * 笔记编辑器组件。
 *
 * 提供文件树浏览与 Markdown 文档编辑功能。左侧为可展开/折叠的文件树
 * （支持新建、重命名、删除文件及文件夹），右侧为基于 CodeMirror 6 的
 * Markdown 编辑器，支持编辑/并排/预览三种视图模式。编辑内容通过 500ms
 * 防抖自动保存至本地文件系统，同时支持 Ctrl+S 手动保存。
 */
import { ref, watch, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { renderMarkdown } from '../composables/useMarkdown';
import type { FileEntry } from '../types';
import { getMenuRegistrations, type EditorSelection } from '../plugin-api/menus-impl';
import InputDialog from './InputDialog.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import TreeNode from './TreeNode.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import MarkdownToolbar from './MarkdownToolbar.vue';
import ContextMenu, { type ContextMenuItem } from './ContextMenu.vue';

// ── 状态 ──────────────────────────────

const tree = ref<FileEntry[]>([]);
const selectedPath = ref<string | null>(null);
const content = ref('');
const viewMode = ref<'edit' | 'split' | 'preview'>('split');
const saving = ref(false);
const isDirty = ref(false);
const cursorLine = ref(1);
const cursorCol = ref(1);

const textareaRef = ref<InstanceType<typeof MarkdownEditor> | null>(null);

// ── 自定义右键菜单 ──────────────────────────
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuItems = ref<ContextMenuItem[]>([]);

/** 操作结果提示（临时显示） */
const statusMsg = ref('');
let statusTimer: ReturnType<typeof setTimeout> | null = null;

function showStatus(msg: string) {
  statusMsg.value = msg;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusMsg.value = '';
  }, 3000);
}

/** 笔记目录路径 */
const notesDir = ref('');

/** 文件树中展开的文件夹路径集合 */
const expanded = ref<Set<string>>(new Set(['inbox']));

/** 当前选中文件的名称 */
const selectedName = computed(() => {
  if (!selectedPath.value) return '';
  return selectedPath.value.split('/').pop() || '';
});

/** 渲染后的 Markdown HTML（经 DOMPurify 净化，可安全用于 v-html） */
const renderedHtml = computed(() => {
  if (!content.value) return '';
  return renderMarkdown(content.value, { breaks: true });
});

/** 字数统计（中文字 + 英文单词） */
const wordCount = computed(() => {
  const text = content.value;
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return chineseChars + englishWords;
});

/** 来自 MarkdownEditor 的光标变更 */
function handleCursorChange(line: number, col: number) {
  cursorLine.value = line;
  cursorCol.value = col;
}

// ── 右键菜单 ──────────────────────────────

function showContextMenu(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();

  const editor = textareaRef.value;
  if (!editor) return;

  const registrations = getMenuRegistrations('editor-context');
  const text = editor.getSelection();

  if (registrations.length === 0 && !text) return;

  contextMenuItems.value = registrations.map((r) => ({
    id: r.id,
    label: r.item.label,
    icon: r.item.icon,
    action: () => {
      const sel: EditorSelection = text
        ? {
            text,
            from: -1,
            to: -1,
            replace: (newText: string) => editor.replaceSelection(newText),
          }
        : (undefined as unknown as EditorSelection);
      r.item.action(sel);
    },
  }));

  const menuHeight = Math.min(contextMenuItems.value.length * 36 + 8, 300);
  contextMenuX.value = event.clientX;
  contextMenuY.value =
    event.clientY + menuHeight > window.innerHeight ? event.clientY - menuHeight : event.clientY;
  contextMenuVisible.value = true;
}

function hideContextMenu() {
  contextMenuVisible.value = false;
}

/** Ctrl+S 手动保存 */
async function handleManualSave() {
  if (!selectedPath.value) return;
  saving.value = true;
  try {
    await invoke('write_note', { path: selectedPath.value, content: content.value });
    isDirty.value = false;
  } catch (e) {
    console.error('保存失败:', e);
  } finally {
    saving.value = false;
  }
}

// ── 自定义对话框状态 ──────────────────────────────

const dialogVisible = ref(false);
const dialogTitle = ref('');
const dialogLabel = ref('');
const dialogPlaceholder = ref('');
const dialogDefault = ref('');
let dialogCallback: ((value: string | null) => void) | null = null;

// ── 确认对话框 ──────────────────────────────

const confirmVisible = ref(false);
const confirmTitle = ref('');
const confirmMessage = ref('');
let confirmCallback: (() => void) | null = null;

/** 显示确认对话框（如删除确认），返回 Promise 表示用户选择。
 *  点击「确认」时 resolve(true)；取消或关闭时 resolve(false)
 *  通过 handleConfirmCancel 的 confirmCallback 置空实现。 */
function showConfirm(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    confirmTitle.value = title;
    confirmMessage.value = message;
    confirmCallback = () => resolve(true);
    confirmVisible.value = true;
  });
}

function handleConfirmOk() {
  confirmVisible.value = false;
  if (confirmCallback) {
    confirmCallback();
    confirmCallback = null;
  }
}

function handleConfirmCancel() {
  confirmVisible.value = false;
  confirmCallback = null;
}

async function loadNotesDir() {
  try {
    notesDir.value = await invoke<string>('get_notes_directory');
  } catch (e) {
    console.error('获取笔记目录失败:', e);
  }
}

async function changeNotesDir() {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择笔记保存目录',
    });
    if (selected) {
      await invoke('set_notes_directory', { dirPath: selected });
      await loadNotesDir();
      await loadTree();
    }
  } catch (e) {
    console.error('设置笔记目录失败:', e);
  }
}

/** 截断路径显示 */
const notesDirShort = computed(() => {
  const dir = notesDir.value;
  if (!dir) return '';
  // 只显示最后两段路径
  const parts = dir.replace(/\\/g, '/').split('/');
  if (parts.length <= 2) return dir;
  return '...' + '/' + parts.slice(-2).join('/');
});

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
    isDirty.value = false;
    cursorLine.value = 1;
    cursorCol.value = 1;
  } catch (e) {
    console.error('读取文件失败:', e);
  }
}

// ── 自动保存（500ms 防抖） ──────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** 监听内容变更，500ms 防抖后自动保存到本地文件系统。
 *  每次变更重置定时器，避免高频写入；保存期间设置 saving 标记
 *  以在底部状态栏显示「保存中...」提示。 */
watch(content, (val) => {
  isDirty.value = true;
  if (!selectedPath.value) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saving.value = true;
    try {
      await invoke('write_note', { path: selectedPath.value, content: val });
      isDirty.value = false;
    } catch (e) {
      console.error('保存失败:', e);
    } finally {
      saving.value = false;
    }
  }, 500);
});

// 初始化加载文件树和笔记目录
loadTree();
loadNotesDir();

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

/** 校验文件/文件夹名称是否合法。
 *  @returns 合法的名称返回 null，否则返回错误提示字符串。 */
const INVALID_NAME_CHARS = /[<>:"/\\|?*]/;

function validateName(name: string): string | null {
  if (INVALID_NAME_CHARS.test(name)) {
    return '名称包含非法字符（< > : " / \\ | ? *）';
  }
  if (name === '.' || name === '..') {
    return '不允许使用 . 或 .. 作为名称';
  }
  if (name.length > 255) {
    return '名称过长（最多 255 字符）';
  }
  return null;
}

/** 在指定目录下创建新的 Markdown 文件（.md）。
 *  弹出输入对话框让用户输入文件名（不含扩展名），自动补全 .md 后缀，
 *  校验名称合法性后通过后端写入空文件，刷新文件树并自动打开新文件。 */
async function createFile(parentDir: string) {
  const name = await showDialog('新建文件', '文件名称（不含扩展名）：', '例如：我的笔记', '');
  if (!name) return;
  const err = validateName(name);
  if (err) {
    showStatus(err);
    return;
  }
  const fileName = name.endsWith('.md') ? name : `${name}.md`;
  const path = parentDir ? `${parentDir}/${fileName}` : fileName;
  try {
    await invoke('write_note', { path, content: '' });
    await loadTree();
    openFile(path);
  } catch (e) {
    showStatus(`创建文件失败: ${e}`);
    console.error('创建文件失败:', e);
  }
}

/** 在指定目录下创建新文件夹。
 *  弹出输入对话框获取文件夹名称，校验合法性后通过后端创建，
 *  刷新文件树并自动展开新建的文件夹。 */
async function createFolder(parentDir: string) {
  const name = await showDialog('新建文件夹', '文件夹名称：', '例如：工作文档', '');
  if (!name) return;
  const err = validateName(name);
  if (err) {
    showStatus(err);
    return;
  }
  const path = parentDir ? `${parentDir}/${name}` : name;
  try {
    await invoke('create_note_dir', { path });
    await loadTree();
    const next = new Set(expanded.value);
    next.add(path);
    expanded.value = next;
  } catch (e) {
    showStatus(`创建文件夹失败: ${e}`);
    console.error('创建文件夹失败:', e);
  }
}

/** 重命名文件或文件夹。
 *  弹出输入对话框获取新名称，校验合法后调用后端重命名。
 *  若当前选中的正是被重命名的条目，则清除选中状态与编辑内容。 */
async function renameEntry(path: string, isDir: boolean) {
  const oldName = path.split('/').pop() || '';
  const newName = await showDialog('重命名', '新名称：', '', oldName);
  if (!newName || newName === oldName) return;
  const err = validateName(newName);
  if (err) {
    showStatus(err);
    return;
  }
  try {
    await invoke('rename_note_entry', { path, newName });
    if (selectedPath.value === path) {
      selectedPath.value = null;
      content.value = '';
    }
    await loadTree();
  } catch (e) {
    showStatus(`重命名失败: ${e}`);
    console.error('重命名失败:', e);
  }
}

/** 删除文件或文件夹（移入系统回收站）。
 *  从文件树中查找条目以区分文件/文件夹类型，弹窗确认后调用后端删除。
 *  若删除的是当前选中的条目则清除编辑状态，完成后显示状态提示。 */
async function deleteEntry(path: string) {
  const name = path.split('/').pop() || '';
  // 判断是否为文件夹（从 tree 中查找）
  const findEntry = (entries: FileEntry[], targetPath: string): FileEntry | null => {
    for (const e of entries) {
      if (e.path === targetPath) return e;
      if (e.children) {
        const found = findEntry(e.children, targetPath);
        if (found) return found;
      }
    }
    return null;
  };
  const entry = findEntry(tree.value, path);
  const typeLabel = entry?.isDir ? '文件夹' : '文件';

  const confirmed = await showConfirm(
    '确认删除',
    `确定删除${typeLabel}「${name}」？删除后将移至系统回收站。`,
  );
  if (!confirmed) return;
  try {
    await invoke('delete_note_entry', { path });
    if (selectedPath.value === path) {
      selectedPath.value = null;
      content.value = '';
    }
    showStatus(`已删除「${name}」（移至回收站）`);
    await loadTree();
  } catch (e) {
    showStatus(`删除失败: ${e}`);
    console.error('删除失败:', e);
  }
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
        <TreeNode
          v-for="entry in tree"
          :key="entry.path"
          :entry="entry"
          :expanded="expanded"
          :selected-path="selectedPath"
          :depth="0"
          @toggle-expand="toggleExpand"
          @select="openFile"
          @create-file="createFile"
          @create-folder="createFolder"
          @rename="renameEntry"
          @delete="deleteEntry"
        />
      </div>

      <!-- 笔记目录设置 -->
      <div class="tree-footer">
        <div class="dir-info" :title="notesDir">
          <span class="dir-label">目录:</span>
          <span class="dir-path">{{ notesDirShort }}</span>
        </div>
        <button class="dir-change-btn" @click="changeNotesDir" title="更改笔记保存位置">
          更改
        </button>
      </div>
    </aside>

    <!-- 右侧编辑区 -->
    <div class="editor-area">
      <template v-if="selectedPath">
        <!-- 顶部工具栏 -->
        <div class="editor-toolbar">
          <div class="toolbar-left">
            <span class="toolbar-filename">{{ selectedName }}</span>
            <span v-if="isDirty" class="toolbar-dirty" title="未保存的更改">&#9679;</span>
          </div>
          <MarkdownToolbar :editor-ref="textareaRef" />
          <div class="toolbar-right">
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
            <button class="toolbar-action-btn" title="新建笔记" @click="createFile('')">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button class="toolbar-action-btn" title="新建文件夹" @click="createFolder('')">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              >
                <path
                  d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2zM12 11v6M9 14h6"
                />
              </svg>
            </button>
          </div>
        </div>

        <!-- 编辑区 -->
        <div class="editor-panes" @contextmenu="showContextMenu">
          <MarkdownEditor
            ref="textareaRef"
            v-show="viewMode !== 'preview'"
            :model-value="content"
            placeholder="开始编写 Markdown..."
            @update:model-value="content = $event"
            @cursor-change="handleCursorChange"
            @save="handleManualSave"
          />
          <div
            v-show="viewMode !== 'edit'"
            :class="['editor-preview', { full: viewMode === 'preview' }]"
            v-html="renderedHtml"
          />
        </div>

        <!-- 底部状态栏 -->
        <div class="editor-statusbar">
          <span>UTF-8</span>
          <span class="statusbar-sep">|</span>
          <span>Markdown</span>
          <span class="statusbar-sep">|</span>
          <span>{{ wordCount }} 字</span>
          <span class="statusbar-sep">|</span>
          <span>行 {{ cursorLine }}, 列 {{ cursorCol }}</span>
          <span v-if="saving" class="statusbar-saving">保存中...</span>
        </div>
      </template>

      <!-- 空状态欢迎页 -->
      <div v-else class="editor-welcome">
        <div class="welcome-content">
          <h1 class="welcome-title">欢迎使用笔记</h1>
          <p class="welcome-desc">从左侧文件树选择文件，或快速开始</p>
          <div class="welcome-actions">
            <button class="welcome-btn welcome-btn-primary" @click="createFile('')">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              新建笔记
            </button>
            <button class="welcome-btn" @click="createFolder('')">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              >
                <path
                  d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2zM12 11v6M9 14h6"
                />
              </svg>
              新建文件夹
            </button>
          </div>
        </div>
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

    <!-- 删除确认对话框 -->
    <ConfirmDialog
      :visible="confirmVisible"
      :title="confirmTitle"
      :message="confirmMessage"
      confirm-text="删除"
      cancel-text="取消"
      :danger="true"
      @confirm="handleConfirmOk"
      @cancel="handleConfirmCancel"
    />

    <!-- 操作状态提示 -->
    <Transition name="status-fade">
      <div v-if="statusMsg" class="status-toast">{{ statusMsg }}</div>
    </Transition>

    <ContextMenu
      :visible="contextMenuVisible"
      :x="contextMenuX"
      :y="contextMenuY"
      :items="contextMenuItems"
      @close="hideContextMenu"
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
  width: 260px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-secondary);
}

.tree-header {
  padding: var(--space-md) var(--space-md) var(--space-sm);
  flex-shrink: 0;
}

.tree-title {
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.tree-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--space-xs) var(--space-md);
}

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
  padding-left: 28px;
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
  margin-left: 10px;
  padding-left: 4px;
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

/* ── 暗色适配 ──────────────────────────── */
[data-theme='hud'] .note-editor,
[data-theme='hud'] .note-editor {
  background:
    linear-gradient(
      135deg,
      rgba(245, 197, 24, 0.03) 0%,
      transparent 35%,
      transparent 75%,
      rgba(0, 0, 0, 0.25) 100%
    ),
    var(--bg-primary);
}

[data-theme='hud'] .file-tree,
[data-theme='hud'] .file-tree {
  background: var(--bg-tertiary);
  border-color: var(--border-subtle);
}

[data-theme='hud'] .tree-title,
[data-theme='hud'] .tree-title {
  font-family: var(--font-heading);
  letter-spacing: 2px;
  text-transform: uppercase;
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

[data-theme='hud'] .node-btn:hover,
[data-theme='hud'] .node-btn:hover {
  background: var(--bg-panel-hover);
}

/* ── 文件树底部目录设置 ──────────── */

.tree-footer {
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
  transition: all var(--transition-fast);
}

.dir-change-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* ── 编辑区 ────────────────────── */

.editor-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
}

/* ── 工具栏 ──────────────────────── */

.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-lg);
  height: 40px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-primary);
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.toolbar-filename {
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.toolbar-dirty {
  font-size: 8px;
  color: #f59e0b;
  line-height: 1;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.toolbar-action-btn {
  background: none;
  border: 1px solid var(--border-light);
  padding: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}

.toolbar-action-btn:hover {
  background: var(--accent-bg);
  color: var(--accent);
  border-color: var(--accent-muted);
}

.editor-modes {
  display: flex;
  gap: 2px;
}

.mode-btn {
  background: none;
  border: 1px solid var(--border-light);
  padding: 3px 10px;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-full);
  transition: all var(--transition-fast);
}

.mode-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.mode-btn.active {
  background: var(--accent);
  color: #fff;
  font-weight: 500;
  border-color: var(--accent);
  box-shadow: var(--shadow-sm);
}

/* ── 编辑区面板 ──────────────────── */

.editor-panes {
  flex: 1;
  display: flex;
  overflow: hidden;
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
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: 0.9em;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
}
.editor-preview :deep(pre) {
  background: var(--bg-secondary);
  padding: var(--space-md);
  border-radius: var(--radius-md);
  overflow-x: auto;
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-sm);
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

/* ── 状态栏 ──────────────────────── */

.editor-statusbar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  height: 28px;
  padding: 0 var(--space-lg);
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-subtle);
  font-size: var(--text-xs);
  color: var(--text-muted);
  flex-shrink: 0;
  user-select: none;
}

.statusbar-sep {
  color: var(--border-default);
}

.statusbar-saving {
  margin-left: auto;
  color: var(--accent);
}

/* ── 状态提示 Toast ──────────────── */

.status-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: var(--text-sm);
  padding: var(--space-sm) var(--space-lg);
  border-radius: var(--radius-full);
  border: 1px solid var(--border-default);
  box-shadow: var(--shadow-md);
  z-index: 10000;
  max-width: 80vw;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-fade-enter-active,
.status-fade-leave-active {
  transition:
    opacity 0.25s,
    transform 0.25s;
}

.status-fade-enter-from,
.status-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

/* ── 空状态欢迎页 ────────────────── */

.editor-welcome {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
}

.welcome-content {
  text-align: center;
  max-width: 360px;
}

.welcome-title {
  font-size: var(--text-h1);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 var(--space-sm);
}

.welcome-desc {
  font-size: var(--text-base);
  color: var(--text-muted);
  margin: 0 0 var(--space-xl);
}

.welcome-actions {
  display: flex;
  gap: var(--space-md);
  justify-content: center;
}

.welcome-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-lg);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.welcome-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-default);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.welcome-btn-primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.welcome-btn-primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
</style>
