<script setup lang="ts">
/**
 * 笔记编辑器组件。
 *
 * 提供可拖动宽度的文件树浏览与 Markdown 文档编辑功能。左侧文件树支持
 * 新建、重命名、删除文件及文件夹，右侧为基于 CodeMirror 6 的 Markdown
 * 编辑器，支持编辑/并排/预览三种视图模式。编辑内容通过 500ms 防抖自动
 * 保存至本地文件系统，同时支持 Ctrl+S 手动保存。
 *
 * 侧边栏宽度、目录展开状态通过 localStorage 持久化。
 */
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';
import { diagnosticsLogger } from '../diagnostics/invoke-logged';
import { open } from '@tauri-apps/plugin-dialog';
import { renderMarkdown } from '../composables/useMarkdown';
import type { FileEntry, FileTreeContextTarget, NotesLayoutState } from '../types';
import { compactFileTree } from '../utils/note-tree';
import { getMenuRegistrations, type EditorSelection } from '../plugin-api/menus-impl';
import InputDialog from './InputDialog.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import TreeNode from './TreeNode.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import MarkdownToolbar from './MarkdownToolbar.vue';
import { useContextMenu } from '../composables/useContextMenu';

// ═══ 布局常量 ═══

/** 侧边栏初始宽度 */
const DEFAULT_SIDEBAR_WIDTH = 260;
/** 侧边栏最小宽度 */
const MIN_SIDEBAR_WIDTH = 220;
/** 侧边栏最大宽度 */
const MAX_SIDEBAR_WIDTH = 420;
/** 整体布局最小宽度 */
/** 编辑区最小宽度 */
const EDITOR_MIN_WIDTH = 360;
/** 分隔条宽度 */
const RESIZER_WIDTH = 4;
/** localStorage 键名 */
const LAYOUT_STORAGE_KEY = 'prism-notes-layout';

// ═══ 状态 ═══

const tree = ref<FileEntry[]>([]);
const selectedPath = ref<string | null>(null);
const content = ref('');
const viewMode = ref<'edit' | 'split' | 'preview'>('split');
const saving = ref(false);
const isDirty = ref(false);
const cursorLine = ref(1);
const cursorCol = ref(1);

const textareaRef = ref<InstanceType<typeof MarkdownEditor> | null>(null);

/** 侧边栏宽度 */
const treeWidth = ref(DEFAULT_SIDEBAR_WIDTH);
/** 是否正在拖动分隔条 */
const isResizing = ref(false);
/** 侧边栏是否被手动收起 */
const sidebarCollapsed = ref(false);
/** 收起前的宽度，用于恢复 */
const previousWidth = ref(DEFAULT_SIDEBAR_WIDTH);

// ═══ 自定义右键菜单 ═══

const { openContextMenu, createClipboardMenuItems } = useContextMenu();

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

/** 渲染后的 Markdown HTML */
const renderedHtml = computed(() => {
  if (!content.value) return '';
  return renderMarkdown(content.value, { breaks: true });
});

/** 字数统计（中文字 + 英文单词） */
const wordCount = computed(() => {
  const text = content.value;
  if (!text) return 0;
  const chineseChars = (text.match(/[一-鿿]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return chineseChars + englishWords;
});

/** 侧边栏实际显示宽度（收起时为 0） */
const effectiveTreeWidth = computed(() => {
  return sidebarCollapsed.value ? 0 : treeWidth.value;
});

/** 文件树展示数据，保留 tree 中的真实路径用于文件操作 */
const displayTree = computed(() => compactFileTree(tree.value));

// ═══ 布局持久化 ═══

/** 保存布局状态到 localStorage */
function saveLayoutState() {
  try {
    const state: NotesLayoutState = {
      sidebarWidth: treeWidth.value,
      expandedPaths: Array.from(expanded.value),
    };
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage 不可用时静默忽略
  }
}

/** 从 localStorage 加载布局状态 */
function loadLayoutState() {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw) as NotesLayoutState;
    if (typeof state.sidebarWidth === 'number' && Number.isFinite(state.sidebarWidth)) {
      treeWidth.value = clampWidth(state.sidebarWidth);
    }
    if (state.expandedPaths && Array.isArray(state.expandedPaths)) {
      expanded.value = new Set(state.expandedPaths);
    }
  } catch {
    // 解析失败时使用默认值
  }
}

