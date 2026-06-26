<script setup lang="ts">
import { ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';

const props = defineProps<{ aiEnabled?: boolean }>();

const pattern = ref('');
const text = ref('');
const flags = ref(['g']);
const copied = ref(false);
const aiLoading = ref(false);

const result = computed(() => {
  if (!pattern.value) return '';
  try {
    const re = new RegExp(pattern.value, flags.value.join(''));
    const matches = text.value.match(re);
    if (!matches) return '无匹配';
    return `匹配 ${matches.length} 处:\n${matches.join('\n')}`;
  } catch (e: any) {
    return '正则错误: ' + e.message;
  }
});

async function copy() {
  await navigator.clipboard.writeText(result.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}

async function aiGenerate() {
  const desc = pattern.value.trim();
  if (!desc) return;
  aiLoading.value = true;
  try {
    pattern.value = await invoke<string>('ai_regex_generate', { description: desc });
  } catch (e: any) {
    pattern.value = '// Error: ' + e;
  } finally {
    aiLoading.value = false;
  }
}
</script>

<template>
  <div class="regex-tool">
    <input
      class="tool-input"
      v-model="pattern"
      placeholder="正则表达式，如 \d{3}"
      spellcheck="false"
    />
    <div class="flags-row">
      <label v-for="f in ['g', 'i', 'm']" :key="f" class="flag-label">
        <input type="checkbox" :value="f" v-model="flags" /> {{ f }}
      </label>
    </div>
    <textarea class="tool-input" v-model="text" placeholder="测试文本" spellcheck="false" />
    <div class="tool-actions">
      <button class="btn" @click="copy">复制结果</button>
      <button
        class="btn btn-ai"
        :disabled="!props.aiEnabled || aiLoading"
        :title="props.aiEnabled ? '' : '请先配置 AI 供应商'"
        @click="aiGenerate"
      >
        {{ aiLoading ? '生成中...' : 'AI 生成' }}
      </button>
      <span v-if="copied" class="copied-hint">已复制</span>
    </div>
    <pre class="tool-output">{{ result || '等待输入...' }}</pre>
  </div>
</template>

<style scoped>
.regex-tool {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.tool-input {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-family: monospace;
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: var(--bg-primary);
  outline: none;
  resize: vertical;
  min-height: 80px;
}
.tool-input:first-child {
  min-height: auto;
}
.tool-input:focus {
  border-color: var(--accent);
}
.flags-row {
  display: flex;
  gap: var(--space-md);
}
.flag-label {
  font-size: var(--text-sm);
  font-family: monospace;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 2px;
}
.tool-actions {
  display: flex;
  gap: var(--space-sm);
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
