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
  updateMeta: [id: string, tags: string[], important: boolean, pinned: boolean, isDaily: boolean];
  decompose: [id: string];
}>();

// 排序规则：置顶优先 → 重要次之 → 未完成在前 → 新建在上
// 同级按创建时间倒序，completed 任务沉底
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
            (id, tags, important, pinned, isDaily) =>
              emit('updateMeta', id, tags, important, pinned, isDaily)
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
          (id, tags, important, pinned, isDaily) =>
            emit('updateMeta', id, tags, important, pinned, isDaily)
        "
        @decompose="(id) => emit('decompose', id)"
      />
    </template>
  </div>
</template>

<style scoped>
.task-list {
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
}

.task-empty {
  padding: 48px var(--space-lg);
  text-align: center;
  color: var(--text-muted);
  font-size: var(--text-base);
}

.pinned-section {
  background: var(--bg-secondary);
}

.pinned-header {
  padding: 6px var(--space-md);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.section-divider {
  height: 1px;
  background: var(--border-light);
}

[data-theme='dark'] .task-list,
[data-theme='auto'] .task-list {
  background: transparent;
}

[data-theme='dark'] .task-empty,
[data-theme='auto'] .task-empty {
  color: var(--text-tertiary);
  font-family: var(--font-heading);
  letter-spacing: 2px;
  text-transform: uppercase;
}

[data-theme='dark'] .pinned-section,
[data-theme='auto'] .pinned-section {
  background: transparent;
}

[data-theme='dark'] .pinned-header,
[data-theme='auto'] .pinned-header {
  font-family: var(--font-heading);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--text-tertiary);
  border-bottom-color: var(--border-subtle);
}

[data-theme='dark'] .pinned-header::after,
[data-theme='auto'] .pinned-header::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}

[data-theme='dark'] .section-divider,
[data-theme='auto'] .section-divider {
  background: var(--border-subtle);
}
</style>
