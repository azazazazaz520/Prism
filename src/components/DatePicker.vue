<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

const emit = defineEmits<{
  select: [date: string | null];
}>();

const props = defineProps<{
  visible: boolean;
}>();

function onClickOutside(e: MouseEvent) {
  if (props.visible) {
    const el = e.target as HTMLElement;
    if (!el.closest('.datepicker') && !el.closest('.date-btn')) {
      emit('select', null);
    }
  }
}

onMounted(() => document.addEventListener('click', onClickOutside));
onUnmounted(() => document.removeEventListener('click', onClickOutside));

const today = new Date();
const currentYear = ref(today.getFullYear());
const currentMonth = ref(today.getMonth());

const weekDays = ['一', '二', '三', '四', '五', '六', '日'];

const daysInMonth = computed(() => {
  return new Date(currentYear.value, currentMonth.value + 1, 0).getDate();
});

const firstDayOfWeek = computed(() => {
  const d = new Date(currentYear.value, currentMonth.value, 1).getDay();
  return d === 0 ? 6 : d - 1; // Monday = 0
});

const days = computed(() => {
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek.value; i++) {
    cells.push(null);
  }
  for (let d = 1; d <= daysInMonth.value; d++) {
    cells.push(d);
  }
  return cells;
});

function prevMonth() {
  if (currentMonth.value === 0) {
    currentMonth.value = 11;
    currentYear.value--;
  } else {
    currentMonth.value--;
  }
}

function nextMonth() {
  if (currentMonth.value === 11) {
    currentMonth.value = 0;
    currentYear.value++;
  } else {
    currentMonth.value++;
  }
}

function selectDay(day: number) {
  const m = String(currentMonth.value + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  emit('select', `${currentYear.value}-${m}-${d}`);
}

function clearDate() {
  emit('select', null);
}

function isToday(day: number): boolean {
  return (
    currentYear.value === today.getFullYear() &&
    currentMonth.value === today.getMonth() &&
    day === today.getDate()
  );
}
</script>

<template>
  <div v-if="visible" class="datepicker">
    <div class="dp-header">
      <button class="dp-nav" @click="prevMonth">&lt;</button>
      <span class="dp-month">{{ currentYear }}年 {{ currentMonth + 1 }}月</span>
      <button class="dp-nav" @click="nextMonth">&gt;</button>
    </div>
    <div class="dp-weekdays">
      <span v-for="wd in weekDays" :key="wd" class="dp-wd">{{ wd }}</span>
    </div>
    <div class="dp-grid">
      <button
        v-for="(cell, i) in days"
        :key="i"
        :class="['dp-day', { empty: cell === null, today: cell !== null && isToday(cell) }]"
        :disabled="cell === null"
        @click="cell !== null && selectDay(cell)"
      >
        {{ cell }}
      </button>
    </div>
    <button class="dp-clear" @click="clearDate">清除日期</button>
  </div>
</template>

<style scoped>
.datepicker {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: white;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 12px;
  z-index: 10;
  width: 260px;
}

.dp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.dp-month {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.dp-nav {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: #666;
  padding: 2px 8px;
  border-radius: 4px;
}

.dp-nav:hover {
  background: #f0f0f0;
}

.dp-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  margin-bottom: 4px;
}

.dp-wd {
  text-align: center;
  font-size: 12px;
  color: #999;
  padding: 4px 0;
}

.dp-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.dp-day {
  aspect-ratio: 1;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #333;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dp-day.empty {
  cursor: default;
}

.dp-day:hover:not(.empty) {
  background: #e8f0fe;
}

.dp-day.today {
  background: #4a90d9;
  color: white;
}

.dp-clear {
  width: 100%;
  margin-top: 8px;
  padding: 6px;
  background: none;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 13px;
  color: #999;
  cursor: pointer;
}

.dp-clear:hover {
  background: #f5f5f5;
}
</style>
