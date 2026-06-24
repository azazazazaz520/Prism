<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { AiSettings, SettingsSubModule } from '../types';
import VendorList from './VendorList.vue';

const activeSub = ref<SettingsSubModule>('preferences');

/** AI 服务配置（从后端加载，编辑后保存回后端） */
const aiSettings = ref<AiSettings>({
  enabled: false,
  api_endpoint: '',
  api_key: '',
  model: 'gpt-4o-mini',
});

/** 提醒提前分钟数 */
const reminderMinutes = ref(30);
const notificationEnabled = ref(true);

const saving = ref(false);
const saved = ref(false);

onMounted(async () => {
  try {
    aiSettings.value = await invoke<AiSettings>('get_ai_settings');
    reminderMinutes.value = await invoke<number>('get_reminder_minutes');
  } catch {
    // 首次运行使用默认值
  }
});

async function saveAiSettings() {
  saving.value = true;
  try {
    aiSettings.value.enabled = true;
    await invoke('set_ai_settings', { settings: aiSettings.value });
    saved.value = true;
    setTimeout(() => {
      saved.value = false;
    }, 2000);
  } catch (e) {
    console.error('保存 AI 设置失败:', e);
  } finally {
    saving.value = false;
  }
}

async function saveReminder() {
  try {
    await invoke('set_reminder_minutes', { minutes: reminderMinutes.value });
  } catch (e) {
    console.error('保存提醒设置失败:', e);
  }
}

const subModules: { key: SettingsSubModule; label: string; icon: string }[] = [
  { key: 'preferences', label: '偏好设置', icon: '🖥' },
  { key: 'vendors', label: '供应商', icon: '🔗' },
  { key: 'models', label: '默认模型', icon: '🤖' },
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
          <span class="nav-icon">{{ m.icon }}</span>
          <span>{{ m.label }}</span>
        </button>
      </nav>

      <!-- 右侧内容区 -->
      <div class="settings-main">
        <!-- 偏好设置 -->
        <div v-if="activeSub === 'preferences'" class="sub-page">
          <div class="settings-group">
            <div class="group-title">AI 设置</div>
            <div class="setting-row">
              <label>API 端点</label>
              <input
                v-model="aiSettings.api_endpoint"
                type="text"
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div class="setting-row">
              <label>API Key</label>
              <input v-model="aiSettings.api_key" type="password" placeholder="sk-..." />
            </div>
            <div class="setting-row">
              <label>模型</label>
              <input v-model="aiSettings.model" type="text" placeholder="gpt-4o-mini" />
            </div>
            <button class="save-btn" @click="saveAiSettings" :disabled="saving">
              {{ saved ? '已保存' : '保存' }}
            </button>
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
          <VendorList @refresh="saved = true" />
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
  padding: 16px 24px 12px;
  border-bottom: 1px solid #f0f0f0;
}

.settings-header h2 {
  font-weight: 600;
  font-size: 18px;
  color: #1a1a2e;
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
  padding: 12px 8px;
  border-right: 1px solid #f0f0f0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  background: none;
  font-size: 12px;
  color: #666;
  cursor: pointer;
  text-align: left;
}
.nav-item:hover {
  background: #f5f5f5;
}
.nav-item.active {
  background: #f0f0f0;
  color: #333;
  font-weight: 500;
}

.nav-icon {
  font-size: 14px;
}

.settings-main {
  flex: 1;
  padding: 16px 24px;
  overflow-y: auto;
}

.sub-page {
  max-width: 480px;
}

.sub-placeholder {
  color: #999;
  font-size: 13px;
}

.settings-group {
  background: #fff;
  border: 1px solid #eee;
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 12px;
}

.group-title {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 12px;
  color: #222;
}

.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #f5f5f5;
}
.setting-row:last-of-type {
  border-bottom: none;
}

.setting-row label {
  font-size: 13px;
  color: #444;
}

.setting-row input[type='text'],
.setting-row input[type='password'] {
  width: 220px;
  padding: 6px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 12px;
  text-align: right;
  outline: none;
}
.setting-row input:focus {
  border-color: #4a90d9;
}

.number-input {
  display: flex;
  align-items: center;
  gap: 6px;
}
.number-input input {
  width: 60px;
  padding: 6px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 12px;
  text-align: right;
  outline: none;
}

.unit {
  font-size: 12px;
  color: #999;
}

.save-btn {
  margin-top: 12px;
  padding: 8px 20px;
  background: #4a90d9;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}
.save-btn:hover {
  background: #357abd;
}
.save-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
