<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';

const emit = defineEmits<{
  select: [date: string | null];
}>();

const props = defineProps<{
  visible: boolean;
  anchorEl?: HTMLElement | null;
}>();

const pickerStyle = ref<Record<string, string>>({});

function updatePosition() {
  if (props.anchorEl && props.visible) {
    const rect = props.anchorEl.getBoundingClientRect();
    pickerStyle.value = {
      top: `${rect.bottom + 4}px`,
      right: `${window.innerWidth - rect.right}px`,
    };
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) updatePosition();
  },
);

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
  <Teleport to="body">
    <div v-if="visible" class="datepicker" :style="pickerStyle">
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
  </Teleport>
</template>

<style scoped>
.datepicker {
  position: fixed;
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  box-shadow: 0 var(--space-xs) var(--space-lg) rgba(0, 0, 0, 0.12);
  padding: var(--space-md);
  z-index: 1000;
  width: 260px;
}

.dp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-sm);
}

.dp-month {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.dp-nav {
  background: none;
  border: none;
  font-size: var(--text-md);
  cursor: pointer;
  color: var(--gray-700);
  padding: 2px var(--space-sm);
  border-radius: var(--radius-sm);
}

.dp-nav:hover {
  background: var(--bg-tertiary);
}

[data-theme='dark'] .datepicker,
[data-theme='auto'] .datepicker {
  background: var(--bg-elevated);
  border: 1px solid var(--border-line);
  clip-path: polygon(
    12px 0%,
    100% 0%,
    100% calc(100% - 12px),
    calc(100% - 12px) 100%,
    0% 100%,
    0% 12px
  );
  border-radius: 0;
}

[data-theme='dark'] .dp-day,
[data-theme='auto'] .dp-day {
  font-family: var(--font-mono);
  font-size: 11px;
}

[data-theme='dark'] .dp-day.today,
[data-theme='auto'] .dp-day.today {
  background: var(--accent);
  color: #0f1118;
}

[data-theme='dark'] .dp-clear,
[data-theme='auto'] .dp-clear {
  border-color: var(--border-line);
  color: var(--text-secondary);
}

[data-theme='dark'] .dp-clear:hover,
[data-theme='auto'] .dp-clear:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-glow-s);
}

.dp-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  margin-bottom: var(--space-xs);
}

.dp-wd {
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-muted);
  padding: var(--space-xs) 0;
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
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--text-base);
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dp-day.empty {
  cursor: default;
}

.dp-day:hover:not(.empty) {
  background: var(--accent-light);
}

.dp-day.today {
  background: var(--accent);
  color: white;
}

.dp-clear {
  width: 100%;
  margin-top: var(--space-sm);
  padding: 6px;
  background: none;
  border: 1px solid var(--gray-300);
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  color: var(--text-muted);
  cursor: pointer;
}

.dp-clear:hover {
  background: var(--bg-hover);
}
</style>