// ═══ 光标与右键菜单 ═══

function handleCursorChange(line: number, col: number) {
  cursorLine.value = line;
  cursorCol.value = col;
}

function showContextMenu(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();

  const editor = textareaRef.value;
  if (!editor) return;

  const registrations = getMenuRegistrations('editor-context');
  const text = editor.getSelection();

  const pluginItems = registrations.map((r) => ({
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

  const clipboardItems = createClipboardMenuItems(event.target as HTMLElement, !!text);
  openContextMenu(event, [...clipboardItems, ...pluginItems]);
}

/** Ctrl+S 手动保存 */
async function handleManualSave() {
  if (!selectedPath.value) return;
  saving.value = true;
  try {
    await invoke('write_note', { path: selectedPath.value, content: content.value });
    isDirty.value = false;
  } catch (e) {
    diagnosticsLogger.error('notes', 'notes.save_failed', '保存笔记失败', e, {
      path: selectedPath.value,
    });
  } finally {
    saving.value = false;
  }
}

// ═══ 自定义对话框状态 ═══

const dialogVisible = ref(false);
const dialogTitle = ref('');
const dialogLabel = ref('');
const dialogPlaceholder = ref('');
const dialogDefault = ref('');
let dialogCallback: ((value: string | null) => void) | null = null;

// ═══ 确认对话框 ═══

const confirmVisible = ref(false);
const confirmTitle = ref('');
const confirmMessage = ref('');
let confirmCallback: (() => void) | null = null;

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

// ═══ 笔记目录 ═══

async function loadNotesDir() {
  try {
    notesDir.value = await invoke<string>('get_notes_directory');
  } catch (e) {
    diagnosticsLogger.error('notes', 'notes.get_directory_failed', '获取笔记目录失败', e);
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
    diagnosticsLogger.error('notes', 'notes.set_directory_failed', '设置笔记目录失败', e);
  }
}

const notesDirShort = computed(() => {
  const dir = notesDir.value;
  if (!dir) return '';
  const parts = dir.replace(/\\/g, '/').split('/');
  if (parts.length <= 2) return dir;
  return '...' + '/' + parts.slice(-2).join('/');
});

// ═══ 文件树加载与导航 ═══

async function loadTree() {
  try {
    tree.value = await invoke<FileEntry[]>('list_note_tree');
  } catch (e) {
    diagnosticsLogger.error('notes', 'notes.load_tree_failed', '加载文件树失败', e);
  }
}

/** 返回当前窗口下允许的最大侧边栏宽度。 */
function getMaxSidebarWidth(): number {
  return Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - EDITOR_MIN_WIDTH - RESIZER_WIDTH);
}

/** 将宽度限制在侧边栏和编辑区都可用的范围内。 */
function getSafeSidebarWidth(width: number): number {
  return Math.min(clampWidth(width), getMaxSidebarWidth());
}

/** 展开指定文件路径的所有父级目录 */
function expandParentDirectories(filePath: string) {
  const parts = filePath.split('/');
  const next = new Set(expanded.value);

  for (let i = 1; i < parts.length; i += 1) {
    next.add(parts.slice(0, i).join('/'));
  }

  expanded.value = next;
  saveLayoutState();
}

async function openFile(path: string) {
  try {
    content.value = await invoke<string>('read_note', { path });
    selectedPath.value = path;
    isDirty.value = false;
    cursorLine.value = 1;
    cursorCol.value = 1;
    // 自动展开父级目录
    expandParentDirectories(path);
  } catch (e) {
    diagnosticsLogger.error('notes', 'notes.read_file_failed', '读取文件失败', e, {
      path: selectedPath.value,
    });
  }
}

// ═══ 自动保存（500ms 防抖） ═══

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function clearPendingSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

watch(content, (val) => {
  isDirty.value = true;
  if (!selectedPath.value) return;
  clearPendingSave();
  const savePath = selectedPath.value;
  if (!savePath) return;
  saveTimer = setTimeout(async () => {
    saving.value = true;
    try {
      await invoke('write_note', { path: savePath, content: val });
      if (selectedPath.value === savePath) isDirty.value = false;
    } catch (e) {
      diagnosticsLogger.error('notes', 'notes.save_failed', '保存笔记失败', e, {
        path: savePath,
      });
    } finally {
      saving.value = false;
    }
  }, 500);
});

// ═══ 自定义对话框 ═══

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

// ═══ 文件树操作 ═══

function toggleExpand(dirPath: string) {
  const next = new Set(expanded.value);
  if (next.has(dirPath)) {
    next.delete(dirPath);
  } else {
    next.add(dirPath);
  }
  expanded.value = next;
  saveLayoutState();
}

/** 全部折叠：清空展开集合并持久化 */
function collapseAll() {
  expanded.value = new Set();
  saveLayoutState();
}

/** 校验文件/文件夹名称 */
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
    // 确保父目录展开
    if (parentDir) {
      const next = new Set(expanded.value);
      next.add(parentDir);
      expanded.value = next;
    }
    openFile(path);
  } catch (e) {
    showStatus(`创建文件失败: ${e}`);
    diagnosticsLogger.error('notes', 'notes.create_file_failed', '创建文件失败', e);
  }
}

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
    saveLayoutState();
  } catch (e) {
    showStatus(`创建文件夹失败: ${e}`);
    diagnosticsLogger.error('notes', 'notes.create_directory_failed', '创建文件夹失败', e);
  }
}

