<script setup lang="ts">
import { ref } from 'vue';

const uuid = ref('');
const copied = ref(false);

function generate() {
  uuid.value = crypto.randomUUID();
}

async function copy() {
  if (!uuid.value) return;
  await navigator.clipboard.writeText(uuid.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div class="uuid-tool">
    <!-- 工具栏 -->
    <div class="tool-toolbar">
      <div class="toolbar-group toolbar-primary">
        <button class="btn btn-primary" @click="generate">生成 UUID</button>
      </div>
      <div class="toolbar-group toolbar-secondary">
        <button class="btn btn-icon" @click="copy" :disabled="!uuid" title="复制 UUID">
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
      </div>
    </div>

    <!-- UUID 显示区域 -->
    <div class="uuid-display-section">
      <div class="uuid-display-box" v-if="uuid">
        <code class="uuid-text">{{ uuid }}</code>
      </div>
      <div v-else class="uuid-placeholder">
        <p>点击"生成 UUID"按钮生成新的 UUID</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.uuid-tool {
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

/* ── UUID 显示区域 ────────────────────────── */
.uuid-display-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 0;
}

.uuid-display-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-xl);
  text-align: center;
}

.uuid-text {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 18px;
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  word-break: break-all;
  letter-spacing: 1px;
}

.uuid-placeholder {
  text-align: center;
  color: var(--text-muted);
  font-style: italic;
}

.uuid-placeholder p {
  margin: 0;
  font-size: var(--text-base);
}

.pane-status {
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.status-copied {
  background: var(--accent-light);
  color: var(--accent);
}
</style>
