<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { AppModule, SettingsSubModule } from './types';
import TaskInput from './components/TaskInput.vue';
import TaskList from './components/TaskList.vue';
import TaskStats from './components/TaskStats.vue';
import SyncStatus from './components/SyncStatus.vue';
import MiniCalendar from './components/MiniCalendar.vue';
import TagFilterBar from './components/TagFilterBar.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import AiCommandPanel from './components/AiCommandPanel.vue';
import AiAssistant from './components/AiAssistant.vue';
import NoteEditor from './components/NoteEditor.vue';
import Toolbox from './components/Toolbox.vue';
import Dashboard from './components/Dashboard.vue';
import { useModuleRegistry } from './composables/useModuleRegistry';
import { useTaskStore } from './composables/useTaskStore';
import { useAiStatus } from './composables/useAiStatus';
import { useDashboard } from './composables/useDashboard';
import { usePluginLoader } from './composables/usePluginLoader';

// ── 模块注册表 ──────────────────────────────

const { isEnabled, load: loadModules } = useModuleRegistry();

// ── 任务看板 Store ──────────────────────────────

const {
  tasks,
  allTags,
  filterDate,
  selectedTags,
  filteredTasks,
  dailyCompletionsMap,
  overdueCount,
  pendingCount,
  isLoading,
  loadAll,
  refreshTasks,
  initSync,
  pullAndMerge,
  addTask,
  toggleTask,
  toggleDailyTask,
  updateTask,
  updateTaskMeta,
  deleteTask,
  clearCompleted,
  selectDate,
  toggleTag,
  addTag,
} = useTaskStore();

// ── AI 状态 ──────────────────────────────

const { aiEnabled, load: loadAiSettings } = useAiStatus();

// ── 全局状态 ──────────────────────────────

/** 当前侧边栏选中的功能模块 */
const activeModule = ref<AppModule>('tasks');

/** 非 tasks 模块时 grid 只保留 icon-rail + 主内容区 */
const gridColumns = computed(() =>
  activeModule.value === 'tasks' ? '56px 280px 1fr 300px' : '56px 1fr',
);

// ── 生命周期 ──────────────────────────────

// 在 setup 顶层注册清理，避免 async onMounted 中 await 后丢失组件上下文
let _unlistenFocus: (() => void) | null = null;
let _pollInterval: ReturnType<typeof setInterval> | null = null;
const _handleForceSync = () => refreshTasks();

onUnmounted(() => {
  _unlistenFocus?.();
  window.removeEventListener('prism:force-sync', _handleForceSync);
  if (_pollInterval) clearInterval(_pollInterval);
});

onMounted(async () => {
  await Promise.all([loadAll(), loadAiSettings(), loadModules()]);
  const { loadLayout } = useDashboard();
  loadLayout();
  // 初始化插件系统（扫描 + 加载配置）
  const { loadPlugins } = usePluginLoader();
  loadPlugins();

  const syncReady = await initSync();
  const appWindow = getCurrentWindow();
  let lastRefresh = 0;
  _unlistenFocus = await appWindow.listen('tauri://focus', () => {
    const now = Date.now();
    if (now - lastRefresh < 5000) return;
    lastRefresh = now;
    refreshTasks(true);
    loadAiSettings();
  });
  window.addEventListener('prism:force-sync', _handleForceSync);
  window.addEventListener('prism:nav-settings', ((e: CustomEvent) => {
    if (e.detail) settingsInitialSub.value = e.detail;
    activeModule.value = 'settings';
  }) as EventListener);
  // 仅在同步已配置时启动 30 秒轮询，作为 Realtime WebSocket 的兜底
  if (syncReady) {
    _pollInterval = setInterval(() => {
      pullAndMerge().catch(() => {});
    }, 30_000);
  }
});

// ── 模块切换 ──────────────────────────────

/** 处理侧边栏模块切换，动作模块（悬浮窗）直接触发而非切换视图 */
function handleSwitchModule(module: AppModule) {
  if (module === 'floating') {
    invoke('show_floating_window');
    return;
  }
  if (module !== 'settings' && !isEnabled(module)) return;
  // 正常切换时清除外部指定的子模块，使用默认行为
  settingsInitialSub.value = undefined;
  activeModule.value = module;
}

const settingsInitialSub = ref<SettingsSubModule | undefined>(undefined);
</script>

