<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Task, AppModule, AiSettings } from './types';
import Sidebar from './components/Sidebar.vue';
import TaskInput from './components/TaskInput.vue';
import TaskList from './components/TaskList.vue';
import TaskStats from './components/TaskStats.vue';
import MiniCalendar from './components/MiniCalendar.vue';
import TagFilterBar from './components/TagFilterBar.vue';
import SettingsPanel from './components/SettingsPanel.vue';

// ── 全局状态 ──────────────────────────────

/** 当前侧边栏选中的功能模块 */
const activeModule = ref<AppModule>('tasks');
const tasks = ref<Task[]>([]);
const filterDate = ref<string | null>(null);
const selectedTags = ref<string[]>([]);
const allTags = ref<string[]>([]);
const dailyCompletedIds = ref<string[]>([]);

/** AI 功能是否可用（已配置 API Key 且用户启用） */
const aiEnabled = ref(false);

// ── 生命周期 ──────────────────────────────

onMounted(async () => {
  await loadAll();
  await loadAiSettings();
  const appWindow = getCurrentWindow();
  const unlistenFocus = await appWindow.listen('tauri://focus', () => {
    loadAll();
  });
  onUnmounted(() => {
    unlistenFocus();
  });
});

/** 从后端加载 AI 配置，判断 AI 功能是否可用 */
async function loadAiSettings() {
  try {
    const settings = await invoke<AiSettings>('get_ai_settings');
    aiEnabled.value = settings.enabled && !!settings.api_key;
  } catch {
    // 后端命令尚未注册时默认禁用
    aiEnabled.value = false;
  }
}

/** 加载所有任务和标签数据 */
async function loadAll() {
  tasks.value = await invoke<Task[]>('get_tasks');
  allTags.value = await invoke<string[]>('get_all_tags');
  await refreshDailyCompletions();
}

function todayStr(): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function refreshDailyCompletions() {
  dailyCompletedIds.value = await invoke<string[]>('get_daily_completions', { date: todayStr() });
}

// ── 计算属性 ──────────────────────────────

const dailyCompletionsMap = computed(() => {
  const map: Record<string, boolean> = {};
  for (const id of dailyCompletedIds.value) {
    map[id] = true;
  }
  return map;
});

/** 根据日期和标签筛选后的任务列表 */
const filteredTasks = computed(() => {
  let result = tasks.value;
  if (filterDate.value) {
    result = result.filter(t => t.due_date === filterDate.value);
  }
  if (selectedTags.value.length > 0) {
    result = result.filter(t =>
      selectedTags.value.some(tag => t.tags.includes(tag))
    );
  }
  return result;
});

const overdueCount = computed(() => {
  const ts = todayStr();
  return tasks.value.filter(t => t.due_date && t.due_date < ts && !t.completed).length;
});

const pendingCount = computed(() => {
  return tasks.value.filter(t => !t.completed).length;
});

// ── 任务操作（保持原有逻辑） ──────────────────────────────

async function handleAdd(
  title: string,
  due_date: string | null,
  tags: string[],
  important: boolean,
  pinned: boolean,
  is_daily: boolean,
) {
  const task = await invoke<Task>('add_task', {
    title,
    dueDate: due_date,
    tags,
    important,
    pinned,
    isDaily: is_daily,
  });
  tasks.value.push(task);
  if (tags.length > 0) {
    allTags.value = await invoke<string[]>('get_all_tags');
  }
}

async function handleToggle(id: string) {
  await invoke('toggle_task', { id });
  const task = tasks.value.find(t => t.id === id);
  if (task) {
    task.completed = !task.completed;
    task.completed_at = task.completed ? new Date().toISOString() : null;
  }
}

async function handleToggleDaily(id: string, date: string) {
  await invoke('toggle_daily_task', { id, date });
  await refreshDailyCompletions();
}

async function handleUpdate(id: string, title: string) {
  const task = tasks.value.find(t => t.id === id);
  if (!task) return;
  await invoke('update_task', {
    id,
    title,
    dueDate: task.due_date,
    tags: task.tags,
    important: task.important,
    pinned: task.pinned,
    isDaily: task.is_daily,
  });
  task.title = title;
}

async function handleUpdateMeta(id: string, tags: string[], important: boolean, pinned: boolean) {
  const task = tasks.value.find(t => t.id === id);
  if (!task) return;
  await invoke('update_task', {
    id,
    title: task.title,
    dueDate: task.due_date,
    tags,
    important,
    pinned,
    isDaily: task.is_daily,
  });
  task.tags = tags;
  task.important = important;
  task.pinned = pinned;
  allTags.value = await invoke<string[]>('get_all_tags');
}

