<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue';

const props = withDefaults(
  defineProps<{
    /** 初始展开的子模块，外部跳转时指定 */
    initialSub?: SettingsSubModule;
  }>(),
  { initialSub: 'preferences' },
);
import { invoke } from '@tauri-apps/api/core';
import type { SettingsSubModule } from '../types';
import { useTheme, type ThemeMode } from '../composables/useTheme';
import { useModuleRegistry } from '../composables/useModuleRegistry';
import VendorList from './VendorList.vue';
import SyncSetup from './SyncSetup.vue';
import PromptEditor from './PromptEditor.vue';

const { theme, setTheme } = useTheme();
const { allModules, isEnabled, toggle: toggleModule } = useModuleRegistry();

const activeSub = ref<SettingsSubModule>(props.initialSub);

/** 主题选择器展开状态 */
const isThemeOpen = ref(false);

/** 触发器 DOM 引用，用于计算下拉菜单位置 */
const themeTriggerRef = ref<HTMLElement | null>(null);

/** 下拉菜单 fixed 定位样式 */
const dropdownStyle = ref({ top: '0px', left: '0px', minWidth: '0px' });

const themeOptions = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
] as const;

function selectTheme(value: ThemeMode) {
  setTheme(value);
  isThemeOpen.value = false;
}

/** 切换下拉菜单并计算 fixed 定位 */
function toggleThemeDropdown() {
  isThemeOpen.value = !isThemeOpen.value;
  if (isThemeOpen.value) {
    // nextTick 等 DOM 更新后再取位置
    nextTick(() => {
      if (themeTriggerRef.value) {
        const rect = themeTriggerRef.value.getBoundingClientRect();
        dropdownStyle.value = {
          top: `${rect.bottom + 4}px`,
          left: `${rect.left}px`,
          minWidth: `${rect.width}px`,
        };
      }
    });
  }
}

/** 点击外部关闭下拉菜单 */
function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (!target.closest('.custom-select') && !target.closest('.select-dropdown')) {
    isThemeOpen.value = false;
  }
}

/** 滚动/缩放时关闭下拉，避免位置错位 */
function handleScrollOrResize() {
  if (isThemeOpen.value) {
    isThemeOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  window.addEventListener('scroll', handleScrollOrResize, true);
  window.addEventListener('resize', handleScrollOrResize);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  window.removeEventListener('scroll', handleScrollOrResize, true);
  window.removeEventListener('resize', handleScrollOrResize);
});

/** 提醒提前分钟数 */
const reminderMinutes = ref(30);

onMounted(async () => {
  try {
    reminderMinutes.value = await invoke<number>('get_reminder_minutes');
  } catch {
    // 首次运行使用默认值
  }
});

async function saveReminder() {
  try {
    await invoke('set_reminder_minutes', { minutes: reminderMinutes.value });
  } catch (e) {
    console.error('保存提醒设置失败:', e);
  }
}

const subModules: { key: SettingsSubModule; label: string }[] = [
  { key: 'preferences', label: '偏好设置' },
  { key: 'vendors', label: '供应商' },
  { key: 'models', label: '默认模型' },
  { key: 'prompts', label: 'Prompt' },
  { key: 'sync', label: '跨设备同步' },
];
</script>

