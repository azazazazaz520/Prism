import { ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { Task, SubTask } from '../types';
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

/** 是否已初始化认证和同步 */
let syncInitialized = false;

/** 任务看板 composable：组合 TaskRepo + FilterEngine + Sync，只做编排 */
export function useTaskStore() {
  const { isLoggedIn, initAuth } = useAuth();
  const { pushTask, pushDailyCompletion, pullTasks, subscribeToChanges, syncStatus } = useSync();
  const syncCode = useSyncCode();

  // ── 创建 TaskRepo，变更时触发同步 ──────────────

  const repo = createTaskRepo((task) => {
    if (isLoggedIn.value) {
      pushTask(task).catch((e) => console.warn('[sync] pushTask:', e));
    }
  });

  const { tasks, allTags, dailyCompletedIds } = repo;

  // ── 计算属性（委托给 FilterEngine） ────────────

  const filteredTasks = computed(() =>
    filterTasks(tasks.value, filterDate.value, selectedTags.value),
  );

  const overdueCount = computed(() => countOverdue(tasks.value));
  const pendingCount = computed(() => countPending(tasks.value));
  const dailyCompletions = computed(() => dailyCompletionsMap(dailyCompletedIds.value));

  // ── 数据加载与同步（编排） ──────────────────────

  async function loadAll() {
    if (!syncInitialized) {
      syncInitialized = true;
      try {
        await initAuth();
      } catch (e) {
        console.warn('[sync] initAuth failed:', e);
      }
    }

    await Promise.all([repo.loadAll(), refreshDailyCompletions()]);

    if (isLoggedIn.value) {
      try {
        await syncCode.restoreProfile();
        const remoteTasks = await pullTasks(true);
        if (remoteTasks.length > 0) {
          tasks.value = mergeLWW(tasks.value, remoteTasks);
        }
      } catch (e) {
        console.warn('[sync] loadAll pull failed:', e);
      }
    }
  }

  async function refreshTasks() {
    await repo.refreshTasks();
    await refreshDailyCompletions();

    if (isLoggedIn.value) {
      try {
        const remoteTasks = await pullTasks(true);
        if (remoteTasks.length > 0) {
          const merged = mergeLWW(tasks.value, remoteTasks);
          if (
            merged.length !== tasks.value.length ||
            !merged.every(
              (t, i) => t.id === tasks.value[i]?.id && t.updated_at === tasks.value[i]?.updated_at,
            )
          ) {
            tasks.value = merged;
          }
        }
      } catch (e) {
        console.warn('[sync] refreshTasks pull failed:', e);
      }
    }
  }

  async function pullAndMerge() {
    const remoteTasks = await pullTasks(true);
    if (remoteTasks.length === 0) return;
    const merged = mergeLWW(tasks.value, remoteTasks);
    if (
      merged.length !== tasks.value.length ||
      !merged.every(
        (t, i) => t.id === tasks.value[i]?.id && t.updated_at === tasks.value[i]?.updated_at,
      )
    ) {
      tasks.value = merged;
    }
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
          }
        } else if (!remoteTask.is_deleted) {
          tasks.value = [...tasks.value, remoteTask];
        }
        allTags.value = tagsFromTasks(tasks.value);
      },
      (_dc) => {
        refreshDailyCompletions();
      },
    );
  }

  async function refreshDailyCompletions() {
    dailyCompletedIds.value = await invoke<string[]>('get_daily_completions', {
      date: getTodayStr(),
    });
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
