<script setup lang="ts">
import { computed } from 'vue';
import type { Task } from '../types';
import TaskItem from './TaskItem.vue';

const props = defineProps<{
  tasks: Task[];
  dailyCompletionsMap: Record<string, boolean>;
  aiEnabled?: boolean;
}>();

const emit = defineEmits<{
  toggle: [id: string];
  toggleDaily: [id: string, date: string];
  update: [id: string, title: string];
  delete: [id: string];
  updateMeta: [id: string, tags: string[], important: boolean, pinned: boolean];
  decompose: [id: string];
}>();

const sortedTasks = computed(() => {
  const arr = [...props.tasks];
  arr.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.important !== b.important) return a.important ? -1 : 1;
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return b.created_at.localeCompare(a.created_at);
  });
  return arr;
});

const pinnedTasks = computed(() => sortedTasks.value.filter((t) => t.pinned && !t.completed));
const normalTasks = computed(() => sortedTasks.value.filter((t) => !t.pinned || t.completed));
</script>

<template>
  <div class="task-list">
    <div v-if="tasks.length === 0" class="task-empty">暂无任务，添加一个吧</div>
    <template v-else>
      <div v-if="pinnedTasks.length > 0" class="pinned-section">
        <div class="pinned-header">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 17v-7" />
            <path d="M8 10l4-4 4 4" />
            <path d="M5 21h14" />
          </svg>
          已置顶
        </div>
        <TaskItem
          v-for="task in pinnedTasks"
          :key="task.id"
          :task="task"
          :is-daily-completed="dailyCompletionsMap[task.id] ?? false"
          :ai-enabled="props.aiEnabled"
          @toggle="(id) => emit('toggle', id)"
          @toggle-daily="(id, date) => emit('toggleDaily', id, date)"
          @update="(id, title) => emit('update', id, title)"
          @delete="(id) => emit('delete', id)"
          @update-meta="
            (id, tags, important, pinned) => emit('updateMeta', id, tags, important, pinned)
          "
          @decompose="(id) => emit('decompose', id)"
        />
      </div>
      <div
        v-if="pinnedTasks.length > 0 && normalTasks.filter((t) => !t.completed).length > 0"
        class="section-divider"
      ></div>
      <TaskItem
        v-for="task in normalTasks"
        :key="task.id"
        :task="task"
        :is-daily-completed="dailyCompletionsMap[task.id] ?? false"
        :ai-enabled="props.aiEnabled"
        @toggle="(id) => emit('toggle', id)"
        @toggle-daily="(id, date) => emit('toggleDaily', id, date)"
        @update="(id, title) => emit('update', id, title)"
        @delete="(id) => emit('delete', id)"
        @update-meta="
          (id, tags, important, pinned) => emit('updateMeta', id, tags, important, pinned)
        "
        @decompose="(id) => emit('decompose', id)"
      />
    </template>
  </div>
</template>

<style scoped>
.task-list {
  background: white;
  border: 1px solid #eee;
  border-radius: 6px;
}

.task-empty {
  padding: 32px 16px;
  text-align: center;
  color: #ccc;
  font-size: 13px;
}

.pinned-section {
  background: #fafafa;
}

.pinned-header {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  color: #999;
  border-bottom: 1px solid #eee;
  display: flex;
  align-items: center;
  gap: 4px;
}

.section-divider {
  height: 1px;
  background: #f0f0f0;
}
</style>
