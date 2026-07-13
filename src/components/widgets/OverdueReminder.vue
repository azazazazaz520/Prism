<script setup lang="ts">
import { computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useTaskStore } from '../../composables/useTaskStore';

const { tasks } = useTaskStore();

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const overdueTasks = computed(() =>
  tasks.value.filter((t) => t.due_date && t.due_date < todayStr() && !t.completed && !t.is_deleted),
);

async function postpone(taskId: string) {
  // 直接调用 invoke 更新 due_date 为 null（延期到未指定）
  try {
    await invoke('update_task', {
      args: {
        id: taskId,
        title: tasks.value.find((t) => t.id === taskId)?.title ?? '',
        dueDate: null,
        tags: tasks.value.find((t) => t.id === taskId)?.tags ?? [],
        important: tasks.value.find((t) => t.id === taskId)?.important ?? false,
        pinned: tasks.value.find((t) => t.id === taskId)?.pinned ?? false,
        isDaily: tasks.value.find((t) => t.id === taskId)?.is_daily ?? false,
      },
    });
    // 同步前端状态
    tasks.value = tasks.value.map((t) =>
      t.id === taskId ? { ...t, due_date: null, updated_at: new Date().toISOString() } : t,
    );
  } catch (e) {
    console.warn('延期失败:', e);
  }
}
</script>

<template>
  <div v-if="overdueTasks.length === 0" class="empty">无过期任务</div>
  <div v-else v-for="t in overdueTasks" :key="t.id" class="ov-item">
    <span class="ov-date">{{ t.due_date!.slice(5) }}</span>
    <span class="ov-title">{{ t.title }}</span>
    <button class="ov-btn" @click="postpone(t.id)">延期</button>
  </div>
</template>

<style scoped>
.empty {
  font-size: 12px;
  color: var(--text-disabled);
  text-align: center;
  padding: 12px 0;
}
.ov-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-subtle);
}
.ov-item:last-child {
  border-bottom: none;
}
.ov-date {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--danger);
  flex-shrink: 0;
}
.ov-title {
  flex: 1;
  font-size: 12px;
  color: var(--text-primary);
}
.ov-btn {
  font-family: var(--font-heading);
  font-size: 8px;
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 2px 8px;
  border: 1px solid var(--accent-dim);
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  transition: all var(--transition-fast);
}
[data-theme='hud'] .ov-btn {
  clip-path: polygon(
    3px 0%,
    100% 0%,
    100% calc(100% - 3px),
    calc(100% - 3px) 100%,
    0% 100%,
    0% 3px
  );
}
.ov-btn:hover {
  background: var(--accent-bg);
}
</style>
