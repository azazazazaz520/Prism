<script setup lang="ts">
import { ref, computed } from 'vue';

const input = ref('');
const mode = ref<'encode' | 'decode'>('encode');
const copied = ref(false);

const output = computed(() => {
  if (!input.value) return '';
  try {
    // encodeURIComponent + unescape：处理非 Latin-1 字符（如中文）的通用方案
    // btoa 仅支持 Latin-1，直接传入多字节字符会抛出 InvalidCharacterError
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

function clearAll() {
  input.value = '';
}
</script>

<template>
  <div class="base64-tool">
    <!-- 工具栏 -->
    <div class="tool-toolbar">
      <div class="toolbar-group toolbar-primary">
        <button :class="['btn', mode === 'encode' ? 'btn-primary' : '']" @click="mode = 'encode'">
          编码
        </button>
        <button :class="['btn', mode === 'decode' ? 'btn-primary' : '']" @click="mode = 'decode'">
          解码
        </button>
      </div>
      <div class="toolbar-group toolbar-secondary">
        <button class="btn btn-icon" @click="copy" :disabled="!output" title="复制结果">
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
        <button class="btn btn-icon" @click="clearAll" :disabled="!input" title="清空">
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
          <span class="pane-label">{{ mode === 'encode' ? '原始文本' : 'Base64' }}</span>
        </div>
        <textarea
          class="pane-content"
          v-model="input"
          :placeholder="mode === 'encode' ? '输入要编码的文本...' : '输入 Base64 字符串...'"
          spellcheck="false"
        ></textarea>
      </div>

      <!-- 输出区 -->
      <div class="pane pane-output">
        <div class="pane-header">
          <span class="pane-label">{{ mode === 'encode' ? 'Base64' : '解码结果' }}</span>
          <span v-if="copied" class="pane-status status-copied">已复制</span>
        </div>
        <pre class="pane-content"><code>{{ output || '等待输入...' }}</code></pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.base64-tool {
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

.flag-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-family: monospace;
  color: var(--text-muted);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.flag-label:hover {
  background: var(--bg-hover);
}

.flag-label input[type='checkbox'] {
  margin: 0;
  accent-color: var(--accent);
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

.btn-primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-icon {
  padding: 6px 8px;
}

.btn-ai {
  background: var(--accent-light);
  color: var(--accent);
  border-color: var(--accent-muted);
  font-weight: var(--font-weight-medium);
}

.btn-ai:hover:not(:disabled) {
  background: var(--accent);
  color: #fff;
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
