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
const completedCount = computed(() => props.tasks.filter(t => t.completed).length);
</script>

<template>
  <div v-if="total > 0" class="task-stats">
    <span class="stats-text">共 {{ total }} 项 | {{ completedCount }} 项已完成</span>
    <button
      v-if="completedCount > 0"
      class="clear-btn"
      @click="emit('clearCompleted')"
    >
      清除已完成
    </button>
  </div>
</template>

<style scoped>
.task-stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 4px;
  margin-top: 12px;
}

.stats-text {
  font-size: 13px;
  color: #999;
}

.clear-btn {
  background: none;
  border: none;
  color: #e74c3c;
  font-size: 13px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.15s;
}

.clear-btn:hover {
  background: #fde8e8;
}
</style>
