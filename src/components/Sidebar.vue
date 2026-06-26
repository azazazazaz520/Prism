<script setup lang="ts">
import type { AppModule, ModuleDescriptor } from '../types';

const props = defineProps<{
  /** 当前激活的功能模块 */
  activeModule: AppModule;
  /** 侧边栏顶部模块列表 */
  topModules: ModuleDescriptor[];
  /** 侧边栏底部模块列表 */
  bottomModules: ModuleDescriptor[];
  /** 动作模块（悬浮窗） */
  actionModules: ModuleDescriptor[];
}>();

const emit = defineEmits<{
  switchModule: [module: AppModule];
}>();

function handleClick(item: ModuleDescriptor) {
  emit('switchModule', item.id);
}
</script>

<template>
  <nav class="sidebar">
    <!-- 品牌区域 -->
    <div class="sidebar-brand">
      <svg
        class="brand-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
      <span class="brand-name">WorkForge</span>
    </div>

    <!-- 顶部导航区：视图模块 -->
    <div class="sidebar-group">
      <div
        v-for="item in topModules"
        :key="item.id"
        :class="['nav-item', { active: activeModule === item.id }]"
        @click="handleClick(item)"
      >
        <span v-if="activeModule === item.id" class="nav-accent-bar"></span>
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

    <!-- 底部导航区：动作模块 + 设置 -->
    <div class="sidebar-group sidebar-bottom">
      <div class="sidebar-divider"></div>
      <div v-for="item in actionModules" :key="item.id" class="nav-item" @click="handleClick(item)">
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
      <div class="sidebar-divider"></div>
      <div
        v-for="item in bottomModules"
        :key="item.id"
        :class="['nav-item', { active: activeModule === item.id }]"
        @click="handleClick(item)"
      >
        <span v-if="activeModule === item.id" class="nav-accent-bar"></span>
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
  display: flex;
  flex-direction: column;
  padding: var(--space-lg) var(--space-md);
  flex-shrink: 0;
  user-select: none;
  transition: all var(--transition-normal);
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  margin-bottom: var(--space-lg);
}

.brand-icon {
  width: 22px;
  height: 22px;
  color: var(--accent);
  stroke-width: 1.5;
}

.brand-name {
  font-size: var(--text-h2);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  letter-spacing: -0.3px;
}

.sidebar-divider {
  height: 1px;
  background: var(--border-light);
  margin: var(--space-sm) var(--space-md);
}

.sidebar-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-bottom {
  margin-top: auto;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 10px var(--space-lg);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--text-base);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
  transition: all var(--transition-fast);
}

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.nav-item.active {
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: var(--font-weight-semibold);
}

.nav-accent-bar {
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 2px;
  background: var(--accent);
}

.nav-icon {
  width: 20px;
  height: 20px;
  stroke-width: 1.5;
}
</style>
