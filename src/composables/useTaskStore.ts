import { ref, computed, watch } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { ensureOutboxReady, outboxCount } from './useOutbox';
import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';
import type { Task, DailyCompletion, TaskMetaPatch } from '../types';
import { useAuth } from './useAuth';
import { useSync } from './useSync';
import { useSyncCode } from './useSyncCode';
import {
  filterTasks,
  tagsFromTasks,
  dailyCompletionsMap,
  countOverdue,
  countPending,
  getTodayStr,
  matchesTaskQuery,
} from './useFilterEngine';
import { withTimeout } from './syncUtils';
import { diagnosticsLogger } from '../diagnostics/invoke-logged';

// 重新导出 — 保持向后兼容
export { mergeTasksLWW } from './useFilterEngine';

/** 按任务 ID 过滤已有任务以及同一事件载荷中的重复任务。 */
export function selectNewImportedTasks(currentTasks: Task[], importedTasks: Task[]): Task[] {
  const knownIds = new Set(currentTasks.map((task) => task.id));
  const additions: Task[] = [];
  for (const task of importedTasks) {
    if (knownIds.has(task.id)) continue;
    knownIds.add(task.id);
    additions.push(task);
  }
  return additions;
}

/** 筛选状态（全局单例，确保跨组件共享） */
const filterDate = ref<string | null>(null);
const selectedTags = ref<string[]>([]);
const searchQuery = ref('');

/**
 * 用户在筛选栏手动添加的标签（尚未附加到任何任务的标签）。
 * 独立追踪，确保不会被从 tasks 重新推算 allTags 时覆盖丢失。
 */
const customTags = ref<string[]>([]);

/** 初始加载与同步合并的加载态（全局单例） */
const isLoading = ref(false);
const isLocalReady = ref(false);
const loadError = ref<string | null>(null);
const isSyncing = ref(false);
const syncError = ref<string | null>(null);

/** 任务数据（全局单例，跨组件共享） */
const tasks = ref<Task[]>([]);

/** 任务派生标签（全局单例） */
const allTags = ref<string[]>([]);

/** 今日已完成任务 ID 列表（全局单例） */
const dailyCompletedIds = ref<string[]>([]);
interface TaskSnapshot {
  revision: number;
  tasks: Task[];
  dailyCompletions: DailyCompletion[];
  outboxCount: number;
}
let appliedRevision = -1;
let snapshotListener: Promise<void> | null = null;
let snapshotRead: Promise<void> | null = null;
let snapshotRequested = false;

interface UndoSnapshot {
  tasks: Task[];
  message: string;
}

/** 最近一次可撤销的破坏性操作，仅保留一个撤销窗口。 */
const undoSnapshot = ref<UndoSnapshot | null>(null);
let undoTimer: ReturnType<typeof setTimeout> | null = null;

/** 是否已初始化认证和同步 */
let syncInitialized = false;
/** 多个组件实例共享同一条后台同步任务，避免重复恢复 Profile 或重复拉取。 */
let syncPromise: Promise<void> | null = null;
let realtimeInitialized = false;
let realtimeProfileId: string | null = null;

