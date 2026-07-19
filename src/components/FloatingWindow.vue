<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { useTaskStore } from '../composables/useTaskStore';
import { initTheme } from '../composables/useTheme';

/**
 * 悬浮窗组件 — 无装饰透明窗口，置顶显示任务卡片轮播。
 * 支持拖拽移动、透明度调节、展开/收起双态切换。
 */

const { tasks, loadAll, refreshTasks } = useTaskStore();

const currentIndex = ref(0);
const opacity = ref(0.92);
const carouselInterval = ref(5000);
const reminderMinutes = ref(30);
const showPanel = ref(false);
const isPaused = ref(false);
const isRefreshing = ref(false);

let timer: ReturnType<typeof setInterval> | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let unlistenFocus: (() => void) | null = null;
let unlistenTheme: (() => void) | null = null;

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

// ── 数据加载（防抖 + 拖动中跳过） ──────────────

let lastLoadTime = 0;
const LOAD_THROTTLE_MS = 5000;

async function loadData() {
  const now = Date.now();
  if (now - lastLoadTime < LOAD_THROTTLE_MS) return;
  if (isDragging.value) return;
  lastLoadTime = now;
  isRefreshing.value = true;
  try {
    await refreshTasks();
    const mins = await invoke<number>('get_reminder_minutes');
    reminderMinutes.value = mins;
  } finally {
    isRefreshing.value = false;
  }
}

// ── 轮播 ──────────────────────────────

/** 切换到下一张任务卡片 */
function nextCard() {
  const list = incompleteTasks.value;
  if (list.length === 0) return;
  currentIndex.value = (currentIndex.value + 1) % list.length;
  resetTimer();
}

/** 切换到上一张任务卡片 */
function prevCard() {
  const list = incompleteTasks.value;
  if (list.length === 0) return;
  currentIndex.value = (currentIndex.value - 1 + list.length) % list.length;
  resetTimer();
}

/** 跳转到指定索引的任务卡片 */
function goToCard(i: number) {
  currentIndex.value = i;
  resetTimer();
}

/** 调节悬浮窗透明度，参数为 0-100 的百分比值 */
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
  // 加载主题（首次显示时自仓库读取）
  await initTheme();
  await loadAll();
  const mins = await invoke<number>('get_reminder_minutes');
  reminderMinutes.value = mins;
  resetTimer();
  pollInterval = setInterval(loadData, 30000);
  const appWindow = getCurrentWindow();
  unlistenFocus = await appWindow.listen('tauri://focus', () => {
    loadData();
  });
  // 监听主窗口主题变更
  unlistenTheme = await listen<string>('theme-changed', (event) => {
    document.documentElement.setAttribute('data-theme', event.payload);
  });
  await invoke('resize_floating_window', { expanded: false });
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
  if (pollInterval) clearInterval(pollInterval);
  if (unlistenFocus) unlistenFocus();
  if (unlistenTheme) unlistenTheme();
});

watch(showPanel, (expanded) => {
  invoke('resize_floating_window', { expanded });
});

// ── 手势滚动 ──────────────────────────────

const scrollContainer = ref<HTMLElement | null>(null);
const isDragging = ref(false);
let dragStartY = 0;
let scrollStartY = 0;

/** 指针按下时记录起始位置与滚动偏移，开始拖拽手势 */
function onPointerDown(e: PointerEvent) {
  const target = e.target as HTMLElement;
  if (target.closest('button, input, select, .topbar, .panel')) return;
  isDragging.value = true;
  dragStartY = e.clientY;
  if (scrollContainer.value) {
    scrollStartY = scrollContainer.value.scrollTop;
  }
}

/** 指针移动时根据拖拽偏移量同步滚动内容区域 */
function onPointerMove(e: PointerEvent) {
  if (!isDragging.value) return;
  const deltaY = dragStartY - e.clientY;
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = scrollStartY + deltaY;
  }
}

/** 指针释放时结束拖拽状态 */
function onPointerUp() {
  isDragging.value = false;
}
</script>

