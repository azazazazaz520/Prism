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
        <path d="M12 2.5L4 7v10l8 4.5 8-4.5V7L12 2.5z" />
        <path d="M12 12L4 7" />
        <path d="M12 12l8-5" />
        <path d="M12 12v9.5" />
      </svg>
      <span class="brand-name">Prism</span>
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

[data-theme='hud'] .sidebar,
[data-theme='hud'] .sidebar {
  background:
    linear-gradient(
      135deg,
      rgba(245, 197, 24, 0.04) 0%,
      transparent 40%,
      transparent 70%,
      rgba(0, 0, 0, 0.3) 100%
    ),
    var(--bg-tertiary);
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  margin-bottom: var(--space-lg);
}

[data-theme='hud'] .sidebar-brand,
[data-theme='hud'] .sidebar-brand {
  margin-bottom: var(--space-xl);
}

.brand-icon {
  width: 22px;
  height: 22px;
  color: var(--accent);
  stroke-width: 1.5;
}

[data-theme='hud'] .brand-icon,
[data-theme='hud'] .brand-icon {
  filter: drop-shadow(0 0 6px rgba(245, 197, 24, 0.4));
}

.brand-name {
  font-size: var(--text-h2);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  letter-spacing: -0.3px;
}

[data-theme='hud'] .brand-name,
[data-theme='hud'] .brand-name {
  font-family: var(--font-heading);
  letter-spacing: 3px;
  text-transform: uppercase;
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

[data-theme='hud'] .nav-item,
[data-theme='hud'] .nav-item {
  border-radius: 0;
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
  font-family: var(--font-heading);
  font-size: var(--text-sm);
  letter-spacing: 1px;
  font-weight: 500;
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

[data-theme='hud'] .nav-item.active,
[data-theme='hud'] .nav-item.active {
  background: var(--accent-glow);
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

[data-theme='hud'] .nav-accent-bar,
[data-theme='hud'] .nav-accent-bar {
  border-radius: 0;
  width: 2px;
  box-shadow: 0 0 8px var(--accent);
}

.nav-icon {
  width: 20px;
  height: 20px;
  stroke-width: 1.5;
}
</style>