<template>
  <!-- 终末地风格 — 背景工业轮廓曲线 -->
  <svg
    class="bg-contour"
    viewBox="0 0 1200 600"
    preserveAspectRatio="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <filter id="contour-glow">
        <feGaussianBlur stdDeviation="2" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <g
      fill="none"
      stroke="var(--accent-dim)"
      stroke-width="0.5"
      filter="url(#contour-glow)"
      opacity="0.15"
    >
      <path d="M0,300 Q150,260 300,290 T600,280 T900,310 T1200,290" />
      <path d="M0,320 Q200,290 400,310 T700,300 T1000,330 T1200,310" opacity="0.6" />
      <path d="M0,270 Q100,240 250,260 T550,250 T850,280 T1200,260" opacity="0.4" />
      <ellipse cx="200" cy="290" rx="80" ry="40" opacity="0.4" />
      <ellipse cx="800" cy="310" rx="120" ry="50" opacity="0.3" />
      <ellipse cx="500" cy="270" rx="60" ry="30" opacity="0.3" />
    </g>
  </svg>
  <div class="app-layout">
    <!-- 图标轨 - 56px -->
    <nav class="icon-rail">
      <div class="rail-brand">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path d="M12 2.5L4 7v10l8 4.5 8-4.5V7L12 2.5z" />
          <path d="M12 12L4 7" />
          <path d="M12 12l8-5" />
          <path d="M12 12v9.5" />
        </svg>
      </div>
      <button
        :class="['rail-btn', { active: activeModule === 'tasks' || activeModule === 'settings' }]"
        data-tooltip="Tasks"
        @click="handleSwitchModule('tasks')"
      >
        <svg viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>
      <button
        v-if="isEnabled('notes')"
        :class="['rail-btn', { active: activeModule === 'notes' }]"
        data-tooltip="Notes"
        @click="handleSwitchModule('notes')"
      >
        <svg viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      </button>
      <button
        v-if="isEnabled('ai-assistant')"
        :class="['rail-btn', { active: activeModule === 'ai-assistant' }]"
        data-tooltip="AI"
        @click="handleSwitchModule('ai-assistant')"
      >
        <svg viewBox="0 0 24 24">
          <path d="M12 2l2.5 5.5L20 10l-5.5 2.5L12 18l-2.5-5.5L4 10l5.5-2.5z" />
        </svg>
      </button>
      <button
        v-if="isEnabled('devtools')"
        :class="['rail-btn', { active: activeModule === 'devtools' }]"
        data-tooltip="Toolbox"
        @click="handleSwitchModule('devtools')"
      >
        <svg viewBox="0 0 24 24">
          <path
            d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
          />
        </svg>
      </button>
      <button
        v-if="isEnabled('floating')"
        class="rail-btn"
        data-tooltip="Floating"
        @click="handleSwitchModule('floating')"
      >
        <svg viewBox="0 0 24 24">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="8" y="8" width="8" height="8" rx="1" />
        </svg>
      </button>
      <div class="rail-spacer"></div>
      <button
        :class="['rail-btn', { active: activeModule === 'settings' }]"
        data-tooltip="Settings"
        @click="handleSwitchModule('settings')"
      >
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
      </button>
    </nav>

    <!-- Sidebar: 280px 分组任务列表 + 内联输入 -->
    <aside v-if="activeModule === 'tasks'" class="task-sidebar">
      <div class="sidebar-header">
        <span class="sidebar-label">Operations</span>
        <span class="sidebar-count">{{ tasks.length }}</span>
      </div>
      <div class="sidebar-list">
        <TaskList
          :tasks="filteredTasks"
          :daily-completions-map="dailyCompletionsMap"
          :ai-enabled="aiEnabled"
          @toggle="toggleTask"
          @toggle-daily="toggleDailyTask"
          @update="updateTask"
          @delete="deleteTask"
          @update-meta="updateTaskMeta"
        />
      </div>
    </aside>

    <!-- 主内容区 -->
    <main class="main-area">
      <Transition name="module-fade" mode="out-in">
        <div v-if="activeModule === 'tasks' && isEnabled('tasks')" key="tasks" class="module-tasks">
          <div v-if="isLoading" class="loading-overlay">
            <span class="loading-spinner"></span>
            <span class="loading-text">加载任务数据…</span>
          </div>
          <template v-else>
            <!-- 顶部固定区：标题 + TaskInput -->
            <div class="tasks-top">
              <div class="main-header">
                <div>
                  <h1 class="main-title">任务看板</h1>
                  <div class="main-subtitle">
                    {{ pendingCount }} 待完成 · {{ overdueCount }} 已过期
                  </div>
                </div>
              </div>
              <div class="main-input">
                <TaskInput :ai-enabled="aiEnabled" @add="addTask" />
              </div>
            </div>

            <!-- 中部可滚区：仪表盘 -->
            <div class="tasks-scroll">
              <Dashboard />
            </div>

            <!-- 底部固定区：统计 + Sync -->
            <div class="tasks-bottom">
              <div class="bottom-stats-row">
                <TaskStats :tasks="tasks" @clear-completed="clearCompleted" />
              </div>
              <div class="bottom-sync-row">
                <SyncStatus />
              </div>
            </div>
          </template>
        </div>

        <div
          v-else-if="activeModule === 'ai-assistant' && isEnabled('ai-assistant')"
          key="ai"
          class="module-ai"
        >
          <AiAssistant />
        </div>

        <div
          v-else-if="activeModule === 'notes' && isEnabled('notes')"
          key="notes"
          class="module-notes"
        >
          <NoteEditor />
        </div>

        <div
          v-else-if="activeModule === 'devtools' && isEnabled('devtools')"
          key="devtools"
          class="module-devtools"
        >
          <Toolbox :ai-enabled="aiEnabled" />
        </div>

        <div v-else key="settings" class="module-settings">
          <SettingsPanel :initial-sub="settingsInitialSub" />
        </div>
      </Transition>
    </main>

    <!-- 右侧面板 (仅任务模块) -->
    <aside v-if="activeModule === 'tasks'" class="right-panel">
      <div class="right-panel-header">
        <span class="right-panel-label"><span class="rp-dot"></span>Cal & Tags</span>
      </div>
      <div class="right-panel-content">
        <MiniCalendar :tasks="tasks" @select-date="selectDate" />
        <div class="detail-section-header" style="margin-top: var(--space-md)">
          <span class="detail-section-label">Filter Tags</span>
          <span class="detail-section-line"></span>
        </div>
        <TagFilterBar
          :tags="allTags"
          :selected="selectedTags"
          @toggle-tag="toggleTag"
          @add-tag="addTag"
        />
      </div>
    </aside>
  </div>
