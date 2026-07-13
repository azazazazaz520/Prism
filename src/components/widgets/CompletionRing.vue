<script setup lang="ts">
import { computed } from 'vue';
import { useTaskStore } from '../../composables/useTaskStore';

const { tasks } = useTaskStore();

const todayTotal = computed(() => tasks.value.filter((t) => !t.is_deleted).length);
const todayDone = computed(() => tasks.value.filter((t) => t.completed && !t.is_deleted).length);
const pct = computed(() =>
  todayTotal.value > 0 ? Math.round((todayDone.value / todayTotal.value) * 100) : 0,
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
      <div class="ri-done">{{ todayDone }} / {{ todayTotal }}</div>
      <div class="ri-label">已完成</div>
    </div>
  </div>
</template>

<style scoped>
.ring-wrap {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
}
.ri-done {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-primary);
}
.ri-label {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: 2px;
}
</style>
