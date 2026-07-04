<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Task } from '../types';

const tasks = ref<Task[]>([]);
const currentIndex = ref(0);
const opacity = ref(0.92);
const carouselInterval = ref(5000);
const reminderMinutes = ref(30);
const showPanel = ref(false);
const isPaused = ref(false);

/** 悬浮窗背景色（透明度由控制面板调整） */
const floatingBg = computed(() => `rgba(28, 28, 34, ${opacity.value})`);

let timer: ReturnType<typeof setInterval> | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let unlistenFocus: (() => void) | null = null;

const incompleteTasks = computed(() => tasks.value.filter((t) => !t.completed));

const currentTask = computed(() => {
  const list = incompleteTasks.value;
  if (list.length === 0) return null;
  return list[currentIndex.value % list.length];
});

const dueStatus = computed(() => {
  if (!currentTask.value?.due_date) return null;
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;
  if (currentTask.value.due_date < todayStr) return 'overdue';
  if (currentTask.value.due_date === todayStr) return 'today';
  return 'upcoming';
});

const dueLabel = computed(() => {
  if (!currentTask.value?.due_date) return '';
  if (dueStatus.value === 'today') return '今天到期';
  if (dueStatus.value === 'overdue') return '已过期';
  const parts = currentTask.value.due_date.split('-');
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
});

async function loadTasks() {
  tasks.value = await invoke<Task[]>('get_tasks');
  const mins = await invoke<number>('get_reminder_minutes');
  reminderMinutes.value = mins;
}

function nextCard() {
  const list = incompleteTasks.value;
  if (list.length === 0) return;
  currentIndex.value = (currentIndex.value + 1) % list.length;
  resetTimer();
}

function prevCard() {
  const list = incompleteTasks.value;
  if (list.length === 0) return;
  currentIndex.value = (currentIndex.value - 1 + list.length) % list.length;
  resetTimer();
}

function goToCard(i: number) {
  currentIndex.value = i;
  resetTimer();
}

function setOpacity(val: number) {
  opacity.value = val / 100;
}

function setCarouselInterval(ms: number) {
  carouselInterval.value = ms;
  resetTimer();
}

async function setReminder(val: number) {
  reminderMinutes.value = val;
  await invoke('set_reminder_minutes', { minutes: val });
}

function resetTimer() {
  if (timer) clearInterval(timer);
  if (carouselInterval.value > 0 && !isPaused.value) {
    timer = setInterval(nextCard, carouselInterval.value);
  }
}

function onMouseEnter() {
  isPaused.value = true;
  if (timer) clearInterval(timer);
}

function onMouseLeave() {
  isPaused.value = false;
  resetTimer();
}

async function exitFloating() {
  await invoke('show_main_window');
}

onMounted(async () => {
  document.documentElement.style.background = 'transparent';
  document.documentElement.style.overflow = 'hidden';
  document.body.style.margin = '0';
  document.body.style.padding = '0';
  document.body.style.background = 'transparent';
  document.body.style.overflow = 'hidden';
  await loadTasks();
  resetTimer();
  pollInterval = setInterval(loadTasks, 30000);
  const appWindow = getCurrentWindow();
  unlistenFocus = await appWindow.listen('tauri://focus', () => {
    loadTasks();
  });
  // 初始化为紧凑尺寸（面板默认关闭）
  await invoke('resize_floating_window', { expanded: false });
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
  if (pollInterval) clearInterval(pollInterval);
  if (unlistenFocus) unlistenFocus();
});

// 面板展开/收起时同步窗口高度
watch(showPanel, (expanded) => {
  invoke('resize_floating_window', { expanded });
});

// Grab-to-scroll
const scrollContainer = ref<HTMLElement | null>(null);
const isDragging = ref(false);
let dragStartY = 0;
let scrollStartY = 0;

function onPointerDown(e: PointerEvent) {
  const target = e.target as HTMLElement;
  if (target.closest('button, input, select, .topbar, .panel')) return;
  isDragging.value = true;
  dragStartY = e.clientY;
  if (scrollContainer.value) {
    scrollStartY = scrollContainer.value.scrollTop;
  }
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging.value) return;
  const deltaY = dragStartY - e.clientY;
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = scrollStartY + deltaY;
  }
}

function onPointerUp() {
  isDragging.value = false;
}
</script>

