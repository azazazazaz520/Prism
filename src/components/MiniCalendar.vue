<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Task } from '../types';

const props = defineProps<{
  tasks: Task[];
}>();

const emit = defineEmits<{
  selectDate: [date: string | null];
}>();

const selectedDate = ref<string | null>(null);
const today = new Date();
const currentYear = ref(today.getFullYear());
const currentMonth = ref(today.getMonth());

const weekDays = ['一', '二', '三', '四', '五', '六', '日'];

const daysInMonth = computed(() =>
  new Date(currentYear.value, currentMonth.value + 1, 0).getDate(),
);

const firstDayOfWeek = computed(() => {
  const d = new Date(currentYear.value, currentMonth.value, 1).getDay();
  return d === 0 ? 6 : d - 1;
});

const days = computed(() => {
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek.value; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth.value; d++) cells.push(d);
  return cells;
});

const datesWithTasks = computed(() => {
  const set = new Set<string>();
  for (const t of props.tasks) {
    if (t.due_date) set.add(t.due_date);
  }
  return set;
});

function dateKey(day: number): string {
  const m = String(currentMonth.value + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${currentYear.value}-${m}-${d}`;
}

function prevMonth() {
  if (currentMonth.value === 0) {
    currentMonth.value = 11;
    currentYear.value--;
  } else currentMonth.value--;
}

function nextMonth() {
  if (currentMonth.value === 11) {
    currentMonth.value = 0;
    currentYear.value++;
  } else currentMonth.value++;
}

function selectDay(day: number) {
  const dk = dateKey(day);
  if (selectedDate.value === dk) {
    selectedDate.value = null;
    emit('selectDate', null);
  } else {
    selectedDate.value = dk;
    emit('selectDate', dk);
  }
}

function isToday(day: number): boolean {
  return (
    currentYear.value === today.getFullYear() &&
    currentMonth.value === today.getMonth() &&
    day === today.getDate()
  );
}

function isSelected(day: number): boolean {
  return selectedDate.value === dateKey(day);
}
</script>

<template>
  <div class="mini-calendar">
    <div class="mc-header">
      <div class="mc-label">
        <span class="mc-label-dot"></span>
        {{ currentYear }}
      </div>
      <div class="mc-month-row">
        <button class="mc-nav" @click="prevMonth">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span class="mc-month">{{ currentMonth + 1 }}月</span>
        <button class="mc-nav" @click="nextMonth">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>
    <div class="mc-weekdays">
      <span v-for="wd in weekDays" :key="wd" class="mc-wd">{{ wd }}</span>
    </div>
    <div class="mc-grid">
      <button
        v-for="(cell, i) in days"
        :key="i"
        :class="[
          'mc-day',
          {
            empty: cell === null,
            today: cell !== null && isToday(cell),
            selected: cell !== null && isSelected(cell),
            'has-task': cell !== null && datesWithTasks.has(dateKey(cell)),
          },
        ]"
        :disabled="cell === null"
        @click="cell !== null && selectDay(cell)"
      >
        <span class="mc-day-num">{{ cell }}</span>
        <span v-if="cell !== null && datesWithTasks.has(dateKey(cell))" class="mc-day-dot"></span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.mini-calendar {
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  padding: var(--space-md);
}

[data-theme='hud'] .mini-calendar,
[data-theme='hud'] .mini-calendar {
  background: var(--bg-panel, rgba(16, 19, 26, 0.82));
  border: 1px solid var(--border-subtle);
  border-radius: 0;
  clip-path: polygon(
    12px 0%,
    100% 0%,
    100% calc(100% - 12px),
    calc(100% - 12px) 100%,
    0% 100%,
    0% 12px
  );
}

/* ── Header — 双行 HUD 风格 ──────────── */
.mc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-md);
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--border-subtle);
  position: relative;
}

.mc-header::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  width: 40%;
  height: 1px;
  background: var(--accent-dim);
  opacity: 0.5;
}

.mc-label {
  font-family: var(--font-heading);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: var(--accent-dim);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.mc-label-dot {
  width: 5px;
  height: 5px;
  background: var(--accent);
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  animation: breathe 3s ease-in-out infinite;
}

@keyframes breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.mc-month-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.mc-month {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 32px;
  text-align: center;
}

/* ── Nav arrows ──────────────────────── */
.mc-nav {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  color: var(--text-tertiary);
  padding: 0;
  transition: all var(--transition-fast);
  clip-path: polygon(
    4px 0%,
    100% 0%,
    100% calc(100% - 4px),
    calc(100% - 4px) 100%,
    0% 100%,
    0% 4px
  );
}

.mc-nav:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-glow-s);
}

/* ── Weekday labels ──────────────────── */
.mc-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  margin-bottom: 2px;
}

.mc-wd {
  text-align: center;
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-tertiary);
  letter-spacing: 1px;
  padding: 2px 0;
  text-transform: uppercase;
}

/* ── Day grid ────────────────────────── */
.mc-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.mc-day {
  aspect-ratio: 1;
  border: 1px solid transparent;
  background: none;
  cursor: pointer;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: all var(--transition-fast);
  font-family: var(--font-mono);
  font-size: 12px;
}

.mc-day-num {
  line-height: 1;
}

.mc-day-dot {
  position: absolute;
  bottom: 3px;
  width: 3px;
  height: 3px;
  background: var(--accent);
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
}

.mc-day.empty {
  cursor: default;
  opacity: 0.15;
}

.mc-day:hover:not(.empty) {
  border-color: var(--border-line);
  background: var(--bg-hover);
}

.mc-day.today {
  color: var(--accent);
  font-weight: 700;
}

.mc-day.today .mc-day-num {
  position: relative;
}

.mc-day.today .mc-day-num::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 50%;
  transform: translateX(-50%);
  width: 3px;
  height: 3px;
  background: var(--accent);
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
}

.mc-day.today .mc-day-dot {
  display: none;
}

.mc-day.selected {
  background: var(--accent);
  border-color: var(--accent);
  color: #0f1118;
  font-weight: 600;
}

.mc-day.selected .mc-day-dot {
  background: #0f1118;
}

.mc-day.selected.today .mc-day-num::after {
  background: #0f1118;
}

/* ── Light mode overrides ────────────── */
[data-theme='light'] .mc-header {
  border-bottom-color: var(--border-light);
}

[data-theme='light'] .mc-nav {
  border-color: var(--border-default);
  border-radius: var(--radius-sm);
  clip-path: none;
}

[data-theme='light'] .mc-nav:hover {
  background: var(--bg-hover);
}

[data-theme='light'] .mc-wd {
  font-family: inherit;
  font-size: var(--text-xs);
  color: var(--gray-400);
}

[data-theme='light'] .mc-day {
  font-family: inherit;
  border-radius: var(--radius-md);
  font-size: var(--text-xs);
}

[data-theme='light'] .mc-day.today {
  font-weight: 700;
  color: var(--accent);
}

[data-theme='light'] .mc-day.today .mc-day-num::after {
  clip-path: none;
  border-radius: 50%;
}

[data-theme='light'] .mc-day.selected {
  border-radius: var(--radius-md);
  color: white;
}

[data-theme='light'] .mc-day-dot {
  clip-path: none;
  border-radius: 50%;
}
</style>
