<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { AppModule, SettingsSubModule } from './types';
import Sidebar from './components/Sidebar.vue';
import TaskInput from './components/TaskInput.vue';
import TaskList from './components/TaskList.vue';
import TaskStats from './components/TaskStats.vue';
import SyncStatus from './components/SyncStatus.vue';
import MiniCalendar from './components/MiniCalendar.vue';
import TagFilterBar from './components/TagFilterBar.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import AiFocusBar from './components/AiFocusBar.vue';
import AiAssistant from './components/AiAssistant.vue';
import NoteEditor from './components/NoteEditor.vue';
import Toolbox from './components/Toolbox.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import { useModuleRegistry } from './composables/useModuleRegistry';
import { useTaskStore } from './composables/useTaskStore';
import { useAiStatus } from './composables/useAiStatus';

// ── 模块注册表 ──────────────────────────────

const { topModules, bottomModules, actionModules, isEnabled } = useModuleRegistry();

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
  addTask,
  toggleTask,
  toggleDailyTask,
  updateTask,
  updateTaskMeta,
  deleteTask,
  clearCompleted,
  decomposeTask,
  selectDate,
  toggleTag,
  addTag,
} = useTaskStore();

// ── AI 状态 ──────────────────────────────

const { aiEnabled, load: loadAiSettings } = useAiStatus();

// ── 全局状态 ──────────────────────────────

/** 当前侧边栏选中的功能模块 */
const activeModule = ref<AppModule>('tasks');

// ── 生命周期 ──────────────────────────────

onMounted(async () => {
  await Promise.all([loadAll(), loadAiSettings()]);
  initSync();
  const appWindow = getCurrentWindow();
  let lastRefresh = 0;
  const unlistenFocus = await appWindow.listen('tauri://focus', () => {
    // 去抖：拖拽窗口等连续焦点事件 5 秒内只刷新一次
    const now = Date.now();
    if (now - lastRefresh < 5000) return;
    lastRefresh = now;
    refreshTasks();
    loadAiSettings();
  });
  // 监听手动同步事件
  const handleForceSync = () => refreshTasks();
  window.addEventListener('prism:force-sync', handleForceSync);
  onUnmounted(() => {
    unlistenFocus();
    window.removeEventListener('prism:force-sync', handleForceSync);
  });
});

// ── 模块切换 ──────────────────────────────

/** 处理侧边栏模块切换，动作模块（悬浮窗）直接触发而非切换视图 */
function handleSwitchModule(module: AppModule) {
  if (module === 'floating') {
    invoke('show_floating_window');
    return;
  }
  if (!isEnabled(module)) return;
  // 正常切换时清除外部指定的子模块，使用默认行为
  settingsInitialSub.value = undefined;
  activeModule.value = module;
}

/** 未配置 AI 时点击导入按钮 → 弹窗提示添加供应商 */
const showVendorDialog = ref(false);
const settingsInitialSub = ref<SettingsSubModule | undefined>(undefined);

function showVendorHint() {
  showVendorDialog.value = true;
}

function goToVendorSettings() {
  showVendorDialog.value = false;
  settingsInitialSub.value = 'vendors';
  activeModule.value = 'settings';
}
</script>

<template>
  <div class="app-layout">
    <!-- 侧边栏导航 -->
    <Sidebar
      :active-module="activeModule"
      :top-modules="topModules"
      :bottom-modules="bottomModules"
      :action-modules="actionModules"
      @switch-module="handleSwitchModule"
    />

    <!-- 主内容区（根据选中模块切换显示） -->
    <main class="main-content">
      <Transition name="module-fade" mode="out-in">
        <!-- 任务看板模块 -->
        <div v-if="activeModule === 'tasks' && isEnabled('tasks')" key="tasks" class="module-tasks">
          <div class="module-header">
            <div>
              <h2 class="module-title">任务看板</h2>
              <span class="module-subtitle"
                >{{ pendingCount }} 项待办 · {{ overdueCount }} 项已过期</span
              >
            </div>
            <span v-if="aiEnabled" class="ai-status">AI 已连接</span>
          </div>
          <div class="module-body">
            <!-- 左侧工具栏：日历 + 标签筛选 -->
            <aside class="task-sidebar">
              <MiniCalendar :tasks="tasks" @select-date="selectDate" />
              <TagFilterBar
                :tags="allTags"
                :selected="selectedTags"
                @toggle-tag="toggleTag"
                @add-tag="addTag"
              />
            </aside>

            <!-- 右侧任务区：输入 + 列表 + 统计 -->
            <div class="task-main">
              <!-- 初始加载中遮罩，无过渡动画避免闪烁 -->
              <div v-if="isLoading" class="loading-overlay">
                <span class="loading-spinner"></span>
                <span class="loading-text">加载任务数据…</span>
              </div>
              <template v-else>
                <AiFocusBar v-if="aiEnabled" :tasks="tasks" />
                <div class="task-input-row">
                  <TaskInput :ai-enabled="aiEnabled" @add="addTask" />
                  <button
                    class="import-btn"
                    :title="aiEnabled ? '从聊天记录导入任务' : '需要先配置 AI 供应商'"
                    @click="aiEnabled ? invoke('show_import_window') : showVendorHint()"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    导入
                  </button>
                </div>
                <TaskList
                  :tasks="filteredTasks"
                  :daily-completions-map="dailyCompletionsMap"
                  :ai-enabled="aiEnabled"
                  @toggle="toggleTask"
                  @toggle-daily="toggleDailyTask"
                  @update="updateTask"
                  @delete="deleteTask"
                  @update-meta="updateTaskMeta"
                  @decompose="decomposeTask"
                />
                <TaskStats :tasks="tasks" @clear-completed="clearCompleted" />
                <SyncStatus />
              </template>
            </div>
          </div>
        </div>

        <!-- AI 助手模块 -->
        <div
          v-else-if="activeModule === 'ai-assistant' && isEnabled('ai-assistant')"
          key="ai"
          class="module-ai"
        >
          <AiAssistant />
        </div>

        <!-- 笔记模块 -->
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

        <!-- 设置模块 -->
        <div v-else key="settings" class="module-settings">
          <SettingsPanel :initial-sub="settingsInitialSub" />
        </div>
      </Transition>
    </main>
    <ConfirmDialog
      :visible="showVendorDialog"
      title="未配置 AI 供应商"
      message="导入功能需要 AI 来解析聊天记录。请先在设置中添加并启用一个 AI 供应商。"
      confirm-text="去设置"
      cancel-text="取消"
      @confirm="goToVendorSettings"
      @cancel="showVendorDialog = false"
    />
  </div>