/** 根据文件树右键目标构造统一菜单 */
function showFileTreeContextMenu(event: MouseEvent, target: FileTreeContextTarget) {
  const parentDir =
    target.kind === 'directory'
      ? target.path
      : target.path.includes('/')
        ? target.path.slice(0, target.path.lastIndexOf('/'))
        : '';
  const creationLocation = target.kind === 'directory' ? target.name : parentDir || '根目录';
  const relativePath = target.path.replace(/\\/g, '/');
  const items = [
    {
      id: 'file-tree.create-file',
      label: `在 ${creationLocation} 中新建文件`,
      action: () => createFile(parentDir),
    },
    {
      id: 'file-tree.create-folder',
      label: `在 ${creationLocation} 中新建文件夹`,
      action: () => createFolder(parentDir),
    },
    {
      id: 'file-tree.rename',
      label: '重命名',
      separatorBefore: true,
      action: () => renameEntry(target.path, target.kind === 'directory'),
    },
    {
      id: 'file-tree.copy-path',
      label: '复制相对路径',
      action: async () => {
        await navigator.clipboard?.writeText(relativePath);
        showStatus('相对路径已复制');
      },
    },
    {
      id: 'file-tree.delete',
      label: '删除',
      separatorBefore: true,
      action: () => deleteEntry(target.path),
    },
  ];
  openContextMenu(event, items);
}

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
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;

    if (selectedPath.value && isPathInside(selectedPath.value, path)) {
      selectedPath.value = replacePathPrefix(selectedPath.value, path, newPath);
    }

    const nextExpanded = new Set<string>();
    for (const expandedPath of expanded.value) {
      nextExpanded.add(
        isPathInside(expandedPath, path)
          ? replacePathPrefix(expandedPath, path, newPath)
          : expandedPath,
      );
    }
    expanded.value = nextExpanded;
    saveLayoutState();
    await loadTree();
  } catch (e) {
    showStatus(`重命名失败: ${e}`);
    diagnosticsLogger.error('notes', 'notes.rename_failed', '重命名失败', e);
  }
}

// ═══ 删除辅助函数 ═══

/** 统计文件夹下所有子项数量（不含自身） */
function countDescendants(entry: FileEntry): number {
  if (!entry.children) return 0;
  return entry.children.reduce((count, child) => count + 1 + countDescendants(child), 0);
}

