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
import { ref, watch, computed, onMounted, onUnmounted, nextTick, defineAsyncComponent } from 'vue';
import { invokeWithDiagnostics as invoke } from '../../diagnostics/invoke-logged';
import { diagnosticsLogger } from '../../diagnostics/invoke-logged';
import { open, save } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import type {
  FileEntry,
  FileTreeContextTarget,
  NoteWorkspaceLayout,
  NotesLayoutState,
  Task,
} from '../../types';
import { compactFileTree } from '../../utils/note-tree';
import { getMenuRegistrations, type EditorSelection } from '../../plugin-api/menus-impl';
import InputDialog from '../overlays/InputDialog.vue';
import ConfirmDialog from '../overlays/ConfirmDialog.vue';
import TreeNode from './TreeNode.vue';
import TaskPicker from '../tasks/TaskPicker.vue';
import NoteQuickSwitcher from './NoteQuickSwitcher.vue';
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
import { FILE_CHANGED_EXTERNALLY } from '../../utils/error-codes';

interface MarkdownEditorApi {
  wrapSelection: (before: string, after: string) => void;
  insertText: (text: string) => void;
  prependToLine: (text: string) => void;
  getSelection: () => string;
  replaceSelection: (text: string) => void;
  focus: () => void;
}

const MarkdownEditor = defineAsyncComponent({
  loader: () => import('./MarkdownEditor.vue'),
  suspensible: false,
});

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
const selectedPath = ref<string | null>(null);
const openTabs = ref<string[]>([]);
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
const content = computed({
  get: () => (selectedPath.value ? documentStore.ensure(selectedPath.value).content : ''),
  set: (value: string) => {
    if (selectedPath.value) documentStore.updateContent(selectedPath.value, value);
  },
});
const isDirty = computed(() =>
  selectedPath.value ? documentStore.ensure(selectedPath.value).dirty : false,
);
const currentFileMtime = computed(() =>
  selectedPath.value ? documentStore.ensure(selectedPath.value).mtime : null,
);

const { tasks, toggleTask, toggleDailyTask, updateTask, addTask, deleteTask } = useTaskStore();
const {
  referenceIndex,
  setNoteContent,
  refreshIndex,
  refreshNoteIndex,
  removeNote,
  resetNotes,
  removeNotesUnderPath,
  renameNote,
  projectTask,
  removeTaskFromAllNotes,
} = useNoteTaskSync();
let projectingTaskReferences = false;
let taskSyncTimer: ReturnType<typeof setTimeout> | null = null;
let taskSnapshot = new Map<string, { title: string; completed: boolean }>();
let focusTitleAfterOpen = false;

const textareaRef = ref<MarkdownEditorApi | null>(null);

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
const noteWorkspaceLayout = ref<NoteWorkspaceLayout>({
  panes: [{ id: 'main', tabs: [], activeTab: null }],
  activePaneId: 'main',
  direction: null,
});
const secondaryTabs = ref<string[]>([]);
const secondaryActiveTab = ref<string | null>(null);
const secondaryLoading = ref(false);
const secondaryContent = computed({
  get: () =>
    secondaryActiveTab.value ? documentStore.ensure(secondaryActiveTab.value).content : '',
  set: (value: string) => {
    if (secondaryActiveTab.value) documentStore.updateContent(secondaryActiveTab.value, value);
  },
});
const secondaryDirty = computed(() =>
  secondaryActiveTab.value ? documentStore.ensure(secondaryActiveTab.value).dirty : false,
);
const secondaryFileMtime = computed(() =>
  secondaryActiveTab.value ? documentStore.ensure(secondaryActiveTab.value).mtime : null,
);
let openFileSequence = 0;
type WorkspacePaneId = 'main' | 'secondary';
let draggedTab: { path: string; pane: WorkspacePaneId } | null = null;
const draggedTabPath = ref<string | null>(null);
const splitDropPreview = ref(false);
const tabDropIndicator = ref<{
  left: number;
  top: number;
  height: number;
} | null>(null);
const dragGhostPosition = ref({ left: 0, top: 0 });
let pointerDrag: {
  path: string;
  pane: WorkspacePaneId;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
} | null = null;
let suppressNextTabClick = false;

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

function splitNoteWorkspace(direction: 'horizontal' | 'vertical') {
  if (!selectedPath.value) {
    showStatus('请先打开一篇笔记');
    closeNoteActionsMenu();
    return;
  }

  const secondaryPath =
    openTabs.value.find((path) => path !== selectedPath.value) || selectedPath.value;
  secondaryTabs.value = [...openTabs.value];
  secondaryActiveTab.value = secondaryPath;
  void loadSecondaryNote(secondaryPath);

  noteWorkspaceLayout.value = {
    panes: [
      { id: 'main', tabs: [...openTabs.value], activeTab: selectedPath.value },
      { id: 'secondary', tabs: [...secondaryTabs.value], activeTab: secondaryPath },
    ],
    activePaneId: 'main',
    direction,
  };
  closeNoteActionsMenu();
}

function splitNoteWorkspaceWithTab(direction: 'horizontal' | 'vertical', tabPath: string) {
  if (!selectedPath.value) return;

  const remainingTabs = openTabs.value.filter((path) => path !== tabPath);
  const mainTabs = remainingTabs.length > 0 ? remainingTabs : [...openTabs.value];
  openTabs.value = mainTabs;
  if (selectedPath.value === tabPath && remainingTabs.length > 0) {
    void openFile(remainingTabs[0]);
  }

  secondaryTabs.value = [tabPath];
  secondaryActiveTab.value = tabPath;
  void loadSecondaryNote(tabPath);
  noteWorkspaceLayout.value = {
    panes: [
      { id: 'main', tabs: [...mainTabs], activeTab: selectedPath.value },
      { id: 'secondary', tabs: [tabPath], activeTab: tabPath },
    ],
    activePaneId: 'main',
    direction,
  };
}

function closeNoteWorkspaceSplit() {
  noteWorkspaceLayout.value = {
    panes: [{ id: 'main', tabs: [...openTabs.value], activeTab: selectedPath.value }],
    activePaneId: 'main',
    direction: null,
  };
  secondaryTabs.value = [];
  secondaryActiveTab.value = null;
  secondaryContent.value = '';
  closeNoteActionsMenu();
}

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
        if (!selectedPath.value) return;
        await navigator.clipboard?.writeText(selectedPath.value);
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

