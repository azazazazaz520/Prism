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

function clearAll() {
  input.value = '';
  output.value = '';
}
</script>

<template>
  <div class="ts-tool">
    <!-- 工具栏 -->
    <div class="tool-toolbar">
      <div class="toolbar-group toolbar-primary">
        <span class="current-timestamp"
          >当前时间戳（秒）：<code>{{ now }}</code></span
        >
        <button class="btn btn-icon" @click="refresh" title="刷新时间戳">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M23 4v6h-6" />
            <path d="M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>
      <div class="toolbar-group toolbar-secondary">
        <button class="btn btn-icon" @click="copy" :disabled="!output && !now" title="复制结果">
          <svg
            v-if="!copied"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
          <svg
            v-else
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
        <button class="btn btn-icon" @click="clearAll" :disabled="!input && !output" title="清空">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path
              d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
            />
          </svg>
        </button>
      </div>
    </div>

    <!-- 分栏区域 -->
    <div class="tool-panes">
      <!-- 输入区 -->
      <div class="pane pane-input">
        <div class="pane-header">
          <span class="pane-label">输入（时间戳或日期）</span>
        </div>
        <input
          class="pane-content input-field"
          v-model="input"
          @input="convert"
          placeholder="Unix 时间戳（如 1704067200）或 ISO 日期（如 2024-01-01T00:00:00）"
        />
      </div>

      <!-- 输出区 -->
      <div class="pane pane-output">
        <div class="pane-header">
          <span class="pane-label">转换结果</span>
          <span v-if="copied" class="pane-status status-copied">已复制</span>
        </div>
        <pre class="pane-content"><code>{{ output || '等待输入...' }}</code></pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ts-tool {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  height: 100%;
}

/* ── 工具栏 ──────────────────────────────── */
.tool-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding-bottom: var(--space-xs);
  border-bottom: 1px solid var(--border-subtle);
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.current-timestamp {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.current-timestamp code {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-weight: var(--font-weight-semibold);
  color: var(--accent);
  background: var(--accent-light);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
}

/* ── 按钮样式 ─────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  cursor: pointer;
  border: 1px solid var(--border-default);
  background: var(--bg-primary);
  color: var(--text-secondary);
  transition:
    background var(--transition-fast) var(--easing-standard),
    border-color var(--transition-fast) var(--easing-standard),
    color var(--transition-fast) var(--easing-standard);
}

.btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-icon {
  padding: 6px 8px;
}

/* ── 分栏布局 ─────────────────────────────── */
.tool-panes {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
  min-height: 0;
}

.pane {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-primary);
}

.pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px var(--space-md);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.pane-label {
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.pane-status {
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.status-success {
  background: rgba(39, 174, 96, 0.1);
  color: var(--success);
}

.status-error {
  background: var(--danger-light);
  color: var(--danger);
}

.status-copied {
  background: var(--accent-light);
  color: var(--accent);
}

.pane-content {
  flex: 1;
  padding: var(--space-md);
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--text-primary);
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.input-field {
  min-height: 44px;
  padding: 10px var(--space-md);
  font-family: inherit;
}

.pane-input .pane-content {
  background: var(--bg-primary);
}

.pane-output .pane-content {
  background: var(--bg-secondary);
}

.pane-output code {
  color: var(--text-primary);
}

/* ── 响应式：小屏幕单列 ───────────────────── */
@media (max-width: 768px) {
  .tool-panes {
    grid-template-columns: 1fr;
  }
}
</style>
