<script setup lang="ts">
import { ref, nextTick, computed } from 'vue';
import type { Task } from '../types';

const props = defineProps<{
  task: Task;
}>();

const emit = defineEmits<{
  toggle: [id: string];
  update: [id: string, title: string];
  delete: [id: string];
}>();

const editing = ref(false);
const editTitle = ref('');

function startEdit() {
  editTitle.value = props.task.title;
  editing.value = true;
  nextTick(() => {
    const input = document.getElementById(`edit-${props.task.id}`) as HTMLInputElement;
    input?.focus();
    input?.select();
  });
}

function confirmEdit() {
  const trimmed = editTitle.value.trim();
  if (trimmed && trimmed !== props.task.title) {
    emit('update', props.task.id, trimmed);
  }
  editing.value = false;
}

function cancelEdit() { editing.value = false; }

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffHr < 24) return `${diffHr} 小时前`;
  if (diffDay < 7) return `${diffDay} 天前`;
  return date.toLocaleDateString('zh-CN');
}

const dueStatus = computed<'overdue' | 'today' | 'upcoming' | null>(() => {
  if (!props.task.due_date) return null;
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;
  if (props.task.due_date < todayStr) return 'overdue';
  if (props.task.due_date === todayStr) return 'today';
  return 'upcoming';
});

const dueLabel = computed(() => {
  if (!props.task.due_date) return '';
  if (dueStatus.value === 'today') return '今天到期';
  if (dueStatus.value === 'overdue') return '已过期';
  return props.task.due_date;
});
</script>

<template>
  <div
    :class="['task-item', {
      completed: task.completed,
      editing: editing,
      [dueStatus || '']: !task.completed && dueStatus
    }]"
  >
    <input
      type="checkbox"
      class="task-checkbox"
      :checked="task.completed"
      @change="emit('toggle', task.id)"
    />

    <div class="task-body" @dblclick="startEdit">
      <template v-if="!editing">
        <span :class="['task-title', { done: task.completed }]">{{ task.title }}</span>
        <span class="task-meta">
          <span class="task-time">{{ formatTime(task.created_at) }}</span>
          <span v-if="dueLabel" :class="['due-badge', dueStatus]">{{ dueLabel }}</span>
        </span>
      </template>
      <template v-else>
        <input
          :id="`edit-${task.id}`"
          v-model="editTitle"
          type="text"
          class="task-edit-input"
          @keydown.enter="confirmEdit"
          @keydown.escape="cancelEdit"
          @blur="confirmEdit"
        />
      </template>
    </div>

    <button
      v-if="!editing"
      class="task-delete-btn"
      title="删除"
      @click="emit('delete', task.id)"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
.task-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  border-left: 3px solid transparent;
  transition: background 0.15s;
}

.task-item:hover { background: #f8f9fa; }
.task-item.completed { background: #fafafa; }

.task-item.overdue { border-left-color: #e74c3c; }
.task-item.today { border-left-color: #f39c12; }
.task-item.upcoming { border-left-color: #4a90d9; }

.task-checkbox {
  width: 18px;
  height: 18px;
  margin-right: 12px;
  cursor: pointer;
  accent-color: #4a90d9;
  flex-shrink: 0;
}

.task-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  cursor: default;
}

.task-title {
  font-size: 15px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-title.done { text-decoration: line-through; color: #aaa; }

.task-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.task-time {
  font-size: 12px;
  color: #999;
}

.due-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.due-badge.overdue { background: #fde8e8; color: #e74c3c; }
.due-badge.today { background: #fef3e0; color: #e67e22; }
.due-badge.upcoming { background: #e8f0fe; color: #4a90d9; }

.task-edit-input {
  font-size: 15px;
  padding: 4px 8px;
  border: 2px solid #4a90d9;
  border-radius: 6px;
  outline: none;
  width: 100%;
}

.task-delete-btn {
  background: none;
  border: none;
  color: #ccc;
  font-size: 20px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.15s;
}

.task-delete-btn:hover { color: #e74c3c; }
</style>
