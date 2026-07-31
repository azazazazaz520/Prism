<script setup lang="ts">
/**
 * 笔记编辑器组件。
 *
 * 提供可拖动宽度的文件树浏览与 Markdown 文档编辑功能。左侧文件树支持
 * 新建、重命名、删除文件及文件夹，右侧为基于 CodeMirror 6 的 Markdown
 * 编辑器采用单栏 Live Preview 基础形态。编辑内容通过 500ms 防抖自动
 * 保存至本地文件系统，同时支持 Ctrl+S 手动保存。
 *
 * 侧边栏宽度、目录展开状态通过 localStorage 持久化。
 */
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { invokeWithDiagnostics as invoke } from '../../diagnostics/invoke-logged';
import { diagnosticsLogger } from '../../diagnostics/invoke-logged';
import { open, save } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import type { FileEntry, FileTreeContextTarget, NotesLayoutState, Task } from '../../types';
import { compactFileTree } from '../../utils/note-tree';
import {
  countDescendantEntries,
  countNoteWords,
  filterFileTree,
  findNoteEntry,
  isPathInside,
  normalizeWorkspacePath,
  parseNoteOutline,
  removeNoteEntry,
  replacePathPrefix,
} from '../../utils/note-editor';
import { getMenuRegistrations, type EditorSelection } from '../../plugin-api/menus-impl';
import InputDialog from '../overlays/InputDialog.vue';
import ConfirmDialog from '../overlays/ConfirmDialog.vue';
import TreeNode from './TreeNode.vue';
import TaskPicker from '../tasks/TaskPicker.vue';
import NoteQuickSwitcher from './NoteQuickSwitcher.vue';
import NoteWorkspaceBoard from './NoteWorkspaceBoard.vue';
import { useContextMenu } from '../../composables/useContextMenu';
import { useTaskStore } from '../../composables/useTaskStore';
import { getTodayStr } from '../../composables/useFilterEngine';
import {
  parseTaskReferences,
  removeTaskReference,
  renderTaskReference,
  updateTaskReferences,
  type TaskReference,
} from '../../notes/task-references';
import { useNoteTaskSync } from '../../composables/useNoteTaskSync';
import {
  shouldScheduleNoteSave,
  useNoteDocumentStore,
} from '../../composables/useNoteDocumentStore';
import { useNoteSaveController } from '../../composables/useNoteSaveController';
import {
  beginNoteSelfWrite,
  endNoteSelfWrite,
  isNoteSelfWriting,
  type NoteSelfWriteToken,
} from '../../composables/useNoteSelfWriteTracker';
import { FILE_CHANGED_EXTERNALLY } from '../../utils/error-codes';
import {
  createWorkspaceState,
  listLeaves,
  removeTabsByPath,
  renameTabPath,
  type NoteWorkspaceState,
} from '../../domain/note-workspace';

const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });

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
const RECENT_WORKSPACES_STORAGE_KEY = 'prism-recent-note-workspaces';
const NOTE_SESSION_STORAGE_PREFIX = 'prism-note-session:';
const NOTE_RECENT_STORAGE_PREFIX = 'prism-note-recent:';
const MAX_RECENT_WORKSPACES = 8;
const MAX_RECENT_NOTES = 12;

// ═══ 状态 ═══

const tree = ref<FileEntry[]>([]);
const loadingDirectories = new Set<string>();
const noteSearch = ref('');
const titleDraft = ref('');
const titleInput = ref<HTMLInputElement | null>(null);
const saving = ref(false);
const exporting = ref(false);
const cursorLine = ref(1);
const cursorCol = ref(1);
const contextPanelOpen = ref(false);
const taskPickerVisible = ref(false);
const noteQuickSwitcherVisible = ref(false);
const noteContentCache = new Map<string, string>();
const recentNotePaths = ref<string[]>([]);

/** 当前打开文件读取时的版本标识，用于外部变更检测 */
const documentStore = useNoteDocumentStore();
const noteSaveController = useNoteSaveController();
const workspaceBoardRef = ref<InstanceType<typeof NoteWorkspaceBoard> | null>(null);
const workspaceBoardState = ref<NoteWorkspaceState>(createWorkspaceState());
const activeNotePath = ref<string | null>(null);
const openNoteTabs = ref<string[]>([]);
// 兼容旧的文件树、任务与会话逻辑；实际编辑区状态由 workspaceBoardState 管理。
const content = computed({
  get: () => (activeNotePath.value ? documentStore.ensure(activeNotePath.value).content : ''),
  set: (value: string) => {
    if (activeNotePath.value) documentStore.updateContent(activeNotePath.value, value);
  },
});
const isDirty = computed(() =>
  activeNotePath.value ? documentStore.ensure(activeNotePath.value).dirty : false,
);
const currentFileMtime = computed(() =>
  activeNotePath.value ? documentStore.ensure(activeNotePath.value).mtime : null,
);

const { tasks, toggleTask, toggleDailyTask, updateTask, addTask, deleteTask } = useTaskStore();
const {
  noteContents,
  referenceIndex,
  setNoteContent,
  refreshIndex,
  refreshNoteIndex,
  removeNote,
  resetNotes,
  removeNotesUnderPath,
  renameNote,
  renameNotesUnderPath,
  projectTask,
  removeTaskFromAllNotes,
} = useNoteTaskSync();
let projectingTaskReferences = false;
let taskSyncTimer: ReturnType<typeof setTimeout> | null = null;
let taskSnapshot = new Map<string, { title: string; completed: boolean }>();
let focusTitleAfterOpen = false;

/** 侧边栏宽度 */
const treeWidth = ref(DEFAULT_SIDEBAR_WIDTH);
/** 是否正在拖动分隔条 */
const isResizing = ref(false);
/** 侧边栏是否被手动收起 */
const sidebarCollapsed = ref(false);
/** 收起前的宽度，用于恢复 */
const previousWidth = ref(DEFAULT_SIDEBAR_WIDTH);

// ═══ 自定义右键菜单 ═══

const { openContextMenu, createClipboardMenuItems, visible: contextMenuVisible } = useContextMenu();

/** 操作结果提示（临时显示） */
const statusMsg = ref('');
let statusTimer: ReturnType<typeof setTimeout> | null = null;
const noteActionsMenuOpen = ref(false);

function showStatus(msg: string) {
  statusMsg.value = msg;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusMsg.value = '';
  }, 3000);
}

function toggleNoteActionsMenu() {
  noteActionsMenuOpen.value = !noteActionsMenuOpen.value;
}

function closeNoteActionsMenu() {
  noteActionsMenuOpen.value = false;
}

function resetNoteWorkspaceLayout() {
  workspaceBoardState.value = createWorkspaceState();
}

function splitNoteWorkspace(direction: 'horizontal' | 'vertical') {
  workspaceBoardRef.value?.splitActiveLeaf(direction);
  closeNoteActionsMenu();
}

function closeNoteWorkspaceSplit() {
  workspaceBoardRef.value?.closeActiveLeaf();
  closeNoteActionsMenu();
}

function syncWorkspacePaneTabs() {
  const activeLeaf = listLeaves(workspaceBoardState.value.root).find(
    (leaf) => leaf.id === workspaceBoardState.value.activeLeafId,
  );
  openNoteTabs.value = activeLeaf?.tabs.map((tab) => tab.path) ?? [];
  activeNotePath.value =
    activeLeaf?.tabs.find((tab) => tab.id === activeLeaf.activeTabId)?.path ?? null;
}

const allWorkspaceTabPaths = computed(() =>
  listLeaves(workspaceBoardState.value.root).flatMap((leaf) => leaf.tabs.map((tab) => tab.path)),
);

function showSplitPaneMenu(event: MouseEvent) {
  openContextMenu(event, [
    {
      id: 'split-pane.context-panel',
      label: contextPanelOpen.value
        ? `隐藏${outlinePanelLabel.value}`
        : `显示${outlinePanelLabel.value}`,
      action: () => {
        contextPanelOpen.value = !contextPanelOpen.value;
      },
    },
    {
      id: 'split-pane.new-note',
      label: '新建笔记',
      action: () => createUntitledFile(),
    },
    {
      id: 'split-pane.new-folder',
      label: '新建文件夹',
      action: () => createFolder(''),
    },
    {
      id: 'split-pane.split-horizontal',
      label: '左右分屏',
      separatorBefore: true,
      action: () => splitNoteWorkspace('horizontal'),
    },
    {
      id: 'split-pane.split-vertical',
      label: '上下分屏',
      action: () => splitNoteWorkspace('vertical'),
    },
    {
      id: 'split-pane.close',
      label: '关闭分屏',
      action: () => closeNoteWorkspaceSplit(),
    },
    {
      id: 'split-pane.quick-switcher',
      label: '查找笔记',
      separatorBefore: true,
      action: () => {
        noteQuickSwitcherVisible.value = true;
      },
    },
    {
      id: 'split-pane.copy-path',
      label: '复制路径',
      action: async () => {
        if (!activeNotePath.value) return;
        await navigator.clipboard?.writeText(activeNotePath.value);
        showStatus('路径已复制');
      },
    },
    {
      id: 'split-pane.export',
      label: '导出为 Word',
      separatorBefore: true,
      action: () => exportCurrentNoteToDocx(),
    },
  ]);
}

async function openPathInActivePane(path: string, initialContent?: string) {
  workspaceBoardRef.value?.openPath(path);
  await loadWorkspacePath(path, initialContent);
}

function handleNoteActionsMenuOutside(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (!target?.closest('.note-toolbar-menu')) closeNoteActionsMenu();
}

interface ExportDocxResult {
  output_path: string;
  pandoc_version: string;
}

/** 笔记目录路径 */
const notesDir = ref('');
const recentWorkspaces = ref<string[]>([]);
const workspaceMenuOpen = ref(false);

