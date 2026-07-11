import { ref, computed, watch, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { Task, DailyCompletion, SubTask } from '../types';
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
} from './useFilterEngine';

// 重新导出 — 保持向后兼容
export { mergeLWW as mergeTasksLWW } from './useFilterEngine';

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

/** 是否已初始化认证和同步 */
let syncInitialized = false;

/** 为 sync pull 操作添加超时，离线时快速失败而非等待 HTTP 超时 */
const PULL_TIMEOUT_MS = 8000;
function withTimeout<T>(promise: Promise<T>, ms = PULL_TIMEOUT_MS): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), ms),
  );
  return Promise.race([promise, timeout]);
}

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

  // ── 响应式状态 ──────────────────────────────

  const tasks = ref<Task[]>([]);
  const allTags = ref<string[]>([]);
  const dailyCompletedIds = ref<string[]>([]);

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

  // ── 通用 CRUD 错误包裹（ponytail: 一个闭包替代 8 个重复函数） ──

  function wrap<T extends (...args: any[]) => Promise<any>>(fn: T, label: string): T {
    return (async (...args: any[]) => {
      try {
        return await fn(...args);
      } catch (e) {
        console.error(`[${label}] failed:`, e);
        await loadAll();
      }
    }) as T;
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

  async function loadAll() {
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

  async function refreshTasks() {
    isLoading.value = true;
    try {
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
      isLoading.value = false;
    }
  }

  async function pullAndMerge() {
    const remoteTasks = await pullTasks(true);
    if (remoteTasks.length === 0) return;
    const merged = mergeLWW(tasks.value, remoteTasks);
    tasks.value = merged;
    syncAllTags(merged);
  }

  async function initSync() {
    if (!isLoggedIn.value) return;
    const hasProfile = await syncCode.hasProfile();
    if (!hasProfile) return;

    subscribeToChanges(
      (remoteTask) => {
        const idx = tasks.value.findIndex((t) => t.id === remoteTask.id);
        if (idx >= 0) {
          if (new Date(remoteTask.updated_at) >= new Date(tasks.value[idx].updated_at)) {
            tasks.value = tasks.value
              .map((t) => (t.id === remoteTask.id ? remoteTask : t))
              .filter((t) => !t.is_deleted);
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
          }
        } else if (!remoteTask.is_deleted) {
          tasks.value = [...tasks.value, remoteTask];
        }
        syncAllTags();
      },
      (dc, eventType) => {
        if (eventType === 'DELETE') {
          invoke('delete_daily_completion', { taskId: dc.task_id, date: dc.date });
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
        allTags.value = await invoke<string[]>('get_all_tags');
      }
      onTaskChanged(task);
    },
    'addTask',
  );

  const toggleTask = wrap(async (id: string) => {
    await invoke('toggle_task', { id });
    tasks.value = tasks.value.map((t) =>
      t.id === id
        ? {
            ...t,
            completed: !t.completed,
            completed_at: !t.completed ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          }
        : t,
    );
    const updated = tasks.value.find((t) => t.id === id);
    if (updated) onTaskChanged(updated);
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
    async (id: string, tags: string[], important: boolean, pinned: boolean) => {
      if (!tasks.value.find((t) => t.id === id)) return;
      const task = tasks.value.find((t) => t.id === id)!;
      await invoke('update_task', {
        args: {
          id,
          title: task.title,
          dueDate: task.due_date,
          tags,
          important,
          pinned,
          isDaily: task.is_daily,
        },
      });
      tasks.value = tasks.value.map((t) =>
        t.id === id ? { ...t, tags, important, pinned, updated_at: new Date().toISOString() } : t,
      );
      allTags.value = await invoke<string[]>('get_all_tags');
      const updated = tasks.value.find((t) => t.id === id);
      if (updated) onTaskChanged(updated);
    },
    'updateTaskMeta',
  );

  const deleteTask = wrap(async (id: string) => {
    await invoke('delete_task', { id });
    tasks.value = tasks.value.map((t) =>
      t.id === id ? { ...t, is_deleted: true, updated_at: new Date().toISOString() } : t,
    );
    const deleted = tasks.value.find((t) => t.id === id);
    if (deleted) onTaskChanged(deleted);
    tasks.value = tasks.value.filter((t) => t.id !== id);
    allTags.value = await invoke<string[]>('get_all_tags');
  }, 'deleteTask');

  const clearCompleted = wrap(async () => {
    await invoke('clear_completed');
    const now = new Date().toISOString();
    tasks.value = tasks.value.map((t) =>
      t.completed && !t.is_deleted ? { ...t, is_deleted: true, updated_at: now } : t,
    );
    const cleared = tasks.value.filter((t) => t.completed && t.is_deleted);
    for (const task of cleared) {
      onTaskChanged(task);
    }
    tasks.value = tasks.value.filter((t) => !t.is_deleted);
  }, 'clearCompleted');

  const decomposeTask = wrap(async (parentId: string) => {
    const subtasks = await invoke<SubTask[]>('ai_decompose', { taskId: parentId });
    for (const sub of subtasks) {
      const task = await invoke<Task>('add_task', {
        args: {
          title: sub.title,
          dueDate: null,
          tags: [],
          important: false,
          pinned: false,
          isDaily: false,
          parentId,
        },
      });
      tasks.value = [...tasks.value, task];
      onTaskChanged(task);
    }
  }, 'decomposeTask');

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

  return {
    // 数据
    tasks,
    allTags,
    dailyCompletedIds,
    filterDate,
    selectedTags,
    syncStatus,
    isLoading,
    // 计算属性
    filteredTasks,
    dailyCompletionsMap: dailyCompletions,
    overdueCount,
    pendingCount,
    // 数据加载
    loadAll,
    refreshTasks,
    initSync,
    // CRUD
    addTask,
    toggleTask,
    toggleDailyTask,
    updateTask,
    updateTaskMeta,
    deleteTask,
    clearCompleted,
    decomposeTask,
    // 筛选
    selectDate,
    toggleTag,
    addTag,
  };
}