/** 判断路径是否位于指定目录内 */
function isPathInside(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`);
}

/** 将路径前缀替换为重命名后的路径。 */
function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  return path === oldPrefix ? newPrefix : `${newPrefix}${path.slice(oldPrefix.length)}`;
}

/** 从文件树中递归查找条目 */
function findEntry(entries: FileEntry[], targetPath: string): FileEntry | null {
  for (const e of entries) {
    if (e.path === targetPath) return e;
    if (e.children) {
      const found = findEntry(e.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

/** 清理已删除路径及其子路径的展开状态 */
function cleanExpandedForPath(deletedPath: string) {
  const next = new Set(expanded.value);
  for (const p of next) {
    if (isPathInside(p, deletedPath)) {
      next.delete(p);
    }
  }
  expanded.value = next;
  saveLayoutState();
}

/** 删除文件或文件夹（移入系统回收站）。
 *  文件夹删除时显示子项数量；删除后清理展开状态，
 *  若当前打开文件位于被删目录内则关闭编辑器。 */
async function deleteEntry(path: string) {
  const name = path.split('/').pop() || '';
  const entry = findEntry(tree.value, path);
  const openPathIsAffected = Boolean(selectedPath.value && isPathInside(selectedPath.value, path));

  let message: string;
  if (entry?.isDir) {
    const count = countDescendants(entry);
    message = `确定将文件夹「${name}」及其中的 ${count} 个项目移入系统回收站吗？`;
  } else {
    message = `确定将文件「${name}」移入系统回收站吗？`;
  }
  if (openPathIsAffected && isDirty.value) {
    message += '\n当前笔记有未保存修改，删除后将无法恢复。';
  }

  const confirmed = await showConfirm('确认删除', message);
  if (!confirmed) return;

  try {
    if (openPathIsAffected) clearPendingSave();
    await invoke('delete_note_entry', { path });

    // 清理被删除路径及其子路径的展开状态
    cleanExpandedForPath(path);

    // 若当前打开文件位于被删除目录内，关闭编辑器
    if (selectedPath.value && isPathInside(selectedPath.value, path)) {
      selectedPath.value = null;
      content.value = '';
    }

    await loadTree();
    showStatus(`已将「${name}」移入系统回收站`);
  } catch (e) {
    showStatus(`删除失败: ${e}`);
    diagnosticsLogger.error('notes', 'notes.delete_failed', '删除笔记失败', e);
  }
}

// ═══ 侧边栏拖动 ═══

/** 约束宽度到有效范围内 */
function clampWidth(w: number): number {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(w)));
}

/** 窗口缩放时重新约束宽度 */
function constrainOnResize() {
  const safeWidth = getSafeSidebarWidth(treeWidth.value);
  if (treeWidth.value !== safeWidth) {
    treeWidth.value = safeWidth;
    saveLayoutState();
  }
}

function startResize(event: PointerEvent) {
  event.preventDefault();
  isResizing.value = true;

  const startX = event.clientX;
  const startWidth = treeWidth.value;

  // 拖动期间禁止文本选择
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'col-resize';

  function onMove(e: PointerEvent) {
    if (!isResizing.value) return;
    const delta = e.clientX - startX;
    const newWidth = getSafeSidebarWidth(startWidth + delta);
    // 确保不挤压编辑区
    treeWidth.value = newWidth;
  }

  function onUp() {
    isResizing.value = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    saveLayoutState();
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

/** 分隔条键盘调整 */
function handleResizerKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    treeWidth.value = clampWidth(treeWidth.value - 20);
    saveLayoutState();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    treeWidth.value = getSafeSidebarWidth(treeWidth.value + 20);
    saveLayoutState();
  } else if (event.key === 'Home') {
    event.preventDefault();
    treeWidth.value = MIN_SIDEBAR_WIDTH;
    saveLayoutState();
  } else if (event.key === 'End') {
    event.preventDefault();
    treeWidth.value = getSafeSidebarWidth(MAX_SIDEBAR_WIDTH);
    saveLayoutState();
  }
}

/** 切换侧边栏收起/展开 */
function toggleSidebar() {
  if (sidebarCollapsed.value) {
    sidebarCollapsed.value = false;
    treeWidth.value = getSafeSidebarWidth(previousWidth.value);
  } else {
    sidebarCollapsed.value = true;
    previousWidth.value = treeWidth.value;
  }
}

// ═══ 生命周期 ═══

onMounted(() => {
  loadLayoutState();
  constrainOnResize();
  loadTree();
  loadNotesDir();
  window.addEventListener('resize', constrainOnResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', constrainOnResize);
});
</script>

<template>
  <div class="note-editor">
    <!-- ═══ 左侧文件树 ═══ -->
    <aside
      class="file-tree"
      :style="{ width: effectiveTreeWidth > 0 ? `${effectiveTreeWidth}px` : '0px' }"
      :class="{ collapsed: sidebarCollapsed }"
    >
      <div class="tree-header">
        <span class="tree-title">笔记</span>
        <div class="tree-header-actions">
          <button
            class="tree-header-btn"
            title="全部折叠"
            aria-label="全部折叠"
            @click="collapseAll"
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
            @click="toggleSidebar"
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
      <div class="tree-list">
        <TreeNode
          v-for="entry in displayTree"
          :key="entry.path"
          :entry="entry"
          :expanded="expanded"
          :selected-path="selectedPath"
          :depth="0"
          @toggle-expand="toggleExpand"
          @select="openFile"
          @create-file="createFile"
          @create-folder="createFolder"
          @context-menu="showFileTreeContextMenu"
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

    <!-- ═══ 拖动分隔条 ═══ -->
    <div
      v-if="!sidebarCollapsed"
      class="tree-resizer"
      role="separator"
      aria-orientation="vertical"
      :aria-valuenow="treeWidth"
      :aria-valuemin="MIN_SIDEBAR_WIDTH"
      :aria-valuemax="MAX_SIDEBAR_WIDTH"
      :tabindex="0"
      @pointerdown="startResize"
      @keydown="handleResizerKeydown"
    />

    <!-- ═══ 右侧编辑区 ═══ -->
    <div class="editor-area">
      <!-- 文件树收起时的展开按钮条（占据实际布局空间） -->
      <div v-if="sidebarCollapsed" class="sidebar-toggle-strip">
        <button
          class="tree-header-btn"
          title="展开文件树"
          aria-label="展开文件树"
          @click="toggleSidebar"
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
            <path d="M7 4l8 8-8 8" />
          </svg>
        </button>
      </div>

      <!-- 编辑区主内容（保持纵向 flex 布局） -->
      <div class="editor-main">
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
    </div>

    <!-- ═══ 对话框与提示 ═══ -->

    <InputDialog
      :visible="dialogVisible"
      :title="dialogTitle"
      :label="dialogLabel"
      :placeholder="dialogPlaceholder"
      :default-value="dialogDefault"
      @confirm="handleDialogConfirm"
      @cancel="handleDialogCancel"
    />

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

    <Transition name="status-fade">
      <div v-if="statusMsg" class="status-toast">{{ statusMsg }}</div>
    </Transition>
  </div>
</template>

<style scoped>
/* ═══ 整体布局 ═══ */

.note-editor {
  flex: 1;
  display: flex;
  overflow: hidden;
  background: var(--bg-primary);
  min-width: 640px;
}

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
  transition: all var(--transition-fast);
}

.tree-header-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* ═══ 文件树列表 ═══ */

.tree-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 var(--space-xs) var(--space-md);
}

/* ═══ 拖动分隔条 ═══ */

.tree-resizer {
  width: 4px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  transition: background-color 0.15s;
  position: relative;
  z-index: 10;
}

.tree-resizer:hover,
.tree-resizer:focus-visible {
  background: var(--accent-muted);
}

.tree-resizer:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}

/* ═══ 文件树底部 ═══ */

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

/* ═══ 编辑区 ═══ */

.editor-area {
  position: relative;
  flex: 1;
  display: flex;
  overflow: hidden;
  background: var(--bg-primary);
  min-width: 360px;
}

/* ═══ 侧边栏展开按钮条（收起时） ═══ */

.sidebar-toggle-strip {
  width: 28px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 8px;
  border-right: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

/* ═══ 编辑区主内容 ═══ */

.editor-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

/* ═══ 工具栏 ═══ */

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

/* ═══ 编辑面板 ═══ */

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

/* ═══ 状态栏 ═══ */

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

/* ═══ 状态提示 Toast ═══ */

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

/* ═══ 空状态欢迎页 ═══ */

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

/* ═══ HUD 主题适配 ═══ */

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

[data-theme='hud'] .file-tree {
  background: var(--bg-tertiary);
  border-color: var(--border-subtle);
}

[data-theme='hud'] .tree-title {
  font-family: var(--font-heading);
  letter-spacing: 2px;
  text-transform: uppercase;
}

[data-theme='hud'] .tree-resizer:hover,
[data-theme='hud'] .tree-resizer:focus-visible {
  background: var(--accent-glow);
}

/* ═══ 减少动画 ═══ */

@media (prefers-reduced-motion: reduce) {
  .file-tree {
    transition: none;
  }

  .tree-resizer {
    transition: none;
  }
}
</style>
