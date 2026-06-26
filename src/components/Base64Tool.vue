<script setup lang="ts">
import { ref, computed } from 'vue';

const input = ref('');
const mode = ref<'encode' | 'decode'>('encode');
const copied = ref(false);

const output = computed(() => {
  if (!input.value) return '';
  try {
    return mode.value === 'encode'
      ? btoa(unescape(encodeURIComponent(input.value)))
      : decodeURIComponent(escape(atob(input.value)));
  } catch {
    return mode.value === 'encode' ? '编码失败' : '解码失败，请检查输入';
  }
});

async function copy() {
  await navigator.clipboard.writeText(output.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div class="base64-tool">
    <div class="mode-switch">
      <button :class="['btn', mode === 'encode' ? 'btn-primary' : '']" @click="mode = 'encode'">
        编码
      </button>
      <button :class="['btn', mode === 'decode' ? 'btn-primary' : '']" @click="mode = 'decode'">
        解码
      </button>
    </div>
    <textarea class="tool-input" v-model="input" placeholder="输入文本..." spellcheck="false" />
    <div class="tool-actions">
      <button class="btn" @click="copy">复制结果</button>
      <span v-if="copied" class="copied-hint">已复制</span>
    </div>
    <pre class="tool-output">{{ output || '等待输入...' }}</pre>
  </div>
</template>

<style scoped>
.base64-tool {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.mode-switch {
  display: flex;
  gap: var(--space-sm);
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
.tool-input {
  width: 100%;
  min-height: 80px;
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
  align-items: center;
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