async function loadSecondaryNote(path: string | null) {
  if (!path) return;
  secondaryLoading.value = true;
  documentStore.beginLoading(path);
  try {
    const cached = noteContentCache.get(path);
    if (cached !== undefined) {
      let cachedMtime: string | null = null;
      try {
        cachedMtime = await invoke<string>('get_note_mtime', { path });
      } catch {
        cachedMtime = null;
      }
      documentStore.finishLoading(path, cached, cachedMtime);
      return;
    }
    const meta = await invoke<{ content: string; mtime: string }>('read_note_meta', { path });
    noteContentCache.set(path, meta.content);
    documentStore.finishLoading(path, meta.content, meta.mtime);
  } catch {
    documentStore.failLoading(path);
    showStatus('无法读取分栏笔记');
  } finally {
    secondaryLoading.value = false;
  }
}

function selectSecondaryTab(path: string) {
  secondaryActiveTab.value = path;
  noteWorkspaceLayout.value.panes[1] = {
    id: 'secondary',
    tabs: [...secondaryTabs.value],
    activeTab: path,
  };
  void loadSecondaryNote(path);
}

function closeSecondaryTab(path: string) {
  const index = secondaryTabs.value.indexOf(path);
  if (index < 0) return;
  const nextTabs = secondaryTabs.value.filter((tab) => tab !== path);
  if (nextTabs.length === 0) {
    closeNoteWorkspaceSplit();
    return;
  }
  secondaryTabs.value = nextTabs;
  const nextPath =
    secondaryActiveTab.value === path
      ? nextTabs[index] || nextTabs[index - 1] || nextTabs[0]
      : secondaryActiveTab.value;
  if (nextPath) selectSecondaryTab(nextPath);
}

function syncWorkspacePaneTabs() {
  noteWorkspaceLayout.value.panes[0].tabs = [...openTabs.value];
  noteWorkspaceLayout.value.panes[0].activeTab = selectedPath.value;
  if (noteWorkspaceLayout.value.direction && noteWorkspaceLayout.value.panes[1]) {
    noteWorkspaceLayout.value.panes[1].tabs = [...secondaryTabs.value];
    noteWorkspaceLayout.value.panes[1].activeTab = secondaryActiveTab.value;
  }
}

function moveTabInList(tabs: string[], fromIndex: number, targetIndex: number) {
  const nextTabs = [...tabs];
  const [movedTab] = nextTabs.splice(fromIndex, 1);
  const adjustedIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
  nextTabs.splice(Math.max(0, adjustedIndex), 0, movedTab);
  return nextTabs;
}

function handleTabDrop(event: DragEvent, targetPane: WorkspacePaneId, targetIndex: number) {
  event.preventDefault();
  event.stopPropagation();
  const source = draggedTab;
  draggedTab = null;
  if (!source) return;

  const targetElement = event.currentTarget as HTMLElement | null;
  if (targetElement?.classList.contains('workspace-tab')) {
    const rect = targetElement.getBoundingClientRect();
    const isAfterTarget =
      targetPane === 'main'
        ? event.clientX >= rect.left + rect.width / 2
        : event.clientX >= rect.left + rect.width / 2;
    if (isAfterTarget) targetIndex += 1;
  }

  const sourceTabs = source.pane === 'main' ? openTabs.value : secondaryTabs.value;
  const sourceIndex = sourceTabs.indexOf(source.path);
  if (sourceIndex < 0) return;

  if (source.pane === targetPane) {
    const nextTabs = moveTabInList(sourceTabs, sourceIndex, targetIndex);
    if (targetPane === 'main') openTabs.value = nextTabs;
    else secondaryTabs.value = nextTabs;
    syncWorkspacePaneTabs();
    return;
  }

  if (source.pane === 'main' && openTabs.value.length === 1) {
    showStatus('主分栏至少保留一篇笔记');
    return;
  }

  if (source.pane === 'main') {
    openTabs.value = openTabs.value.filter((tab) => tab !== source.path);
    if (selectedPath.value === source.path) {
      const nextPath = openTabs.value[sourceIndex] || openTabs.value[sourceIndex - 1] || null;
      if (nextPath) void openFile(nextPath);
      else {
        selectedPath.value = null;
        content.value = '';
      }
    }

    if (!secondaryTabs.value.includes(source.path)) {
      secondaryTabs.value = [
        ...secondaryTabs.value.slice(0, targetIndex),
        source.path,
        ...secondaryTabs.value.slice(targetIndex),
      ];
    }
    secondaryActiveTab.value = source.path;
    void loadSecondaryNote(source.path);
  } else {
    secondaryTabs.value = secondaryTabs.value.filter((tab) => tab !== source.path);
    if (secondaryActiveTab.value === source.path) {
      const nextPath =
        secondaryTabs.value[sourceIndex] || secondaryTabs.value[sourceIndex - 1] || null;
      secondaryActiveTab.value = nextPath;
      if (nextPath) void loadSecondaryNote(nextPath);
      else {
        secondaryContent.value = '';
        closeNoteWorkspaceSplit();
      }
    }

    if (!openTabs.value.includes(source.path)) {
      openTabs.value = [
        ...openTabs.value.slice(0, targetIndex),
        source.path,
        ...openTabs.value.slice(targetIndex),
      ];
    }
    void openFile(source.path);
  }

  syncWorkspacePaneTabs();
}

function handleTabClick(event: MouseEvent, path: string, pane: WorkspacePaneId) {
  if (suppressNextTabClick) {
    event.preventDefault();
    suppressNextTabClick = false;
    return;
  }
  if (pane === 'main') void openFile(path);
  else selectSecondaryTab(path);
}

function getPointerDropTarget(clientX: number, clientY: number) {
  const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  const tab = element?.closest<HTMLElement>('[data-workspace-tab]');
  if (tab) {
    const pane = tab.dataset.workspacePane as WorkspacePaneId | undefined;
    const path = tab.dataset.workspacePath;
    if (!pane || !path) return null;
    const tabs = pane === 'main' ? openTabs.value : secondaryTabs.value;
    const index = tabs.indexOf(path);
    if (index < 0) return null;
    const rect = tab.getBoundingClientRect();
    return {
      pane,
      index: index + (clientX >= rect.left + rect.width / 2 ? 1 : 0),
      element: tab,
    };
  }

  const strip = element?.closest<HTMLElement>('[data-workspace-tabs]');
  if (!strip) return null;
  const pane = strip.dataset.workspaceTabs as WorkspacePaneId | undefined;
  if (!pane) return null;
  return {
    pane,
    index: pane === 'main' ? openTabs.value.length : secondaryTabs.value.length,
    element: strip,
  };
}

