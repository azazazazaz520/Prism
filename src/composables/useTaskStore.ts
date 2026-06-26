import { ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { Task, SubTask } from '../types';

/** 任务数据（全局单例 ref，确保跨组件共享） */
const tasks = ref<Task[]>([]);
const allTags = ref<string[]>([]);
const dailyCompletedIds = ref<string[]>([]);

/** 筛选状态 */
const filterDate = ref<string | null>(null);
const selectedTags = ref<string[]>([]);

/** 任务看板 composable：核心数据 + 筛选 + CRUD 操作 */
export function useTaskStore() {
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
    return result;
  });

  const overdueCount = computed(() => {
    const ts = todayStr();
    return tasks.value.filter((t) => t.due_date && t.due_date < ts && !t.completed).length;
  });

  const pendingCount = computed(() => {
    return tasks.value.filter((t) => !t.completed).length;
  });

  // ── 数据加载 ──────────────────────────────

  /** 加载所有任务和标签数据 */
  async function loadAll() {
    tasks.value = await invoke<Task[]>('get_tasks');
    allTags.value = await invoke<string[]>('get_all_tags');
    await refreshDailyCompletions();
  }

  async function refreshDailyCompletions() {
    dailyCompletedIds.value = await invoke<string[]>('get_daily_completions', {
      date: todayStr(),
    });
  }

  // ── 任务 CRUD（集中双写：invoke 成功后更新 ref） ──────

  async function addTask(
    title: string,
    due_date: string | null,
    tags: string[],
    important: boolean,
    pinned: boolean,
    is_daily: boolean,
  ) {
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
    tasks.value.push(task);
    if (tags.length > 0) {
      allTags.value = await invoke<string[]>('get_all_tags');
    }
  }

  async function toggleTask(id: string) {
    await invoke('toggle_task', { id });
    const task = tasks.value.find((t) => t.id === id);
    if (task) {
      task.completed = !task.completed;
      task.completed_at = task.completed ? new Date().toISOString() : null;
    }
  }

  async function toggleDailyTask(id: string, date: string) {
    await invoke('toggle_daily_task', { id, date });
    await refreshDailyCompletions();
  }

  async function updateTask(id: string, title: string) {
    const task = tasks.value.find((t) => t.id === id);
    if (!task) return;
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
    task.title = title;
  }

  async function updateTaskMeta(id: string, tags: string[], important: boolean, pinned: boolean) {
    const task = tasks.value.find((t) => t.id === id);
    if (!task) return;
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
    task.tags = tags;
    task.important = important;
    task.pinned = pinned;
    allTags.value = await invoke<string[]>('get_all_tags');
  }

  async function deleteTask(id: string) {
    await invoke('delete_task', { id });
    tasks.value = tasks.value.filter((t) => t.id !== id);
    allTags.value = await invoke<string[]>('get_all_tags');
  }

  async function clearCompleted() {
    await invoke('clear_completed');
    tasks.value = tasks.value.filter((t) => !t.completed);
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
      tasks.value.push(task);
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
    // 计算属性
    filteredTasks,
    dailyCompletionsMap,
    overdueCount,
    pendingCount,
    // 数据加载
    loadAll,
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