</template>

<style scoped>
/* 整体布局：侧边栏 + 主内容区 flex 布局 */
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-primary);
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-secondary);
  transition: background var(--transition-normal);
}

/* 模块容器通用样式 */
.module-tasks,
.module-settings,
.module-ai,
.module-notes,
.module-devtools {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
  border-radius: var(--radius-xl) 0 0 0;
  box-shadow: -1px 0 0 var(--border-light);
  z-index: 1;
}

[data-theme='dark'] .module-tasks,
[data-theme='auto'] .module-tasks,
[data-theme='dark'] .module-ai,
[data-theme='auto'] .module-ai,
[data-theme='dark'] .module-notes,
[data-theme='auto'] .module-notes,
[data-theme='dark'] .module-devtools,
[data-theme='auto'] .module-devtools,
[data-theme='dark'] .module-settings,
[data-theme='auto'] .module-settings {
  background:
    linear-gradient(
      135deg,
      rgba(245, 197, 24, 0.03) 0%,
      transparent 35%,
      transparent 75%,
      rgba(0, 0, 0, 0.25) 100%
    ),
    var(--bg-primary);
  border-radius: 0;
  box-shadow: none;
}

/* 任务看板头部：标题 + 统计 + AI 状态 */
.module-header {
  padding: var(--space-2xl) var(--space-xl) var(--space-lg);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 1px solid transparent;
}

[data-theme='dark'] .module-header,
[data-theme='auto'] .module-header {
  border-bottom: 1px solid var(--border-subtle);
}

.module-title {
  font-weight: 700;
  font-size: 24px;
  color: var(--text-primary);
  margin: 0;
}

[data-theme='dark'] .module-title,
[data-theme='auto'] .module-title {
  font-family: var(--font-heading);
  font-size: 28px;
  letter-spacing: 1px;
}

.module-subtitle {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin-top: 4px;
  display: block;
}

[data-theme='dark'] .module-subtitle,
[data-theme='auto'] .module-subtitle {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
  letter-spacing: 1px;
}

.ai-status {
  font-size: var(--text-xs);
  color: var(--gray-600);
  padding: 3px var(--space-sm);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  white-space: nowrap;
}

[data-theme='dark'] .ai-status,
[data-theme='auto'] .ai-status {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-tertiary);
  border-color: var(--border-subtle);
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
  border-radius: 0;
  letter-spacing: 1px;
}

.module-subtitle {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin-top: 4px;
  display: block;
}

.ai-status {
  font-size: var(--text-xs);
  color: var(--gray-600);
  padding: 3px var(--space-sm);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  white-space: nowrap;
}

/* 任务看板内容区：左右分区布局 */
.module-body {
  flex: 1;
  padding: 0 var(--space-2xl) var(--space-2xl);
  overflow: hidden;
  display: flex;
  gap: var(--space-xl);
  max-width: 1280px;
  margin: 0 auto;
  width: 100%;
}

/* 左侧工具栏：日历 + 标签筛选，固定宽度 */
.task-sidebar {
  width: 240px;
  flex-shrink: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

/* 右侧任务区：输入 + 列表 + 统计，flex 填充 */
.task-main {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
  padding-top: var(--space-sm);
  position: relative;
}

/* 加载中遮罩 */
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
  border-radius: var(--radius-xl) 0 0 0;
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

.task-input-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
}

.task-input-row > :first-child {
  flex: 1;
  margin-bottom: 0;
}

.import-btn {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 12px var(--space-lg);
  background: var(--bg-primary);
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-full);
  font-size: var(--text-base);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  font-weight: 500;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.import-btn:hover {
  border-color: var(--accent);
  background: var(--accent-light);
  color: var(--accent);
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
