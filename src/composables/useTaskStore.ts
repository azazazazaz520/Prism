import { ref, computed, watch, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { Task, DailyCompletion } from '../types';
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
  mergeLWW,
  mergeTasksLWW,
} from './useFilterEngine';
import { withTimeout } from './syncUtils';

// 重新导出 — 保持向后兼容
export { mergeTasksLWW } from './useFilterEngine';

/** 筛选状态（全局单例，确保跨组件共享） */
const filterDate = ref<string | null>(null);
const selectedTags = ref<string[]>([]);

/**
 * 用户在筛选栏手动添加的标签（尚未附加到任何任务的标签）。
 * 独立追踪，确保不会被从 tasks 重新推算 allTags 时覆盖丢失。
 */
const customTags = ref<string[]>([]);

/** 初始加载与同步合并的加载态（全局单例） */
const isLoading = ref(false);
const isLocalReady = ref(false);
const isSyncing = ref(false);
const syncError = ref<string | null>(null);

/** 任务数据（全局单例，跨组件共享） */
const tasks = ref<Task[]>([]);

/** 任务派生标签（全局单例） */
const allTags = ref<string[]>([]);

/** 今日已完成任务 ID 列表（全局单例） */
const dailyCompletedIds = ref<string[]>([]);
const pendingResetTasks = ref<Task[]>([]);

/** 是否已初始化认证和同步 */
let syncInitialized = false;

