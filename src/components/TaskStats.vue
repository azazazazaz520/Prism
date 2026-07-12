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
const activeCount = computed(() => props.tasks.filter((t) => !t.completed && !t.is_deleted).length);
const progressPct = computed(() =>
  total.value > 0 ? Math.round((completedCount.value / total.value) * 100) : 0,
);
</script>

<template>
  <div v-if="total > 0" class="task-stats">
    <div class="stats-row">
      <span class="stats-text"
        >共 {{ total }} 项 · {{ completedCount }} 已完成 · {{ activeCount }} 进行中</span
      >
      <button v-if="completedCount > 0" class="clear-btn" @click="emit('clearCompleted')">
        清除已完成
      </button>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
    </div>
  </div>
</template>

<style scoped>
.task-stats {
  padding: var(--space-sm) 2px;
  margin-top: var(--space-sm);
}

.stats-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
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

/* ── 进度条 ──────────────────────────── */
.progress-bar {
  margin-top: var(--space-sm);
  height: 3px;
  background: var(--gray-200);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
  transition: width 0.4s ease;
}

[data-theme='hud'] .progress-bar {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 0;
}

[data-theme='hud'] .progress-fill {
  background: linear-gradient(
    90deg,
    var(--accent-dim) 0%,
    var(--accent) 30%,
    var(--accent) 70%,
    #fff3b0 100%
  );
  box-shadow: 0 0 8px var(--accent-glow);
  border-radius: 0;
}
</style>
