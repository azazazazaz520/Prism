<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Vendor, VendorPreset } from '../types';

const props = defineProps<{
  vendor: Vendor | null;
}>();

const emit = defineEmits<{
  save: [vendor: Vendor];
  close: [];
}>();

const PRESETS: VendorPreset[] = [
  {
    provider: 'openai',
    name: 'OpenAI',
    base_url: 'https://api.openai.com/v1',
    api_path: '/chat/completions',
    model: 'gpt-4o-mini',
  },
  {
    provider: 'google',
    name: 'Google',
    base_url: 'https://generativelanguage.googleapis.com/v1beta',
    api_path: '/chat/completions',
    model: 'gemini-pro',
  },
  {
    provider: 'claude',
    name: 'Claude',
    base_url: 'https://api.anthropic.com/v1',
    api_path: '/chat/completions',
    model: 'claude-sonnet',
  },
];

const isEditing = computed(() => !!props.vendor);

const selectedPreset = ref<string>(props.vendor?.provider || 'openai');
const enabled = ref(props.vendor?.enabled ?? true);
const name = ref(props.vendor?.name || '');
const apiKey = ref(props.vendor?.api_key || '');
const baseUrl = ref(props.vendor?.base_url || '');
const apiPath = ref(props.vendor?.api_path || '');
const model = ref(props.vendor?.model || '');

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// 选预设时自动填充
function selectPreset(provider: string) {
  selectedPreset.value = provider;
  const preset = PRESETS.find((p) => p.provider === provider);
  if (preset && !props.vendor) {
    name.value = preset.name;
    baseUrl.value = preset.base_url;
    apiPath.value = preset.api_path;
    model.value = preset.model;
  }
}

// 初始化
if (props.vendor) {
  selectPreset(props.vendor.provider);
} else {
  selectPreset('openai');
}

function handleSave() {
  const vendor: Vendor = {
    id: props.vendor?.id || genId(),
    name: name.value || PRESETS.find((p) => p.provider === selectedPreset.value)!.name,
    provider: selectedPreset.value,
    api_key: apiKey.value,
    base_url: baseUrl.value,
    api_path: apiPath.value,
    model: model.value,
    enabled: enabled.value,
    is_default: props.vendor?.is_default || false,
  };
  emit('save', vendor);
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-card">
      <div class="modal-header">
        <h3>{{ isEditing ? '编辑供应商' : '添加供应商' }}</h3>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>

      <div class="modal-body">
        <!-- 供应商选择 -->
        <div class="preset-row">
          <button
            v-for="p in PRESETS"
            :key="p.provider"
            :class="['preset-btn', { selected: selectedPreset === p.provider }]"
            @click="selectPreset(p.provider)"
          >
            {{ p.name }}
          </button>
        </div>

        <!-- 启用开关 -->
        <div class="field-row">
          <label>是否启用</label>
          <div :class="['toggle', { on: enabled }]" @click="enabled = !enabled">
            <div class="toggle-knob" />
          </div>
        </div>

        <div class="field-row">
          <label>名称</label>
          <input v-model="name" type="text" />
        </div>

        <div class="field-row">
          <label>API Key</label>
          <input v-model="apiKey" type="password" placeholder="sk-..." />
        </div>

        <div class="field-row">
          <label>Base URL</label>
          <input v-model="baseUrl" type="text" />
        </div>

        <div class="field-row">
          <label>API 路径</label>
          <input v-model="apiPath" type="text" />
        </div>

        <div class="field-row">
          <label>模型</label>
          <input v-model="model" type="text" />
        </div>
      </div>

      <div class="modal-footer">
        <button class="save-btn" @click="handleSave">
          {{ isEditing ? '保存' : '+ 添加' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal-card {
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  width: 420px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 var(--space-xs) var(--space-xl) rgba(0, 0, 0, 0.15);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-lg) var(--space-xl) var(--space-md);
  border-bottom: 1px solid var(--border-subtle);
}

.modal-header h3 {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  font-size: var(--text-lg);
  cursor: pointer;
  color: var(--text-muted);
}

.modal-body {
  padding: var(--space-lg) var(--space-xl);
}

.preset-row {
  display: flex;
  gap: var(--space-xs);
  margin-bottom: var(--space-sm);
}

.preset-btn {
  flex: 1;
  padding: var(--space-sm);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--text-sm);
  transition: all var(--transition-fast);
}
.preset-btn.selected {
  border-color: var(--accent);
  background: var(--accent-glow-s);
  color: var(--text-primary);
  font-weight: 500;
}

.field-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-sm) 0;
  border-bottom: 1px solid var(--border-subtle);
}

.field-row label {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  flex-shrink: 0;
  width: 80px;
}

.field-row input {
  flex: 1;
  padding: 5px var(--space-sm);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  outline: none;
  text-align: right;
  background: var(--bg-secondary);
  color: var(--text-primary);
}
.field-row input:focus {
  border-color: var(--accent);
}

.toggle {
  width: 40px;
  height: 22px;
  background: var(--border-default);
  border-radius: 11px;
  position: relative;
  cursor: pointer;
  transition: background var(--transition-normal);
}
.toggle.on {
  background: var(--accent);
}
.toggle-knob {
  width: 18px;
  height: 18px;
  background: white;
  border-radius: 50%;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform var(--transition-normal);
}
.toggle.on .toggle-knob {
  transform: translateX(18px);
}

.modal-footer {
  padding: var(--space-md) var(--space-xl) var(--space-lg);
  display: flex;
  justify-content: flex-end;
}

.save-btn {
  padding: var(--space-sm) var(--space-2xl);
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  cursor: pointer;
  transition: opacity var(--transition-fast);
}
.save-btn:hover {
  opacity: 0.85;
}
</style>
