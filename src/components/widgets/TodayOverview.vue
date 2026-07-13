<script setup lang="ts">
import { computed } from 'vue';
import { useTaskStore } from '../../composables/useTaskStore';
const { pendingCount, overdueCount, tasks } = useTaskStore();
const completedToday = computed(
  () => tasks.value.filter((t) => t.completed && !t.is_deleted).length,
);
</script>

<template>
  <div class="today-stats">
    <div class="today-stat">
      <div class="ts-num">{{ pendingCount }}</div>
      <div class="ts-label">待完成</div>
    </div>
    <div class="today-stat">
      <div class="ts-num accent">{{ completedToday }}</div>
      <div class="ts-label">已完成</div>
    </div>
    <div class="today-stat">
      <div class="ts-num warn">{{ overdueCount }}</div>
      <div class="ts-label">已过期</div>
    </div>
  </div>
</template>

<style scoped>
.today-stats {
  display: flex;
  gap: 12px;
}
.today-stat {
  flex: 1;
  text-align: center;
}
.ts-num {
  font-family: var(--font-mono);
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}
.ts-num.accent {
  color: var(--accent);
}
.ts-num.warn {
  color: var(--warning);
}
.ts-label {
  font-family: var(--font-heading);
  font-size: 8px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--text-tertiary, var(--text-muted));
  margin-top: 2px;
}
</style>
