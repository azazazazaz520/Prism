<script setup lang="ts">
import { ref, onMounted } from 'vue';

const now = ref(0);
const input = ref('');
const output = ref('');
const copied = ref(false);

onMounted(() => (now.value = Math.floor(Date.now() / 1000)));

function refresh() {
  now.value = Math.floor(Date.now() / 1000);
}

function convert() {
  const v = input.value.trim();
  if (!v) {
    output.value = '';
    return;
  }
  if (/^\d+$/.test(v)) {
    let ts = parseInt(v);
    if (ts < 1e12) ts *= 1000;
    const d = new Date(ts);
    output.value = `UTC: ${d.toISOString().slice(0, 19).replace('T', ' ')}\n本地: ${d.toLocaleString()}`;
  } else {
    const d = new Date(v);
    if (isNaN(d.getTime())) {
      output.value = '无法解析，请输入 Unix 时间戳 或 ISO 日期';
    } else {
      output.value = `时间戳(秒): ${Math.floor(d.getTime() / 1000)}\n毫秒: ${d.getTime()}\n${d.toLocaleString()}`;
    }
  }
}

async function copy() {
  await navigator.clipboard.writeText(output.value || String(now.value));
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div class="ts-tool">
    <div class="ts-now">
      当前 Unix 时间戳（秒）：<code>{{ now }}</code>
      <button class="btn-small" @click="refresh">刷新</button>
    </div>
    <input
      class="tool-input"
      v-model="input"
      @input="convert"
      placeholder="输入时间戳 或 ISO 日期..."
    />
    <pre class="tool-output">{{ output || '输入以转换...' }}</pre>
    <div class="tool-actions">
      <button class="btn" @click="copy">复制</button>
      <span v-if="copied" class="copied-hint">已复制</span>
    </div>
  </div>
</template>

<style scoped>
.ts-tool {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.ts-now {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.ts-now code {
  font-family: monospace;
  font-weight: 600;
  color: var(--text-primary);
}
.btn-small {
  padding: 1px 8px;
  font-size: 11px;
  border: 1px solid var(--border-light);
  border-radius: 4px;
  cursor: pointer;
  background: var(--bg-primary);
  color: var(--text-secondary);
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
}
.tool-input:focus {
  border-color: var(--accent);
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
  min-height: 50px;
  color: var(--text-primary);
}
</style>
