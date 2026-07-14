<script setup lang="ts">
import { computed } from 'vue';
import { useTaskStore } from '../../composables/useTaskStore';

const { tasks } = useTaskStore();

const activeTasks = computed(() => tasks.value.filter((t) => !t.is_deleted));
const totalCount = computed(() => activeTasks.value.length);
const todayDone = computed(() => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tomorrowStart = todayStart + 86400000;
  return activeTasks.value.filter((t) => {
    if (!t.completed || !t.completed_at) return false;
    const ts = new Date(t.completed_at).getTime();
    return ts >= todayStart && ts < tomorrowStart;
  }).length;
});
const pct = computed(() =>
  totalCount.value > 0 ? Math.round((todayDone.value / totalCount.value) * 100) : 0,
);
const circumference = 2 * Math.PI * 28;
const offset = computed(() => circumference - (pct.value / 100) * circumference);
</script>

<template>
  <div class="ring-wrap">
    <svg width="60" height="60" viewBox="0 0 64 64" class="ring-svg">
      <circle cx="32" cy="32" r="28" fill="none" stroke="var(--gray-200)" stroke-width="4" />
      <circle
        cx="32"
        cy="32"
        r="28"
        fill="none"
        stroke="var(--accent)"
        stroke-width="4"
        stroke-linecap="round"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="offset"
        transform="rotate(-90 32 32)"
        style="transition: stroke-dashoffset 0.8s ease"
      />
      <text
        x="32"
        y="36"
        text-anchor="middle"
        font-family="var(--font-mono)"
        font-size="13"
        font-weight="700"
        fill="var(--text-primary)"
      >
        {{ pct }}%
      </text>
    </svg>
    <div>
      <div class="ri-done">{{ todayDone }} / {{ totalCount }}</div>
      <div class="ri-label">今日完成率</div>
    </div>
  </div>
</template>

<style scoped>
.ring-wrap {
  display: flex;
  align-items: center;
  gap: 14px;
}
.ri-done {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
}
.ri-label {
  font-size: 10px;
  color: var(--text-tertiary, var(--text-muted));
  margin-top: 1px;
}
</style>
