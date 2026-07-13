<script setup lang="ts">
import { useTaskStore } from '../../composables/useTaskStore';
import { useDashboard } from '../../composables/useDashboard';

const { clearCompleted } = useTaskStore();
const { resetLayout } = useDashboard();

function handleClear() {
  clearCompleted();
}
function handleReset() {
  resetLayout();
}
</script>

<template>
  <div class="qa-list">
    <button class="qa-item" @click="handleClear">
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      清除已完成任务
    </button>
    <button class="qa-item" @click="handleReset">
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
      恢复默认布局
    </button>
  </div>
</template>

<style scoped>
.qa-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.qa-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 12px;
  transition: all var(--transition-fast);
  text-align: left;
}
[data-theme='hud'] .qa-item {
  border-color: var(--border-line);
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
}
.qa-item:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-bg);
}
</style>