/** 为 sync pull 操作添加超时，离线时快速失败而非等待 HTTP 超时 */
/** 任务看板 composable：组合 TaskRepo + FilterEngine + Sync，只做编排 */
export function useTaskStore() {
  const { isLoggedIn, initAuth } = useAuth();
  const {
    pushTask,
    pushDailyCompletion,
    pushDeleteDailyCompletion,
    pullTasks,
    pullDailyCompletions,
    subscribeToChanges,
    syncStatus,
    getProfileId,
  } = useSync();
  const syncCode = useSyncCode();
  let syncPromise: Promise<void> | null = null;
  let realtimeInitialized = false;

  // ── 副作用（仅 App.vue 首调用时触发） ──────────────

  // ── 同步回调 ──────────────────────────────

  function onTaskChanged(task: Task) {
    if (isLoggedIn.value) {
      pushTask(task).catch((e) => console.warn('[sync] pushTask:', e));
    }
  }

  function onDailyChanged(dc: DailyCompletion) {
    if (isLoggedIn.value) {
      pushDailyCompletion(dc).catch((e) => console.warn('[sync] pushDailyCompletion:', e));
    }
  }

  function onDailyDeleted(taskId: string, date: string) {
    if (isLoggedIn.value) {
      pushDeleteDailyCompletion(taskId, date).catch((e) =>
        console.warn('[sync] pushDeleteDailyCompletion:', e),
      );
    }
  }

  // ── 通用 CRUD 错误包裹（一个闭包替代 8 个重复函数） ──

  function wrap<A extends any[], R>(
    fn: (...args: A) => Promise<R>,
    label: string,
  ): (...args: A) => Promise<R | undefined> {
    return async (...args: A) => {
      try {
        return await fn(...args);
      } catch (e) {
        console.error(`[${label}] failed:`, e);
        await loadAll();
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

  // ── 计算属性（委托给 FilterEngine） ────────────

  const filteredTasks = computed(() =>
    filterTasks(tasks.value, filterDate.value, selectedTags.value),
  );

  const overdueCount = computed(() => countOverdue(tasks.value));
  const pendingCount = computed(() => countPending(tasks.value));
  const dailyCompletions = computed(() => dailyCompletionsMap(dailyCompletedIds.value));

  // ── 数据加载与同步（编排） ──────────────────────

  async function loadAllLegacy() {
    isLoading.value = true;
    try {
      if (!syncInitialized) {
        syncInitialized = true;
        try {
          await initAuth();
        } catch (e) {
          console.warn('[sync] initAuth failed:', e);
        }
      }

      // 跨天重置每日任务的 completed 状态（今日无记录则清零）
      // 返回被修改的任务，需同步到 Supabase 确保多设备一致
      const changedTasks = await invoke<Task[]>('reset_daily_tasks', {
        today: getTodayStr(),
      });
      if (isLoggedIn.value && changedTasks.length > 0) {
        for (const t of changedTasks) {
          pushTask(t).catch((e) => console.warn('[sync] push reset_daily:', e));
        }
      }

      const localTasks = await invoke<Task[]>('get_tasks');
      await refreshDailyCompletions();

      let merged = localTasks.filter((t) => !t.is_deleted);

      if (isLoggedIn.value) {
        try {
          const profileRestored = await syncCode.restoreProfile();
          if (profileRestored) {
            syncCode
              .mergeLocalToProfile(getProfileId()!)
              .catch((e) => console.warn('[sync] mergeLocalToProfile failed:', e));
          }
        } catch (e) {
          console.warn('[sync] restoreProfile failed:', e);
        }

        if (navigator.onLine) {
          try {
            const [remoteTasks, remoteDCs] = await Promise.all([
              withTimeout(pullTasks(true)),
              withTimeout(pullDailyCompletions()),
            ]);
            if (remoteTasks && remoteTasks.length > 0) {
              merged = mergeLWW(merged, remoteTasks);
              invoke('sync_local_tasks', { remoteTasks }).catch((e) =>
                console.warn('[sync] sync_local_tasks failed:', e),
              );
            }
            if (remoteDCs && remoteDCs.length > 0) {
              await mergeDailyCompletions(remoteDCs);
            }
          } catch (e) {
            console.warn('[sync] loadAll pull failed:', e);
          }
        }
      }

      tasks.value = merged;
      syncAllTags(merged);
    } finally {
      isLoading.value = false;
    }
  }

  async function refreshTasksLegacy(silent = false) {
    if (!silent) isLoading.value = true;
    try {
      // 跨天重置每日任务的 completed 状态
      const changedTasks = await invoke<Task[]>('reset_daily_tasks', {
        today: getTodayStr(),
      });
      if (isLoggedIn.value && changedTasks.length > 0) {
        for (const t of changedTasks) {
          pushTask(t).catch((e) => console.warn('[sync] push reset_daily:', e));
        }
      }

      const localTasks = await invoke<Task[]>('get_tasks');
      await refreshDailyCompletions();

      let merged = localTasks.filter((t) => !t.is_deleted);

      if (isLoggedIn.value && navigator.onLine) {
        try {
          const [remoteTasks, remoteDCs] = await Promise.all([
            withTimeout(pullTasks(true)),
            withTimeout(pullDailyCompletions()),
          ]);
          if (remoteTasks && remoteTasks.length > 0) {
            merged = mergeLWW(merged, remoteTasks);
            invoke('sync_local_tasks', { remoteTasks }).catch((e) =>
              console.warn('[sync] sync_local_tasks failed:', e),
            );
          }
          if (remoteDCs && remoteDCs.length > 0) {
            await mergeDailyCompletions(remoteDCs);
          }
        } catch (e) {
          console.warn('[sync] refreshTasks pull failed:', e);
        }
      }

      tasks.value = merged;
      syncAllTags(merged);
    } finally {
      if (!silent) isLoading.value = false;
    }
  }

  async function loadLocalTasks(force = false): Promise<void> {
    if (isLocalReady.value && !force) return;

    isLoading.value = true;
    try {
      pendingResetTasks.value = await invoke<Task[]>('reset_daily_tasks', {
        today: getTodayStr(),
      });
      const localTasks = await invoke<Task[]>('get_tasks');
      await refreshDailyCompletions();
      const visibleTasks = localTasks.filter((task) => !task.is_deleted);
      tasks.value = visibleTasks;
      syncAllTags(visibleTasks);
      isLocalReady.value = true;
    } finally {
      isLoading.value = false;
    }
  }

  async function applyRemoteTasks(remoteTasks: Task[]): Promise<void> {
    if (remoteTasks.length === 0) return;

    const result = mergeTasksLWW(tasks.value, remoteTasks);
    if (!result.changed) return;

    tasks.value = result.tasks;
    syncAllTags(result.tasks);
    try {
      await invoke('sync_local_tasks', { remoteTasks });
    } catch (e) {
      console.warn('[sync] persist remote tasks failed:', e);
    }
  }

  async function pullRemoteAndMerge(): Promise<void> {
    if (!isLoggedIn.value || !navigator.onLine) return;

    const [remoteTasks, remoteDCs] = await Promise.all([
      withTimeout(pullTasks(true)),
      withTimeout(pullDailyCompletions()),
    ]);
    await applyRemoteTasks(remoteTasks);
    await mergeDailyCompletions(remoteDCs);
  }

  function startBackgroundSync(): Promise<void> {
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

        for (const task of pendingResetTasks.value) {
          pushTask(task).catch((e) => console.warn('[sync] push reset_daily:', e));
        }
        pendingResetTasks.value = [];

        const profileRestored = await syncCode.restoreProfile();
        if (profileRestored) {
          syncCode
            .mergeLocalToProfile(getProfileId()!)
            .catch((e) => console.warn('[sync] mergeLocalToProfile failed:', e));
        }

        await initSync();
        await pullRemoteAndMerge();
      } catch (e) {
        syncError.value = e instanceof Error ? e.message : '后台同步失败';
        console.warn('[sync] background sync failed:', e);
      } finally {
        isSyncing.value = false;
        syncPromise = null;
      }
    })();

    return syncPromise;
  }

  async function loadAll() {
    await loadLocalTasks();
    void startBackgroundSync();
  }

  async function refreshTasks(silent = false) {
    if (!silent) isLoading.value = true;
    try {
      await loadLocalTasks(true);
      void startBackgroundSync();
    } finally {
      if (!silent) isLoading.value = false;
    }
  }

  async function pullAndMerge() {
    await startBackgroundSync();
  }

  async function initSync(): Promise<boolean> {
    if (!isLoggedIn.value) return false;
    const hasProfile = await syncCode.hasProfile();
    if (!hasProfile) return false;
    if (realtimeInitialized) return true;
    realtimeInitialized = true;

    subscribeToChanges(
      (remoteTask) => {
        const current = tasks.value.find((task) => task.id === remoteTask.id);
        if (current && new Date(remoteTask.updated_at) < new Date(current.updated_at)) return;

        void applyRemoteTasks([remoteTask]).then(() => {
          if (remoteTask.is_daily && !remoteTask.completed) {
            dailyCompletedIds.value = dailyCompletedIds.value.filter(
              (tid) => tid !== remoteTask.id,
            );
            invoke('delete_daily_completion', { taskId: remoteTask.id, date: getTodayStr() });
          }
          if (remoteTask.is_daily && remoteTask.completed) {
            if (!dailyCompletedIds.value.includes(remoteTask.id)) {
              dailyCompletedIds.value = [...dailyCompletedIds.value, remoteTask.id];
            }
          }
        });
      },
      (dc, eventType) => {
        if (eventType === 'DELETE') {
          if (dc.task_id && dc.date) {
            invoke('delete_daily_completion', { taskId: dc.task_id, date: dc.date });
          }
          if (dc.date === getTodayStr()) {
            dailyCompletedIds.value = dailyCompletedIds.value.filter((tid) => tid !== dc.task_id);
          }
        } else {
          invoke('sync_remote_daily_completions', {
            remoteCompletions: [{ task_id: dc.task_id, date: dc.date }],
          });
          if (dc.date === getTodayStr() && !dailyCompletedIds.value.includes(dc.task_id)) {
            const task = tasks.value.find((t) => t.id === dc.task_id);
            if (!task || task.completed) {
              dailyCompletedIds.value = [...dailyCompletedIds.value, dc.task_id];
            }
          }
        }
      },
    );
    return true;
  }

  async function refreshDailyCompletions() {
    dailyCompletedIds.value = await invoke<string[]>('get_daily_completions', {
      date: getTodayStr(),
    });
  }

  async function cleanStaleDailyCompletions(remoteDCs: Array<{ task_id: string; date: string }>) {
    const remoteDates = [...new Set(remoteDCs.map((dc) => dc.date))];
    for (const date of remoteDates) {
      const remoteIds = remoteDCs.filter((dc) => dc.date === date).map((dc) => dc.task_id);
      const localIds = await invoke<string[]>('get_daily_completions', { date });
      for (const taskId of localIds) {
        if (!remoteIds.includes(taskId)) {
          await invoke('delete_daily_completion', { taskId, date });
        }
      }
    }
  }

  async function mergeDailyCompletions(remoteDCs: DailyCompletion[]) {
    if (remoteDCs.length === 0) return;
    try {
      await cleanStaleDailyCompletions(remoteDCs);
      await invoke('sync_remote_daily_completions', {
        remoteCompletions: remoteDCs.map((dc) => ({
          task_id: dc.task_id,
          date: dc.date,
          profile_id: dc.profile_id,
        })),
      });
      await refreshDailyCompletions();
    } catch (e) {
      console.warn('[sync] mergeDailyCompletions failed:', e);
    }
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
      tasks.value = [...tasks.value, task];
      if (tags.length > 0) {
        syncAllTags();
      }
      onTaskChanged(task);
    },
    'addTask',
  );

  const toggleTask = wrap(async (id: string) => {
    const canonical = await invoke<Task>('toggle_task', { id });
    tasks.value = tasks.value.map((t) => (t.id === id ? canonical : t));
    onTaskChanged(canonical);
  }, 'toggleTask');

  const toggleDailyTask = wrap(async (id: string, date: string) => {
    const wasCompleted = dailyCompletedIds.value.includes(id);
    await invoke('toggle_daily_task', { id, date });
    await refreshDailyCompletions();

    const task = tasks.value.find((t) => t.id === id);
    if (task) {
      const newlyCompleted = !wasCompleted;
      tasks.value = tasks.value.map((t) =>
        t.id === id
          ? {
              ...t,
              completed: newlyCompleted,
              completed_at: newlyCompleted ? new Date().toISOString() : null,
              updated_at: new Date().toISOString(),
            }
          : t,
      );
      const updated = tasks.value.find((t) => t.id === id);
      if (updated) onTaskChanged(updated);
    }

    if (wasCompleted) {
      onDailyDeleted(id, date);
    } else {
      // 推送 daily_completion 到 Supabase，防止 cleanStaleDailyCompletions 误删
      onDailyChanged({ task_id: id, date });
    }
  }, 'toggleDailyTask');

  const updateTask = wrap(async (id: string, title: string) => {
    if (!tasks.value.find((t) => t.id === id)) return;
    const task = tasks.value.find((t) => t.id === id)!;
    await invoke('update_task', {
      args: {
        id,
        title,
        dueDate: task.due_date,
        tags: task.tags,
        important: task.important,
        pinned: task.pinned,
        isDaily: task.is_daily,
      },
    });
    tasks.value = tasks.value.map((t) =>
      t.id === id ? { ...t, title, updated_at: new Date().toISOString() } : t,
    );
    const updated = tasks.value.find((t) => t.id === id);
    if (updated) onTaskChanged(updated);
  }, 'updateTask');

  const updateTaskMeta = wrap(
    async (
      id: string,
      tags: string[],
      important: boolean,
      pinned: boolean,
      isDaily: boolean,
      dueDate?: string | null,
    ) => {
      if (!tasks.value.find((t) => t.id === id)) return;
      const task = tasks.value.find((t) => t.id === id)!;
      await invoke('update_task', {
        args: {
          id,
          title: task.title,
          dueDate: dueDate !== undefined ? dueDate : task.due_date,
          tags,
          important,
          pinned,
          isDaily,
        },
      });
      const patch: Partial<Task> = {
        tags,
        important,
        pinned,
        is_daily: isDaily,
        updated_at: new Date().toISOString(),
      };
      if (dueDate !== undefined) {
        (patch as any).due_date = dueDate;
      }
      tasks.value = tasks.value.map((t) => (t.id === id ? { ...t, ...patch } : t));
      syncAllTags();
      const updated = tasks.value.find((t) => t.id === id);
      if (updated) onTaskChanged(updated);
    },
    'updateTaskMeta',
  );

  const deleteTask = wrap(async (id: string) => {
    await invoke('delete_task', { id });
    const now = new Date().toISOString();
    // 标记父任务 + 子任务为已删除
    const deletedIds = new Set<string>();
    tasks.value = tasks.value.map((t) => {
      if (t.id === id || t.parent_id === id) {
        deletedIds.add(t.id);
        return { ...t, is_deleted: true, updated_at: now };
      }
      return t;
    });
    for (const tid of deletedIds) {
      const t = tasks.value.find((x) => x.id === tid);
      if (t) onTaskChanged(t);
    }
    tasks.value = tasks.value.filter((t) => !deletedIds.has(t.id));
    syncAllTags();
  }, 'deleteTask');

  const clearCompleted = wrap(async () => {
    // 跳过每日任务（is_daily），每日任务每天自动重置，不应被清除
    const clearedIds = tasks.value
      .filter((t) => t.completed && !t.is_deleted && !t.is_daily)
      .map((t) => t.id);
    await invoke('clear_completed');
    const now = new Date().toISOString();
    tasks.value = tasks.value.map((t) =>
      t.completed && !t.is_deleted && !t.is_daily ? { ...t, is_deleted: true, updated_at: now } : t,
    );
    const cleared = tasks.value.filter((t) => t.completed && t.is_deleted);
    for (const task of cleared) {
      onTaskChanged(task);
    }
    tasks.value = tasks.value.filter((t) => !t.is_deleted);
    // 清理已清除任务的 daily completion 记录
    dailyCompletedIds.value = dailyCompletedIds.value.filter((tid) => !clearedIds.includes(tid));
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
      pullAndMerge().catch((e) => console.warn('[sync] auto-pull after reconnect failed:', e));
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
    syncStatus,
    isLoading,
    isLocalReady,
    isSyncing,
    syncError,
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
    pushTask,
    // CRUD
    addTask,
    toggleTask,
    toggleDailyTask,
    updateTask,
    updateTaskMeta,
    deleteTask,
    clearCompleted,
    // 筛选
    selectDate,
    toggleTag,
    addTag,
  };
}
