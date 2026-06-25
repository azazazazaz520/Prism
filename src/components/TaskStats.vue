<script setup lang="ts">
import { computed } from 'vue';
import type { Task } from '../types';

const props = defineProps<{
  tasks: Task[];
}>();

const emit = defineEmits<{
  clearCompleted: [];
}>();

const total = computed(() => props.tasks.length);
const completedCount = computed(() => props.tasks.filter((t) => t.completed).length);
</script>

<template>
  <div v-if="total > 0" class="task-stats">
    <span class="stats-text">共 {{ total }} 项 | {{ completedCount }} 项已完成</span>
    <button v-if="completedCount > 0" class="clear-btn" @click="emit('clearCompleted')">
      清除已完成
    </button>
  </div>
</template>

<style scoped>
.task-stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-sm) 2px;
  margin-top: var(--space-sm);
}

.stats-text {
  font-size: var(--text-sm);
  color: var(--text-disabled);
}

.clear-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: var(--text-sm);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: color var(--transition-fast);
}

.clear-btn:hover {
  color: var(--danger);
}
</style>
