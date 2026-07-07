import { ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { Task, DailyCompletion, SubTask } from '../types';
import { useAuth } from './useAuth';
import { useSync } from './useSync';
import { useSyncCode } from './useSyncCode';
import { createTaskRepo } from './useTaskRepo';
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
  } = useSync();
  const syncCode = useSyncCode();

  // ── 创建 TaskRepo，变更时触发同步 ──────────────

  const repo = createTaskRepo(
    (task) => {
      if (isLoggedIn.value) {
        pushTask(task).catch((e) => console.warn('[sync] pushTask:', e));
      }
    },
    (dc) => {
      if (isLoggedIn.value) {
        pushDailyCompletion(dc).catch((e) => console.warn('[sync] pushDailyCompletion:', e));
      }
    },
    (taskId, date) => {
      if (isLoggedIn.value) {
        pushDeleteDailyCompletion(taskId, date).catch((e) =>
          console.warn('[sync] pushDeleteDailyCompletion:', e),
        );
      }
    },
  );

  const { tasks, allTags, dailyCompletedIds } = repo;

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
          await syncCode.restoreProfile();
          const [remoteTasks, remoteDCs] = await Promise.all([
            pullTasks(true),
            pullDailyCompletions(),
          ]);
          if (remoteTasks.length > 0) {
            merged = mergeLWW(merged, remoteTasks);
          }
          if (remoteDCs.length > 0) {
            await mergeDailyCompletions(remoteDCs);
          }
        } catch (e) {
          console.warn('[sync] loadAll pull failed:', e);
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

      if (isLoggedIn.value) {
        try {
          const [remoteTasks, remoteDCs] = await Promise.all([
            pullTasks(true),
            pullDailyCompletions(),
          ]);
          if (remoteTasks.length > 0) {
            merged = mergeLWW(merged, remoteTasks);
          }
          if (remoteDCs.length > 0) {
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
            // 安全网：当每日任务的 completed 被远端置为 false 时，
            // 同步清理 dailyCompletedIds 和本地磁盘，防止 Realtime DELETE
            // 事件因 REPLICA IDENTITY DEFAULT 丢失字段而被过滤掉
            if (remoteTask.is_daily && !remoteTask.completed) {
              dailyCompletedIds.value = dailyCompletedIds.value.filter(
                (tid) => tid !== remoteTask.id,
              );
              // 同时清理本地磁盘，否则 refreshDailyCompletions() 会从磁盘
              // 重新读回旧数据，覆盖内存中的正确状态
              invoke('delete_daily_completion', { taskId: remoteTask.id, date: getTodayStr() });
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
            // 竞态防护：若任务 completed 已为 false，说明取消完成的任务更新
            // 已先于本 INSERT 到达，不应再将此任务加入 dailyCompletedIds
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

  /// 将远端每日完成记录合并到本地 store
  async function mergeDailyCompletions(remoteDCs: DailyCompletion[]) {
    if (remoteDCs.length === 0) return;
    try {
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

  // ── CRUD 包装器（委托给 TaskRepo + 错误回退） ──

  // 注意：构造 repo 时已设 onTaskChanged → sync，所以 CRUD 操作自动同步

  async function addTask(
    title: string,
    due_date: string | null,
    tags: string[],
    important: boolean,
    pinned: boolean,
    is_daily: boolean,
  ) {
    try {
      await repo.addTask(title, due_date, tags, important, pinned, is_daily);
    } catch (e) {
      console.error('[addTask] invoke failed, falling back to reload:', e);
      await loadAll();
    }
  }

  async function toggleTask(id: string) {
    try {
      await repo.toggleTask(id);
    } catch (e) {
      console.error('[toggleTask] invoke failed, falling back to reload:', e);
      await loadAll();
    }
  }

  async function toggleDailyTask(id: string, date: string) {
    try {
      await repo.toggleDailyTask(id, date);
    } catch (e) {
      console.error('[toggleDailyTask] invoke failed, falling back to reload:', e);
      await loadAll();
    }
  }

  async function updateTask(id: string, title: string) {
    try {
      await repo.updateTask(id, title);
    } catch (e) {
      console.error('[updateTask] invoke failed, falling back to reload:', e);
      await loadAll();
    }
  }

  async function updateTaskMeta(id: string, tags: string[], important: boolean, pinned: boolean) {
    try {
      await repo.updateTaskMeta(id, tags, important, pinned);
    } catch (e) {
      console.error('[updateTaskMeta] invoke failed, falling back to reload:', e);
      await loadAll();
    }
  }

  async function deleteTask(id: string) {
    try {
      await repo.deleteTask(id);
    } catch (e) {
      console.error('[deleteTask] invoke failed, falling back to reload:', e);
      await loadAll();
    }
  }

  async function clearCompleted() {
    try {
      await repo.clearCompleted();
    } catch (e) {
      console.error('[clearCompleted] invoke failed, falling back to reload:', e);
      await loadAll();
    }
  }

  async function decomposeTask(parentId: string) {
    try {
      await repo.decomposeTask(parentId);
    } catch (e) {
      console.error('[decomposeTask] invoke failed, falling back to reload:', e);
      await loadAll();
    }
  }

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
    // 追踪手动添加的标签，确保 syncAllTags() 不会覆盖丢失
    if (!customTags.value.includes(tag)) {
      customTags.value.push(tag);
    }
    if (!allTags.value.includes(tag)) {
      allTags.value.push(tag);
    }
    selectedTags.value = [tag];
  }

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