function handleTabPointerDown(event: PointerEvent, path: string, pane: WorkspacePaneId) {
  if (event.button !== 0) return;
  if ((event.target as HTMLElement).closest('.workspace-tab-close')) return;
  pointerDrag = {
    path,
    pane,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
  };
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', handleTabPointerMove, { passive: false });
  window.addEventListener('pointerup', handleTabPointerUp);
  window.addEventListener('pointercancel', handleTabPointerCancel);
}

function handleTabPointerMove(event: PointerEvent) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const distance = Math.hypot(
    event.clientX - pointerDrag.startX,
    event.clientY - pointerDrag.startY,
  );
  if (!pointerDrag.active && distance < 6) return;
  if (!pointerDrag.active) {
    pointerDrag.active = true;
    draggedTab = { path: pointerDrag.path, pane: pointerDrag.pane };
    draggedTabPath.value = pointerDrag.path;
    document.body.classList.add('workspace-pointer-dragging');
  }
  dragGhostPosition.value = {
    left: event.clientX + 14,
    top: event.clientY + 14,
  };
  updateSplitDropPreview(event.clientX, event.clientY);
  updateTabDropIndicator(event.clientX, event.clientY);
  event.preventDefault();
}

function updateSplitDropPreview(clientX: number, clientY: number) {
  if (!pointerDrag?.active || noteWorkspaceLayout.value.direction) {
    splitDropPreview.value = false;
    return;
  }

  const editorMain = document.querySelector<HTMLElement>('.editor-main');
  const documentBody = editorMain?.querySelector<HTMLElement>('.editor-document-body');
  if (!editorMain || !documentBody) {
    splitDropPreview.value = false;
    return;
  }

  const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  const isOverTabArea = Boolean(element?.closest('[data-workspace-tab], [data-workspace-tabs]'));
  const bodyRect = documentBody.getBoundingClientRect();
  const isInsideDocumentBody =
    clientX >= bodyRect.left &&
    clientX <= bodyRect.right &&
    clientY >= bodyRect.top &&
    clientY <= bodyRect.bottom;
  const rightDropZoneStart = bodyRect.left + bodyRect.width * 0.68;
  const isInsideRightDropZone = clientX >= rightDropZoneStart;

  splitDropPreview.value = !isOverTabArea && isInsideDocumentBody && isInsideRightDropZone;
}

function updateTabDropIndicator(clientX: number, clientY: number) {
  if (!pointerDrag?.active || splitDropPreview.value) {
    tabDropIndicator.value = null;
    return;
  }

  const target = getPointerDropTarget(clientX, clientY);
  if (!target) {
    tabDropIndicator.value = null;
    return;
  }

  const targetElement = target.element as HTMLElement;
  const targetRect = targetElement.getBoundingClientRect();
  const isTab = targetElement.matches('[data-workspace-tab]');
  const isAfter = isTab && clientX >= targetRect.left + targetRect.width / 2;
  tabDropIndicator.value = {
    left: isAfter ? targetRect.right : targetRect.left,
    top: targetRect.top,
    height: targetRect.height,
  };
}

function finishTabPointerDrag(event: PointerEvent) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const wasDragging = pointerDrag.active;
  if (wasDragging) {
    if (splitDropPreview.value && draggedTab) {
      splitNoteWorkspaceWithTab('horizontal', draggedTab.path);
      draggedTab = null;
    } else {
      const target = getPointerDropTarget(event.clientX, event.clientY);
      if (target) {
        const dropEvent = {
          clientX: event.clientX,
          currentTarget: target.element,
          preventDefault: () => undefined,
          stopPropagation: () => undefined,
        } as unknown as DragEvent;
        handleTabDrop(dropEvent, target.pane, target.index);
      } else {
        draggedTab = null;
      }
    }
    suppressNextTabClick = true;
  }
  pointerDrag = null;
  draggedTabPath.value = null;
  splitDropPreview.value = false;
  tabDropIndicator.value = null;
  document.body.classList.remove('workspace-pointer-dragging');
  window.removeEventListener('pointermove', handleTabPointerMove);
  window.removeEventListener('pointerup', handleTabPointerUp);
  window.removeEventListener('pointercancel', handleTabPointerCancel);
}

function handleTabPointerUp(event: PointerEvent) {
  finishTabPointerDrag(event);
}

function handleTabPointerCancel(event: PointerEvent) {
  finishTabPointerDrag(event);
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
  if (!selectedPath.value) return '';
  return selectedPath.value.split('/').pop() || '';
});

const outlinePanelLabel = computed(() => {
  const noteName = selectedName.value.replace(/\.md$/i, '');
  return noteName ? `${noteName}的大纲` : '笔记大纲';
});

