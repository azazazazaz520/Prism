<script setup lang="ts">
import type { AppModule } from '../types';

const props = defineProps<{
  /** 当前激活的功能模块 */
  activeModule: AppModule;
  /** AI 功能是否已配置并启用 */
  aiEnabled: boolean;
}>();

const emit = defineEmits<{
  switchModule: [module: AppModule];
}>();

/** 侧边栏导航项定义 */
interface NavItem {
  module: AppModule;
  label: string;
  /** SVG path 数据（纯线条风格，stroke-width 1.5） */
  iconPath: string;
}

/** 顶部导航项：任务看板、AI 助手、日历 */
const topItems: NavItem[] = [
  {
    module: 'tasks',
    label: '任务看板',
    // 四宫格方块
    iconPath: 'M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 0h7v7h-7v-7z',
  },
  {
    module: 'ai-assistant',
    label: 'AI 助手',
    // 层叠菱形
    iconPath: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  },
  {
    module: 'calendar',
    label: '日历',
    // 日历图标
    iconPath: 'M3 4h18v18H3V4zm13-2v4M8 2v4M3 10h18',
  },
];

/** 底部导航项：悬浮窗、设置 */
const bottomItems: NavItem[] = [
  {
    module: 'floating',
    label: '悬浮窗',
    // 嵌套方框（画中画）
    iconPath: 'M4 4h16v16H4V4zm4 4h8v8H8V8z',
  },
  {
    module: 'settings',
    label: '设置',
    // 齿轮图标
    iconPath:
      'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
  },
];

function handleClick(item: NavItem) {
  // 悬浮窗是直接触发动作，不切换模块视图
  if (item.module === 'floating') {
    emit('switchModule', 'floating');
    return;
  }
  emit('switchModule', item.module);
}
</script>

<template>
  <nav class="sidebar">
    <!-- 顶部导航区：任务、AI、日历 -->
    <div class="sidebar-group">
      <div
        v-for="item in topItems"
        :key="item.module"
        :class="[
          'sidebar-item',
          {
            active: activeModule === item.module,
          },
        ]"
        :title="item.label"
        @click="handleClick(item)"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          :stroke="activeModule === item.module ? '#222' : '#bbb'"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path :d="item.iconPath" />
        </svg>
      </div>
    </div>

    <!-- 底部导航区：悬浮窗、设置 -->
    <div class="sidebar-group sidebar-bottom">
      <div
        v-for="item in bottomItems"
        :key="item.module"
        :class="[
          'sidebar-item',
          {
            active: activeModule === item.module,
          },
        ]"
        :title="item.label"
        @click="handleClick(item)"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          :stroke="activeModule === item.module ? '#222' : '#bbb'"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path :d="item.iconPath" />
        </svg>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.sidebar {
  width: 56px;
  background: #fff;
  border-right: 1px solid #eee;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0;
  flex-shrink: 0;
  user-select: none;
}

.sidebar-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.sidebar-bottom {
  margin-top: auto;
}

.sidebar-item {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
}

.sidebar-item:hover {
  background: #f0f0f0;
}

.sidebar-item.active {
  background: #e8e8e8;
}
</style>
