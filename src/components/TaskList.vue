<script setup lang="ts">
import type { Task } from '../types';
import TaskItem from './TaskItem.vue';

defineProps<{
  tasks: Task[];
}>();

const emit = defineEmits<{
  toggle: [id: string];
  update: [id: string, title: string];
  delete: [id: string];
}>();
</script>

<template>
  <div class="task-list">
    <div v-if="tasks.length === 0" class="task-empty">
      暂无任务，添加一个吧
    </div>
    <TaskItem
      v-for="task in tasks"
      :key="task.id"
      :task="task"
      @toggle="(id) => emit('toggle', id)"
      @update="(id, title) => emit('update', id, title)"
      @delete="(id) => emit('delete', id)"
    />
  </div>
</template>

<style scoped>
.task-list {
  background: white;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.task-empty {
  padding: 40px 20px;
  text-align: center;
  color: #bbb;
  font-size: 15px;
}
</style>