/** 当前笔记中出现的正式任务引用。 */
const currentTaskReferences = computed(() => {
  if (!selectedPath.value) return [];
  return parseTaskReferences(content.value, selectedPath.value);
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

    if (!selectedPath.value) return;
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

  const references = parseTaskReferences(markdown, selectedPath.value || '');
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
  if (!selectedPath.value) return;
  const title = await showDialog('在笔记中创建任务', '任务标题');
  const trimmed = title?.trim();
  if (!trimmed) return;
  const task = await addTask(trimmed, null, [], false, false, false);
  if (!task) return;
  textareaRef.value?.insertText(`${renderTaskReference(task)}\n`);
}

function openTaskPicker() {
  if (!selectedPath.value) return;
  taskPickerVisible.value = true;
}

function closeTaskPicker() {
  taskPickerVisible.value = false;
  nextTick(() => textareaRef.value?.focus());
}

function insertTaskReference(task: Task) {
  if (currentTaskReferences.value.some((reference) => reference.taskId === task.id)) {
    showStatus('该任务已经关联到当前笔记');
    closeTaskPicker();
    return;
  }
  textareaRef.value?.insertText(`${renderTaskReference(task)}\n`);
  taskPickerVisible.value = false;
}

async function createTaskFromPicker(title: string) {
  const task = await addTask(title, null, [], false, false, false);
  if (!task) return;
  textareaRef.value?.insertText(`${renderTaskReference(task)}\n`);
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
  if (copied) textareaRef.value?.insertText(`${renderTaskReference(copied)}\n`);
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

function filterFileTree(entries: FileEntry[], query: string): FileEntry[] {
  if (!query.trim()) return entries;
  const normalized = query.trim().toLocaleLowerCase();
  return entries.flatMap((entry) => {
    if (entry.isDir) {
      const children = filterFileTree(entry.children ?? [], normalized);
      return children.length > 0 ? [{ ...entry, children }] : [];
    }
    return entry.name.toLocaleLowerCase().includes(normalized) ? [entry] : [];
  });
}

const filteredDisplayTree = computed(() => filterFileTree(displayTree.value, noteSearch.value));

/** 当前笔记中的 Markdown 标题，用于笔记大纲。
 *  代码块（``` 围栏）内的 # 不会被识别为标题。 */
const outline = computed(() => {
  const codeFenceRe = /^\s{0,3}(`{3,}|~{3,})/;
  const result: { level: number; title: string }[] = [];
  let inCodeFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  for (const line of content.value.split(/\r?\n/)) {
    const fence = codeFenceRe.exec(line);
    if (fence) {
      if (!inCodeFence) {
        inCodeFence = true;
        fenceChar = fence[1][0];
        fenceLen = fence[1].length;
      } else if (fence[1][0] === fenceChar && fence[1].length >= fenceLen) {
        inCodeFence = false;
      }
      continue;
    }
    if (inCodeFence) continue;

    const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (match) {
      result.push({ level: match[1].length, title: match[2] });
    }
  }

  return result;
});

/** 当前笔记任务引用所在的其他笔记路径，用于反向链接提示。 */
const backlinkPaths = computed(() => {
  const paths = new Set<string>();
  for (const reference of currentTaskReferences.value) {
    for (const item of referenceIndex.value.byTaskId.get(reference.taskId) ?? []) {
      if (item.notePath !== selectedPath.value) paths.add(item.notePath);
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
  const taskItems = selectedPath.value
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
  if (!selectedPath.value) return;
  await queueNoteSave(
    selectedPath.value,
    { content: content.value, expectedMtime: currentFileMtime.value },
    true,
  );
}

// ═══ 外部文件变更处理 ═══

/** 使用 Pandoc 将当前笔记导出为 Word 文档。 */
async function exportCurrentNoteToDocx() {
  const path = selectedPath.value;
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
async function reloadFromDisk(path = selectedPath.value) {
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
async function checkExternalModification() {
  if (!selectedPath.value) return;
  try {
    const diskMtime = await invoke<string>('get_note_mtime', { path: selectedPath.value });
    if (currentFileMtime.value && diskMtime !== currentFileMtime.value) {
      if (isDirty.value) await presentNoteConflict(selectedPath.value);
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

function normalizeWorkspacePath(path: string) {
  return path.replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase();
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
    openTabs.value = [];
    selectedPath.value = null;
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
  const entry = findEntry(tree.value, directoryPath);
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
  const entry = findEntry(tree.value, directoryPath);
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
  let entry = findEntry(tree.value, directoryPath);
  while (entry?.isDir && entry.children?.length === 1 && entry.children[0].isDir) {
    entry = entry.children[0];
  }
  return entry ? loadDirectory(entry.path) : false;
}

interface NoteSessionState {
  openTabs: string[];
  selectedPath: string | null;
}

function sessionStorageKey() {
  return `${NOTE_SESSION_STORAGE_PREFIX}${normalizeWorkspacePath(notesDir.value)}`;
}

function saveNoteSession() {
  if (!notesDir.value) return;
  try {
    const state: NoteSessionState = {
      openTabs: openTabs.value,
      selectedPath: selectedPath.value,
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
    };
  } catch {
    return null;
  }
}

async function restoreNoteSession() {
  const state = loadNoteSession();
  if (!state) return;
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

  openTabs.value = tabs;
  const selected =
    state.selectedPath && tabs.includes(state.selectedPath) ? state.selectedPath : tabs[0];
  await openFile(selected);
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
  const requestSequence = ++openFileSequence;
  try {
    await ensureParentDirectoriesLoaded(path);
    if (requestSequence !== openFileSequence) return;
    documentStore.beginLoading(path);
    if (!openTabs.value.includes(path)) openTabs.value = [...openTabs.value, path];
    selectedPath.value = path;
    syncWorkspacePaneTabs();
    titleDraft.value = path.split('/').pop()?.replace(/\.md$/i, '') || '未命名';
    const cached = noteContentCache.get(path);
    if (initialContent !== undefined) {
      const mtime = await invoke<string>('get_note_mtime', { path });
      documentStore.finishLoading(path, initialContent, mtime);
      if (requestSequence !== openFileSequence) return;
    } else if (cached) {
      // 从缓存恢复时仍从磁盘获取最新 mtime 用于冲突检测
      try {
        documentStore.finishLoading(path, cached, await invoke<string>('get_note_mtime', { path }));
        if (requestSequence !== openFileSequence) return;
      } catch {
        documentStore.finishLoading(path, cached, null);
      }
    } else {
      const meta = await invoke<{ content: string; mtime: string }>('read_note_meta', { path });
      if (requestSequence !== openFileSequence) return;
      documentStore.finishLoading(path, meta.content, meta.mtime);
    }
    if (requestSequence !== openFileSequence) return;
    noteContentCache.set(path, content.value);
    setNoteContent(path, content.value);
    documentStore.markSaved(path, documentStore.ensure(path).mtime);
    cursorLine.value = 1;
    cursorCol.value = 1;
    // 自动展开父级目录
    expandParentDirectories(path);
    if (focusTitleAfterOpen) {
      focusTitleAfterOpen = false;
      await nextTick();
      titleInput.value?.focus();
      titleInput.value?.select();
    }
    rememberNotePath(path);
    saveNoteSession();
  } catch (e) {
    documentStore.failLoading(path);
    diagnosticsLogger.error('notes', 'notes.read_file_failed', '读取文件失败', e, {
      path: selectedPath.value,
    });
  }
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
    await openFile(path, '');
    void refreshDirectory(parentDir);
  } catch (e) {
    showStatus(`创建文件失败: ${e}`);
    diagnosticsLogger.error('notes', 'notes.create_file_failed', '创建文件失败', e);
  }
}

/** 标题失焦时将标题同步为文件名和标签页名称。 */
async function renameCurrentNoteTitle() {
  if (!selectedPath.value) return;
  const nextTitle = titleDraft.value.trim();
  const currentTitle = selectedPath.value.split('/').pop()?.replace(/\.md$/i, '') || '';
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
  const parentDir = selectedPath.value.includes('/')
    ? selectedPath.value.slice(0, selectedPath.value.lastIndexOf('/'))
    : '';
  const newPath = `${parentDir ? `${parentDir}/` : ''}${nextTitle.endsWith('.md') ? nextTitle : `${nextTitle}.md`}`;
  if (newPath === selectedPath.value) return;
  if (findEntry(tree.value, newPath)) {
    showStatus('目标文件已存在');
    titleDraft.value = currentTitle;
    return;
  }
  try {
    const oldPath = selectedPath.value;
    await invoke('rename_note_entry', { path: oldPath, newName: newPath.split('/').pop() });
    openTabs.value = openTabs.value.map((tab) => (tab === oldPath ? newPath : tab));
    selectedPath.value = newPath;
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

async function closeTab(path: string) {
  const index = openTabs.value.indexOf(path);
  const nextTabs = openTabs.value.filter((tab) => tab !== path);
  openTabs.value = nextTabs;
  noteContentCache.delete(path);
  saveNoteSession();
  if (selectedPath.value !== path) return;
  const nextPath = nextTabs[index] || nextTabs[index - 1] || null;
  if (nextPath) await openFile(nextPath);
  else {
    selectedPath.value = null;
    content.value = '';
  }
}

// ═══ 自动保存（500ms 防抖） ═══

function clearPendingSave(path = selectedPath.value) {
  if (!path) return;
  noteSaveController.cancel(path);
}

function queueNoteSave(
  path: string,
  snapshot: { content: string; expectedMtime: string | null },
  flushNow = false,
) {
  saving.value = true;
  noteSaveController.schedule(
    path,
    snapshot,
    (nextSnapshot) =>
      invoke<string>('write_note', {
        path,
        content: nextSnapshot.content,
        expectedMtime: nextSnapshot.expectedMtime,
      }),
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
  );
  return flushNow ? noteSaveController.flush(path) : Promise.resolve();
}

watch(content, (val) => {
  if (selectedPath.value) {
    const document = documentStore.ensure(selectedPath.value);
    if (!shouldScheduleNoteSave(document)) return;
  }
  if (selectedPath.value) {
    noteContentCache.set(selectedPath.value, val);
    setNoteContent(selectedPath.value, val);
  }
  scheduleTaskReferenceSync(val);
  if (!selectedPath.value) return;
  const savePath = selectedPath.value;
  if (!savePath) return;
  queueNoteSave(savePath, { content: val, expectedMtime: currentFileMtime.value });
  /*
    saving.value = true;
    try {
      const writtenMtime = await invoke<string>('write_note', {
        path: savePath,
        content: val,
        expectedMtime,
      });
      if (noteSaveVersions.get(savePath) !== version) return;
      noteContentCache.set(savePath, val);
      setNoteContent(savePath, val);
      if (selectedPath.value === savePath) {
        documentStore.markSaved(savePath, writtenMtime);
      }
      if (secondaryActiveTab.value === savePath) {
        documentStore.markSaved(savePath, writtenMtime);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.startsWith(FILE_CHANGED_EXTERNALLY)) {
        // 文件在外部被修改，静默加载外部最新版本
        await reloadFromDisk(savePath);
      } else {
        diagnosticsLogger.error('notes', 'notes.save_failed', '保存笔记失败', e, {
          path: savePath,
        });
      }
    } finally {
      saving.value = false;
    }
  }, 500);
  noteSaveTimers.set(savePath, timer);
  */
});

// ═══ 自定义对话框 ═══

watch(secondaryContent, (val) => {
  if (secondaryLoading.value || !secondaryActiveTab.value) return;
  if (selectedPath.value === secondaryActiveTab.value) return;
  const document = documentStore.ensure(secondaryActiveTab.value);
  if (!shouldScheduleNoteSave(document)) return;
  noteContentCache.set(secondaryActiveTab.value, val);
  const savePath = secondaryActiveTab.value;
  const expectedMtime = secondaryFileMtime.value;
  noteSaveController.schedule(
    savePath,
    { content: val, expectedMtime },
    (snapshot) =>
      invoke<string>('write_note', {
        path: savePath,
        content: snapshot.content,
        expectedMtime: snapshot.expectedMtime,
      }),
    (writtenMtime, savedSnapshot) => {
      noteContentCache.set(savePath, savedSnapshot.content);
      setNoteContent(savePath, savedSnapshot.content);
      documentStore.markSaved(savePath, writtenMtime);
    },
    async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith(FILE_CHANGED_EXTERNALLY)) {
        await presentNoteConflict(savePath);
      } else {
        showStatus('分栏笔记保存失败');
      }
    },
  );
  /* const timer = setTimeout(async () => {
    if (noteSaveVersions.get(savePath) !== version) return;
    noteSaveTimers.delete(savePath);
    try {
      const writtenMtime = await invoke<string>('write_note', {
        path: savePath,
        content: val,
        expectedMtime,
      });
      if (noteSaveVersions.get(savePath) !== version) return;
      noteContentCache.set(savePath, val);
      setNoteContent(savePath, val);
      if (secondaryActiveTab.value === savePath) {
        documentStore.markSaved(savePath, writtenMtime);
      }
    } catch {
      showStatus('分栏笔记保存失败');
    }
  }, 500);
  noteSaveTimers.set(savePath, timer); */
});

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
    await openFile(path, '');
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
    await invoke('rename_note_entry', { path, newName });
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;

    if (selectedPath.value && isPathInside(selectedPath.value, path)) {
      selectedPath.value = replacePathPrefix(selectedPath.value, path, newPath);
    }
    renameNote(path, newPath);

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

function removeTreeEntry(entries: FileEntry[], targetPath: string): FileEntry[] {
  return entries
    .filter((entry) => entry.path !== targetPath)
    .map((entry) =>
      entry.isDir && entry.children
        ? { ...entry, children: removeTreeEntry(entry.children, targetPath) }
        : entry,
    );
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
 *  删除后先更新本地界面，再等待系统回收站操作结果；失败时恢复界面快照。 */
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

  const treeSnapshot = tree.value;
  const tabsSnapshot = [...openTabs.value];
  const selectedSnapshot = selectedPath.value;
  const contentSnapshot = content.value;
  const dirtySnapshot = isDirty.value;

  if (openPathIsAffected) clearPendingSave();
  tree.value = removeTreeEntry(tree.value, path);
  cleanExpandedForPath(path);
  openTabs.value = openTabs.value.filter((tab) => !isPathInside(tab, path));
  for (const tab of tabsSnapshot) {
    if (isPathInside(tab, path)) noteContentCache.delete(tab);
  }
  removeNotesUnderPath(path);
  if (selectedPath.value && isPathInside(selectedPath.value, path)) {
    selectedPath.value = null;
    content.value = '';
  }
  saveNoteSession();
  showStatus(`正在将「${name}」移入系统回收站…`);

  try {
    await invoke('delete_note_entry', { path });
    showStatus(`已将「${name}」移入系统回收站`);
  } catch (e) {
    tree.value = treeSnapshot;
    openTabs.value = tabsSnapshot;
    selectedPath.value = selectedSnapshot;
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
  void openFile(path);
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
function handleFileChangeEvent(event: { kind: string; path: string }) {
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
      removeNote(event.path);
      // 文件创建或删除 → 防抖刷新文件树
      if (fileTreeDebounceTimer) clearTimeout(fileTreeDebounceTimer);
      fileTreeDebounceTimer = setTimeout(() => {
        const parentPath = event.path.includes('/')
          ? event.path.slice(0, event.path.lastIndexOf('/'))
          : '';
        void refreshDirectory(parentPath);
      }, 300);
      break;
    case 'modify':
      // 文件内容被外部修改 → 仅当不是当前正在编辑的文件时更新
      if (event.path === selectedPath.value) {
        if (!isDirty.value) void reloadFromDisk();
        else void presentNoteConflict(event.path);
      } else {
        // 更新缓存中的旧版本
        noteContentCache.delete(event.path);
      }
      void refreshNoteIndex(event.path);
      break;
  }
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
  const unlisten = await listen<{ kind: string; path: string }>('notes://file-changed', (event) =>
    handleFileChangeEvent(event.payload),
  );
  unlistenFileWatcher = () => unlisten();
});

async function initializeNotesWorkspace() {
  await loadNotesDir();
  loadRecentNotePaths();
  await loadTree();
  await restoreNoteSession();
  void refreshIndex();
}

watch([openTabs, selectedPath, notesDir], saveNoteSession, { deep: true });

watch(
  openTabs,
  (tabs) => {
    noteWorkspaceLayout.value.panes[0].tabs = [...tabs];
    if (noteWorkspaceLayout.value.direction) {
      noteWorkspaceLayout.value.panes[1].tabs = [...secondaryTabs.value];
    }
  },
  { deep: true },
);

// 从其他视图切回笔记视图时，检测当前文件是否被外部修改
watch(
  () => props.active,
  (active) => {
    if (active) checkExternalModification();
  },
);

onUnmounted(() => {
  window.removeEventListener('pointermove', handleTabPointerMove);
  window.removeEventListener('pointerup', handleTabPointerUp);
  window.removeEventListener('pointercancel', handleTabPointerCancel);
  document.body.classList.remove('workspace-pointer-dragging');
  splitDropPreview.value = false;
  tabDropIndicator.value = null;
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

        <!-- 编辑区主内容（保持纵向 flex 布局） -->
        <div class="editor-main">
          <div
            v-show="!noteWorkspaceLayout.direction"
            class="workspace-tabs editor-tabs"
            role="tablist"
            aria-label="打开的笔记"
            data-workspace-tabs="main"
          >
            <button
              v-if="sidebarCollapsed"
              type="button"
              class="editor-file-toggle"
              title="展开文件库"
              aria-label="展开文件库"
              @click="toggleSidebar"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 5 7 7-7 7" />
              </svg>
            </button>
            <button
              v-for="tab in openTabs"
              :key="`editor-${tab}`"
              type="button"
              class="workspace-tab"
              :class="{
                active: selectedPath === tab,
                'is-pointer-dragging': draggedTabPath === tab,
              }"
              data-workspace-tab
              data-workspace-pane="main"
              :data-workspace-path="tab"
              role="tab"
              :aria-selected="selectedPath === tab"
              @pointerdown="handleTabPointerDown($event, tab, 'main')"
              @click="handleTabClick($event, tab, 'main')"
            >
              <span class="workspace-tab-name">{{ tab.split('/').pop() }}</span>
              <span v-if="selectedPath === tab && isDirty" class="workspace-tab-dirty">•</span>
              <span
                class="workspace-tab-close"
                role="button"
                tabindex="0"
                aria-label="关闭笔记标签"
                @click.stop="closeTab(tab)"
                @keydown.enter.stop="closeTab(tab)"
              >
                ×
              </span>
            </button>
            <button
              type="button"
              class="workspace-tab-new"
              aria-label="新建笔记"
              @click="createUntitledFile()"
            >
              +
            </button>
          </div>
          <template v-if="selectedPath">
            <!-- 顶部工具栏 -->
            <div
              class="editor-toolbar"
              :class="{ 'editor-toolbar-split': noteWorkspaceLayout.direction }"
            >
              <div class="toolbar-left">
                <span class="toolbar-filename">{{ selectedName }}</span>
                <span v-if="isDirty" class="toolbar-dirty" title="未保存的更改">&#9679;</span>
              </div>
              <div class="toolbar-right">
                <div class="note-toolbar-menu">
                  <button
                    class="toolbar-action-btn"
                    :class="{ active: contextMenuVisible }"
                    title="更多操作"
                    aria-label="更多操作"
                    :aria-expanded="contextMenuVisible"
                    @click.stop="showSplitPaneMenu"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <circle cx="5" cy="12" r="1.6" />
                      <circle cx="12" cy="12" r="1.6" />
                      <circle cx="19" cy="12" r="1.6" />
                    </svg>
                  </button>
                  <div v-if="noteActionsMenuOpen" class="note-toolbar-menu-popover" @click.stop>
                    <button
                      type="button"
                      @click="
                        createUntitledFile();
                        closeNoteActionsMenu();
                      "
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      <span>新建笔记</span>
                    </button>
                    <button
                      type="button"
                      @click="
                        createFolder('');
                        closeNoteActionsMenu();
                      "
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M22 19a2 2 0 01-2 2V5a2 2 0 012 2zM12 11v6M9 14h6" />
                      </svg>
                      <span>新建文件夹</span>
                    </button>
                    <div class="note-toolbar-menu-separator" aria-hidden="true" />
                    <button type="button" @click="splitNoteWorkspace('horizontal')">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                        <path d="M12 4v16" />
                      </svg>
                      <span>左右分屏</span>
                    </button>
                    <button type="button" @click="splitNoteWorkspace('vertical')">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                        <path d="M4 12h16" />
                      </svg>
                      <span>上下分屏</span>
                    </button>
                    <button
                      v-if="noteWorkspaceLayout.direction"
                      type="button"
                      @click="closeNoteWorkspaceSplit"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                        <path d="m9 9 6 6m0-6-6 6" />
                      </svg>
                      <span>关闭分屏</span>
                    </button>
                    <button
                      type="button"
                      :disabled="exporting"
                      @click="
                        exportCurrentNoteToDocx();
                        closeNoteActionsMenu();
                      "
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 3h10l4 4v14H5zM15 3v5h5M8 15h8M8 18h5" />
                        <path d="M8 11h5" />
                      </svg>
                      <span>导出为 Word</span>
                    </button>
                  </div>
                </div>
                <button class="toolbar-action-btn" title="新建笔记" @click="createUntitledFile()">
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
                <button
                  class="toolbar-action-btn"
                  title="导出为 Word"
                  :disabled="exporting"
                  @click="exportCurrentNoteToDocx"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M12 3v12M7 10l5 5 5-5" />
                    <path d="M5 21h14" />
                  </svg>
                </button>
                <button
                  class="toolbar-action-btn context-toggle"
                  :class="{ active: contextPanelOpen }"
                  :aria-pressed="contextPanelOpen"
                  :title="`显示${outlinePanelLabel}`"
                  :aria-label="`显示${outlinePanelLabel}`"
                  @click="contextPanelOpen = !contextPanelOpen"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                    <path d="M15 4v16" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- 编辑区 -->
            <div
              v-if="currentTaskReferences.length > 0"
              class="note-task-strip"
              :class="{ 'note-task-strip-split': noteWorkspaceLayout.direction }"
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
              v-else
              class="note-task-strip note-task-strip-empty"
              :class="{ 'note-task-strip-split': noteWorkspaceLayout.direction }"
            >
              <span class="note-task-strip-label">正文中的正式任务</span>
              <button class="note-task-add" @click="addTaskReference">创建任务</button>
              <button class="note-task-add" @click="linkExistingTask">关联已有任务</button>
            </div>

            <div
              class="editor-panes"
              :class="{
                'editor-panes-split-horizontal': noteWorkspaceLayout.direction === 'horizontal',
                'editor-panes-split-vertical': noteWorkspaceLayout.direction === 'vertical',
              }"
              @contextmenu="showContextMenu"
            >
              <div class="editor-document">
                <div
                  v-if="noteWorkspaceLayout.direction"
                  class="workspace-tabs editor-tabs split-pane-tabs"
                  role="tablist"
                  aria-label="主分栏中的笔记"
                  data-workspace-tabs="main"
                >
                  <button
                    v-for="tab in openTabs"
                    :key="`main-split-${tab}`"
                    type="button"
                    class="workspace-tab"
                    :class="{
                      active: selectedPath === tab,
                      'is-pointer-dragging': draggedTabPath === tab,
                    }"
                    data-workspace-tab
                    data-workspace-pane="main"
                    :data-workspace-path="tab"
                    role="tab"
                    :aria-selected="selectedPath === tab"
                    @pointerdown="handleTabPointerDown($event, tab, 'main')"
                    @click="handleTabClick($event, tab, 'main')"
                  >
                    <span class="workspace-tab-name">{{ tab.split('/').pop() }}</span>
                    <span v-if="selectedPath === tab && isDirty" class="workspace-tab-dirty"
                      >•</span
                    >
                    <span
                      class="workspace-tab-close"
                      role="button"
                      tabindex="0"
                      aria-label="关闭主分栏笔记标签"
                      @click.stop="closeTab(tab)"
                      @keydown.enter.stop="closeTab(tab)"
                    >
                      ×
                    </span>
                  </button>
                  <button
                    type="button"
                    class="workspace-tab-new"
                    aria-label="新建笔记"
                    @click="createUntitledFile()"
                  >
                    +
                  </button>
                </div>
                <div v-if="noteWorkspaceLayout.direction" class="split-pane-document-header">
                  <div class="split-pane-header-side">
                    <button type="button" class="split-pane-nav-btn" disabled aria-label="后退">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m15 5-7 7 7 7" />
                      </svg>
                    </button>
                    <button type="button" class="split-pane-nav-btn" disabled aria-label="前进">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m9 5 7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                  <span class="split-pane-document-title">{{ selectedName }}</span>
                  <div class="split-pane-header-side split-pane-header-actions">
                    <button
                      type="button"
                      class="split-pane-nav-btn"
                      aria-label="更多操作"
                      @click.stop="showSplitPaneMenu"
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
                      aria-label="关闭分屏"
                      @click="closeNoteWorkspaceSplit"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M7 7l10 10M17 7 7 17" />
                      </svg>
                    </button>
                  </div>
                </div>
                <input
                  ref="titleInput"
                  v-model="titleDraft"
                  class="note-document-title"
                  :class="{ 'note-document-title-split': noteWorkspaceLayout.direction }"
                  type="text"
                  aria-label="笔记标题"
                  @blur="renameCurrentNoteTitle"
                  @keydown.enter.prevent="titleInput?.blur()"
                />
                <div class="editor-document-body">
                  <MarkdownEditor
                    ref="textareaRef"
                    :key="selectedPath"
                    :model-value="content"
                    placeholder="开始编写 Markdown..."
                    @update:model-value="content = $event"
                    @cursor-change="handleCursorChange"
                    @save="handleManualSave"
                  />
                </div>
              </div>
              <div
                v-if="noteWorkspaceLayout.direction"
                class="editor-document split-editor-document"
              >
                <div
                  class="workspace-tabs editor-tabs split-pane-tabs"
                  role="tablist"
                  aria-label="次分栏中的笔记"
                  data-workspace-tabs="secondary"
                >
                  <button
                    v-for="tab in secondaryTabs"
                    :key="`secondary-${tab}`"
                    type="button"
                    class="workspace-tab split-pane-tab"
                    :class="{
                      active: secondaryActiveTab === tab,
                      'is-pointer-dragging': draggedTabPath === tab,
                    }"
                    data-workspace-tab
                    data-workspace-pane="secondary"
                    :data-workspace-path="tab"
                    role="tab"
                    :aria-selected="secondaryActiveTab === tab"
                    @pointerdown="handleTabPointerDown($event, tab, 'secondary')"
                    @click="handleTabClick($event, tab, 'secondary')"
                  >
                    <span class="workspace-tab-name">{{ tab.split('/').pop() }}</span>
                    <span
                      class="workspace-tab-close"
                      role="button"
                      tabindex="0"
                      aria-label="关闭分栏笔记标签"
                      @click.stop="closeSecondaryTab(tab)"
                      @keydown.enter.stop="closeSecondaryTab(tab)"
                    >
                      ×
                    </span>
                  </button>
                  <span v-if="secondaryLoading" class="split-pane-label">读取中…</span>
                </div>
                <div class="split-pane-document-header">
                  <div class="split-pane-header-side">
                    <button type="button" class="split-pane-nav-btn" disabled aria-label="后退">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m15 5-7 7 7 7" />
                      </svg>
                    </button>
                    <button type="button" class="split-pane-nav-btn" disabled aria-label="前进">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m9 5 7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                  <span class="split-pane-document-title">
                    {{ secondaryActiveTab?.split('/').pop() || '未选择笔记' }}
                  </span>
                  <div class="split-pane-header-side split-pane-header-actions">
                    <button
                      type="button"
                      class="split-pane-nav-btn"
                      aria-label="更多操作"
                      @click.stop="showSplitPaneMenu"
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
                      aria-label="关闭分屏"
                      @click="closeNoteWorkspaceSplit"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M7 7l10 10M17 7 7 17" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div class="editor-document-body">
                  <MarkdownEditor
                    :key="`split-${secondaryActiveTab}`"
                    :model-value="secondaryContent"
                    placeholder="开始编辑 Markdown..."
                    @update:model-value="secondaryContent = $event"
                  />
                </div>
              </div>
            </div>

            <div v-if="splitDropPreview" class="split-drop-preview" aria-hidden="true">
              <span class="split-drop-preview-label">
                <svg viewBox="0 0 24 24">
                  <path d="M6 4h12v16H6z" />
                  <path d="M12 4v16" />
                </svg>
                {{ draggedTabPath?.split('/').pop() }}
              </span>
            </div>

            <!-- 底部状态栏 -->
            <div
              v-if="tabDropIndicator"
              class="tab-drop-indicator"
              :style="{
                left: `${tabDropIndicator.left}px`,
                top: `${tabDropIndicator.top}px`,
                height: `${tabDropIndicator.height}px`,
              }"
              aria-hidden="true"
            />

            <div
              v-if="draggedTabPath"
              class="tab-drag-ghost"
              :style="{
                left: `${dragGhostPosition.left}px`,
                top: `${dragGhostPosition.top}px`,
              }"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24">
                <path d="M6 3.75h8l4 4V20.25H6z" />
                <path d="M14 3.75v4h4M9 12h6M9 15.5h6" />
              </svg>
              <span>{{ draggedTabPath.split('/').pop() }}</span>
            </div>

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
              <div class="welcome-actions">
                <button class="welcome-btn welcome-btn-primary" @click="createUntitledFile()">
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
                  新建笔记 <span>(Ctrl + N)</span>
                </button>
                <button class="welcome-btn" @click="openNotesWorkspace">
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
                  打开工作区 <span>(Ctrl + O)</span>
                </button>
                <button type="button" class="welcome-btn" @click="openFileLibrary">
                  搜索笔记 <span>(Ctrl + P)</span>
                </button>
              </div>
              <div class="welcome-shortcuts">
                <span><kbd>Ctrl N</kbd> 新建笔记</span>
                <span><kbd>Ctrl P</kbd> 搜索笔记</span>
              </div>
            </div>
          </div>
        </div>

        <aside v-if="contextPanelOpen" class="note-context-panel">
          <template v-if="selectedPath">
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
                @click="openFile(path)"
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
      :open-tabs="openTabs"
      :selected-path="selectedPath"
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
  min-height: 38px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

.split-pane-tab {
  min-width: 128px;
  max-width: 220px;
  min-height: 34px;
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
  overflow: hidden;
}

.note-document-title {
  width: min(860px, 100%);
  box-sizing: border-box;
  margin: 18px auto 4px;
  padding: 0 40px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: clamp(28px, 3vw, 38px);
  font-weight: 700;
  letter-spacing: -0.04em;
}

.note-document-title::selection {
  background: var(--selection-bg, rgba(124, 92, 255, 0.24));
}

.editor-document-body {
  flex: 1;
  min-height: 0;
  display: block;
  overflow: hidden;
}

.editor-document-body > :first-child {
  width: 100%;
  height: 100%;
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

.workspace-tabs {
  min-width: 0;
  flex: 1;
  height: 100%;
  display: flex;
  align-items: stretch;
  overflow-x: auto;
}

.workspace-tab,
.workspace-tab-new {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
}

.workspace-tab {
  min-width: 150px;
  max-width: 240px;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  border-right: 1px solid var(--border-subtle);
  font-size: 13px;
}

.workspace-tab {
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.workspace-tab:active,
.workspace-tab.is-pointer-dragging {
  cursor: grabbing;
}

.workspace-tab.is-pointer-dragging {
  opacity: 0.55;
}

:global(body.workspace-pointer-dragging) {
  cursor: grabbing;
  user-select: none;
}

.workspace-tab:hover,
.workspace-tab.active {
  color: var(--text-primary);
  background: var(--bg-primary);
}

.workspace-tab.active {
  box-shadow: inset 0 -2px 0 var(--accent);
}

.workspace-tab-close {
  color: var(--text-muted);
  font-size: 17px;
  line-height: 1;
}

.workspace-tab-dirty {
  margin-left: auto;
  color: var(--accent);
}

.workspace-tab-new {
  min-width: 48px;
  font-size: 18px;
}

.workspace-tab-new:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
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

.editor-tabs {
  flex: 0 0 38px;
  min-height: 38px;
  align-items: flex-end;
  padding: 0 8px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

.editor-tabs .workspace-tab {
  height: 34px;
  min-width: 128px;
  max-width: 220px;
  padding: 0 10px 0 14px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.editor-tabs .workspace-tab:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.editor-tabs .workspace-tab.active {
  background: var(--bg-primary);
  border-color: var(--border-subtle);
  color: var(--text-primary);
  box-shadow: inset 0 -1px 0 var(--bg-primary);
}

.workspace-tab-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-tabs .workspace-tab-close {
  width: 18px;
  height: 18px;
  margin-left: auto;
  font-size: 14px;
}

.editor-tabs .workspace-tab-new {
  align-self: center;
  min-width: 34px;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}

.editor-tabs .workspace-tab-new:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
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
