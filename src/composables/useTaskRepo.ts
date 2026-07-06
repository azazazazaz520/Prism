import { ref, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { Task, SubTask, DailyCompletion } from '../types';
import { getTodayStr } from './useFilterEngine';

/**
 * TaskRepo — 任务 CRUD 模块
 *
 * 封装所有 Rust 后端交互，管理本地任务列表的响应式状态。
 * 不关心同步 — 调用方通过 onTaskChanged / onDailyChanged 回调获知变更。
 */

export interface TaskRepo {
  tasks: Ref<Task[]>;
  allTags: Ref<string[]>;
  dailyCompletedIds: Ref<string[]>;
  loadAll: () => Promise<void>;
  refreshTasks: () => Promise<void>;
  refreshDailyCompletions: () => Promise<void>;
  addTask: (
    title: string,
    dueDate: string | null,
    tags: string[],
    important: boolean,
    pinned: boolean,
    isDaily: boolean,
    parentId?: string,
  ) => Promise<Task>;
  toggleTask: (id: string) => Promise<void>;
  toggleDailyTask: (id: string, date: string) => Promise<DailyCompletion>;
  updateTask: (id: string, title: string) => Promise<void>;
  updateTaskMeta: (
    id: string,
    tags: string[],
    important: boolean,
    pinned: boolean,
  ) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  clearCompleted: () => Promise<void>;
  decomposeTask: (parentId: string) => Promise<void>;
}

/** 创建 TaskRepo 实例 */
export function createTaskRepo(
  onTaskChanged?: (task: Task) => void,
  onDailyChanged?: (dc: DailyCompletion) => void,
): TaskRepo {
  const tasks = ref<Task[]>([]);
  const allTags = ref<string[]>([]);
  const dailyCompletedIds = ref<string[]>([]);

  // ── 数据加载 ──────────────────────────────

  async function loadAll() {
    const [localTasks, _allTags] = await Promise.all([
      invoke<Task[]>('get_tasks'),
      invoke<string[]>('get_all_tags'),
    ]);
    allTags.value = _allTags;
    tasks.value = localTasks.filter((t) => !t.is_deleted);
  }

  async function refreshTasks() {
    const [localTasks, _allTags] = await Promise.all([
      invoke<Task[]>('get_tasks'),
      invoke<string[]>('get_all_tags'),
    ]);
    allTags.value = _allTags;
    const filtered = localTasks.filter((t) => !t.is_deleted);

    if (
      filtered.length !== tasks.value.length ||
      !filtered.every(
        (t, i) => t.id === tasks.value[i]?.id && t.updated_at === tasks.value[i]?.updated_at,
      )
    ) {
      tasks.value = filtered;
    }
  }

  async function refreshDailyCompletions() {
    dailyCompletedIds.value = await invoke<string[]>('get_daily_completions', {
      date: getTodayStr(),
    });
  }

  // ── CRUD ──────────────────────────────

  async function addTask(
    title: string,
    dueDate: string | null,
    tags: string[],
    important: boolean,
    pinned: boolean,
    isDaily: boolean,
    parentId?: string,
  ): Promise<Task> {
    const task = await invoke<Task>('add_task', {
      args: { title, dueDate, tags, important, pinned, isDaily, parentId },
    });
    tasks.value = [...tasks.value, task];
    if (tags.length > 0) {
      allTags.value = await invoke<string[]>('get_all_tags');
    }
    onTaskChanged?.(task);
    return task;
  }

  async function toggleTask(id: string) {
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
    if (updated) onTaskChanged?.(updated);
  }

  /// 切换每日任务完成状态，返回变动的 DailyCompletion 供同步层推送
  async function toggleDailyTask(id: string, date: string): Promise<DailyCompletion> {
    await invoke('toggle_daily_task', { id, date });
    await refreshDailyCompletions();

    // 判断操作类型：当前是否在已完成列表中
    const isCurrentlyCompleted = dailyCompletedIds.value.includes(id);
    const dc: DailyCompletion = {
      task_id: id,
      date,
      profile_id: null,
    };
    onDailyChanged?.(dc);
    return dc;
  }

  async function updateTask(id: string, title: string) {
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
    if (updated) onTaskChanged?.(updated);
  }

  async function updateTaskMeta(id: string, tags: string[], important: boolean, pinned: boolean) {
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
    if (updated) onTaskChanged?.(updated);
  }

  async function deleteTask(id: string) {
    await invoke('delete_task', { id });
    tasks.value = tasks.value.map((t) =>
      t.id === id ? { ...t, is_deleted: true, updated_at: new Date().toISOString() } : t,
    );
    const deleted = tasks.value.find((t) => t.id === id);
    if (deleted) onTaskChanged?.(deleted);
    tasks.value = tasks.value.filter((t) => t.id !== id);
    allTags.value = await invoke<string[]>('get_all_tags');
  }

  async function clearCompleted() {
    await invoke('clear_completed');
    const now = new Date().toISOString();
    tasks.value = tasks.value.map((t) =>
      t.completed && !t.is_deleted ? { ...t, is_deleted: true, updated_at: now } : t,
    );
    const cleared = tasks.value.filter((t) => t.completed && t.is_deleted);
    for (const task of cleared) {
      onTaskChanged?.(task);
    }
    tasks.value = tasks.value.filter((t) => !t.is_deleted);
  }

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
      onTaskChanged?.(task);
    }
  }

  return {
    tasks,
    allTags,
    dailyCompletedIds,
    loadAll,
    refreshTasks,
    refreshDailyCompletions,
    addTask,
    toggleTask,
    toggleDailyTask,
    updateTask,
    updateTaskMeta,
    deleteTask,
    clearCompleted,
    decomposeTask,
  };
}
