<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
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
let timer: ReturnType<typeof setInterval> | null = null;

const incompleteTasks = computed(() => tasks.value.filter(t => !t.completed));

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
  document.body.style.margin = '0';
  document.body.style.padding = '0';
  document.body.style.background = 'transparent';
  document.body.style.overflow = 'hidden';
  await loadTasks();
  resetTimer();
  const interval = setInterval(loadTasks, 30000);
  const appWindow = getCurrentWindow();
  const unlistenFocus = await appWindow.listen('tauri://focus', () => {
    loadTasks();
  });
  onUnmounted(() => {
    clearInterval(interval);
    unlistenFocus();
  });
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
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
    :style="{ background: `rgba(30, 30, 40, ${opacity})` }"
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
        <button
          :class="['topbar-btn', { active: showPanel }]"
          @click="showPanel = !showPanel"
        >
          ⚙️ 控制
        </button>
      </div>
    </div>

    <div class="card-area">
      <div v-if="incompleteTasks.length === 0" class="no-tasks">
        🎉 全部完成！
      </div>
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
  </div>
</template>

<style scoped>
* { margin: 0; padding: 0; box-sizing: border-box; }

.floating-window {
  width: 320px;
  min-height: 100vh;
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08);
  overflow-y: scroll;
  scrollbar-width: none;
  user-select: none;
  cursor: grab;
  font-family: -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif;
}

.floating-window::-webkit-scrollbar { display: none; }

.floating-window.dragging { cursor: grabbing; }

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(255,255,255,0.05);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  cursor: move;
  -webkit-app-region: drag;
}

.topbar-left {
  font-size: 12px;
  color: #aaa;
  display: flex;
  align-items: center;
  gap: 6px;
}

.count {
  color: #4a90d9;
  font-weight: 600;
  font-size: 13px;
}

.topbar-btns { display: flex; gap: 6px; }

.topbar-btn {
  background: rgba(255,255,255,0.08);
  border: none;
  color: #999;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  -webkit-app-region: no-drag;
}

.topbar-btn:hover { background: rgba(255,255,255,0.15); color: #ddd; }
.topbar-btn.active { background: rgba(74,144,217,0.2); color: #4a90d9; }

.card-area {
  padding: 16px;
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card {
  width: 100%;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 14px 16px;
  animation: fadeIn 0.35s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.card-title {
  font-size: 15px;
  color: #eee;
  margin-bottom: 10px;
  line-height: 1.4;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.card-pin { flex-shrink: 0; font-size: 13px; }

.card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.card-tag {
  font-size: 10px;
  background: rgba(74,144,217,0.2);
  color: #6db3f2;
  padding: 2px 7px;
  border-radius: 8px;
}

.card-due {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 8px;
  font-weight: 500;
}

.card-due.overdue { background: rgba(231,76,60,0.2); color: #f07070; }
.card-due.today { background: rgba(243,156,18,0.2); color: #f5b642; }
.card-due.upcoming { background: rgba(74,144,217,0.15); color: #6db3f2; }

.card-important { font-size: 11px; color: #f5b642; }

.no-tasks { text-align: center; color: #666; font-size: 14px; }

.carousel-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px 12px;
  gap: 14px;
}

.arrow-btn {
  background: rgba(255,255,255,0.06);
  border: none;
  color: #888;
  font-size: 16px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.arrow-btn:hover { background: rgba(255,255,255,0.15); color: #ddd; }

.dots { display: flex; gap: 6px; }

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255,255,255,0.2);
  transition: all 0.2s;
  cursor: pointer;
}

.dot.active {
  background: #4a90d9;
  box-shadow: 0 0 6px rgba(74,144,217,0.5);
}

.panel {
  border-top: 1px solid rgba(255,255,255,0.06);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.panel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #999;
}

.panel-row label { flex-shrink: 0; margin-right: 10px; }

.panel-row input[type="range"] {
  flex: 1;
  accent-color: #4a90d9;
  height: 4px;
}

.opacity-val {
  min-width: 32px;
  text-align: right;
  font-family: monospace;
  font-size: 11px;
}

.panel-row select {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.1);
  color: #ccc;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 12px;
  outline: none;
  cursor: pointer;
}

.panel-row select option { background: #2d2d2d; color: #ccc; }

.exit-btn {
  width: 100%;
  margin-top: 4px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  color: #999;
  padding: 6px;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.exit-btn:hover {
  background: rgba(231,76,60,0.15);
  color: #e74c3c;
  border-color: rgba(231,76,60,0.3);
}
</style>