<template>
  <div class="settings-panel">
    <div class="settings-header">
      <h2>设置</h2>
    </div>

    <div class="settings-body">
      <!-- 左侧子导航 -->
      <nav class="settings-nav">
        <button
          v-for="m in subModules"
          :key="m.key"
          :class="['nav-item', { active: activeSub === m.key }]"
          @click="activeSub = m.key"
        >
          <!-- SVG 图标 -->
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
            <template v-if="m.key === 'preferences'">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </template>
            <template v-else-if="m.key === 'vendors'">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </template>
            <template v-else-if="m.key === 'sync'">
              <polyline points="1 4 1 10 7 10" />
              <polyline points="23 20 23 14 17 14" />
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
            </template>
            <template v-else-if="m.key === 'prompts'">
              <polyline points="16 3 21 3 21 8" />
              <line x1="4" y1="20" x2="21" y2="3" />
              <polyline points="21 16 21 21 16 21" />
              <line x1="15" y1="15" x2="21" y2="21" />
              <line x1="4" y1="4" x2="9" y2="9" />
            </template>
            <template v-else>
              <path d="M12 2a4 4 0 0 1 4 4v1h4v14H4V7h4V6a4 4 0 0 1 4-4z" />
              <circle cx="9" cy="13" r="1" />
              <circle cx="15" cy="13" r="1" />
              <line x1="9" y1="17" x2="15" y2="17" />
            </template>
          </svg>
          <span>{{ m.label }}</span>
        </button>
      </nav>

      <!-- 右侧内容区 -->
      <div class="settings-main">
        <!-- 偏好设置 -->
        <div v-if="activeSub === 'preferences'" class="sub-page">
          <div class="settings-group">
            <div class="group-title">外观</div>
            <div class="setting-row">
              <label>主题模式</label>
              <div class="custom-select" :class="{ open: isThemeOpen }">
                <button
                  ref="themeTriggerRef"
                  type="button"
                  class="select-trigger"
                  @click="toggleThemeDropdown"
                >
                  {{ themeOptions.find((o) => o.value === theme)?.label || '跟随系统' }}
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <Teleport to="body">
                  <div v-if="isThemeOpen" class="select-dropdown" :style="dropdownStyle">
                    <button
                      v-for="opt in themeOptions"
                      :key="opt.value"
                      type="button"
                      :class="['dropdown-item', { selected: theme === opt.value }]"
                      @click="selectTheme(opt.value)"
                    >
                      {{ opt.label }}
                    </button>
                  </div>
                </Teleport>
              </div>
            </div>
          </div>

          <div class="settings-group">
            <div class="group-title">模块</div>
            <div
              v-for="m in allModules.filter((m) => m.id !== 'settings')"
              :key="m.id"
              class="setting-row"
            >
              <label>{{ m.label }}</label>
              <button
                :class="['toggle-btn', { on: isEnabled(m.id) }]"
                @click="toggleModule(m.id, !isEnabled(m.id))"
              >
                <span class="toggle-knob" />
              </button>
            </div>
          </div>

          <div class="settings-group">
            <div class="group-title">提醒设置</div>
            <div class="setting-row">
              <label>提前提醒</label>
              <div class="number-input">
                <input
                  v-model.number="reminderMinutes"
                  type="number"
                  min="0"
                  @change="saveReminder"
                />
                <span class="unit">分钟</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 供应商管理 -->
        <div v-else-if="activeSub === 'vendors'" class="sub-page">
          <VendorList />
        </div>

        <!-- TODO: 默认模型选择器——当前仅展示占位文本 -->
        <div v-else-if="activeSub === 'models'" class="sub-page sub-placeholder">
          <p>默认模型设置将在后续版本中完善。</p>
        </div>

        <!-- 同步 -->
        <div v-else-if="activeSub === 'sync'" class="sub-page">
          <SyncSetup />
        </div>

        <!-- Prompt 管理 -->
        <div v-else-if="activeSub === 'prompts'" class="sub-page sub-page-full">
          <PromptEditor />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settings-header {
  padding: var(--space-lg) var(--space-2xl) var(--space-md);
  border-bottom: 1px solid var(--border-light);
}

.settings-header h2 {
  font-weight: 600;
  font-size: var(--text-lg);
  color: var(--text-primary);
  margin: 0;
}

.settings-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.settings-nav {
  width: 140px;
  flex-shrink: 0;
  padding: var(--space-md) var(--space-sm);
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: none;
  border-radius: var(--radius-full);
  background: none;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
  transition: all var(--transition-fast);
}
.nav-item:hover {
  background: var(--bg-hover);
  transform: translateX(2px);
}
.nav-item.active {
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
}

.settings-main {
  flex: 1;
  padding: var(--space-lg) var(--space-2xl);
  overflow-y: auto;
}

.sub-page {
  max-width: 480px;
}