/** 文件树中展开的文件夹路径集合 */
const expanded = ref<Set<string>>(new Set(['inbox']));

/** 当前选中文件的名称 */
const selectedName = computed(() => {
  if (!activeNotePath.value) return '';
  return activeNotePath.value.split('/').pop() || '';
});

const outlinePanelLabel = computed(() => {
  const noteName = selectedName.value.replace(/\.md$/i, '');
  return noteName ? `${noteName}的大纲` : '笔记大纲';
});

/** 当前笔记中出现的正式任务引用。 */
const currentTaskReferences = computed(() => {
  if (!activeNotePath.value) return [];
  return parseTaskReferences(content.value, activeNotePath.value);
});

function taskForReference(reference: TaskReference) {
  return tasks.value.find((task) => task.id === reference.taskId);
}

/** 任务 Store 变化后，将正式任务投影回当前笔记的全部引用。 */
watch(
  tasks,
  (nextTasks) => {
    if (projectingTaskReferences) return;

    // 任务 Store 可能来自本地编辑、Android 或 Supabase Realtime；统一投影到所有本地笔记。
    const changedTasks = nextTasks.filter((task) => {
      const previous = taskSnapshot.get(task.id);
      return !previous || previous.title !== task.title || previous.completed !== task.completed;
    });
    taskSnapshot = new Map(
      nextTasks.map((task) => [task.id, { title: task.title, completed: task.completed }]),
    );
    for (const task of changedTasks) void projectTask(task);

    if (!activeNotePath.value) return;
    let nextContent = content.value;
    for (const reference of currentTaskReferences.value) {
      const task = nextTasks.find((item) => item.id === reference.taskId);
      if (!task) continue;
      nextContent = updateTaskReferences(nextContent, task);
    }

    if (nextContent === content.value) return;
    projectingTaskReferences = true;
    content.value = nextContent;
    queueMicrotask(() => {
      projectingTaskReferences = false;
    });
  },
  { deep: true },
);

/** 将当前笔记中用户直接修改的任务引用写回正式任务。 */
async function syncEditedTaskReferences(markdown: string) {
  if (projectingTaskReferences) return;

  const references = parseTaskReferences(markdown, activeNotePath.value || '');
  for (const reference of references) {
    const task = taskForReference(reference);
    if (!task) continue;

    if (reference.title !== task.title) {
      await updateTask(task.id, reference.title);
    }
    if (reference.completed !== task.completed) {
      if (task.is_daily) await toggleDailyTask(task.id, getTodayStr());
      else await toggleTask(task.id);
    }
  }
}

function scheduleTaskReferenceSync(markdown: string) {
  if (taskSyncTimer) clearTimeout(taskSyncTimer);
  taskSyncTimer = setTimeout(() => {
    void syncEditedTaskReferences(markdown);
  }, 500);
}

async function handleTaskToggle(taskId: string) {
  const task = tasks.value.find((item) => item.id === taskId);
  if (!task) return;
  if (task.is_daily) await toggleDailyTask(taskId, getTodayStr());
  else await toggleTask(taskId);
}

async function addTaskReference() {
  if (!activeNotePath.value) return;
  const title = await showDialog('在笔记中创建任务', '任务标题');
  const trimmed = title?.trim();
  if (!trimmed) return;
  const task = await addTask(trimmed, null, [], false, false, false);
  if (!task) return;
  workspaceBoardRef.value?.insertText(`${renderTaskReference(task)}\n`);
}

function openTaskPicker() {
  if (!activeNotePath.value) return;
  taskPickerVisible.value = true;
}

function closeTaskPicker() {
  taskPickerVisible.value = false;
  nextTick(() => workspaceBoardRef.value?.focusActiveEditor());
}

function insertTaskReference(task: Task) {
  if (currentTaskReferences.value.some((reference) => reference.taskId === task.id)) {
    showStatus('该任务已经关联到当前笔记');
    closeTaskPicker();
    return;
  }
  workspaceBoardRef.value?.insertText(`${renderTaskReference(task)}\n`);
  taskPickerVisible.value = false;
}

async function createTaskFromPicker(title: string) {
  const task = await addTask(title, null, [], false, false, false);
  if (!task) return;
  workspaceBoardRef.value?.insertText(`${renderTaskReference(task)}\n`);
  taskPickerVisible.value = false;
}

async function copyTaskReference(reference: TaskReference) {
  const task = taskForReference(reference);
  if (!task) return;
  const copied = await addTask(
    task.title,
    task.due_date,
    [...task.tags],
    task.important,
    task.pinned,
    task.is_daily,
    task.parent_id || undefined,
  );
  if (copied) workspaceBoardRef.value?.insertText(`${renderTaskReference(copied)}\n`);
}

async function linkExistingTask() {
  openTaskPicker();
}

async function removeReference(reference: TaskReference) {
  const task = taskForReference(reference);
  const confirmed = await showConfirm(
    '移除笔记中的任务引用',
    `只从当前笔记移除“${task?.title || reference.title}”，正式任务仍会保留。`,
  );
  if (!confirmed) return;
  content.value = removeTaskReference(content.value, reference.taskId, reference.line);
}

async function deleteReferencedTask(reference: TaskReference) {
  const task = taskForReference(reference);
  if (!task) return removeReference(reference);
  const confirmed = await showConfirm(
    '删除正式任务',
    `删除“${task.title}”后，所有笔记中的引用都会失效并被移除。`,
  );
  if (!confirmed) return;
  for (const item of [...currentTaskReferences.value]
    .filter((r) => r.taskId === task.id)
    .reverse()) {
    content.value = removeTaskReference(content.value, item.taskId, item.line);
  }
  await deleteTask(task.id);
  await removeTaskFromAllNotes(task.id);
}

function showTaskReferenceMenu(event: MouseEvent, reference: TaskReference) {
  event.preventDefault();
  const task = taskForReference(reference);
  openContextMenu(event, [
    {
      id: 'note-task.toggle',
      label: task?.completed ? '标记为未完成' : '标记为已完成',
      action: () => handleTaskToggle(reference.taskId),
    },
    {
      id: 'note-task.copy',
      label: 'Copy as a new task',
      action: () => copyTaskReference(reference),
    },
    {
      id: 'note-task.remove',
      label: '仅从当前笔记移除',
      separatorBefore: true,
      action: () => removeReference(reference),
    },
    {
      id: 'note-task.delete',
      label: '删除正式任务及全部引用',
      action: () => deleteReferencedTask(reference),
    },
  ]);
}

/** 字数统计（中文字 + 英文单词） */
const wordCount = computed(() => {
  return countNoteWords(content.value);
});

/** 侧边栏实际显示宽度（收起时为 0） */
const effectiveTreeWidth = computed(() => {
  return sidebarCollapsed.value ? 0 : treeWidth.value;
});

/** 文件树展示数据，保留 tree 中的真实路径用于文件操作 */
const displayTree = computed(() => compactFileTree(tree.value));

const filteredDisplayTree = computed(() => filterFileTree(displayTree.value, noteSearch.value));

/** 当前笔记中的 Markdown 标题，用于笔记大纲。
 *  代码块（``` 围栏）内的 # 不会被识别为标题。 */
const outline = computed(() => parseNoteOutline(content.value));

/** 当前笔记任务引用所在的其他笔记路径，用于反向链接提示。 */
const backlinkPaths = computed(() => {
  const paths = new Set<string>();
  for (const reference of currentTaskReferences.value) {
    for (const item of referenceIndex.value.byTaskId.get(reference.taskId) ?? []) {
      if (item.notePath !== activeNotePath.value) paths.add(item.notePath);
    }
  }
  return [...paths];
});

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

  const editor = workspaceBoardRef.value;
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
  const formatItems = [
    {
      id: 'editor-format.bold',
      label: '加粗',
      separatorBefore: true,
      action: () => editor.wrapSelection('**', '**'),
    },
    {
      id: 'editor-format.italic',
      label: '倾斜',
      action: () => editor.wrapSelection('_', '_'),
    },
    {
      id: 'editor-format.strikethrough',
      label: '删除线',
      action: () => editor.wrapSelection('~~', '~~'),
    },
    {
      id: 'editor-format.inline-code',
      label: '行内代码',
      action: () => editor.wrapSelection('`', '`'),
    },
    {
      id: 'editor-format.heading-1',
      label: '一级标题',
      separatorBefore: true,
      action: () => editor.prependToLine('# '),
    },
    {
      id: 'editor-format.heading-2',
      label: '二级标题',
      action: () => editor.prependToLine('## '),
    },
    {
      id: 'editor-format.heading-3',
      label: '三级标题',
      action: () => editor.prependToLine('### '),
    },
    {
      id: 'editor-format.bullet-list',
      label: '无序列表',
      separatorBefore: true,
      action: () => editor.prependToLine('- '),
    },
    {
      id: 'editor-format.ordered-list',
      label: '有序列表',
      action: () => editor.prependToLine('1. '),
    },
    {
      id: 'editor-format.blockquote',
      label: '引用块',
      action: () => editor.prependToLine('> '),
    },
    {
      id: 'editor-format.code-block',
      label: '代码块',
      action: () => editor.insertText('```\n\n```'),
    },
    {
      id: 'editor-insert.link',
      label: '链接',
      separatorBefore: true,
      action: () => (text ? editor.wrapSelection('[', '](url)') : editor.insertText('[文字](url)')),
    },
    {
      id: 'editor-insert.image',
      label: '图片',
      action: () => editor.insertText('![替代文字](图片地址)'),
    },
    {
      id: 'editor-insert.rule',
      label: '分隔线',
      action: () => editor.insertText('\n---\n'),
    },
  ];
  const taskItems = activeNotePath.value
    ? [
        {
          id: 'editor-task.create',
          label: '在正文中创建任务',
          separatorBefore: true,
          action: () => addTaskReference(),
        },
        {
          id: 'editor-task.link',
          label: '关联已有任务',
          action: () => linkExistingTask(),
        },
      ]
    : [];

  openContextMenu(event, [...clipboardItems, ...formatItems, ...pluginItems, ...taskItems]);
}

