<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { SettingsSubModule } from '../types';
import { useTheme, type ThemeMode } from '../composables/useTheme';
import { useModuleRegistry } from '../composables/useModuleRegistry';
import VendorList from './VendorList.vue';

const { theme, setTheme } = useTheme();
const { allModules, isEnabled, toggle: toggleModule } = useModuleRegistry();

const activeSub = ref<SettingsSubModule>('preferences');

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
              <select
                :value="theme"
                class="theme-select"
                @change="setTheme(($event.target as HTMLSelectElement).value as ThemeMode)"
              >
                <option value="auto">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
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

        <!-- 默认模型（占位） -->
        <div v-else-if="activeSub === 'models'" class="sub-page sub-placeholder">
          <p>默认模型设置将在后续版本中完善。</p>
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
</style>
