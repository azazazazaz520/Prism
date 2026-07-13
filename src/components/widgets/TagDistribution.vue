<script setup lang="ts">
import { computed } from 'vue';
import { useTaskStore } from '../../composables/useTaskStore';

const { tasks } = useTaskStore();

const tagCounts = computed(() => {
  const counts: Record<string, number> = {};
  for (const t of tasks.value) {
    if (t.is_deleted) continue;
    for (const tag of t.tags) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }
  const max = Math.max(...Object.values(counts), 1);
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count, pct: (count / max) * 100 }));
});
</script>

<template>
  <div class="tag-bars">
    <div v-for="t in tagCounts" :key="t.name" class="tag-bar-item">
      <span class="tb-label">{{ t.name }}</span>
      <div class="tb-track"><div class="tb-fill" :style="{ width: t.pct + '%' }"></div></div>
      <span class="tb-count">{{ t.count }}</span>
    </div>
  </div>
</template>

<style scoped>
.tag-bars {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.tag-bar-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.tb-label {
  font-family: var(--font-heading);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  letter-spacing: 1px;
  color: var(--text-secondary);
  width: 48px;
  text-align: right;
  flex-shrink: 0;
}
.tb-track {
  flex: 1;
  height: 4px;
  background: var(--gray-200);
  overflow: hidden;
  border-radius: var(--radius-sm);
}
.tb-fill {
  height: 100%;
  background: var(--accent);
  border-radius: var(--radius-sm);
  transition: width 0.6s ease;
}
.tb-count {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-muted);
  width: 20px;
}
</style>