async function handleDelete(id: string) {
  await invoke('delete_task', { id });
  tasks.value = tasks.value.filter(t => t.id !== id);
  allTags.value = await invoke<string[]>('get_all_tags');
}

async function handleClearCompleted() {
  await invoke('clear_completed');
  tasks.value = tasks.value.filter(t => !t.completed);
}

// ── 筛选操作 ──────────────────────────────

function handleSelectDate(date: string | null) {
  filterDate.value = date;
}

function handleToggleTag(tag: string) {
  if (!tag) {
    selectedTags.value = [];
    return;
  }
  const idx = selectedTags.value.indexOf(tag);
  if (idx >= 0) {
    selectedTags.value.splice(idx, 1);
  } else {
    selectedTags.value.push(tag);
  }
}

function handleAddTag(tag: string) {
  if (!allTags.value.includes(tag)) {
    allTags.value.push(tag);
  }
  selectedTags.value = [tag];
}

// ── 模块切换 ──────────────────────────────

/** 处理侧边栏模块切换，悬浮窗直接触发动作而非切换视图 */
function handleSwitchModule(module: AppModule) {
  if (module === 'floating') {
    invoke('show_floating_window');
    return;
  }
  activeModule.value = module;
}
</script>

<template>
  <div class="app-layout">
    <!-- 侧边栏导航 -->
    <Sidebar
      :active-module="activeModule"
      :ai-enabled="aiEnabled"
      @switch-module="handleSwitchModule"
    />

    <!-- 主内容区（根据选中模块切换显示） -->
    <main class="main-content">

      <!-- 任务看板模块 -->
      <div v-if="activeModule === 'tasks'" class="module-tasks">
        <div class="module-header">
          <div>
            <h2 class="module-title">任务看板</h2>
            <span class="module-subtitle">{{ pendingCount }} 项待办 · {{ overdueCount }} 项已过期</span>
          </div>
          <span v-if="aiEnabled" class="ai-status">AI 已连接</span>
        </div>
        <div class="module-body">
          <MiniCalendar
            :tasks="tasks"
            @select-date="handleSelectDate"
          />
          <TagFilterBar
            :tags="allTags"
            :selected="selectedTags"
            @toggle-tag="handleToggleTag"
            @add-tag="handleAddTag"
          />
          <TaskInput @add="handleAdd" />
          <TaskList
            :tasks="filteredTasks"
            :daily-completions-map="dailyCompletionsMap"
            @toggle="handleToggle"
            @toggle-daily="handleToggleDaily"
            @update="handleUpdate"
            @delete="handleDelete"
            @update-meta="handleUpdateMeta"
          />
          <TaskStats
            :tasks="tasks"
            @clear-completed="handleClearCompleted"
          />
        </div>
      </div>

      <!-- AI 助手模块（Phase 4 实现） -->
      <div v-else-if="activeModule === 'ai-assistant'" class="module-placeholder">
        <h2 class="module-title">AI 助手</h2>
        <p class="placeholder-text">AI 助手功能将在 Phase 4 中实现</p>
      </div>

      <!-- 日历视图模块（Phase 5 实现） -->
      <div v-else-if="activeModule === 'calendar'" class="module-placeholder">
        <h2 class="module-title">日历视图</h2>
        <p class="placeholder-text">日历视图功能将在 Phase 5 中实现</p>
      </div>

      <!-- 设置模块 -->
      <div v-else-if="activeModule === 'settings'" class="module-settings">
        <SettingsPanel />
      </div>
    </main>
  </div>
</template>

<style scoped>
/* 整体布局：侧边栏 + 主内容区 flex 布局 */
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: #fafafa;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 模块容器通用样式 */
.module-tasks,
.module-settings,
.module-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 任务看板头部：标题 + 统计 + AI 状态 */
.module-header {
  padding: 16px 24px 12px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.module-title {
  font-weight: 600;
  font-size: 20px;
  color: #1a1a2e;
  margin: 0;
}

.module-subtitle {
  font-size: 11px;
  color: #aaa;
  margin-top: 2px;
  display: block;
}

.ai-status {
  font-size: 11px;
  color: #555;
  padding: 4px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  white-space: nowrap;
}

/* 任务看板内容区：可滚动 */
.module-body {
  flex: 1;
  padding: 0 24px 16px;
  overflow-y: auto;
}

/* 占位模块（尚未实现的 Phase） */
.module-placeholder {
  padding: 24px;
  align-items: center;
  justify-content: center;
}

.placeholder-text {
  color: #aaa;
  font-size: 14px;
}
</style>