/** 任务看板 composable：组合 TaskRepo + FilterEngine + Sync，只做编排 */
export function useTaskStore() {
  const { isLoggedIn, initAuth } = useAuth();
  const {
    pullTasks,
    pullDailyCompletions,
    subscribeToChanges,
    unsubscribeFromChanges,
    syncStatus,
    lastSyncAt,
    offlineQueueCount,
    getProfileId,
    flushOutbox,
  } = useSync();
  const syncCode = useSyncCode();

  // ── 副作用（同步任务由模块级状态统一去重） ──────────────

  // ── 通用 CRUD 错误包裹（一个闭包替代 8 个重复函数） ──

  function wrap<A extends any[], R>(
    fn: (...args: A) => Promise<R>,
    label: string,
  ): (...args: A) => Promise<R | undefined> {
    return async (...args: A) => {
      try {
        return await fn(...args);
      } catch (e) {
        diagnosticsLogger.error('task', 'task.operation_failed', `任务操作失败：${label}`, e, {
          operation: label,
        });
        await refreshLocalSnapshot();
      }
    };
  }

  /**
   * 统一计算 allTags = 任务派生标签 ∪ 手动添加标签。
   * 所有需要更新 allTags 的代码路径都应通过此函数，
   * 确保 customTags 不会被覆盖丢失。
   */
  function syncAllTags(source?: Task[]) {
    const tasks_ = source ?? tasks.value;
    const derived = tagsFromTasks(tasks_);
    const union = [...new Set([...derived, ...customTags.value])].sort();
    allTags.value = union;
  }

  function registerUndo(snapshot: Task[], message: string) {
    if (undoTimer) clearTimeout(undoTimer);
    undoSnapshot.value = snapshot.length > 0 ? { tasks: snapshot, message } : null;
    if (snapshot.length > 0) {
      undoTimer = setTimeout(() => {
        undoSnapshot.value = null;
        undoTimer = null;
      }, 5_000);
    }
  }

  async function undoLastAction() {
    const snapshot = undoSnapshot.value;
    if (!snapshot) return;

    if (undoTimer) clearTimeout(undoTimer);
    undoSnapshot.value = null;
    undoTimer = null;

    for (const task of snapshot.tasks) await invoke('restore_task', { id: task.id });
    await refreshLocalSnapshot();
  }

  // ── 计算属性（委托给 FilterEngine） ────────────

  const filteredTasks = computed(() => {
    const filtered = filterTasks(tasks.value, filterDate.value, selectedTags.value);
    const query = searchQuery.value.trim().toLocaleLowerCase();
    return filtered.filter((task) => matchesTaskQuery(task, query));
  });

  const overdueCount = computed(() => countOverdue(tasks.value));
  const pendingCount = computed(() => countPending(tasks.value));
  const dailyCompletions = computed(() => dailyCompletionsMap(dailyCompletedIds.value));

  // ── 数据加载与同步（编排） ──────────────────────

  function applySnapshot(snapshot: TaskSnapshot) {
    if (snapshot.revision < appliedRevision) return;
    appliedRevision = snapshot.revision;
    outboxCount.value = snapshot.outboxCount;
    tasks.value = snapshot.tasks;
    dailyCompletedIds.value = snapshot.tasks
      .filter((task) => task.is_daily && task.completed)
      .map((task) => task.id);
    syncAllTags(snapshot.tasks);
    isLocalReady.value = true;
  }

  function refreshLocalSnapshot(): Promise<void> {
    snapshotRequested = true;
    if (snapshotRead) return snapshotRead;
    snapshotRead = (async () => {
      while (snapshotRequested) {
        snapshotRequested = false;
        applySnapshot(await invoke<TaskSnapshot>('get_task_snapshot'));
      }
    })().finally(() => {
      snapshotRead = null;
    });
    return snapshotRead;
  }

  async function initializeSnapshots() {
    if (!snapshotListener) {
      snapshotListener = listen<number>('tasks://data-changed', (event) => {
        if (event.payload <= appliedRevision) return;
        void refreshLocalSnapshot().catch((error) =>
          diagnosticsLogger.error('task', 'task.snapshot_failed', '读取共享任务状态失败', error),
        );
      })
        .then((unlisten) => {
          window.addEventListener('beforeunload', unlisten, { once: true });
        })
        .catch((error) => {
          snapshotListener = null;
          throw error;
        });
    }
    await snapshotListener;
  }

  async function loadLocalTasks(force = false): Promise<void> {
    if (isLocalReady.value && !force) return;
    isLoading.value = true;
    loadError.value = null;
    try {
      await ensureOutboxReady();
      await initializeSnapshots();
      await invoke('reset_daily_tasks', { today: getTodayStr() });
      await refreshLocalSnapshot();
    } catch (error) {
      loadError.value = String(error);
      diagnosticsLogger.error('task', 'task.load_failed', '加载本地任务失败', error);
    } finally {
      isLoading.value = false;
    }
  }

  async function applyRemoteTasks(remoteTasks: Task[]): Promise<void> {
    if (!remoteTasks.length) return;
    await invoke('sync_local_tasks', { remoteTasks });
    await refreshLocalSnapshot();
  }

  async function pullRemoteAndMerge(forceFull = false): Promise<void> {
    if (!isLoggedIn.value || !navigator.onLine) return;
    const snapshot = await invoke<TaskSnapshot>('get_task_snapshot');
    const [remoteTasks, remoteDCs] = await Promise.all([
      withTimeout(pullTasks(forceFull)),
      withTimeout(pullDailyCompletions()),
    ]);
    const applied = await mergeDailyCompletions(remoteDCs, snapshot.revision);
    await applyRemoteTasks(remoteTasks);
    if (!applied) {
      const current = await invoke<TaskSnapshot>('get_task_snapshot');
      await mergeDailyCompletions(await withTimeout(pullDailyCompletions()), current.revision);
    }
  }

  function runBackgroundSync(options: {
    restoreProfile: boolean;
    forceFullPull: boolean;
  }): Promise<void> {
    if (syncPromise) return syncPromise;

    syncPromise = (async () => {
      isSyncing.value = true;
      syncError.value = null;
      try {
        if (!syncInitialized) {
          syncInitialized = true;
          await initAuth();
        }

        if (!isLoggedIn.value) return;

        const profileReady = options.restoreProfile ? await syncCode.restoreProfile() : true;
        if (options.restoreProfile && profileReady) {
          await syncCode.mergeLocalToProfile(getProfileId()!);
        }
        // 已配对操作在 Profile 恢复后发送，未配对操作使用当前认证用户归属。
        if (navigator.onLine) await flushOutbox();

        await initSync();
        await pullRemoteAndMerge(options.forceFullPull);
      } catch (e) {
        syncError.value = e instanceof Error ? e.message : '后台同步失败';
        diagnosticsLogger.error('sync', 'sync.background_failed', '后台同步失败', e);
      } finally {
        isSyncing.value = false;
        syncPromise = null;
      }
    })();

    return syncPromise;
  }

  /** 应用启动或登录后的完整恢复：恢复 Profile、重放队列并执行一次全量拉取。 */
  function startBackgroundSync(): Promise<void> {
    return runBackgroundSync({ restoreProfile: true, forceFullPull: true });
  }

  /** 正常运行期同步：不重新配对，只刷新队列并执行增量拉取。 */
  function startIncrementalSync(): Promise<void> {
    return runBackgroundSync({ restoreProfile: false, forceFullPull: false });
  }

  async function loadAll() {
    await loadLocalTasks();
    if (isLocalReady.value) void startBackgroundSync();
  }

  async function refreshTasks(silent = false) {
    if (!silent) isLoading.value = true;
    try {
      await loadLocalTasks(true);
      void pullAndMerge().catch((e) =>
        diagnosticsLogger.warn('sync', 'sync.refresh_pull_failed', '刷新后的增量同步失败', {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      if (!silent) isLoading.value = false;
    }
  }

  async function pullAndMerge() {
    await refreshLocalSnapshot();
    if (!isLoggedIn.value || !navigator.onLine) return;

    const syncConfig = await syncCode.getSyncConfig();
    // 配置存在但当前 Profile 丢失时，才重新进入恢复流程；正常轮询不重复调用配对接口。
    if (syncConfig.sync_code && getProfileId() !== syncConfig.profile_id) {
      await startBackgroundSync();
      return;
    }

    await startIncrementalSync();
  }

  async function initSync(): Promise<boolean> {
    if (!isLoggedIn.value) return false;
    const hasProfile = await syncCode.hasProfile();
    if (!hasProfile) return false;

    const profileId = getProfileId();
    if (!profileId) return false;
    if (realtimeInitialized && realtimeProfileId === profileId) return true;

    if (realtimeInitialized || realtimeProfileId !== null) {
      await unsubscribeFromChanges();
      realtimeInitialized = false;
      realtimeProfileId = null;
    }

    const channel = await subscribeToChanges(
      (remoteTask) => {
        void applyRemoteTasks([remoteTask]).catch((error) =>
          diagnosticsLogger.error('sync', 'sync.realtime_task_failed', '保存远端任务失败', error),
        );
      },
      (completion, eventType) => {
        const command =
          eventType === 'DELETE' ? 'delete_daily_completion' : 'sync_remote_daily_completions';
        const args =
          eventType === 'DELETE'
            ? { taskId: completion.task_id, date: completion.date }
            : { remoteCompletions: [completion] };
        void invoke(command, args)
          .then(refreshLocalSnapshot)
          .catch((error) =>
            diagnosticsLogger.error(
              'sync',
              'sync.realtime_daily_failed',
              '保存远端完成记录失败',
              error,
            ),
          );
      },
    );
    realtimeInitialized = channel !== null;
    realtimeProfileId = channel ? profileId : null;
    return realtimeInitialized;
  }

  async function mergeDailyCompletions(remoteDCs: DailyCompletion[], revision: number) {
    const applied = await invoke<boolean>('sync_remote_daily_completions', {
      remoteCompletions: remoteDCs,
      replaceSnapshot: true,
      profileId: getProfileId(),
      snapshotRevision: revision,
    });
    await refreshLocalSnapshot();
    return applied;
  }

  // ── CRUD（带 wrap 包裹 + 内联 TaskRepo 逻辑） ──

  const addTask = wrap(
    async (
      title: string,
      dueDate: string | null,
      tags: string[],
      important: boolean,
      pinned: boolean,
      isDaily: boolean,
      parentId?: string,
    ) => {
      const task = await invoke<Task>('add_task', {
        args: { title, dueDate, tags, important, pinned, isDaily, parentId },
      });
      await refreshLocalSnapshot();
      return task;
    },
    'addTask',
  );

  /** 导入已经由后端保存，通过共享快照更新当前窗口。 */
  function applyImportedTasks(_importedTasks: Task[]) {
    void refreshLocalSnapshot().catch((error) =>
      diagnosticsLogger.error('task', 'task.import_refresh_failed', '刷新导入任务失败', error),
    );
  }

  const toggleTask = wrap(async (id: string, completed?: boolean) => {
    const task = tasks.value.find((item) => item.id === id);
    if (!task) return;
    await invoke('toggle_task', { id, completed: completed ?? !task.completed });
    await refreshLocalSnapshot();
  }, 'toggleTask');

  const toggleDailyTask = wrap(async (id: string, date: string, completed?: boolean) => {
    await invoke('toggle_daily_task', {
      id,
      date,
      completed: completed ?? !dailyCompletedIds.value.includes(id),
    });
    await refreshLocalSnapshot();
  }, 'toggleDailyTask');

  const updateTask = wrap(async (id: string, title: string) => {
    await invoke('update_task', { args: { id, title } });
    await refreshLocalSnapshot();
  }, 'updateTask');

  const updateTaskMeta = wrap(async (id: string, patch: TaskMetaPatch) => {
    await invoke('update_task', { args: { id, ...patch } });
    await refreshLocalSnapshot();
  }, 'updateTaskMeta');

  const deleteTask = wrap(async (id: string) => {
    const deleted = tasks.value
      .filter((task) => task.id === id || task.parent_id === id)
      .map((task) => ({ ...task }));
    await invoke('delete_task', { id });
    await refreshLocalSnapshot();
    registerUndo(deleted, '任务已删除');
  }, 'deleteTask');

  const clearCompleted = wrap(async () => {
    const cleared = tasks.value
      .filter((task) => task.completed && !task.is_daily)
      .map((task) => ({ ...task }));
    await invoke('clear_completed');
    await refreshLocalSnapshot();
    registerUndo(cleared, String(cleared.length) + ' 个已完成任务已清除');
  }, 'clearCompleted');

  // ── 筛选操作 ──────────────────────────────

  function selectDate(date: string | null) {
    filterDate.value = date;
  }

  function toggleTag(tag: string) {
    if (!tag) {
      selectedTags.value = [];
      return;
    }
    const idx = selectedTags.value.indexOf(tag);
    if (idx >= 0) {
      selectedTags.value.splice(idx, 1);
    } else {
      selectedTags.value.push(tag);
    }
  }

  function addTag(tag: string) {
    if (!customTags.value.includes(tag)) {
      customTags.value.push(tag);
    }
    if (!allTags.value.includes(tag)) {
      allTags.value.push(tag);
    }
    selectedTags.value = [tag];
  }

  // 网络恢复后自动拉取远端变更（弥补 Tauri webview 中 online 事件不可靠）
  watch(syncStatus, (newVal, oldVal) => {
    if (newVal === 'idle' && (oldVal === 'offline' || oldVal === 'error')) {
      pullAndMerge().catch((e) =>
        diagnosticsLogger.warn('sync', 'sync.auto_pull_failed', '网络恢复后的自动拉取失败', {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  });

  watch(isLoggedIn, (loggedIn) => {
    if (loggedIn) void startBackgroundSync();
  });

  return {
    // 数据
    tasks,
    allTags,
    dailyCompletedIds,
    filterDate,
    selectedTags,
    searchQuery,
    syncStatus,
    lastSyncAt,
    offlineQueueCount,
    isLoading,
    loadError,
    isLocalReady,
    isSyncing,
    syncError,
    undoMessage: computed(() => undoSnapshot.value?.message ?? null),
    // 计算属性
    filteredTasks,
    dailyCompletionsMap: dailyCompletions,
    overdueCount,
    pendingCount,
    // 数据加载
    loadAll,
    refreshTasks,
    initSync,
    pullAndMerge,
    // CRUD
    addTask,
    applyImportedTasks,
    toggleTask,
    toggleDailyTask,
    updateTask,
    updateTaskMeta,
    deleteTask,
    clearCompleted,
    undoLastAction,
    // 筛选
    selectDate,
    toggleTag,
    addTag,
  };
}