<template>
  <div
    ref="scrollContainer"
    class="floating-window"
    :class="{ dragging: isDragging }"
    :style="{ backgroundColor: floatingBg }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointerleave="onPointerUp"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <div class="topbar" data-tauri-drag-region>
      <div class="topbar-left">
        <span>🎯 未完成:</span>
        <span class="count">{{ incompleteTasks.length }}</span>
        <span>项</span>
      </div>
      <div class="topbar-btns">
        <button :class="['topbar-btn', { active: showPanel }]" @click="showPanel = !showPanel">
          ⚙️ 控制
        </button>
      </div>
    </div>

    <div class="card-area">
      <div v-if="incompleteTasks.length === 0" class="no-tasks">🎉 全部完成！</div>
      <div v-else-if="currentTask" class="card" :key="currentTask.id">
        <div class="card-title">
          <span v-if="currentTask.pinned" class="card-pin">📌</span>
          <span>{{ currentTask.title }}</span>
        </div>
        <div class="card-meta">
          <span v-for="tag in currentTask.tags" :key="tag" class="card-tag">🏷 {{ tag }}</span>
          <span v-if="dueStatus" :class="['card-due', dueStatus]">📅 {{ dueLabel }}</span>
          <span v-if="currentTask.important" class="card-important">⭐ 重要</span>
        </div>
      </div>
    </div>

    <div v-if="incompleteTasks.length > 0" class="carousel-controls">
      <button class="arrow-btn" @click="prevCard">◀</button>
      <div class="dots">
        <span
          v-for="(_, i) in incompleteTasks"
          :key="i"
          :class="['dot', { active: i === currentIndex % incompleteTasks.length }]"
          @click="goToCard(i)"
        ></span>
      </div>
      <button class="arrow-btn" @click="nextCard">▶</button>
    </div>

    <Transition name="panel-slide">
      <div v-if="showPanel" class="panel">
        <div class="panel-row">
          <label>🔆 透明度</label>
          <input
            type="range"
            min="30"
            max="100"
            :value="Math.round(opacity * 100)"
            @input="setOpacity(($event.target as HTMLInputElement).valueAsNumber)"
          />
          <span class="opacity-val">{{ opacity.toFixed(2) }}</span>
        </div>
        <div class="panel-row">
          <label>⏱ 自动轮播</label>
          <select
            :value="carouselInterval"
            @change="setCarouselInterval(Number(($event.target as HTMLSelectElement).value))"
          >
            <option :value="3000">3 秒</option>
            <option :value="5000">5 秒</option>
            <option :value="10000">10 秒</option>
            <option :value="0">关闭</option>
          </select>
        </div>
        <div class="panel-row">
          <label>🔔 截止提醒</label>
          <select
            :value="reminderMinutes"
            @change="setReminder(Number(($event.target as HTMLSelectElement).value))"
          >
            <option :value="0">关闭</option>
            <option :value="10">提前 10 分钟</option>
            <option :value="30">提前 30 分钟</option>
            <option :value="60">提前 1 小时</option>
          </select>
        </div>
        <button class="exit-btn" @click="exitFloating">↩ 退出悬浮窗</button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.floating-window {
  width: 260px;
  min-height: 100vh;
  clip-path: inset(0 round 20px);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  filter: drop-shadow(0 2px 16px rgba(0, 0, 0, 0.35));
  overflow: hidden;
  overflow-y: auto;
  scrollbar-width: none;
  user-select: none;
  cursor: grab;
  font-family: var(--font-sans);
}

.floating-window::-webkit-scrollbar {
  display: none;
}

.floating-window.dragging {
  cursor: grabbing;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px var(--space-sm);
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  cursor: move;
  -webkit-app-region: drag;
}

.topbar-left {
  font-size: 11px;
  color: var(--text-disabled);
  display: flex;
  align-items: center;
  gap: 4px;
}

.count {
  color: var(--accent);
  font-weight: 600;
  font-size: var(--text-base);
}

.topbar-btns {
  display: flex;
  gap: 6px;
}

.topbar-btn {
  background: rgba(255, 255, 255, 0.06);
  border: none;
  color: var(--text-muted);
  font-size: 10px;
  padding: 3px 7px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-app-region: no-drag;
}

.topbar-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: var(--text-secondary);
}
.topbar-btn.active {
  background: var(--accent-muted);
  color: var(--accent);
}

.card-area {
  padding: var(--space-md) var(--space-sm);
  min-height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card {
  width: 100%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-md);
  padding: var(--space-xs) var(--space-md);
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.card-title {
  font-size: var(--text-sm);
  color: var(--text-primary);
  margin-bottom: var(--space-xs);
  line-height: 1.3;
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.card-pin {
  flex-shrink: 0;
  font-size: var(--text-base);
}

.card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.card-tag {
  font-size: var(--text-xs);
  background: var(--accent-muted);
  color: var(--accent);
  padding: 2px 7px;
  border-radius: var(--radius-sm);
}

.card-due {
  font-size: var(--text-xs);
  padding: 2px 7px;
  border-radius: var(--radius-sm);
  font-weight: 500;
}

.card-due.overdue {
  background: var(--danger-light);
  color: var(--danger);
}
.card-due.today {
  background: var(--warning-light);
  color: var(--warning);
}
.card-due.upcoming {
  background: var(--accent-muted);
  color: var(--accent);
}

.card-important {
  font-size: var(--text-xs);
  color: var(--warning);
}

.no-tasks {
  text-align: center;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.carousel-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 var(--space-sm) var(--space-sm);
  gap: var(--space-xs);
}

.arrow-btn {
  background: rgba(255, 255, 255, 0.06);
  border: none;
  color: var(--text-muted);
  font-size: var(--text-md);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}

.arrow-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: var(--text-primary);
}

.dots {
  display: flex;
  gap: 6px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  transition: all var(--transition-normal);
  cursor: pointer;
}

.dot.active {
  background: var(--accent);
  box-shadow: 0 0 6px rgba(74, 144, 217, 0.5);
}

.panel {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding: var(--space-sm) var(--space-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.panel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
}

.panel-row label {
  flex-shrink: 0;
  margin-right: var(--space-sm);
}

.panel-row input[type='range'] {
  flex: 1;
  accent-color: var(--accent);
  height: 4px;
}

.opacity-val {
  min-width: 32px;
  text-align: right;
  font-family: monospace;
  font-size: var(--text-xs);
}

.panel-row select {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  padding: 3px var(--space-sm);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  outline: none;
  cursor: pointer;
}

.panel-row select option {
  background: #2d2d2d;
  color: var(--text-secondary);
}

.exit-btn {
  width: 100%;
  margin-top: 2px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-muted);
  padding: 4px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.exit-btn:hover {
  background: var(--danger-light);
  color: var(--danger);
  border-color: rgba(231, 76, 60, 0.3);
}

/* ── 面板进出场动画 ────────────────────── */
.panel-slide-enter-active,
.panel-slide-leave-active {
  transition: all 0.2s ease;
}
.panel-slide-enter-from,
.panel-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
