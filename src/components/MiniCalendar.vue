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
  new Date(currentYear.value, currentMonth.value + 1, 0).getDate()
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
  if (currentMonth.value === 0) { currentMonth.value = 11; currentYear.value--; }
  else currentMonth.value--;
}

function nextMonth() {
  if (currentMonth.value === 11) { currentMonth.value = 0; currentYear.value++; }
  else currentMonth.value++;
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
  return currentYear.value === today.getFullYear() &&
    currentMonth.value === today.getMonth() &&
    day === today.getDate();
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
            'has-task': cell !== null && datesWithTasks.has(dateKey(cell))
          }
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
  background: white;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  padding: 12px 16px;
  margin-bottom: 16px;
}

.mc-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.mc-month {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.mc-nav {
  background: none;
  border: none;
  font-size: 14px;
  cursor: pointer;
  color: #888;
  padding: 2px 8px;
  border-radius: 4px;
}

.mc-nav:hover { background: #f0f0f0; }

.mc-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  margin-bottom: 2px;
}

.mc-wd {
  text-align: center;
  font-size: 11px;
  color: #aaa;
  padding: 2px 0;
}

.mc-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.mc-day {
  aspect-ratio: 1;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: #333;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.mc-day.empty { cursor: default; }

.mc-day:hover:not(.empty) { background: #e8f0fe; }

.mc-day.today {
  font-weight: 700;
  color: #4a90d9;
}

.mc-day.selected {
  background: #4a90d9;
  color: white;
}

.mc-day.has-task::after {
  content: '';
  position: absolute;
  bottom: 2px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #4a90d9;
}

.mc-day.selected.has-task::after {
  background: white;
}
</style>
