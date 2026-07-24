<script setup lang="ts">
import { ref, computed } from 'vue';
import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';

const props = defineProps<{ aiEnabled?: boolean }>();

const pattern = ref('');
const text = ref('');
const flags = ref(['g']);
const copied = ref(false);
const aiLoading = ref(false);
const isValid = ref<boolean | null>(null);

// 实时测试正则
const result = computed(() => {
  if (!pattern.value) return '';
  try {
    const re = new RegExp(pattern.value, flags.value.join(''));
    const matches = text.value.match(re);
    isValid.value = true;
    if (!matches) return '无匹配';
    return `✓ 匹配 ${matches.length} 处:\n${matches.join('\n')}`;
  } catch (e: any) {
    isValid.value = false;
    return '✗ 正则错误: ' + e.message;
  }
});

async function copy() {
  if (!result.value) return;
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

function clearAll() {
  pattern.value = '';
  text.value = '';
  isValid.value = null;
}

const hasContent = computed(() => pattern.value.length > 0 || text.value.length > 0);
</script>

<template>
  <div class="regex-tool">
    <!-- 工具栏 -->
    <div class="tool-toolbar">
      <div class="toolbar-group toolbar-primary">
        <label v-for="f in ['g', 'i', 'm']" :key="f" class="flag-label">
          <input type="checkbox" :value="f" v-model="flags" />
          <span>{{ f }}</span>
        </label>
      </div>
      <div class="toolbar-group toolbar-secondary">
        <button class="btn btn-icon" @click="copy" :disabled="!result" title="复制结果">
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
        <button class="btn btn-icon" @click="clearAll" :disabled="!hasContent" title="清空">
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
        <button
          v-if="props.aiEnabled"
          class="btn btn-ai"
          :disabled="!pattern || aiLoading"
          title="使用 AI 生成正则表达式"
          @click="aiGenerate"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          {{ aiLoading ? '生成中...' : 'AI 生成' }}
        </button>
      </div>
    </div>

    <!-- 分栏区域 -->
    <div class="tool-panes">
      <!-- 输入区 -->
      <div class="pane pane-input">
        <div class="pane-header">
          <span class="pane-label">正则表达式</span>
          <span v-if="isValid === true" class="pane-status status-success">✓ 有效</span>
          <span v-else-if="isValid === false" class="pane-status status-error"> 无效</span>
        </div>
        <input
          class="pane-content input-field"
          v-model="pattern"
          placeholder="如 \d{3}-\d{4}"
          spellcheck="false"
        />
      </div>

      <!-- 输出区 -->
      <div class="pane pane-output">
        <div class="pane-header">
          <span class="pane-label">测试结果</span>
          <span v-if="copied" class="pane-status status-copied">已复制</span>
        </div>
        <pre class="pane-content"><code>{{ result || '等待输入...' }}</code></pre>
      </div>
    </div>

    <!-- 测试文本 -->
    <div class="test-text-pane">
      <div class="pane-header">
        <span class="pane-label">测试文本</span>
      </div>
      <textarea
        class="pane-content"
        v-model="text"
        placeholder="输入要匹配的文本..."
        spellcheck="false"
      ></textarea>
    </div>
  </div>
</template>

<style scoped>
.regex-tool {
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
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
}

.pane {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-primary);
}

.test-text-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-primary);
  min-height: 120px;
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