<template>
  <div
    ref="scrollContainer"
    class="floating-window"
    :class="{ dragging: isDragging }"
    :style="{ '--float-opacity': opacity }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointerleave="onPointerUp"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <div class="topbar" data-tauri-drag-region>
      <div class="topbar-left">
        <svg
          class="topbar-icon"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
        <span class="topbar-label">未完成</span>
        <span class="count">{{ incompleteTasks.length }}</span>
        <span class="topbar-label">项</span>
      </div>
      <div class="topbar-btns">
        <button :class="['topbar-btn', { active: showPanel }]" @click="showPanel = !showPanel">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
          <span>控制</span>
        </button>
      </div>
    </div>

    <div class="card-area">
      <div v-if="isRefreshing" class="loading-hint">
        <span class="mini-spinner"></span>
      </div>
      <div v-else-if="incompleteTasks.length === 0" class="no-tasks">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span>全部完成</span>
      </div>
      <div v-else-if="currentTask" class="card" :key="currentTask.id">
        <div class="card-title">
          <svg
            v-if="currentTask.pinned"
            class="card-pin-icon"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <line x1="12" y1="2" x2="12" y2="17" />
            <path d="M5 17h14l-3-6V5H8v6l-3 6z" />
          </svg>
          <span>{{ currentTask.title }}</span>
        </div>
        <div class="card-meta">
          <span v-for="tag in currentTask.tags" :key="tag" class="card-tag">
            <svg
              width="9"
              height="9"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"
              />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            {{ tag }}
          </span>
          <span v-if="dueStatus" :class="['card-due', dueStatus]">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {{ dueLabel }}
          </span>
          <span v-if="currentTask.important" class="card-important">
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <polygon
                points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
              />
            </svg>
            重要
          </span>
        </div>
      </div>
    </div>

    <div v-if="incompleteTasks.length > 0" class="carousel-controls">
      <button class="arrow-btn" @click="prevCard">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <div class="dots">
        <span
          v-for="(_, i) in incompleteTasks"
          :key="i"
          :class="['dot', { active: i === currentIndex % incompleteTasks.length }]"
          @click="goToCard(i)"
        ></span>
      </div>
      <button class="arrow-btn" @click="nextCard">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>

    <Transition name="panel-slide">
      <div v-if="showPanel" class="panel">
        <div class="panel-row">
          <label>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
            透明度
          </label>
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
          <label>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            自动轮播
          </label>
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
          <label>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            截止提醒
          </label>
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
        <button class="exit-btn" @click="exitFloating">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <polyline points="9 14 4 9 9 4" />
            <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
          </svg>
          退出悬浮窗
        </button>
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

/* ── 悬浮窗容器 ────────────────────── */
.floating-window {
  --float-opacity: 0.92;
  width: 260px;
  min-height: 100vh;
  /* 始终维持暗色玻璃质感，仅透明度可变 */
  background: rgba(28, 28, 34, var(--float-opacity));
  clip-path: inset(0 round var(--radius-xl));
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  filter: drop-shadow(0 2px 16px rgba(0, 0, 0, 0.35));
  overflow: hidden;
  overflow-y: auto;
  scrollbar-width: none;
  user-select: none;
  cursor: grab;
  font-family: var(--font-sans);
  color: var(--text-primary);
}

.floating-window::-webkit-scrollbar {
  display: none;
}

.floating-window.dragging {
  cursor: grabbing;
}

/* ── 顶部栏 ────────────────────── */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px var(--space-sm);
  background: var(--bg-hover);
  border-bottom: 1px solid var(--border-subtle);
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

.topbar-icon {
  color: var(--accent);
}

.topbar-label {
  color: var(--text-disabled);
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
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--accent-muted);
  border: none;
  color: var(--text-muted);
  font-size: 10px;
  padding: 3px 7px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-app-region: no-drag;
  font-family: var(--font-sans);
}

.topbar-btn:hover {
  background: var(--accent-light);
  color: var(--text-secondary);
}

.topbar-btn.active {
  background: var(--accent-muted);
  color: var(--accent);
}

