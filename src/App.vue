<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { AppModule } from './types';
import Sidebar from './components/Sidebar.vue';
import TaskInput from './components/TaskInput.vue';
import TaskList from './components/TaskList.vue';
import TaskStats from './components/TaskStats.vue';
import MiniCalendar from './components/MiniCalendar.vue';
import TagFilterBar from './components/TagFilterBar.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import AiFocusBar from './components/AiFocusBar.vue';
import AiAssistant from './components/AiAssistant.vue';
import NoteEditor from './components/NoteEditor.vue';
import Toolbox from './components/Toolbox.vue';
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
  loadAll,
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
  const appWindow = getCurrentWindow();
  const unlistenFocus = await appWindow.listen('tauri://focus', () => {
    loadAll();
    loadAiSettings();
  });
  onUnmounted(() => {
    unlistenFocus();
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
  activeModule.value = module;
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
              <AiFocusBar v-if="aiEnabled" :tasks="tasks" />
              <TaskInput :ai-enabled="aiEnabled" @add="addTask" />
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
            </div>
          </div>
        </div>

        <!-- AI 助手模块（Phase 4） -->
        <div
          v-else-if="activeModule === 'ai-assistant' && isEnabled('ai-assistant')"
          key="ai"
          class="module-ai"
        >
          <AiAssistant />
        </div>

        <!-- 日历视图模块 -->
        <div
          v-else-if="activeModule === 'calendar' && isEnabled('calendar')"
          key="calendar"
          class="module-placeholder"
        >
          <h2 class="module-title">日历视图</h2>
          <p class="placeholder-text">日历视图功能将在 Phase 5 中实现</p>
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
          <SettingsPanel />
        </div>
      </Transition>
    </main>
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
.module-placeholder,
.module-ai,
.module-notes,
.module-devtools {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
  border-radius: var(--radius-lg) 0 0 0;
  box-shadow: -4px 0 var(--shadow-md);
  z-index: 1;
}

/* 任务看板头部：标题 + 统计 + AI 状态 */
.module-header {
  padding: var(--space-2xl) var(--space-xl) var(--space-lg);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 1px solid transparent;
}

.module-title {
  font-weight: 700;
  font-size: 24px;
  color: var(--text-primary);
  margin: 0;
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
}

/* 占位模块（尚未实现的 Phase） */
.module-placeholder {
  padding: var(--space-xl);
  align-items: center;
  justify-content: center;
}

.placeholder-text {
  color: var(--text-disabled);
  font-size: var(--text-base);
}

/* ── 模块切换过渡 ────────────────────── */
.module-fade-enter-active,
.module-fade-leave-active {
  transition: opacity var(--transition-normal) var(--easing-standard);
}
.module-fade-enter-from,
.module-fade-leave-to {
  opacity: 0;
}
</style>
