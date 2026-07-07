import { ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { Task, SubTask } from '../types';
import { useAuth } from './useAuth';
import { useSync } from './useSync';
import { useSyncCode } from './useSyncCode';

/** 任务数据（全局单例 ref，确保跨组件共享） */
const tasks = ref<Task[]>([]);
const allTags = ref<string[]>([]);
const dailyCompletedIds = ref<string[]>([]);

/** 筛选状态 */
const filterDate = ref<string | null>(null);
const selectedTags = ref<string[]>([]);

/** 是否已初始化认证和同步 */
let syncInitialized = false;

/** LWW 合并纯函数：将远端任务合并到本地任务列表。
 *  返回合并后的新数组，不修改原数组。
 *  >= 而非 >：手动同步时远端优先，防止 DB 直接修改后 updated_at 未变导致漏更新。 */
export function mergeTasksLWW(local: Task[], remote: Task[]): Task[] {
  if (remote.length === 0) return local;

  const merged = new Map(local.map((t) => [t.id, t]));

  for (const rt of remote) {
    const lt = merged.get(rt.id);
    if (!lt || new Date(rt.updated_at) >= new Date(lt.updated_at)) {
      merged.set(rt.id, rt);
    }
  }

  return [...merged.values()].filter((t) => !t.is_deleted);
}

/** 任务看板 composable：核心数据 + 筛选 + CRUD + 同步 */
export function useTaskStore() {
  const { isLoggedIn, initAuth } = useAuth();
  const { pushTask, pullTasks, subscribeToChanges, syncStatus } = useSync();
  const syncCode = useSyncCode();

  // ── 计算属性 ──────────────────────────────

  const dailyCompletionsMap = computed(() => {
    const map: Record<string, boolean> = {};
    for (const id of dailyCompletedIds.value) {
      map[id] = true;
    }
    return map;
  });

  /** 根据日期和标签筛选后的任务列表 */
  const filteredTasks = computed(() => {
    let result = tasks.value;
    if (filterDate.value) {
      result = result.filter((t) => t.due_date === filterDate.value);
    }
    if (selectedTags.value.length > 0) {
      result = result.filter((t) => selectedTags.value.some((tag) => t.tags.includes(tag)));
    }
    return [...result];
  });

  const overdueCount = computed(() => {
    const ts = todayStr();
    return tasks.value.filter((t) => t.due_date && t.due_date < ts && !t.completed).length;
  });

  const pendingCount = computed(() => {
    return tasks.value.filter((t) => !t.completed).length;
  });

  // ── 数据加载与同步 ──────────────────────────

  /** 加载本地数据，若已配对则从远端合并，并初始化 Realtime 订阅 */
  async function loadAll() {
    // 仅在首次调用时初始化认证和同步
    if (!syncInitialized) {
      syncInitialized = true;
      try {
        await initAuth();
      } catch (e) {
        console.warn('[sync] initAuth failed:', e);
      }
    }

    const [localTasks, _allTags] = await Promise.all([
      invoke<Task[]>('get_tasks'),
      invoke<string[]>('get_all_tags'),
    ]);
    allTags.value = _allTags;
    await refreshDailyCompletions();

    // 先展示本地数据，防止远端慢/失败时黑屏
    tasks.value = localTasks.filter((t) => !t.is_deleted);

    // 恢复已配对的 profile，并尝试远端合并
    if (isLoggedIn.value) {
      try {
        await syncCode.restoreProfile();
        const remoteTasks = await pullTasks(true);
        if (remoteTasks.length > 0) {
          tasks.value = mergeTasksLWW(tasks.value, remoteTasks);
        }
      } catch (e) {
        console.warn('[sync] loadAll pull failed:', e);
      }
    }
  }

  /**
   * 重新进入时刷新任务：后台合并本地+远端，替换前不重置列表。
   * 与 loadAll 的区别：保持当前数据可见，避免"先闪本地再出远端"的闪烁。
   */
  async function refreshTasks() {
    const [localTasks, _allTags] = await Promise.all([
      invoke<Task[]>('get_tasks'),
      invoke<string[]>('get_all_tags'),
    ]);
    allTags.value = _allTags;
    await refreshDailyCompletions();

    let merged = localTasks.filter((t) => !t.is_deleted);

    if (isLoggedIn.value) {
      try {
        const remoteTasks = await pullTasks(true);
        if (remoteTasks.length > 0) {
          merged = mergeTasksLWW(merged, remoteTasks);
        }
      } catch (e) {
        console.warn('[sync] refreshTasks pull failed:', e);
      }
    }

    // 仅在结果有变化时替换，避免无关更新触发重渲染
    if (
      merged.length !== tasks.value.length ||
      !merged.every(
        (t, i) => t.id === tasks.value[i]?.id && t.updated_at === tasks.value[i]?.updated_at,
      )
    ) {
      tasks.value = merged;
    }
  }

  /** LWW 合并远端任务到本地，强制全量拉取 */
  async function pullAndMerge() {
    const remoteTasks = await pullTasks(true);
    if (remoteTasks.length === 0) return;

    const merged = mergeTasksLWW(tasks.value, remoteTasks);
    if (
      merged.length !== tasks.value.length ||
      !merged.every(
        (t, i) => t.id === tasks.value[i]?.id && t.updated_at === tasks.value[i]?.updated_at,
      )
    ) {
      tasks.value = merged;
    }
  }

  /** 初始化 Realtime 订阅（仅已配对时生效） */
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
        allTags.value = [...new Set(tasks.value.flatMap((t) => t.tags))].sort();
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
      date: todayStr(),
    });
  }

  // ── 同步推送辅助 ──────────────────────────

  function syncPush(task: Task) {
    if (!isLoggedIn.value) return;
    pushTask(task).catch((e) => console.warn('[sync] pushTask:', e));
  }

  // ── 任务 CRUD ──────────────────────────────

  async function addTask(
    title: string,
    due_date: string | null,
    tags: string[],
    important: boolean,
    pinned: boolean,
    is_daily: boolean,
  ) {
    try {
      const task = await invoke<Task>('add_task', {
        args: {
          title,
          dueDate: due_date,
          tags,
          important,
          pinned,
          isDaily: is_daily,
        },
      });
      tasks.value = [...tasks.value, task];
      if (tags.length > 0) {
        allTags.value = await invoke<string[]>('get_all_tags');
      }
      syncPush(task);
    } catch (e) {
      console.error('[addTask] invoke failed, falling back to reload:', e);
      await loadAll();
    }
  }

  async function toggleTask(id: string) {
    try {
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
      if (updated) syncPush(updated);
    } catch (e) {
      console.error('[toggleTask] invoke failed, falling back to reload:', e);
      await loadAll();
    }
  }

  async function toggleDailyTask(id: string, date: string) {
    try {
      await invoke('toggle_daily_task', { id, date });
      await refreshDailyCompletions();
    } catch (e) {
      console.error('[toggleDailyTask] invoke failed, falling back to reload:', e);
      await loadAll();
    }
  }

  async function updateTask(id: string, title: string) {
    if (!tasks.value.find((t) => t.id === id)) return;
    try {
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
      if (updated) syncPush(updated);
    } catch (e) {
      console.error('[updateTask] invoke failed, falling back to reload:', e);
      await loadAll();
    }
  }

  async function updateTaskMeta(id: string, tags: string[], important: boolean, pinned: boolean) {
    if (!tasks.value.find((t) => t.id === id)) return;
    try {
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
      if (updated) syncPush(updated);
    } catch (e) {
      console.error('[updateTaskMeta] invoke failed, falling back to reload:', e);
      await loadAll();
    }
  }

  async function deleteTask(id: string) {
    try {
      await invoke('delete_task', { id });
      tasks.value = tasks.value.map((t) =>
        t.id === id ? { ...t, is_deleted: true, updated_at: new Date().toISOString() } : t,
      );
      const deleted = tasks.value.find((t) => t.id === id);
      if (deleted) syncPush(deleted);
      tasks.value = tasks.value.filter((t) => t.id !== id);
      allTags.value = await invoke<string[]>('get_all_tags');
    } catch (e) {
      console.error('[deleteTask] invoke failed, falling back to reload:', e);
      await loadAll();
    }
  }

  async function clearCompleted() {
    try {
      await invoke('clear_completed');
      const now = new Date().toISOString();
      tasks.value = tasks.value.map((t) =>
        t.completed && !t.is_deleted ? { ...t, is_deleted: true, updated_at: now } : t,
      );
      // 推送每个被清除的任务
      const cleared = tasks.value.filter((t) => t.completed && t.is_deleted);
      for (const task of cleared) {
        syncPush(task);
      }
      tasks.value = tasks.value.filter((t) => !t.is_deleted);
    } catch (e) {
      console.error('[clearCompleted] invoke failed, falling back to reload:', e);
      await loadAll();
    }
  }

  /** AI 拆解任务：调用后端获取子任务，逐个创建并关联父任务 */
  async function decomposeTask(parentId: string) {
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
      syncPush(task);
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
    dailyCompletionsMap,
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

function todayStr(): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
