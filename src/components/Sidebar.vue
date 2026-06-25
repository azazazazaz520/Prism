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
    iconPath: 'M3 6h18M7 12h10M10 18h4', // 列表图标
  },
  {
    module: 'ai-assistant',
    label: 'AI 助手',
    iconPath:
      'M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z', // 星星/魔法棒
  },
  {
    module: 'calendar',
    label: '日历视图',
    iconPath: 'M3 4h18v18H3V4zm13-2v4M8 2v4M3 10h18', // 日历
  },
];

/** 底部导航项：悬浮窗、设置 */
const bottomItems: NavItem[] = [
  {
    module: 'floating',
    label: '悬浮窗',
    iconPath: 'M4 4h16v16H4V4zm4 4h8v8H8V8z', // 画中画
  },
  {
    module: 'settings',
    label: '设置',
    iconPath:
      'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z', // 齿轮
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
          'nav-item',
          {
            active: activeModule === item.module,
          },
        ]"
        @click="handleClick(item)"
      >
        <svg
          class="nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path :d="item.iconPath" />
        </svg>
        <span>{{ item.label }}</span>
      </div>
    </div>

    <!-- 底部导航区：悬浮窗、设置 -->
    <div class="sidebar-group sidebar-bottom">
      <div
        v-for="item in bottomItems"
        :key="item.module"
        :class="[
          'nav-item',
          {
            active: activeModule === item.module,
          },
        ]"
        @click="handleClick(item)"
      >
        <svg
          class="nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path :d="item.iconPath" />
        </svg>
        <span>{{ item.label }}</span>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.sidebar {
  width: 240px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  padding: var(--space-lg) var(--space-md);
  flex-shrink: 0;
  user-select: none;
}

.sidebar-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.sidebar-bottom {
  margin-top: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-secondary);
  transition: all var(--transition-fast);
}

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.nav-item.active {
  background: var(--bg-primary);
  color: var(--accent);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.nav-icon {
  width: 20px;
  height: 20px;
  stroke-width: 1.5;
}
</style>