/* ── 卡片区 ────────────────────── */
.card-area {
  padding: var(--space-md) var(--space-sm);
  min-height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card {
  width: 100%;
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
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

.card-pin-icon {
  flex-shrink: 0;
  color: var(--accent);
  margin-top: 1px;
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
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.card-due {
  font-size: var(--text-xs);
  padding: 2px 7px;
  border-radius: var(--radius-sm);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 3px;
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
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

/* ── 空态 ────────────────────── */
.no-tasks {
  text-align: center;
  color: var(--text-muted);
  font-size: var(--text-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.no-tasks svg {
  color: var(--success);
}

/* ── 加载指示器 ────────────────────── */
.loading-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-md) 0;
}

.mini-spinner {
  width: 16px;
  height: 16px;
  display: inline-block;
  border: 2px solid var(--border-default);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── 轮播控制 ────────────────────── */
.carousel-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 var(--space-sm) var(--space-sm);
  gap: var(--space-xs);
}

.arrow-btn {
  background: var(--accent-muted);
  border: none;
  color: var(--text-muted);
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}

.arrow-btn:hover {
  background: var(--accent-light);
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
  background: var(--text-disabled);
  transition: all var(--transition-normal);
  cursor: pointer;
}

.dot.active {
  background: var(--accent);
  box-shadow: 0 0 6px var(--accent-glow-strong);
}

/* ── 控制面板 ────────────────────── */
.panel {
  border-top: 1px solid var(--border-subtle);
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.panel-row input[type='range'] {
  flex: 1;
  accent-color: var(--accent);
  height: 4px;
}

.opacity-val {
  min-width: 32px;
  text-align: right;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.panel-row select {
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  padding: 3px var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  outline: none;
  cursor: pointer;
  font-family: var(--font-sans);
}

.panel-row select option {
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.exit-btn {
  width: 100%;
  margin-top: 2px;
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  color: var(--text-muted);
  padding: 4px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: var(--font-sans);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.exit-btn:hover {
  background: var(--danger-light);
  color: var(--danger);
  border-color: var(--danger-light);
}

/* ── 面板进出场 ────────────────────── */
.panel-slide-enter-active,
.panel-slide-leave-active {
  transition: all 0.2s ease;
}

.panel-slide-enter-from,
.panel-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ═══════════════════════════════════════════
   HUD / 终末地风格 — data-theme="hud"
   ═══════════════════════════════════════════ */

[data-theme='hud'] .floating-window {
  /* HUD 下底色微调偏暖，维持玻璃质感 */
  background: rgba(24, 22, 20, var(--float-opacity, 0.92));
  clip-path: var(--cut-corner);
  filter: none;
  box-shadow: var(--shadow-lg);
  font-family: var(--font-mono);
}

[data-theme='hud'] .topbar {
  border-bottom-color: var(--border-line);
}

[data-theme='hud'] .topbar-btn {
  border-radius: 0;
  clip-path: polygon(
    var(--cut-sm) 0%,
    100% 0%,
    100% calc(100% - var(--cut-sm)),
    calc(100% - var(--cut-sm)) 100%,
    0% 100%,
    0% var(--cut-sm)
  );
}

[data-theme='hud'] .arrow-btn {
  border-radius: 0;
  clip-path: polygon(
    var(--cut-sm) 0%,
    100% 0%,
    100% calc(100% - var(--cut-sm)),
    calc(100% - var(--cut-sm)) 100%,
    0% 100%,
    0% var(--cut-sm)
  );
}

[data-theme='hud'] .exit-btn {
  border-radius: 0;
  clip-path: polygon(
    var(--cut-sm) 0%,
    100% 0%,
    100% calc(100% - var(--cut-sm)),
    calc(100% - var(--cut-sm)) 100%,
    0% 100%,
    0% var(--cut-sm)
  );
}

[data-theme='hud'] .panel-row select {
  border-radius: 0;
  clip-path: polygon(
    var(--cut-sm) 0%,
    100% 0%,
    100% calc(100% - var(--cut-sm)),
    calc(100% - var(--cut-sm)) 100%,
    0% 100%,
    0% var(--cut-sm)
  );
}

[data-theme='hud'] .card-tag {
  border-radius: 0;
  clip-path: polygon(
    var(--cut-sm) 0%,
    100% 0%,
    100% calc(100% - var(--cut-sm)),
    calc(100% - var(--cut-sm)) 100%,
    0% 100%,
    0% var(--cut-sm)
  );
}

[data-theme='hud'] .card-due {
  border-radius: 0;
  clip-path: polygon(
    var(--cut-sm) 0%,
    100% 0%,
    100% calc(100% - var(--cut-sm)),
    calc(100% - var(--cut-sm)) 100%,
    0% 100%,
    0% var(--cut-sm)
  );
}

[data-theme='hud'] .panel {
  border-top-color: var(--border-line);
}
</style>