/** Ctrl+S 手动保存 */
async function handleManualSave() {
  if (!activeNotePath.value) return;
  await queueNoteSave(
    activeNotePath.value,
    { content: content.value, expectedMtime: currentFileMtime.value },
    true,
  );
}

// ═══ 外部文件变更处理 ═══

/** 使用 Pandoc 将当前笔记导出为 Word 文档。 */
async function exportCurrentNoteToDocx() {
  const path = activeNotePath.value;
  if (!path || exporting.value) return;

  exporting.value = true;
  try {
    if (isDirty.value) {
      clearPendingSave();
      await handleManualSave();
    }

    const defaultName = `${selectedName.value.replace(/\.md$/i, '') || '未命名'}.docx`;
    const selected = await save({
      defaultPath: defaultName,
      title: '导出为 Word',
      filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    });
    if (!selected) return;

    const outputPath = /\.docx$/i.test(selected) ? selected : `${selected}.docx`;
    const result = await invoke<ExportDocxResult>('export_note_to_docx', {
      options: { notePath: path, outputPath },
    });
    showStatus(`已导出 Word：${result.output_path.split(/[\\/]/).pop() || outputPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('PANDOC_NOT_FOUND')) {
      showStatus('未找到 Pandoc，请安装 Pandoc 或将其加入系统 PATH');
    } else if (message.startsWith('PANDOC_TIMEOUT')) {
      showStatus('Word 导出超时，请检查文档中的图片或附件');
    } else if (message.startsWith('PANDOC_CONVERSION_FAILED')) {
      showStatus(`Word 导出失败：${message.replace(/^PANDOC_CONVERSION_FAILED:\s*/, '')}`);
    } else if (message.startsWith('DOCX_OUTPUT_FAILED')) {
      showStatus(`Word 导出失败：${message.replace(/^DOCX_OUTPUT_FAILED:\s*/, '')}`);
    } else {
      diagnosticsLogger.error('notes', 'notes.export_docx_failed', '导出 Word 失败', error, {
        path,
      });
      showStatus(`Word 导出失败：${message || '请检查 Pandoc 配置和输出目录'}`);
    }
  } finally {
    exporting.value = false;
  }
}

/**
 * 从磁盘重新加载当前文件，替换编辑器内容。
 * 用于外部变更检测后的自动同步。
 */
async function reloadFromDisk(path = activeNotePath.value) {
  if (!path) return;
  try {
    const meta = await invoke<{ content: string; mtime: string }>('read_note_meta', {
      path,
    });
    noteContentCache.set(path, meta.content);
    setNoteContent(path, meta.content);
    documentStore.finishLoading(path, meta.content, meta.mtime);
  } catch {
    // 文件可能被删除等，静默处理
  }
}

async function presentNoteConflict(path: string) {
  const document = documentStore.ensure(path);
  if (document.conflict || conflictPath.value === path) return;

  try {
    const meta = await invoke<{ content: string; mtime: string }>('read_note_meta', { path });
    if (!document.dirty) {
      await reloadFromDisk(path);
      return;
    }

    noteSaveController.cancel(path);
    documentStore.setConflict(path, meta.content, meta.mtime);
    conflictPath.value = path;
    confirmTitle.value = '文件已在外部修改';
    confirmMessage.value =
      '磁盘中的内容已经发生变化。请选择加载磁盘版本，或保留当前编辑内容并覆盖磁盘版本。';
    confirmActionText.value = '加载磁盘版本';
    confirmCancelText.value = '保留本地内容';
    confirmDanger.value = false;
    confirmVisible.value = true;
  } catch (error) {
    diagnosticsLogger.error('notes', 'notes.conflict_read_failed', '读取外部修改失败', error, {
      path,
    });
  }
}

/** 检查当前文件是否被外部修改，若变化则自动加载最新版本 */
type NoteFileChangeEvent = {
  kind: string;
  path: string;
  oldPath?: string;
  newPath?: string;
};

/** 外部重命名时先确认目标文件可读，再迁移编辑器状态，避免误删或覆盖内容。 */
async function handleExternalRename(oldPath: string, newPath: string) {
  if (!oldPath || !newPath || oldPath === newPath) return;

  const hasOldState =
    documentStore.documents.has(oldPath) ||
    noteContentCache.has(oldPath) ||
    allWorkspaceTabPaths.value.includes(oldPath) ||
    noteContents.value[oldPath] !== undefined;
  if (!hasOldState) {
    void refreshNoteIndex(newPath);
    return;
  }

  let meta: { content: string; mtime: string };
  try {
    meta = await invoke<{ content: string; mtime: string }>('read_note_meta', { path: newPath });
  } catch (error) {
    diagnosticsLogger.error(
      'notes',
      'notes.rename_target_read_failed',
      '外部重命名目标读取失败',
      error,
      {
        oldPath,
        newPath,
      },
    );
    return;
  }

  const document = documentStore.ensure(oldPath);
  const wasDirty = document.dirty;
  noteSaveController.cancel(oldPath);
  documentStore.rename(oldPath, newPath);

  noteContentCache.delete(oldPath);
  noteContentCache.set(newPath, wasDirty ? document.content : meta.content);
  renameNote(oldPath, newPath);

  const nextState = renameTabPath(workspaceBoardState.value, oldPath, newPath);
  workspaceBoardState.value = nextState;
  workspaceBoardRef.value?.setState(nextState);

  if (wasDirty) {
    documentStore.setConflict(newPath, meta.content, meta.mtime);
    conflictPath.value = newPath;
    confirmTitle.value = '文件已在外部重命名';
    confirmMessage.value =
      '文件已被外部重命名。当前编辑内容已保留，请确认磁盘版本后再决定是否覆盖目标文件。';
    confirmActionText.value = '加载磁盘版本';
    confirmCancelText.value = '保留本地内容';
    confirmDanger.value = false;
    confirmVisible.value = true;
  } else {
    documentStore.finishLoading(newPath, meta.content, meta.mtime);
    setNoteContent(newPath, meta.content);
  }

  void refreshNoteIndex(newPath);
  void refreshDirectory(newPath.includes('/') ? newPath.slice(0, newPath.lastIndexOf('/')) : '');
  saveNoteSession();
}

async function checkExternalModification() {
  if (!activeNotePath.value) return;
  try {
    const diskMtime = await invoke<string>('get_note_mtime', { path: activeNotePath.value });
    if (currentFileMtime.value && diskMtime !== currentFileMtime.value) {
      if (isDirty.value) await presentNoteConflict(activeNotePath.value);
      else await reloadFromDisk();
    }
  } catch {
    // 文件可能被删除等，静默处理
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
const confirmActionText = ref('删除');
const confirmCancelText = ref('取消');
const confirmDanger = ref(true);
const conflictPath = ref<string | null>(null);
let confirmCallback: (() => void) | null = null;

function showConfirm(
  title: string,
  message: string,
  actionText = '删除',
  danger = true,
): Promise<boolean> {
  return new Promise((resolve) => {
    confirmTitle.value = title;
    confirmMessage.value = message;
    confirmActionText.value = actionText;
    confirmDanger.value = danger;
    confirmCallback = () => resolve(true);
    confirmVisible.value = true;
  });
}

function handleConfirmOk() {
  if (conflictPath.value) {
    const path = conflictPath.value;
    const conflict = documentStore.ensure(path).conflict;
    confirmVisible.value = false;
    conflictPath.value = null;
    confirmCancelText.value = '取消';
    if (conflict) {
      documentStore.finishLoading(path, conflict.diskContent, conflict.diskMtime);
      noteContentCache.set(path, conflict.diskContent);
      setNoteContent(path, conflict.diskContent);
    }
    return;
  }
  confirmVisible.value = false;
  if (confirmCallback) {
    confirmCallback();
    confirmCallback = null;
  }
}

function handleConfirmCancel() {
  if (conflictPath.value) {
    const path = conflictPath.value;
    const conflict = documentStore.ensure(path).conflict;
    confirmVisible.value = false;
    conflictPath.value = null;
    confirmCancelText.value = '取消';
    if (conflict) {
      documentStore.acceptConflictForOverwrite(path);
      const document = documentStore.ensure(path);
      queueNoteSave(
        path,
        { content: document.content, expectedMtime: conflict.diskMtime },
        true,
      ).catch(() => undefined);
    }
    return;
  }
  confirmVisible.value = false;
  confirmCallback = null;
}

// ═══ 笔记目录 ═══

async function loadNotesDir() {
  try {
    notesDir.value = await invoke<string>('get_notes_directory');
    rememberWorkspace(notesDir.value);
    return notesDir.value;
  } catch (e) {
    diagnosticsLogger.error('notes', 'notes.get_directory_failed', '获取笔记目录失败', e);
    return '';
  }
}

function loadRecentWorkspaces() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_WORKSPACES_STORAGE_KEY) || '[]');
    if (Array.isArray(value)) {
      recentWorkspaces.value = value.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    recentWorkspaces.value = [];
  }
}

function rememberWorkspace(path: string) {
  const normalized = normalizeWorkspacePath(path);
  recentWorkspaces.value = [
    path,
    ...recentWorkspaces.value.filter((item) => normalizeWorkspacePath(item) !== normalized),
  ].slice(0, MAX_RECENT_WORKSPACES);
  localStorage.setItem(RECENT_WORKSPACES_STORAGE_KEY, JSON.stringify(recentWorkspaces.value));
}

function recentNotesStorageKey() {
  return `${NOTE_RECENT_STORAGE_PREFIX}${normalizeWorkspacePath(notesDir.value)}`;
}

function loadRecentNotePaths() {
  if (!notesDir.value) return;
  try {
    const raw = JSON.parse(localStorage.getItem(recentNotesStorageKey()) || '[]');
    recentNotePaths.value = Array.isArray(raw)
      ? raw.filter((path): path is string => typeof path === 'string').slice(0, MAX_RECENT_NOTES)
      : [];
  } catch {
    recentNotePaths.value = [];
  }
}

function rememberNotePath(path: string) {
  if (!notesDir.value) return;
  recentNotePaths.value = [path, ...recentNotePaths.value.filter((item) => item !== path)].slice(
    0,
    MAX_RECENT_NOTES,
  );
  localStorage.setItem(recentNotesStorageKey(), JSON.stringify(recentNotePaths.value));
}

async function switchNotesWorkspace(selected: string) {
  if (normalizeWorkspacePath(selected) === normalizeWorkspacePath(notesDir.value)) {
    workspaceMenuOpen.value = false;
    return;
  }

  if (isDirty.value) {
    clearPendingSave();
    await handleManualSave();
  }

  try {
    await invoke('set_notes_directory', { dirPath: selected });
    notesDir.value = selected;
    rememberWorkspace(selected);
    loadRecentNotePaths();
    workspaceMenuOpen.value = false;
    openNoteTabs.value = [];
    activeNotePath.value = null;
    resetNoteWorkspaceLayout();
    content.value = '';
    titleDraft.value = '';
    noteContentCache.clear();
    documentStore.clearAll();
    resetNotes();
    expanded.value = new Set(['inbox']);
    await loadTree();
  } catch (e) {
    diagnosticsLogger.error('notes', 'notes.switch_workspace_failed', '切换笔记工作区失败', e);
    showStatus(`切换笔记工作区失败: ${e}`);
  }
}

async function openNotesWorkspace() {
  await changeNotesDir();
}

async function changeNotesDir() {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '打开笔记工作区',
    });
    if (typeof selected === 'string') {
      await switchNotesWorkspace(selected);
    }
  } catch (e) {
    diagnosticsLogger.error('notes', 'notes.open_workspace_failed', '打开笔记工作区失败', e);
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

async function loadTree(_refreshReferences = false) {
  try {
    const nextTree = await invoke<FileEntry[]>('list_note_dir', { path: '' });
    tree.value = nextTree;
    return nextTree;
  } catch (e) {
    diagnosticsLogger.error('notes', 'notes.load_tree_failed', '加载文件树失败', e);
    return [];
  }
}

function updateDirectoryChildren(
  entries: FileEntry[],
  directoryPath: string,
  children: FileEntry[],
): FileEntry[] {
  return entries.map((entry) => {
    if (entry.path === directoryPath) return { ...entry, children };
    if (entry.isDir && entry.children) {
      return {
        ...entry,
        children: updateDirectoryChildren(entry.children, directoryPath, children),
      };
    }
    return entry;
  });
}

async function loadDirectory(directoryPath: string) {
  if (loadingDirectories.has(directoryPath)) return false;
  const entry = findNoteEntry(tree.value, directoryPath);
  if (!entry || !entry.isDir || entry.children) return true;

  loadingDirectories.add(directoryPath);
  try {
    const children = await invoke<FileEntry[]>('list_note_dir', { path: directoryPath });
    tree.value = updateDirectoryChildren(tree.value, directoryPath, children);
    return true;
  } catch (e) {
    diagnosticsLogger.error('notes', 'notes.load_directory_failed', '加载目录失败', e, {
      path: directoryPath,
    });
    return false;
  } finally {
    loadingDirectories.delete(directoryPath);
  }
}

function invalidateDirectory(entries: FileEntry[], directoryPath: string): FileEntry[] {
  return entries.map((entry) => {
    if (entry.path === directoryPath && entry.isDir) return { ...entry, children: undefined };
    if (entry.isDir && entry.children) {
      return { ...entry, children: invalidateDirectory(entry.children, directoryPath) };
    }
    return entry;
  });
}

async function refreshDirectory(directoryPath: string) {
  if (!directoryPath) return loadTree();
  const entry = findNoteEntry(tree.value, directoryPath);
  if (!entry?.isDir || !entry.children) return true;
  tree.value = invalidateDirectory(tree.value, directoryPath);
  return loadDirectory(directoryPath);
}

async function ensureParentDirectoriesLoaded(filePath: string) {
  const parts = filePath.split('/');
  for (let i = 1; i < parts.length; i += 1) {
    const directoryPath = parts.slice(0, i).join('/');
    if (!(await loadDirectory(directoryPath))) break;
  }
}

async function loadDisplayedDirectory(directoryPath: string) {
  let entry = findNoteEntry(tree.value, directoryPath);
  while (entry?.isDir && entry.children?.length === 1 && entry.children[0].isDir) {
    entry = entry.children[0];
  }
  return entry ? loadDirectory(entry.path) : false;
}

interface NoteSessionState {
  openTabs: string[];
  selectedPath: string | null;
  workspaceState?: NoteWorkspaceState;
}

function sessionStorageKey() {
  return `${NOTE_SESSION_STORAGE_PREFIX}${normalizeWorkspacePath(notesDir.value)}`;
}

function saveNoteSession() {
  if (!notesDir.value) return;
  try {
    const state: NoteSessionState = {
      openTabs: allWorkspaceTabPaths.value,
      selectedPath: getActiveWorkspacePath(),
      workspaceState: workspaceBoardState.value,
    };
    localStorage.setItem(sessionStorageKey(), JSON.stringify(state));
  } catch {
    // localStorage 不可用时继续使用当前会话状态
  }
}

function loadNoteSession(): NoteSessionState | null {
  if (!notesDir.value) return null;
  try {
    const raw = localStorage.getItem(sessionStorageKey());
    if (!raw) return null;
    const state = JSON.parse(raw) as Partial<NoteSessionState>;
    if (!Array.isArray(state.openTabs)) return null;
    return {
      openTabs: state.openTabs.filter((path): path is string => typeof path === 'string'),
      selectedPath: typeof state.selectedPath === 'string' ? state.selectedPath : null,
      workspaceState: isWorkspaceState(state.workspaceState) ? state.workspaceState : undefined,
    };
  } catch {
    return null;
  }
}

async function restoreNoteSession() {
  const state = loadNoteSession();
  if (!state) return;
  if (state.workspaceState) {
    workspaceBoardState.value = state.workspaceState;
    await nextTick();
    syncWorkspacePaneTabs();
    for (const leaf of listLeaves(state.workspaceState.root)) {
      for (const tab of leaf.tabs) await loadWorkspacePath(tab.path);
    }
    titleDraft.value = getActiveWorkspacePath()?.split('/').pop()?.replace(/\.md$/i, '') || '';
    return;
  }
  const availability = await Promise.all(
    state.openTabs.map(async (path) => {
      try {
        await invoke<string>('get_note_mtime', { path });
        return path;
      } catch {
        return null;
      }
    }),
  );
  const tabs = availability.filter((path): path is string => path !== null);
  if (tabs.length === 0) return;

  const selected =
    state.selectedPath && tabs.includes(state.selectedPath) ? state.selectedPath : tabs[0];
  await nextTick();
  for (const path of tabs) {
    workspaceBoardRef.value?.openPath(path);
    await loadWorkspacePath(path);
  }
  workspaceBoardRef.value?.openPath(selected);
  saveNoteSession();
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

async function openFile(path: string, initialContent?: string) {
  await openPathInActivePane(path, initialContent);
}

function isWorkspaceState(value: unknown): value is NoteWorkspaceState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<NoteWorkspaceState>;
  return Boolean(candidate.root && typeof candidate.activeLeafId === 'string');
}

async function loadWorkspacePath(path: string, initialContent?: string) {
  documentStore.beginLoading(path);
  try {
    let noteContent = initialContent;
    let mtime: string | null = null;
    if (noteContent === undefined) {
      const cached = noteContentCache.get(path);
      if (cached !== undefined) {
        noteContent = cached;
        try {
          mtime = await invoke<string>('get_note_mtime', { path });
        } catch {
          mtime = null;
        }
      } else {
        const meta = await invoke<{ content: string; mtime: string }>('read_note_meta', { path });
        noteContent = meta.content;
        mtime = meta.mtime;
      }
    } else {
      mtime = await invoke<string>('get_note_mtime', { path });
    }
    documentStore.finishLoading(path, noteContent ?? '', mtime);
    noteContentCache.set(path, noteContent ?? '');
    setNoteContent(path, noteContent ?? '');
    documentStore.markSaved(path, mtime);
    rememberNotePath(path);
    expandParentDirectories(path);
  } catch (error) {
    documentStore.failLoading(path);
    diagnosticsLogger.error('notes', 'notes.read_file_failed', '读取工作区笔记失败', error, {
      path,
    });
    showStatus('无法读取笔记');
  }
}

async function handleWorkspaceOpenPath(path: string) {
  await loadWorkspacePath(path);
}

function handleWorkspaceContentUpdate(path: string, value: string) {
  documentStore.updateContent(path, value);
  const document = documentStore.ensure(path);
  if (!shouldScheduleNoteSave(document)) return;
  noteContentCache.set(path, value);
  setNoteContent(path, value);
  queueNoteSave(path, { content: value, expectedMtime: document.mtime });
}

async function handleWorkspaceSavePath(path: string) {
  const document = documentStore.ensure(path);
  if (!shouldScheduleNoteSave(document)) return;
  await queueNoteSave(path, { content: document.content, expectedMtime: document.mtime }, true);
}

async function handleWorkspaceRename(path: string, title: string) {
  const nextTitle = title.trim();
  const currentTitle = path.split('/').pop()?.replace(/\.md$/i, '') || '';
  if (!nextTitle || nextTitle === currentTitle) return;
  const err = validateName(nextTitle);
  if (err) {
    showStatus(err);
    return;
  }
  const parentDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const newPath = `${parentDir ? `${parentDir}/` : ''}${nextTitle.endsWith('.md') ? nextTitle : `${nextTitle}.md`}`;
  if (newPath === path || findNoteEntry(tree.value, newPath)) {
    showStatus('目标文件已存在');
    return;
  }
  try {
    await noteSaveController.flush(path);
    await invoke('rename_note_entry', { path, newName: newPath.split('/').pop() });
    documentStore.rename(path, newPath);
    const cached = noteContentCache.get(path);
    if (cached !== undefined) {
      noteContentCache.delete(path);
      noteContentCache.set(newPath, cached);
    }
    renameNote(path, newPath);
    if (workspaceBoardState.value) {
      const nextState = renameTabPath(workspaceBoardState.value, path, newPath);
      workspaceBoardState.value = nextState;
      workspaceBoardRef.value?.setState(nextState);
    }
    saveNoteSession();
    void refreshDirectory(parentDir);
  } catch (error) {
    showStatus(`重命名失败: ${error}`);
    diagnosticsLogger.error('notes', 'notes.rename_failed', '重命名失败', error, { path });
  }
}

async function handleWorkspaceCreateNote() {
  await createUntitledFile();
}

function handleWorkspaceStateChange(next: NoteWorkspaceState) {
  workspaceBoardState.value = next;
  const activeLeaf = listLeaves(next.root).find((leaf) => leaf.id === next.activeLeafId);
  openNoteTabs.value = activeLeaf?.tabs.map((tab) => tab.path) ?? [];
  activeNotePath.value =
    activeLeaf?.tabs.find((tab) => tab.id === activeLeaf.activeTabId)?.path ?? null;
  if (activeNotePath.value) {
    titleDraft.value = activeNotePath.value.split('/').pop()?.replace(/\.md$/i, '') || '未命名';
  }
  saveNoteSession();
}

/** 在当前目录生成不冲突的未命名文件路径。 */
function getUntitledPath(parentDir: string): string {
  const existing = new Set<string>();
  function collect(entries: FileEntry[]) {
    for (const entry of entries) {
      existing.add(entry.path);
      if (entry.children) collect(entry.children);
    }
  }
  collect(tree.value);

  const prefix = parentDir ? `${parentDir}/` : '';
  const first = `${prefix}未命名.md`;
  if (!existing.has(first)) return first;
  let index = 2;
  while (existing.has(`${prefix}未命名 ${index}.md`)) index += 1;
  return `${prefix}未命名 ${index}.md`;
}

/** 直接创建未命名文件，标题输入框会在打开后自动选中。 */
async function createUntitledFile(parentDir = '') {
  const path = getUntitledPath(parentDir);
  try {
    await invoke('write_note', { path, content: '' });
    setNoteContent(path, '');
    if (parentDir) {
      const next = new Set(expanded.value);
      next.add(parentDir);
      expanded.value = next;
    }
    focusTitleAfterOpen = true;
    await openPathInActivePane(path, '');
    void refreshDirectory(parentDir);
  } catch (e) {
    showStatus(`创建文件失败: ${e}`);
    diagnosticsLogger.error('notes', 'notes.create_file_failed', '创建文件失败', e);
  }
}

/** 标题失焦时将标题同步为文件名和标签页名称。 */
async function renameCurrentNoteTitle() {
  if (!activeNotePath.value) return;
  const nextTitle = titleDraft.value.trim();
  const currentTitle = activeNotePath.value.split('/').pop()?.replace(/\.md$/i, '') || '';
  if (!nextTitle || nextTitle === currentTitle) {
    titleDraft.value = currentTitle;
    return;
  }
  const err = validateName(nextTitle);
  if (err) {
    showStatus(err);
    titleDraft.value = currentTitle;
    return;
  }
  const parentDir = activeNotePath.value.includes('/')
    ? activeNotePath.value.slice(0, activeNotePath.value.lastIndexOf('/'))
    : '';
  const newPath = `${parentDir ? `${parentDir}/` : ''}${nextTitle.endsWith('.md') ? nextTitle : `${nextTitle}.md`}`;
  if (newPath === activeNotePath.value) return;
  if (findNoteEntry(tree.value, newPath)) {
    showStatus('目标文件已存在');
    titleDraft.value = currentTitle;
    return;
  }
  try {
    const oldPath = activeNotePath.value;
    await noteSaveController.flush(oldPath);
    await invoke('rename_note_entry', { path: oldPath, newName: newPath.split('/').pop() });
    documentStore.rename(oldPath, newPath);
    openNoteTabs.value = openNoteTabs.value.map((tab) => (tab === oldPath ? newPath : tab));
    activeNotePath.value = newPath;
    const cached = noteContentCache.get(oldPath);
    if (cached !== undefined) {
      noteContentCache.delete(oldPath);
      noteContentCache.set(newPath, cached);
    }
    renameNote(oldPath, newPath);
    void refreshDirectory(parentDir);
  } catch (e) {
    titleDraft.value = currentTitle;
    showStatus(`重命名失败: ${e}`);
    diagnosticsLogger.error('notes', 'notes.rename_failed', '重命名失败', e);
  }
}

// ═══ 自动保存（500ms 防抖） ═══

function clearPendingSave(path = activeNotePath.value) {
  if (!path) return;
  noteSaveController.cancel(path);
}

function queueNoteSave(
  path: string,
  snapshot: { content: string; expectedMtime: string | null },
  flushNow = false,
) {
  saving.value = true;
  let selfWriteToken: NoteSelfWriteToken | null = null;
  noteSaveController.schedule(
    path,
    snapshot,
    async (nextSnapshot) => {
      selfWriteToken = beginNoteSelfWrite(path);
      return invoke<string>('write_note', {
        path,
        content: nextSnapshot.content,
        expectedMtime: nextSnapshot.expectedMtime,
      });
    },
    (writtenMtime, savedSnapshot) => {
      noteContentCache.set(path, savedSnapshot.content);
      setNoteContent(path, savedSnapshot.content);
      documentStore.markSaved(path, writtenMtime);
      saving.value = false;
    },
    async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith(FILE_CHANGED_EXTERNALLY)) {
        await presentNoteConflict(path);
      } else {
        diagnosticsLogger.error('notes', 'notes.save_failed', '保存笔记失败', error, { path });
      }
      saving.value = false;
    },
    () => {
      if (selfWriteToken !== null) endNoteSelfWrite(path, selfWriteToken);
    },
  );
  return flushNow ? noteSaveController.flush(path) : Promise.resolve();
}

watch(content, (val) => {
  if (activeNotePath.value) {
    const document = documentStore.ensure(activeNotePath.value);
    if (!shouldScheduleNoteSave(document)) return;
  }
  if (activeNotePath.value) {
    noteContentCache.set(activeNotePath.value, val);
    setNoteContent(activeNotePath.value, val);
  }
  scheduleTaskReferenceSync(val);
  if (!activeNotePath.value) return;
  const savePath = activeNotePath.value;
  if (!savePath) return;
  queueNoteSave(savePath, { content: val, expectedMtime: currentFileMtime.value });
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

async function toggleExpand(dirPath: string) {
  const next = new Set(expanded.value);
  if (next.has(dirPath)) {
    next.delete(dirPath);
  } else {
    if (!(await loadDisplayedDirectory(dirPath))) return;
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
    setNoteContent(path, '');
    // 确保父目录展开
    if (parentDir) {
      const next = new Set(expanded.value);
      next.add(parentDir);
      expanded.value = next;
    }
    await openPathInActivePane(path, '');
    void refreshDirectory(parentDir);
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
    await refreshDirectory(parentDir);
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
    const affectedPaths = new Set<string>();
    for (const candidate of [
      ...openNoteTabs.value,
      ...documentStore.documents.keys(),
      ...noteContentCache.keys(),
    ]) {
      if (isPathInside(candidate, path)) affectedPaths.add(candidate);
    }
    await Promise.all([...affectedPaths].map((candidate) => noteSaveController.flush(candidate)));
    await invoke('rename_note_entry', { path, newName });
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;

    documentStore.renamePrefix(path, newPath);
    renameNotesUnderPath(path, newPath);
    const migratePath = (candidate: string) =>
      isPathInside(candidate, path) ? replacePathPrefix(candidate, path, newPath) : candidate;
    openNoteTabs.value = openNoteTabs.value.map(migratePath);
    if (activeNotePath.value) {
      activeNotePath.value = migratePath(activeNotePath.value);
      titleDraft.value = activeNotePath.value.split('/').pop()?.replace(/\.md$/i, '') || '未命名';
    }
    for (const [oldPath, content] of [...noteContentCache.entries()]) {
      if (!isPathInside(oldPath, path)) continue;
      noteContentCache.delete(oldPath);
      noteContentCache.set(migratePath(oldPath), content);
    }
    syncWorkspacePaneTabs();
    const workspaceState = renameTabPath(workspaceBoardState.value, path, newPath);
    workspaceBoardState.value = workspaceState;
    workspaceBoardRef.value?.setState(workspaceState);

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
    await refreshDirectory(parentPath);
  } catch (e) {
    showStatus(`重命名失败: ${e}`);
    diagnosticsLogger.error('notes', 'notes.rename_failed', '重命名失败', e);
  }
}

// ═══ 删除辅助函数 ═══

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
 *  删除后先更新本地界面，再等待系统回收站操作结果；失败时恢复界面快照。 */
async function deleteEntry(path: string) {
  const name = path.split('/').pop() || '';
  const entry = findNoteEntry(tree.value, path);
  const isDirectory = Boolean(entry?.isDir);
  const workspacePaths = allWorkspaceTabPaths.value;
  const affectedOpenPaths = workspacePaths.filter((candidate) => isPathInside(candidate, path));
  const openPathIsAffected = affectedOpenPaths.length > 0;
  const dirtyAffectedPaths = affectedOpenPaths.filter(
    (candidate) => documentStore.ensure(candidate).dirty,
  );

  let message: string;
  if (entry?.isDir) {
    const count = countDescendantEntries(entry);
    message = `确定将文件夹「${name}」及其中的 ${count} 个项目移入系统回收站吗？`;
  } else {
    message = `确定将文件「${name}」移入系统回收站吗？`;
  }
  if (dirtyAffectedPaths.length > 0) {
    message += `\n有 ${dirtyAffectedPaths.length} 篇打开的笔记存在未保存修改，删除后将无法恢复。`;
  }

  const confirmed = await showConfirm('确认删除', message);
  if (!confirmed) return;

  const treeSnapshot = tree.value;
  const tabsSnapshot = [...openNoteTabs.value];
  const selectedSnapshot = activeNotePath.value;
  const contentSnapshot = content.value;
  const dirtySnapshot = isDirty.value;
  const workspaceSnapshot = workspaceBoardState.value;

  for (const affectedPath of affectedOpenPaths) noteSaveController.cancel(affectedPath);
  tree.value = removeNoteEntry(tree.value, path);
  cleanExpandedForPath(path);
  const nextWorkspaceState = removeTabsByPath(workspaceBoardState.value, path, isDirectory);
  workspaceBoardState.value = nextWorkspaceState;
  workspaceBoardRef.value?.setState(nextWorkspaceState);
  openNoteTabs.value = openNoteTabs.value.filter((tab) => !isPathInside(tab, path));
  for (const tab of affectedOpenPaths) noteContentCache.delete(tab);
  for (const cachedPath of [...noteContentCache.keys()]) {
    if (isPathInside(cachedPath, path)) noteContentCache.delete(cachedPath);
  }
  removeNotesUnderPath(path);
  if (activeNotePath.value && isPathInside(activeNotePath.value, path)) {
    activeNotePath.value = null;
    content.value = '';
  }
  saveNoteSession();
  showStatus(`正在将「${name}」移入系统回收站…`);

  try {
    await invoke('delete_note_entry', { path });
    showStatus(`已将「${name}」移入系统回收站`);
  } catch (e) {
    tree.value = treeSnapshot;
    openNoteTabs.value = tabsSnapshot;
    activeNotePath.value = selectedSnapshot;
    workspaceBoardState.value = workspaceSnapshot;
    workspaceBoardRef.value?.setState(workspaceSnapshot);
    content.value = contentSnapshot;
    if (selectedSnapshot && dirtySnapshot) documentStore.markDirty(selectedSnapshot);
    else if (selectedSnapshot) {
      documentStore.markSaved(selectedSnapshot, documentStore.ensure(selectedSnapshot).mtime);
    }
    saveNoteSession();
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    void refreshDirectory(parentPath);
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

/** 打开全局笔记快速切换器。 */
function openFileLibrary() {
  noteQuickSwitcherVisible.value = true;
}

function closeNoteQuickSwitcher() {
  noteQuickSwitcherVisible.value = false;
}

function selectQuickSwitcherPath(path: string) {
  closeNoteQuickSwitcher();
  openPathInActivePane(path);
}

function handleKeyboardShortcuts(event: KeyboardEvent) {
  if (!props.active) return;
  const modifier = event.ctrlKey || event.metaKey;
  if (
    !modifier ||
    event.altKey ||
    taskPickerVisible.value ||
    noteQuickSwitcherVisible.value ||
    dialogVisible.value ||
    confirmVisible.value
  ) {
    return;
  }

  const key = event.key.toLocaleLowerCase();
  if (key === 'n') {
    event.preventDefault();
    event.stopPropagation();
    void createUntitledFile();
  } else if (key === 'p') {
    event.preventDefault();
    event.stopPropagation();
    openFileLibrary();
  }
}

function removeWorkspace(path: string) {
  const normalized = normalizeWorkspacePath(path);
  if (normalized === normalizeWorkspacePath(notesDir.value)) {
    showStatus('无法移除当前打开的工作区');
    return;
  }
  recentWorkspaces.value = recentWorkspaces.value.filter(
    (item) => normalizeWorkspacePath(item) !== normalized,
  );
  localStorage.setItem(RECENT_WORKSPACES_STORAGE_KEY, JSON.stringify(recentWorkspaces.value));
}

function handleDocumentClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (!target?.closest('.tree-footer')) workspaceMenuOpen.value = false;
}

// ═══ 生命周期 ═══

let unlistenFileWatcher: (() => void) | null = null;
let fileTreeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/** 处理文件系统监听事件 */
function handleFileChangeEvent(event: NoteFileChangeEvent) {
  if (
    isNoteSelfWriting(event.path) ||
    (event.oldPath ? isNoteSelfWriting(event.oldPath) : false) ||
    (event.newPath ? isNoteSelfWriting(event.newPath) : false)
  ) {
    return;
  }

  switch (event.kind) {
    case 'create':
      void refreshNoteIndex(event.path);
      if (fileTreeDebounceTimer) clearTimeout(fileTreeDebounceTimer);
      fileTreeDebounceTimer = setTimeout(() => {
        const parentPath = event.path.includes('/')
          ? event.path.slice(0, event.path.lastIndexOf('/'))
          : '';
        void refreshDirectory(parentPath);
      }, 300);
      break;
    case 'remove':
      if (documentStore.documents.get(event.path)?.dirty) {
        noteSaveController.cancel(event.path);
        diagnosticsLogger.warn(
          'notes',
          'notes.external_remove_preserved',
          '外部删除后保留本地编辑内容',
          {
            path: event.path,
          },
        );
        return;
      }
      removeNote(event.path);
      {
        const nextState = removeTabsByPath(
          workspaceBoardState.value,
          event.path,
          Boolean(findNoteEntry(tree.value, event.path)?.isDir),
        );
        workspaceBoardState.value = nextState;
        workspaceBoardRef.value?.setState(nextState);
      }
      // 文件创建或删除 → 防抖刷新文件树
      if (fileTreeDebounceTimer) clearTimeout(fileTreeDebounceTimer);
      fileTreeDebounceTimer = setTimeout(() => {
        const parentPath = event.path.includes('/')
          ? event.path.slice(0, event.path.lastIndexOf('/'))
          : '';
        void refreshDirectory(parentPath);
      }, 300);
      break;
    case 'rename':
      if (event.oldPath && event.newPath) {
        void handleExternalRename(event.oldPath, event.newPath);
      }
      break;
    case 'modify':
      // 文件内容被外部修改 → 仅当不是当前正在编辑的文件时更新
      const activeWorkspacePath = getActiveWorkspacePath();
      if (event.path === activeWorkspacePath) {
        if (!documentStore.ensure(event.path).dirty) void reloadFromDisk(event.path);
        else void presentNoteConflict(event.path);
      } else if (allWorkspaceTabPaths.value.includes(event.path)) {
        const document = documentStore.ensure(event.path);
        if (document.dirty) void presentNoteConflict(event.path);
        else void reloadFromDisk(event.path);
      } else {
        // 更新缓存中的旧版本
        noteContentCache.delete(event.path);
      }
      void refreshNoteIndex(event.path);
      break;
  }
}

function getActiveWorkspacePath(): string | null {
  const currentState = workspaceBoardState.value;
  if (!currentState) return null;
  const activeLeaf = listLeaves(currentState.root).find(
    (leaf) => leaf.id === currentState.activeLeafId,
  );
  return activeLeaf?.tabs.find((tab) => tab.id === activeLeaf.activeTabId)?.path ?? null;
}

onMounted(async () => {
  loadLayoutState();
  constrainOnResize();
  loadRecentWorkspaces();
  void initializeNotesWorkspace();
  window.addEventListener('resize', constrainOnResize);
  window.addEventListener('keydown', handleKeyboardShortcuts, true);
  window.addEventListener('focus', checkExternalModification);
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('click', handleNoteActionsMenuOutside);

  // 监听 Rust 后端的文件系统变更事件
  const unlisten = await listen<NoteFileChangeEvent>('notes://file-changed', (event) =>
    handleFileChangeEvent(event.payload),
  );
  unlistenFileWatcher = () => unlisten();
});

async function initializeNotesWorkspace() {
  resetNoteWorkspaceLayout();
  await loadNotesDir();
  loadRecentNotePaths();
  await loadTree();
  await restoreNoteSession();
  void refreshIndex();
}

watch([openNoteTabs, activeNotePath, notesDir], saveNoteSession, { deep: true });

// 从其他视图切回笔记视图时，检测当前文件是否被外部修改
watch(
  () => props.active,
  (active) => {
    if (active) checkExternalModification();
  },
);

onUnmounted(() => {
  if (taskSyncTimer) clearTimeout(taskSyncTimer);
  noteSaveController.dispose();
  if (fileTreeDebounceTimer) clearTimeout(fileTreeDebounceTimer);
  if (unlistenFileWatcher) unlistenFileWatcher();
  window.removeEventListener('resize', constrainOnResize);
  window.removeEventListener('keydown', handleKeyboardShortcuts, true);
  window.removeEventListener('focus', checkExternalModification);
  document.removeEventListener('click', handleDocumentClick);
  document.removeEventListener('click', handleNoteActionsMenuOutside);
});
</script>

<template>
  <div class="note-workspace">
    <div class="note-editor">
      <!-- ═══ 左侧文件树 ═══ -->
      <aside
        class="file-tree"
        :style="{ width: effectiveTreeWidth > 0 ? `${effectiveTreeWidth}px` : '0px' }"
        :class="{ collapsed: sidebarCollapsed }"
      >
        <div class="tree-header">
          <div class="tree-header-actions">
            <button
              class="tree-header-btn"
              title="新建笔记"
              aria-label="新建笔记"
              @click="createUntitledFile()"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button
              class="tree-header-btn"
              title="新建文件夹"
              aria-label="新建文件夹"
              @click="createFolder('')"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
                />
                <path d="M12 10v6M9 13h6" />
              </svg>
            </button>
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
        <div class="tree-search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <input
            v-model="noteSearch"
            type="search"
            placeholder="过滤文件树"
            aria-label="过滤文件树"
          />
        </div>
        <div class="tree-list">
          <TreeNode
            v-for="entry in filteredDisplayTree"
            :key="entry.path"
            :entry="entry"
            :expanded="expanded"
            :selected-path="activeNotePath"
            :depth="0"
            @toggle-expand="toggleExpand"
            @select="openPathInActivePane"
            @create-file="createFile"
            @create-folder="createFolder"
            @context-menu="showFileTreeContextMenu"
            @rename="renameEntry"
            @delete="deleteEntry"
          />
        </div>

        <!-- 笔记目录设置 -->
        <div class="tree-footer" @click.stop>
          <button
            class="dir-info"
            :title="notesDir"
            @click="workspaceMenuOpen = !workspaceMenuOpen"
          >
            <span class="dir-label">目录:</span>
            <span class="dir-path">{{ notesDirShort }}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m7 10 5 5 5-5" />
            </svg>
          </button>
          <div v-if="workspaceMenuOpen" class="workspace-menu" role="menu">
            <div
              v-for="workspace in recentWorkspaces"
              :key="workspace"
              class="workspace-menu-entry"
            >
              <button
                type="button"
                class="workspace-menu-item"
                :class="{
                  active: normalizeWorkspacePath(workspace) === normalizeWorkspacePath(notesDir),
                }"
                role="menuitem"
                @click="switchNotesWorkspace(workspace)"
              >
                <span class="workspace-menu-name">{{ workspace.split(/[\\/]/).pop() }}</span>
                <span class="workspace-menu-path">{{ workspace }}</span>
                <span
                  v-if="normalizeWorkspacePath(workspace) === normalizeWorkspacePath(notesDir)"
                  class="workspace-menu-check"
                  >✓</span
                >
              </button>
              <button
                type="button"
                class="workspace-menu-remove"
                title="从工作区列表移除"
                aria-label="从工作区列表移除"
                @click="removeWorkspace(workspace)"
              >
                ×
              </button>
            </div>
            <div class="workspace-menu-divider" />
            <button
              type="button"
              class="workspace-menu-item workspace-menu-open"
              role="menuitem"
              @click="changeNotesDir"
            >
              <span class="workspace-menu-name">打开笔记工作区…</span>
            </button>
          </div>
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

        <div class="editor-main">
          <NoteWorkspaceBoard
            ref="workspaceBoardRef"
            :documents="documentStore.documents"
            :initial-state="workspaceBoardState"
            @open-path="handleWorkspaceOpenPath"
            @update-content="handleWorkspaceContentUpdate"
            @save-path="handleWorkspaceSavePath"
            @rename-path="handleWorkspaceRename"
            @create-note="handleWorkspaceCreateNote"
            @open-workspace="openNotesWorkspace"
            @open-menu="showSplitPaneMenu"
            @state-change="handleWorkspaceStateChange"
          >
            <template #leaf-tools="{ leaf }">
              <div
                v-if="
                  leaf.id === workspaceBoardState.activeLeafId &&
                  activeNotePath &&
                  currentTaskReferences.length
                "
                class="note-task-strip"
              >
                <button class="note-task-add" title="在正文中创建任务" @click="addTaskReference">
                  ＋
                </button>
                <button class="note-task-add" title="关联已有任务" @click="linkExistingTask">
                  关联
                </button>
                <span class="note-task-strip-label">本页任务</span>
                <button
                  v-for="reference in currentTaskReferences"
                  :key="`${reference.taskId}-${reference.line}`"
                  class="note-task-chip"
                  :class="{ completed: taskForReference(reference)?.completed }"
                  :title="taskForReference(reference)?.title || reference.title"
                  @click="handleTaskToggle(reference.taskId)"
                  @contextmenu="showTaskReferenceMenu($event, reference)"
                >
                  <span class="note-task-checkbox">{{
                    taskForReference(reference)?.completed ? '✓' : ''
                  }}</span>
                  <span>{{ taskForReference(reference)?.title || reference.title }}</span>
                </button>
              </div>
              <div
                v-else-if="leaf.id === workspaceBoardState.activeLeafId && activeNotePath"
                class="note-task-strip note-task-strip-empty"
              >
                <span class="note-task-strip-label">正文中的正式任务</span>
                <button class="note-task-add" @click="addTaskReference">创建任务</button>
                <button class="note-task-add" @click="linkExistingTask">关联已有任务</button>
              </div>
            </template>
          </NoteWorkspaceBoard>
          <div class="editor-statusbar">
            <span>UTF-8</span>
            <span class="statusbar-sep">|</span>
            <span>Markdown</span>
            <span class="statusbar-sep">|</span>
            <span>{{ wordCount }}</span>
            <span class="statusbar-sep">|</span>
            <span>Line {{ cursorLine }}, Col {{ cursorCol }}</span>
            <span v-if="saving" class="statusbar-saving">保存中...</span>
          </div>
        </div>
        <aside v-if="contextPanelOpen" class="note-context-panel">
          <template v-if="activeNotePath">
            <div class="context-heading">
              <div>
                <span class="context-eyebrow">CONTEXT</span>
                <h2>当前笔记</h2>
              </div>
              <span class="context-count">{{ currentTaskReferences.length }}</span>
            </div>
            <section class="context-section">
              <div class="context-section-title">本页任务</div>
              <button
                v-for="reference in currentTaskReferences"
                :key="`context-${reference.taskId}-${reference.line}`"
                type="button"
                class="context-task"
                :class="{ completed: taskForReference(reference)?.completed }"
                @click="handleTaskToggle(reference.taskId)"
              >
                <span class="context-task-box">{{
                  taskForReference(reference)?.completed ? '✓' : ''
                }}</span>
                <span>{{ taskForReference(reference)?.title || reference.title }}</span>
              </button>
              <button type="button" class="context-add-task" @click="addTaskReference">
                + 新建正式任务
              </button>
            </section>
            <section v-if="backlinkPaths.length > 0" class="context-section">
              <div class="context-section-title">反向链接 · {{ backlinkPaths.length }}</div>
              <button
                v-for="path in backlinkPaths"
                :key="path"
                type="button"
                class="context-link"
                @click="openPathInActivePane(path)"
              >
                <span>{{ path.split('/').pop() }}</span>
                <small>{{ path }}</small>
              </button>
            </section>
            <section v-if="outline.length > 0" class="context-section">
              <div class="context-section-title">{{ outlinePanelLabel }}</div>
              <div
                v-for="item in outline"
                :key="`${item.level}-${item.title}`"
                class="outline-item"
                :style="{ paddingLeft: `${(item.level - 1) * 12}px` }"
              >
                {{ item.title }}
              </div>
            </section>
          </template>
          <div v-else class="context-empty">
            <span class="context-eyebrow">CONTEXT</span>
            <h2>工作区概览</h2>
            <p>选择一篇笔记后，这里会显示任务、反向链接和笔记大纲。</p>
          </div>
        </aside>
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
      :confirm-text="confirmActionText"
      :cancel-text="confirmCancelText"
      :danger="confirmDanger"
      @confirm="handleConfirmOk"
      @cancel="handleConfirmCancel"
    />

    <TaskPicker
      :visible="taskPickerVisible"
      :tasks="tasks"
      :current-task-ids="currentTaskReferences.map((reference) => reference.taskId)"
      @select="insertTaskReference"
      @create="createTaskFromPicker"
      @cancel="closeTaskPicker"
    />

    <NoteQuickSwitcher
      :visible="noteQuickSwitcherVisible"
      :tree="tree"
      :open-tabs="allWorkspaceTabPaths"
      :selected-path="getActiveWorkspacePath()"
      :recent-paths="recentNotePaths"
      @select="selectQuickSwitcherPath"
      @cancel="closeNoteQuickSwitcher"
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
  min-width: 0;
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
  transition: all var(--transition-fast);
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
  width: 34px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 6px;
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
  position: relative;
}

.note-workspace-board {
  flex: 1;
  min-height: 0;
}

.note-tabs {
  display: flex;
  align-items: stretch;
  min-height: 38px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
  scrollbar-width: none;
}

.note-tabs::-webkit-scrollbar {
  display: none;
}

.note-tab,
.note-tab-new {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 0 12px;
  border: 0;
  border-right: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
}

.note-tab {
  max-width: 210px;
}

.note-tab:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.note-tab.active {
  background: var(--bg-primary);
  color: var(--text-primary);
  box-shadow: inset 0 2px 0 var(--accent);
}

.note-tab-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-tab-dirty {
  color: var(--accent);
  font-size: 14px;
  line-height: 1;
}

.note-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 15px;
  line-height: 1;
}

.note-tab-close:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}

.note-tab-new {
  width: 38px;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 18px;
}

.note-tab-new:hover {
  color: var(--accent);
  background: var(--bg-hover);
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

.editor-toolbar-split {
  display: none;
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

.context-toggle.active {
  color: var(--accent);
  background: var(--accent-light);
}

.context-toggle svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
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

/* 低频笔记操作统一收纳到更多菜单。 */
.toolbar-right > .toolbar-action-btn:not(.context-toggle) {
  display: none;
}

.note-toolbar-menu {
  position: relative;
}

.note-toolbar-menu-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  min-width: 168px;
  padding: var(--space-xs);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  box-shadow: var(--shadow-lg);
}

.note-toolbar-menu-popover button {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
}

.note-toolbar-menu-popover button:hover {
  background: var(--bg-hover);
}

.note-toolbar-menu-popover button:disabled {
  opacity: 0.5;
  cursor: wait;
}

.note-toolbar-menu-popover svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}

.note-toolbar-menu-separator {
  height: 1px;
  margin: var(--space-xs) 0;
  background: var(--border-subtle);
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

.toolbar-action-btn.active {
  background: var(--accent-bg);
  color: var(--accent);
  border-color: var(--accent-muted);
}

.toolbar-action-btn:disabled {
  opacity: 0.5;
  cursor: wait;
}

.editor-modes {
  display: none;
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

.note-task-strip {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-height: 38px;
  padding: 0 var(--space-lg);
  overflow-x: auto;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

.note-task-strip-label {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.note-task-add {
  flex-shrink: 0;
  padding: 3px 8px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  cursor: pointer;
}

.note-task-add:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.note-task-strip-empty {
  gap: var(--space-sm);
}

.note-task-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  max-width: 240px;
  padding: 4px 8px;
  overflow: hidden;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-task-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.note-task-chip.completed {
  color: var(--text-muted);
  text-decoration: line-through;
}

.note-task-checkbox {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: 1px solid var(--border-default);
  border-radius: 3px;
  color: var(--accent);
  text-decoration: none;
}

.editor-panes {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.editor-panes-split-horizontal {
  flex-direction: row;
}

.editor-panes-split-vertical {
  flex-direction: column;
}

.editor-panes-split-horizontal .editor-document,
.editor-panes-split-vertical .editor-document {
  min-width: 0;
  min-height: 0;
}

.editor-panes-split-horizontal .editor-document {
  width: 50%;
}

.editor-panes-split-vertical .editor-document {
  height: 50%;
}

.split-editor-document {
  border-left: 1px solid var(--border-subtle);
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-primary);
}

.split-pane-tabs {
  display: flex;
  align-items: stretch;
  min-height: 40px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

.split-pane-tab {
  min-width: 128px;
  max-width: 220px;
  min-height: 36px;
  padding: 0 12px;
  border: 0;
  border-right: 1px solid var(--border-subtle);
  border-radius: 0;
  font-size: var(--text-xs);
}

.split-pane-tab.active {
  background: var(--bg-primary);
  box-shadow: inset 0 -2px 0 var(--accent);
}

.split-pane-document-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 38px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.split-pane-header-side {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 72px;
}

.split-pane-header-actions {
  justify-content: flex-end;
}

.split-pane-nav-btn {
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

.split-pane-nav-btn:not(:disabled):hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.split-pane-nav-btn:disabled {
  opacity: 0.42;
  cursor: default;
}

.split-pane-nav-btn svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.split-pane-document-title {
  min-width: 0;
  max-width: 60%;
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

.split-pane-label {
  color: var(--text-muted);
}

.split-pane-empty-tab {
  flex: 0 0 128px;
  min-width: 128px;
  max-width: 220px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  box-shadow: inset 0 -2px 0 var(--accent);
}

.split-pane-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 260px;
  padding: 32px 24px;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.split-pane-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.split-pane-welcome-btn {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.split-pane-welcome-btn span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.split-pane-welcome-btn:hover {
  color: var(--accent-hover);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.note-document-title-split,
.note-task-strip-split {
  display: none;
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

.editor-document {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
}

.note-document-title {
  width: min(820px, 100%);
  box-sizing: border-box;
  margin: 18px auto 4px;
  padding: 0 32px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: clamp(30px, 3vw, 36px);
  font-weight: 700;
  letter-spacing: -0.04em;
}

.note-document-title::selection {
  background: var(--selection-bg, rgba(124, 92, 255, 0.24));
}

@media (max-width: 720px) {
  .note-document-title {
    margin-top: 14px;
    padding: 0 20px;
  }
}

.editor-document-body {
  flex: 0 0 auto;
  display: block;
  overflow: visible;
}

.editor-document-body > :first-child {
  width: 100%;
  height: auto;
}

.editor-document-body :deep(.codemirror-wrapper) {
  flex: none;
  overflow: visible;
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

/* ═══ 笔记工作区正式布局 ═══ */

.note-workspace {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
}

.workspace-topbar {
  height: 38px;
  flex: 0 0 38px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

.note-editor {
  min-height: 0;
  height: auto;
}

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

.editor-area {
  min-width: 0;
}

.editor-main {
  background: var(--bg-primary);
}

.tab-drag-ghost {
  position: fixed;
  z-index: 60;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 240px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: var(--text-primary);
  color: var(--bg-primary);
  font-size: var(--text-sm);
  font-weight: 600;
  box-shadow: var(--shadow-md);
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
}

.tab-drag-ghost svg {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tab-drag-ghost span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-drop-indicator {
  position: fixed;
  z-index: 55;
  width: 3px;
  border-radius: 999px;
  background: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
  pointer-events: none;
}

.split-drop-preview {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 28px;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 50%;
  border: 2px solid var(--accent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent) 42%, transparent);
  pointer-events: none;
}

.split-drop-preview-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  font-size: var(--text-sm);
  font-weight: 600;
  box-shadow: var(--shadow-md);
}

.split-drop-preview-label svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.editor-toolbar {
  min-height: 48px;
  padding: 0 26px;
  background: var(--bg-primary);
}

.toolbar-filename {
  color: var(--text-muted);
  font-size: 12px;
}

.editor-modes {
  display: none;
}

.editor-panes {
  gap: 0;
}

.welcome-content {
  max-width: 430px;
  text-align: left;
}

.welcome-eyebrow {
  display: block;
  margin-bottom: 12px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
}

.welcome-title {
  margin-bottom: 10px;
  font-size: clamp(28px, 3vw, 38px);
  letter-spacing: -0.04em;
}

.welcome-desc {
  margin-bottom: 22px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.7;
}

.welcome-shortcuts {
  display: flex;
  gap: 16px;
  margin-top: 18px;
  color: var(--text-muted);
  font-size: 11px;
}

.welcome-shortcuts kbd {
  margin-right: 4px;
  padding: 3px 5px;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  background: var(--bg-secondary);
  font-size: 10px;
}

.note-context-panel {
  width: 260px;
  flex: 0 0 260px;
  overflow-y: auto;
  padding: 24px 18px;
  border-left: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

.context-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 20px;
}

.context-eyebrow {
  display: block;
  margin-bottom: 6px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.context-heading h2,
.context-empty h2 {
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 700;
}

.context-count {
  display: inline-flex;
  min-width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--accent-muted);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
}

.context-section {
  padding: 16px 0;
  border-top: 1px solid var(--border-subtle);
}

.context-section-title {
  margin-bottom: 10px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
}

.context-task,
.context-link,
.context-add-task {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 0;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
  font: inherit;
  font-size: 12px;
}

.context-task:hover,
.context-link:hover,
.context-add-task:hover {
  color: var(--accent);
}

.context-task.completed {
  color: var(--text-muted);
  text-decoration: line-through;
}

.context-task-box {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  color: var(--accent);
  font-size: 10px;
}

.context-task.completed .context-task-box {
  border-color: var(--accent);
  background: var(--accent-muted);
}

.context-add-task {
  margin-top: 5px;
  color: var(--accent);
  font-size: 11px;
}

.context-link {
  flex-direction: column;
  gap: 1px;
}

.context-link small {
  color: var(--text-muted);
  font-size: 10px;
}

.outline-item {
  padding-top: 5px;
  padding-bottom: 5px;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.context-empty {
  padding-top: 12px;
}

.context-empty p {
  margin-top: 12px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.7;
}

@media (max-width: 1180px) {
  .note-context-panel {
    display: none;
  }
}

/* 顶层标签栏不再横跨文件栏；编辑区内的副本承担实际显示。 */
.workspace-topbar {
  display: none;
}

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

.sidebar-toggle-strip .tree-header-btn {
  width: 28px;
  height: 30px;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
}

.sidebar-toggle-strip .tree-header-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sidebar-toggle-strip {
  display: none;
}

.editor-file-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  margin: 0 4px 2px 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.editor-file-toggle:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.editor-file-toggle svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* 任务是正文中的块，不在编辑器上方重复呈现一条任务栏。 */
.note-task-strip {
  display: none;
}

.editor-toolbar {
  height: 38px;
  min-height: 38px;
  padding: 0 14px;
}

.editor-welcome {
  align-items: center;
  justify-content: center;
  padding: 32px;
}

.welcome-content {
  max-width: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.welcome-eyebrow {
  margin-bottom: 10px;
  color: var(--text-muted);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.welcome-title {
  margin-bottom: 8px;
  font-size: clamp(24px, 3vw, 32px);
  letter-spacing: -0.03em;
}

.welcome-desc {
  max-width: 34em;
  margin-bottom: 20px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.7;
}

.welcome-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.welcome-btn {
  min-height: 28px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--accent);
  font-size: 15px;
  cursor: pointer;
  box-shadow: none;
}

.welcome-btn svg {
  display: none;
}

.welcome-btn span {
  color: var(--text-muted);
  font-size: 12px;
}

.welcome-btn:hover,
.welcome-btn-primary:hover {
  background: var(--bg-hover);
  color: var(--accent-hover);
  border: 0;
  transform: none;
  box-shadow: none;
}

.welcome-shortcuts {
  justify-content: flex-start;
  gap: 14px;
}

.toolbar-filename {
  font-weight: 400;
  color: var(--text-muted);
}
</style>