.sub-page-full {
  max-width: none;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.sub-placeholder {
  color: var(--text-muted);
  font-size: var(--text-base);
}

.settings-group {
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: var(--space-xl);
  margin-bottom: var(--space-lg);
  box-shadow: var(--shadow-sm);
}

.group-title {
  font-weight: 600;
  font-size: var(--text-sm);
  margin-bottom: var(--space-md);
  color: var(--text-primary);
}

.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-sm) 0;
  border-bottom: 1px solid var(--bg-hover);
}
.setting-row:last-of-type {
  border-bottom: none;
}

.setting-row label {
  font-size: var(--text-base);
  color: var(--text-secondary);
}

.setting-row input[type='text'],
.setting-row input[type='password'] {
  width: 220px;
  padding: 6px var(--space-sm);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  text-align: right;
  outline: none;
}
.setting-row input:focus {
  border-color: var(--accent);
}

.number-input {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}
.number-input input {
  width: 60px;
  padding: 6px var(--space-sm);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  text-align: right;
  outline: none;
  background: var(--bg-primary);
  color: var(--text-primary);
  /* 隐藏原生数字输入框的上下箭头 */
  -moz-appearance: textfield;
}
.number-input input::-webkit-outer-spin-button,
.number-input input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.number-input input:focus {
  border-color: var(--accent);
}

.unit {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.theme-select {
  padding: 6px var(--space-sm);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  outline: none;
  cursor: pointer;
}
.theme-select:focus {
  border-color: var(--accent);
}

/* 自定义下拉菜单 */
.custom-select {
  position: relative;
  display: inline-block;
}

.select-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 6px var(--space-sm);
  min-width: 120px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.select-trigger:hover {
  border-color: var(--accent);
}
.select-trigger svg {
  margin-left: auto;
  transition: transform var(--transition-fast);
}
.custom-select.open .select-trigger svg {
  transform: rotate(180deg);
}

.select-dropdown {
  position: fixed;
  z-index: 1000;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  animation: dropdown-fade-in 0.15s ease-out;
}

@keyframes dropdown-fade-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.dropdown-item {
  display: block;
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  border: none;
  background: none;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.dropdown-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.dropdown-item.selected {
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
}

/* 模块开关按钮 */
.toggle-btn {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 12px;
  border: none;
  background: var(--gray-300);
  cursor: pointer;
  transition: background var(--transition-fast);
  padding: 0;
}

.toggle-btn.on {
  background: var(--accent);
}

.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform var(--transition-fast);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.toggle-btn.on .toggle-knob {
  transform: translateX(20px);
}

/* ── 暗色适配 ──────────────────────────── */
[data-theme='dark'] .settings-group,
[data-theme='auto'] .settings-group {
  background: var(--bg-tertiary);
  border-color: var(--border-subtle);
  box-shadow: none;
  border-radius: 0;
  clip-path: polygon(
    12px 0%,
    100% 0%,
    100% calc(100% - 12px),
    calc(100% - 12px) 100%,
    0% 100%,
    0% 12px
  );
}

[data-theme='dark'] .group-title,
[data-theme='auto'] .group-title {
  font-family: var(--font-heading);
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--accent-dim);
}

[data-theme='dark'] .nav-item,
[data-theme='auto'] .nav-item {
  font-family: var(--font-heading);
  letter-spacing: 1px;
  border-radius: 0;
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
}

[data-theme='dark'] .nav-item.active,
[data-theme='auto'] .nav-item.active {
  background: var(--accent-glow);
}

[data-theme='dark'] .setting-row,
[data-theme='auto'] .setting-row {
  border-bottom-color: var(--border-subtle);
}

[data-theme='dark'] .select-trigger,
[data-theme='auto'] .select-trigger {
  background: var(--bg-secondary);
  border-color: var(--border-line);
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
  border-radius: 0;
}

[data-theme='dark'] .select-dropdown,
[data-theme='auto'] .select-dropdown {
  background: var(--bg-elevated);
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
}

[data-theme='dark'] .toggle-btn,
[data-theme='auto'] .toggle-btn {
  background: var(--gray-300);
}

[data-theme='dark'] .toggle-btn.on,
[data-theme='auto'] .toggle-btn.on {
  background: var(--accent);
}
</style>
