<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { AiMode, AiExecuteResult, ParsedTask } from '../types';

const emit = defineEmits<{
  addTask: [parsed: ParsedTask];
}>();

// ── 模式 ────────────────────────────────

const mode = ref<AiMode>('auto');
const modeOptions: { value: AiMode; label: string; prefix: string }[] = [
  { value: 'auto', label: '自动识别', prefix: '' },
  { value: 'add', label: '添加任务', prefix: '/add' },
  { value: 'summary', label: '总结日报', prefix: '/summary' },
  { value: 'focus', label: '今日建议', prefix: '/focus' },
];

function setMode(m: AiMode) {
  mode.value = m;
}

// ── 输入 ────────────────────────────────

const input = ref('');
const loading = ref(false);
const result = ref<AiExecuteResult | null>(null);
const error = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);

// 检测命令前缀自动切换模式
function detectModePrefix(val: string) {
  for (const opt of modeOptions) {
    if (opt.prefix && val.trimStart().startsWith(opt.prefix)) {
      mode.value = opt.value;
      return;
    }
  }
  // 没有匹配的前缀 → 保持当前模式（不强制切换回 auto）
}

function onInput(e: Event) {
  const val = (e.target as HTMLTextAreaElement).value;
  input.value = val;
  detectModePrefix(val);
  autoResize();
}

// ── 提交 ────────────────────────────────

async function submit() {
  const text = input.value.trim();
  if (!text || loading.value) return;

  const currentMode = mode.value;
  const opt = modeOptions.find((o) => o.value === currentMode);
  let sendText = text;
  if (opt?.prefix && text.startsWith(opt.prefix)) {
    sendText = text.slice(opt.prefix.length).trim();
  }

  loading.value = true;
  error.value = '';
  result.value = null;

  try {
    const res = await invoke<AiExecuteResult>('ai_execute', {
      mode: currentMode,
      input: sendText,
    });
    result.value = res;
  } catch (e: any) {
    error.value = typeof e === 'string' ? e : 'AI 请求失败';
  } finally {
    loading.value = false;
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
}

// ── 任务创建 ────────────────────────────

function createTask(task: ParsedTask) {
  emit('addTask', task);
}

// ── 自动调整高度 ────────────────────────

function autoResize() {
  nextTick(() => {
    const el = textareaRef.value;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  });
}
</script>

<template>
  <div class="ai-command-panel">
    <!-- 模式选择器 + 输入区 -->
    <div class="acp-input-area">
      <div class="acp-mode-selector">
        <select
          class="acp-mode-select"
          :value="mode"
          @change="setMode(($event.target as HTMLSelectElement).value as AiMode)"
        >
          <option v-for="opt in modeOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>
      <textarea
        ref="textareaRef"
        class="acp-input"
        :value="input"
        :placeholder="mode === 'auto' ? '输入指令，AI 自动识别意图...' : ''"
        rows="1"
        @input="onInput"
        @keydown="onKeydown"
      ></textarea>
      <button class="acp-submit" :disabled="loading || !input.trim()" @click="submit">
        <svg
          v-if="!loading"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
        <span v-else>...</span>
      </button>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="acp-error" @click="error = ''">
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
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      {{ error }}
    </div>

    <!-- 回复区 -->
    <div v-if="result" class="acp-result">
      <div v-if="result.text" class="acp-text" v-html="result.text.replace(/\n/g, '<br>')"></div>

      <!-- /add 模式：任务预览 + 创建按钮 -->
      <div v-if="result.tasks.length > 0" class="acp-tasks">
        <div v-for="(task, idx) in result.tasks" :key="idx" class="acp-task-preview">
          <div class="acp-task-info">
            <span class="acp-task-title">{{ task.title }}</span>
            <span v-if="task.due_date" class="acp-task-meta">{{ task.due_date }}</span>
            <span v-if="task.tags.length" class="acp-task-meta">{{ task.tags.join(', ') }}</span>
          </div>
          <button class="acp-task-create" @click="createTask(task)">添加</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ai-command-panel {
  margin-bottom: var(--space-md);
}

.acp-input-area {
  display: flex;
  align-items: flex-start;
  gap: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: border-color var(--transition-fast);
}

.acp-input-area:focus-within {
  border-color: var(--accent);
}

.acp-mode-selector {
  flex-shrink: 0;
  padding: var(--space-sm);
  border-right: 1px solid var(--border-subtle);
}

.acp-mode-select {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-family: inherit;
  outline: none;
  cursor: pointer;
  padding: 2px 4px;
}

.acp-mode-select option {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.acp-input {
  flex: 1;
  padding: var(--space-sm);
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: inherit;
  outline: none;
  resize: none;
  min-height: 28px;
  line-height: 1.5;
}

.acp-input::placeholder {
  color: var(--text-muted);
}

.acp-submit {
  flex-shrink: 0;
  padding: var(--space-sm);
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--transition-fast);
}

.acp-submit:hover:not(:disabled) {
  color: var(--accent);
}

.acp-submit:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.acp-error {
  margin-top: var(--space-xs);
  font-size: var(--text-xs);
  color: var(--danger);
  padding: var(--space-xs) 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.acp-result {
  margin-top: var(--space-sm);
}

.acp-text {
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: 1.6;
  padding: var(--space-md);
  background: var(--accent-bg);
  border: 1px solid var(--accent-muted);
  border-radius: var(--radius-md);
}

.acp-tasks {
  margin-top: var(--space-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.acp-task-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.acp-task-info {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  flex: 1;
  min-width: 0;
}

.acp-task-title {
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.acp-task-meta {
  font-size: var(--text-xs);
  color: var(--text-muted);
  flex-shrink: 0;
}

.acp-task-create {
  flex-shrink: 0;
  padding: 2px var(--space-md);
  background: var(--accent);
  color: #0f1118;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}

.acp-task-create:hover {
  opacity: 0.85;
}

/* ── HUD 主题 ─────────────────────── */
[data-theme='hud'] .acp-input-area {
  background: var(--bg-elevated);
  border-color: var(--border-line);
  border-radius: 0;
  clip-path: polygon(
    12px 0%,
    100% 0%,
    100% calc(100% - 12px),
    calc(100% - 12px) 100%,
    0% 100%,
    0% 12px
  );
}

[data-theme='hud'] .acp-mode-select {
  font-family: var(--font-heading);
  letter-spacing: 1px;
  text-transform: uppercase;
  font-size: 10px;
}

[data-theme='hud'] .acp-input {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

[data-theme='hud'] .acp-input::placeholder {
  font-family: var(--font-heading);
  letter-spacing: 1px;
  font-size: 10px;
}

[data-theme='hud'] .acp-text {
  background: var(--bg-elevated);
  border-color: var(--border-line);
  border-radius: 0;
  clip-path: polygon(
    8px 0%,
    100% 0%,
    100% calc(100% - 8px),
    calc(100% - 8px) 100%,
    0% 100%,
    0% 8px
  );
}

[data-theme='hud'] .acp-task-preview {
  background: var(--bg-elevated);
  border-color: var(--border-line);
  border-radius: 0;
}

[data-theme='hud'] .acp-task-create {
  clip-path: polygon(
    4px 0%,
    100% 0%,
    100% calc(100% - 4px),
    calc(100% - 4px) 100%,
    0% 100%,
    0% 4px
  );
  border-radius: 0;
  font-family: var(--font-heading);
  letter-spacing: 1px;
  font-size: 10px;
}
</style>
