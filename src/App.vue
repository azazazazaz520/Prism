<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Task } from './types';
import TaskInput from './components/TaskInput.vue';
import TaskList from './components/TaskList.vue';
import TaskStats from './components/TaskStats.vue';
import MiniCalendar from './components/MiniCalendar.vue';
import TagFilterBar from './components/TagFilterBar.vue';

const tasks = ref<Task[]>([]);
const filterDate = ref<string | null>(null);
const selectedTags = ref<string[]>([]);
const allTags = ref<string[]>([]);
const dailyCompletedIds = ref<string[]>([]);

onMounted(async () => {
  await loadAll();
  const appWindow = getCurrentWindow();
  const unlistenFocus = await appWindow.listen('tauri://focus', () => {
    loadAll();
  });
  onUnmounted(() => {
    unlistenFocus();
  });
});

async function loadAll() {
  tasks.value = await invoke<Task[]>('get_tasks');
  allTags.value = await invoke<string[]>('get_all_tags');
  await refreshDailyCompletions();
}

function todayStr(): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function refreshDailyCompletions() {
  dailyCompletedIds.value = await invoke<string[]>('get_daily_completions', { date: todayStr() });
}

const dailyCompletionsMap = computed(() => {
  const map: Record<string, boolean> = {};
  for (const id of dailyCompletedIds.value) {
    map[id] = true;
  }
  return map;
});

const filteredTasks = computed(() => {
  let result = tasks.value;
  if (filterDate.value) {
    result = result.filter(t => t.due_date === filterDate.value);
  }
  if (selectedTags.value.length > 0) {
    result = result.filter(t =>
      selectedTags.value.some(tag => t.tags.includes(tag))
    );
  }
  return result;
});

const overdueCount = computed(() => {
  const ts = todayStr();
  return tasks.value.filter(t => t.due_date && t.due_date < ts && !t.completed).length;
});

async function handleAdd(
  title: string,
  due_date: string | null,
  tags: string[],
  important: boolean,
  pinned: boolean,
  is_daily: boolean,
) {
  const task = await invoke<Task>('add_task', {
    title,
    dueDate: due_date,
    tags,
    important,
    pinned,
    isDaily: is_daily,
  });
  tasks.value.push(task);
  if (tags.length > 0) {
    allTags.value = await invoke<string[]>('get_all_tags');
  }
}

async function handleToggle(id: string) {
  await invoke('toggle_task', { id });
  const task = tasks.value.find(t => t.id === id);
  if (task) {
    task.completed = !task.completed;
    task.completed_at = task.completed ? new Date().toISOString() : null;
  }
}

async function handleToggleDaily(id: string, date: string) {
  await invoke('toggle_daily_task', { id, date });
  await refreshDailyCompletions();
}

async function handleUpdate(id: string, title: string) {
  const task = tasks.value.find(t => t.id === id);
  if (!task) return;
  await invoke('update_task', {
    id,
    title,
    dueDate: task.due_date,
    tags: task.tags,
    important: task.important,
    pinned: task.pinned,
    isDaily: task.is_daily,
  });
  task.title = title;
}

async function handleUpdateMeta(id: string, tags: string[], important: boolean, pinned: boolean) {
  const task = tasks.value.find(t => t.id === id);
  if (!task) return;
  await invoke('update_task', {
    id,
    title: task.title,
    dueDate: task.due_date,
    tags,
    important,
    pinned,
    isDaily: task.is_daily,
  });
  task.tags = tags;
  task.important = important;
  task.pinned = pinned;
  allTags.value = await invoke<string[]>('get_all_tags');
}

async function handleDelete(id: string) {
  await invoke('delete_task', { id });
  tasks.value = tasks.value.filter(t => t.id !== id);
  allTags.value = await invoke<string[]>('get_all_tags');
}

async function handleClearCompleted() {
  await invoke('clear_completed');
  tasks.value = tasks.value.filter(t => !t.completed);
}

function handleSelectDate(date: string | null) {
  filterDate.value = date;
}

function handleToggleTag(tag: string) {
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

function handleAddTag(tag: string) {
  if (!allTags.value.includes(tag)) {
    allTags.value.push(tag);
  }
  selectedTags.value = [tag];
}

async function switchToFloating() {
  await invoke('show_floating_window');
}
</script>

<template>
  <div class="app">
    <h1 class="app-title">TODO</h1>
    <button class="float-mode-btn" @click="switchToFloating">🔲 悬浮窗模式</button>
    <MiniCalendar
      :tasks="tasks"
      @select-date="handleSelectDate"
    />
    <TagFilterBar
      :tags="allTags"
      :selected="selectedTags"
      @toggle-tag="handleToggleTag"
      @add-tag="handleAddTag"
    />
    <div v-if="overdueCount > 0" class="overdue-alert">
      ⚠️ {{ overdueCount }} 项任务已过期
    </div>
    <TaskInput @add="handleAdd" />
    <TaskList
      :tasks="filteredTasks"
      :daily-completions-map="dailyCompletionsMap"
      @toggle="handleToggle"
      @toggle-daily="handleToggleDaily"
      @update="handleUpdate"
      @delete="handleDelete"
      @update-meta="handleUpdateMeta"
    />
    <TaskStats
      :tasks="tasks"
      @clear-completed="handleClearCompleted"
    />
  </div>
</template>

<style scoped>
.app {
  max-width: 480px;
  margin: 0 auto;
  padding: 24px 20px;
  min-height: 100vh;
}

.app-title {
  font-size: 28px;
  font-weight: 700;
  color: #1a1a2e;
  margin-bottom: 16px;
  text-align: center;
}

.float-mode-btn {
  display: block;
  width: 100%;
  padding: 8px;
  margin-bottom: 12px;
  background: #1a1a2e;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.float-mode-btn:hover { background: #2d2d44; }

.overdue-alert {
  background: #fde8e8;
  color: #c0392b;
  font-size: 13px;
  padding: 8px 12px;
  border-radius: 8px;
  margin-bottom: 12px;
  text-align: center;
}
</style>