</template>

<style scoped>
/* 四栏布局 — icon-rail + sidebar + main + right-panel */
.app-layout {
  display: grid;
  grid-template-columns: v-bind(gridColumns);
  grid-template-rows: 1fr;
  height: 100vh;
  overflow: hidden;
  gap: 0;
}

/* ── 背景轮廓曲线 ────────────────────── */
.bg-contour {
  display: none;
}

:global([data-theme='hud'] .bg-contour) {
  display: block;
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}

/* ── 图标轨 56px ──────────────────────── */
.icon-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-md) 0;
  gap: var(--space-xs);
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-subtle);
}

[data-theme='hud'] .icon-rail {
  background:
    linear-gradient(90deg, var(--accent-glow-s) 0%, transparent 30%), var(--bg-deep, #0f1118);
}

.rail-brand {
  margin-bottom: var(--space-md);
  color: var(--accent);
}

[data-theme='hud'] .rail-brand {
  filter: drop-shadow(0 0 6px var(--accent-glow-strong));
}

.rail-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  position: relative;
  transition: all 0.2s;
}

[data-theme='hud'] .rail-btn {
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
  color: var(--text-tertiary);
}

.rail-btn svg {
  width: 18px;
  height: 18px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.5;
}

.rail-btn:hover {
  background: var(--accent-glow-s);
  color: var(--text-secondary);
}

.rail-btn:hover::after {
  content: attr(data-tooltip);
  position: absolute;
  left: 48px;
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
  padding: 4px var(--space-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: var(--font-heading);
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  pointer-events: none;
  z-index: 50;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.rail-btn.active {
  background: var(--accent-glow);
  color: var(--accent);
}

.rail-btn.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 25%;
  height: 50%;
  width: 2px;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent);
}

[data-theme='hud'] .rail-btn:hover::after {
  border-color: var(--border-line);
  border-radius: 0;
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
  box-shadow: 0 0 12px var(--accent-bg);
}

.rail-spacer {
  flex: 1;
}

/* ── 任务侧栏 280px ───────────────────── */
.task-sidebar {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-panel);
  border-right: 1px solid var(--border-subtle);
}

[data-theme='hud'] .task-sidebar {
  background:
    linear-gradient(
      135deg,
      var(--accent-glow-s) 0%,
      transparent 40%,
      transparent 70%,
      rgba(0, 0, 0, 0.3) 100%
    ),
    var(--bg-tertiary);
}

.sidebar-header {
  padding: var(--space-md) var(--space-md) var(--space-sm);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.sidebar-label {
  font-family: var(--font-heading);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.sidebar-count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--accent-dim);
  background: var(--accent-glow-s);
  padding: 1px 6px;
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
}

.sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--space-sm);
}

.sidebar-list::-webkit-scrollbar {
  width: 3px;
}
.sidebar-list::-webkit-scrollbar-track {
  background: transparent;
}
.sidebar-list::-webkit-scrollbar-thumb {
  background: var(--border-line);
}

/* ── 主内容区任务输入 ──────────────────── */
.main-input {
  padding: var(--space-lg) var(--space-xl) var(--space-md);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

/* ── 主内容区 ─────────────────────────── */
.main-area {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
}

[data-theme='hud'] .main-area {
  background:
    linear-gradient(
      135deg,
      var(--accent-glow-s) 0%,
      transparent 35%,
      transparent 75%,
      rgba(0, 0, 0, 0.25) 100%
    ),
    var(--bg-primary);
}

.module-tasks {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.module-ai,
.module-notes,
.module-devtools,
.module-settings {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── 三段式任务布局 ────────────────────── */
.tasks-top {
  flex-shrink: 0;
}

.tasks-scroll {
  flex: 1;
  overflow-y: auto;
}

.tasks-bottom {
  flex-shrink: 0;
  border-top: 1px solid var(--border-subtle);
  padding: var(--space-sm) var(--space-xl);
  background: var(--bg-primary);
}

.bottom-sync-row {
  display: flex;
  justify-content: flex-end;
  padding-top: 2px;
}

.ai-disabled-hint {
  font-size: var(--text-sm);
  color: var(--text-muted);
  padding: var(--space-md) 0;
}

.link-btn {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: inherit;
  font-family: inherit;
  padding: 0;
  text-decoration: underline;
}

/* ── HUD 角标 ─────────────────────────── */
.main-area::before {
  content: '';
  position: absolute;
  bottom: 16px;
  left: 16px;
  width: 40px;
  height: 40px;
  border-bottom: 1px solid var(--border-line);
  border-left: 1px solid var(--border-line);
  z-index: 0;
  pointer-events: none;
  opacity: 0.4;
}

[data-theme='light'] .main-area::before {
  opacity: 0.25;
}

.main-header {
  padding: var(--space-lg) var(--space-xl) var(--space-md);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-subtle);
  position: relative;
}

/* 扫描线 — 终末地风格能量线 */
.main-header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 5%;
  width: 90%;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--accent-dim) 20%,
    var(--border-line) 80%,
    transparent
  );
  opacity: 0.5;
}

.main-title {
  font-family: var(--font-heading);
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--text-primary);
  margin: 0;
  line-height: 1.1;
}

.main-subtitle {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
  letter-spacing: 1px;
  margin-top: 4px;
}

.task-detail {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-xl);
}

.task-detail::-webkit-scrollbar {
  width: 3px;
}
.task-detail::-webkit-scrollbar-track {
  background: transparent;
}
.task-detail::-webkit-scrollbar-thumb {
  background: var(--border-line);
}

/* ── 右侧面板 300px ───────────────────── */
.right-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-panel);
  border-left: 1px solid var(--border-subtle);
}

[data-theme='hud'] .right-panel {
  background:
    linear-gradient(
      135deg,
      var(--accent-glow-s) 0%,
      transparent 35%,
      transparent 75%,
      rgba(0, 0, 0, 0.25) 100%
    ),
    var(--bg-tertiary);
}

.right-panel-header {
  padding: var(--space-md);
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.right-panel-label {
  font-family: var(--font-heading);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: var(--accent-dim);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.rp-dot {
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

.data-stream {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-tertiary);
  opacity: 0.4;
  letter-spacing: 1px;
}

.right-panel-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-md);
}

.right-panel-content::-webkit-scrollbar {
  width: 3px;
}
.right-panel-content::-webkit-scrollbar-track {
  background: transparent;
}
.right-panel-content::-webkit-scrollbar-thumb {
  background: var(--border-line);
}

/* ── Detail sections ──────────────────── */
.detail-section {
  margin-bottom: var(--space-xl);
}

.detail-section-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}

.detail-section-label {
  font-family: var(--font-heading);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--accent-dim);
  flex-shrink: 0;
}

.detail-section-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--border-line), transparent);
}

/* ── 加载遮罩 ─────────────────────────── */
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  background: var(--bg-primary);
  z-index: 10;
}

.loading-spinner {
  width: 20px;
  height: 20px;
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

.loading-text {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

/* ── 模块切换过渡 ────────────────────── */
.module-fade-enter-active,
.module-fade-leave-active {
  transition: all var(--transition-normal) var(--easing-standard);
}
.module-fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.module-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
