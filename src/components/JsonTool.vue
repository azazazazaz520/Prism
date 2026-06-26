<script setup lang="ts">
import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';

const props = defineProps<{ aiEnabled?: boolean }>();

const input = ref('');
const output = ref('');
const copied = ref(false);
const aiLoading = ref(false);

function handleInput(val: string) {
  input.value = val;
  try {
    const parsed = JSON.parse(val);
    output.value = JSON.stringify(parsed, null, 2);
  } catch {
    output.value = '';
  }
}

function format() {
  try {
    output.value = JSON.stringify(JSON.parse(input.value), null, 2);
  } catch (e: any) {
    output.value = 'JSON 无效: ' + e.message;
  }
}

function minify() {
  try {
    output.value = JSON.stringify(JSON.parse(input.value));
  } catch (e: any) {
    output.value = 'JSON 无效: ' + e.message;
  }
}

function validate() {
  try {
    JSON.parse(input.value);
    output.value = 'JSON 有效';
  } catch (e: any) {
    output.value = '无效: ' + e.message;
  }
}

async function copy() {
  await navigator.clipboard.writeText(output.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}

async function aiExplain() {
  if (!input.value) return;
  aiLoading.value = true;
  try {
    output.value = await invoke<string>('ai_json_explain', { jsonText: input.value });
  } catch (e: any) {
    output.value = 'AI 调用失败: ' + e;
  } finally {
    aiLoading.value = false;
  }
}
</script>

<template>
  <div class="json-tool">
    <textarea
      class="tool-input"
      :value="input"
      @input="handleInput(($event.target as HTMLTextAreaElement).value)"
      placeholder='粘贴 JSON，如 {"name":"test"}'
      spellcheck="false"
    ></textarea>
    <div class="tool-actions">
      <button class="btn btn-primary" @click="format">格式化</button>
      <button class="btn" @click="minify">压缩</button>
      <button class="btn" @click="validate">校验</button>
      <button class="btn" @click="copy">复制</button>
      <button
        class="btn btn-ai"
        :disabled="!props.aiEnabled || aiLoading"
        :title="props.aiEnabled ? '' : '请先配置 AI 供应商'"
        @click="aiExplain"
      >
        {{ aiLoading ? '分析中...' : 'AI 解释' }}
      </button>
      <span v-if="copied" class="copied-hint">已复制</span>
    </div>
    <pre class="tool-output">{{ output || '等待输入...' }}</pre>
  </div>
</template>

<style scoped>
.json-tool {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.tool-input {
  width: 100%;
  min-height: 100px;
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-family: monospace;
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: var(--bg-primary);
  resize: vertical;
  outline: none;
}

.tool-input:focus {
  border-color: var(--accent);
}

.tool-actions {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
  align-items: center;
}

.btn {
  padding: 5px 14px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  cursor: pointer;
  border: 1px solid var(--border-default);
  background: var(--bg-primary);
  color: var(--text-secondary);
}

.btn:hover {
  background: var(--bg-hover);
}

.btn-primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-ai {
  background: var(--accent-light);
  color: var(--accent);
  border-color: var(--accent-muted);
  font-weight: 500;
}

.btn-ai:hover:not(:disabled) {
  background: var(--accent);
  color: #fff;
}

.btn-ai:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.copied-hint {
  font-size: var(--text-xs);
  color: var(--success);
}

.tool-output {
  padding: var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  font-family: monospace;
  font-size: var(--text-sm);
  white-space: pre-wrap;
  min-height: 60px;
  color: var(--text-primary);
}
</style>
