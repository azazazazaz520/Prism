<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { AiSettings } from '../types';

/** AI 服务配置（从后端加载，编辑后保存回后端） */
const aiSettings = ref<AiSettings>({
  enabled: false,
  api_endpoint: '',
  api_key: '',
  model: 'gpt-4o-mini',
});

/** 提醒提前分钟数（与已有后端命令联动） */
const reminderMinutes = ref(30);
const notificationEnabled = ref(true);

const saving = ref(false);
const saved = ref(false);

onMounted(async () => {
  try {
    aiSettings.value = await invoke<AiSettings>('get_ai_settings');
    reminderMinutes.value = await invoke<number>('get_reminder_minutes');
  } catch {
    // 首次运行或后端命令尚未注册时使用默认值
  }
});

/** 保存 AI 配置到后端（持久化到 tasks.json），自动启用 AI */
async function saveAiSettings() {
  saving.value = true;
  try {
    aiSettings.value.enabled = true;
    await invoke('set_ai_settings', { settings: aiSettings.value });
    saved.value = true;
    setTimeout(() => { saved.value = false; }, 2000);
  } catch (e) {
    console.error('保存 AI 设置失败:', e);
  } finally {
    saving.value = false;
  }
}

/** 保存提醒设置（调用已有的后端命令） */
async function saveReminder() {
  try {
    await invoke('set_reminder_minutes', { minutes: reminderMinutes.value });
  } catch (e) {
    console.error('保存提醒设置失败:', e);
  }
}
</script>

<template>
  <div class="settings-panel">
    <div class="settings-header">
      <h2>偏好设置</h2>
    </div>

    <div class="settings-content">
      <!-- AI 服务配置组 -->
      <div class="settings-group">
        <div class="group-title">AI 设置</div>
        <div class="setting-row">
          <label>API 端点</label>
          <input v-model="aiSettings.api_endpoint" type="text"
            placeholder="https://api.openai.com/v1" />
        </div>
        <div class="setting-row">
          <label>API Key</label>
          <input v-model="aiSettings.api_key" type="password"
            placeholder="sk-..." />
        </div>
        <div class="setting-row">
          <label>模型</label>
          <input v-model="aiSettings.model" type="text"
            placeholder="gpt-4o-mini" />
        </div>
        <button class="save-btn" @click="saveAiSettings" :disabled="saving">
          {{ saved ? '已保存' : '保存' }}
        </button>
      </div>

      <!-- 提醒配置组 -->
      <div class="settings-group">
        <div class="group-title">提醒设置</div>
        <div class="setting-row">
          <label>提前提醒</label>
          <div class="number-input">
            <input v-model.number="reminderMinutes" type="number" min="0"
              @change="saveReminder" />
            <span class="unit">分钟</span>
          </div>
        </div>
        <div class="setting-row">
          <label>系统通知</label>
          <div :class="['toggle', { on: notificationEnabled }]"
            @click="notificationEnabled = !notificationEnabled">
            <div class="toggle-knob" />
          </div>
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
}

.settings-header h2 {
  font-weight: 600;
  font-size: 20px;
  color: #1a1a2e;
  margin: 0;
}

.settings-content {
  flex: 1;
  padding: 0 24px 16px;
  overflow-y: auto;
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

.setting-row input[type="text"],
.setting-row input[type="password"] {
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

.toggle {
  width: 40px;
  height: 22px;
  background: #ccc;
  border-radius: 11px;
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
}

.toggle.on {
  background: #4a90d9;
}

.toggle-knob {
  width: 18px;
  height: 18px;
  background: white;
  border-radius: 50%;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform 0.2s;
}

.toggle.on .toggle-knob {
  transform: translateX(18px);
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
