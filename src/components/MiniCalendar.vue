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
      <button class="mc-nav" @click="prevMonth">&lt;</button>
      <span class="mc-month">{{ currentYear }}年 {{ currentMonth + 1 }}月</span>
      <button class="mc-nav" @click="nextMonth">&gt;</button>
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
        {{ cell }}
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

[data-theme='dark'] .mini-calendar,
[data-theme='auto'] .mini-calendar {
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

.mc-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-xs);
}

.mc-month {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
}

[data-theme='dark'] .mc-month,
[data-theme='auto'] .mc-month {
  font-family: var(--font-heading);
  letter-spacing: 1px;
}

.mc-nav {
  background: none;
  border: none;
  font-size: var(--text-sm);
  cursor: pointer;
  color: var(--gray-600);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
}

[data-theme='dark'] .mc-nav,
[data-theme='auto'] .mc-nav {
  border: 1px solid var(--border-subtle);
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
  border-radius: 0;
  color: var(--text-tertiary);
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
}

.mc-nav:hover {
  background: var(--bg-tertiary);
}

[data-theme='dark'] .mc-nav:hover,
[data-theme='auto'] .mc-nav:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: transparent;
}

.mc-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  margin-bottom: 1px;
}

.mc-wd {
  text-align: center;
  font-size: var(--text-xs);
  color: var(--gray-400);
  padding: 1px 0;
}

[data-theme='dark'] .mc-wd,
[data-theme='auto'] .mc-wd {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-tertiary);
  letter-spacing: 1px;
}

.mc-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
}

.mc-day {
  aspect-ratio: 1;
  border: none;
  background: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--text-xs);
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

[data-theme='dark'] .mc-day,
[data-theme='auto'] .mc-day {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
  border-radius: 0;
}

.mc-day.empty {
  cursor: default;
}

[data-theme='dark'] .mc-day.empty,
[data-theme='auto'] .mc-day.empty {
  opacity: 0.3;
}

.mc-day:hover:not(.empty) {
  background: var(--accent-light);
}

[data-theme='dark'] .mc-day:hover:not(.empty),
[data-theme='auto'] .mc-day:hover:not(.empty) {
  background: var(--accent-glow-s);
  color: var(--text-primary);
}

[data-theme='dark'] .mc-day.selected:hover:not(.empty),
[data-theme='auto'] .mc-day.selected:hover:not(.empty) {
  background: var(--accent);
  color: #0f1118;
}

.mc-day.today {
  font-weight: 700;
  color: var(--accent);
}

[data-theme='dark'] .mc-day.today::after,
[data-theme='auto'] .mc-day.today::after {
  content: '';
  position: absolute;
  bottom: 2px;
  width: 4px;
  height: 2px;
  background: var(--accent);
}

.mc-day.selected {
  background: var(--accent);
  color: white;
}

[data-theme='dark'] .mc-day.selected,
[data-theme='auto'] .mc-day.selected {
  background: var(--accent);
  color: var(--bg-void, #08090c);
}

.mc-day.has-task::after {
  content: '';
  position: absolute;
  bottom: 1px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--accent);
}

[data-theme='dark'] .mc-day.has-task::before,
[data-theme='auto'] .mc-day.has-task::before {
  content: '';
  position: absolute;
  top: 3px;
  right: 3px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--status-info);
}

[data-theme='dark'] .mc-day.has-task::after,
[data-theme='auto'] .mc-day.has-task::after {
  display: none;
}

.mc-day.selected.has-task::after {
  background: white;
}
</style>
