<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { Task } from './types';
import TaskInput from './components/TaskInput.vue';
import TaskList from './components/TaskList.vue';
import TaskStats from './components/TaskStats.vue';

const tasks = ref<Task[]>([]);

onMounted(async () => {
  tasks.value = await invoke<Task[]>('get_tasks');
});

async function handleAdd(title: string) {
  const task = await invoke<Task>('add_task', { title });
  tasks.value.push(task);
}

async function handleToggle(id: string) {
  await invoke('toggle_task', { id });
  const task = tasks.value.find(t => t.id === id);
  if (task) {
    task.completed = !task.completed;
    task.completed_at = task.completed ? new Date().toISOString() : null;
  }
}

async function handleUpdate(id: string, title: string) {
  await invoke('update_task', { id, title });
  const task = tasks.value.find(t => t.id === id);
  if (task) task.title = title;
}

async function handleDelete(id: string) {
  await invoke('delete_task', { id });
  tasks.value = tasks.value.filter(t => t.id !== id);
}

async function handleClearCompleted() {
  await invoke('clear_completed');
  tasks.value = tasks.value.filter(t => !t.completed);
}
</script>

<template>
  <div class="app">
    <h1 class="app-title">TODO</h1>
    <TaskInput @add="handleAdd" />
    <TaskList
      :tasks="tasks"
      @toggle="handleToggle"
      @update="handleUpdate"
      @delete="handleDelete"
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
  margin-bottom: 24px;
  text-align: center;
}
</style>
