<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';
import type { AiMode, AiExecuteResult, ParsedTask } from '../types';

const emit = defineEmits<{
  addTask: [parsed: ParsedTask];
}>();

// ── 模式 ────────────────────────────────

const mode = ref<AiMode>('auto');
const modeDropdownOpen = ref(false);
const modeTriggerRef = ref<HTMLElement | null>(null);
const modeDropdownStyle = ref<Record<string, string>>({});

function toggleModeDropdown() {
  modeDropdownOpen.value = !modeDropdownOpen.value;
  if (modeDropdownOpen.value && modeTriggerRef.value) {
    const rect = modeTriggerRef.value.getBoundingClientRect();
    modeDropdownStyle.value = {
      top: rect.bottom + 4 + 'px',
      left: rect.left + 'px',
    };
  }
}

function onModeClickOutside(e: MouseEvent) {
  if (modeDropdownOpen.value) {
    const target = e.target as HTMLElement;
    if (!target.closest('.acp-mode-dropdown') && !target.closest('.acp-mode-trigger')) {
      modeDropdownOpen.value = false;
    }
  }
}

onMounted(() => document.addEventListener('click', onModeClickOutside));
onUnmounted(() => document.removeEventListener('click', onModeClickOutside));
const modeOptions: { value: AiMode; label: string; prefix: string }[] = [
  { value: 'auto', label: '自动识别', prefix: '' },
  { value: 'add', label: '添加任务', prefix: '/add' },
  { value: 'summary', label: '总结日报', prefix: '/summary' },
  { value: 'focus', label: '今日建议', prefix: '/focus' },
];

const currentModeLabel = computed(
  () => modeOptions.find((o) => o.value === mode.value)?.label ?? '自动识别',
);

function setMode(m: AiMode) {
  mode.value = m;
  modeDropdownOpen.value = false;
}

import { useAiResultCache } from '../composables/useAiResultCache';

const {
  commandResult: result,
  commandError: error,
  saveCommandResult,
  saveCommandError,
  clearCommandResult,
} = useAiResultCache();

// ── 输入 ────────────────────────────────

const input = ref('');
const loading = ref(false);
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
  clearCommandResult();

  try {
    const res = await invoke<AiExecuteResult>('ai_execute', {
      mode: currentMode,
      input: sendText,
    });
    saveCommandResult(res);
  } catch (e: any) {
    saveCommandError(typeof e === 'string' ? e : 'AI 请求失败');
  } finally {
    loading.value = false;
  }
}

function clearResult() {
  clearCommandResult();
  addedTaskIndices.value.clear();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
}

// ── 任务创建 ────────────────────────────

const addedTaskIndices = ref(new Set<number>());

const allTasksAdded = computed(() => {
  if (!result.value || result.value.tasks.length === 0) return false;
  return addedTaskIndices.value.size >= result.value.tasks.length;
});

function createTask(task: ParsedTask, idx: number) {
  emit('addTask', task);
  addedTaskIndices.value.add(idx);
  // 全部添加后清空结果
  if (addedTaskIndices.value.size >= (result.value?.tasks.length ?? 0)) {
    clearCommandResult();
    input.value = '';
    addedTaskIndices.value.clear();
    nextTick(() => {
      if (textareaRef.value) {
        textareaRef.value.style.height = 'auto';
      }
    });
  }
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
        <button
          ref="modeTriggerRef"
          type="button"
          class="acp-mode-trigger"
          @click="toggleModeDropdown"
        >
          {{ currentModeLabel }}
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <Teleport to="body">
          <div v-if="modeDropdownOpen" class="acp-mode-dropdown" :style="modeDropdownStyle">
            <button
              v-for="opt in modeOptions"
              :key="opt.value"
              type="button"
              :class="['acp-mode-option', { active: mode === opt.value }]"
              @click="setMode(opt.value)"
            >
              {{ opt.label }}
              <span v-if="opt.prefix" class="acp-mode-prefix">{{ opt.prefix }}</span>
            </button>
          </div>
        </Teleport>
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
      <button
        class="acp-submit"
        :class="{ 'is-loading': loading }"
        :disabled="!loading && !input.trim()"
        @click="submit"
      >
        <!-- 加载中：旋转 spinner -->
        <svg
          v-if="loading"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <!-- 默认：发送箭头 -->
        <svg
          v-else
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
      <div class="acp-result-actions">
        <button class="acp-clear-btn" @click="clearResult">清除结果</button>
      </div>
      <div v-if="result.text" class="acp-text">{{ result.text }}</div>

      <!-- /add 模式：任务预览 + 创建按钮 -->
      <div v-if="result.tasks.length > 0" class="acp-tasks">
        <div v-for="(task, idx) in result.tasks" :key="idx" class="acp-task-preview">
          <div class="acp-task-info">
            <span class="acp-task-title">{{ task.title }}</span>
            <span v-if="task.due_date" class="acp-task-meta">{{ task.due_date }}</span>
            <span v-if="task.tags.length" class="acp-task-meta">{{ task.tags.join(', ') }}</span>
          </div>
          <button
            :class="['acp-task-create', { added: addedTaskIndices.has(idx) }]"
            :disabled="addedTaskIndices.has(idx)"
            @click="createTask(task, idx)"
          >
            {{ addedTaskIndices.has(idx) ? '已添加' : '添加' }}
          </button>
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
  position: relative;
}

.acp-mode-trigger {
  display: flex;
  align-items: center;
  gap: 3px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-family: inherit;
  outline: none;
  cursor: pointer;
  padding: 2px 4px;
  white-space: nowrap;
}

.acp-mode-trigger:hover {
  color: var(--accent);
}

.acp-mode-dropdown {
  position: fixed;
  z-index: 200;
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  min-width: 140px;
}

[data-theme='hud'] .acp-mode-dropdown {
  background: var(--bg-elevated);
  border-color: var(--border-line);
  clip-path: polygon(
    8px 0%,
    100% 0%,
    100% calc(100% - 8px),
    calc(100% - 8px) 100%,
    0% 100%,
    0% 8px
  );
  border-radius: 0;
}

.acp-mode-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: all var(--transition-fast);
}

.acp-mode-option:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.acp-mode-option.active {
  color: var(--accent);
  font-weight: 500;
}

.acp-mode-prefix {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
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
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
}

.acp-submit:hover:not(:disabled) {
  color: var(--accent);
}

.acp-submit:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}

.acp-submit.is-loading {
  color: var(--accent);
  cursor: default;
  opacity: 1;
}

.acp-submit.is-loading svg {
  animation: acp-spin 0.8s linear infinite;
}

@keyframes acp-spin {
  to {
    transform: rotate(360deg);
  }
}

.acp-result-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--space-xs);
}
.acp-clear-btn {
  font-family: var(--font-heading);
  font-size: 8px;
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 2px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.acp-clear-btn:hover {
  border-color: var(--danger);
  color: var(--danger);
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
  white-space: pre-line;
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

.acp-task-create:hover:not(:disabled) {
  opacity: 0.85;
}

.acp-task-create:disabled,
.acp-task-create.added {
  background: var(--gray-300);
  color: var(--text-muted);
  cursor: default;
  opacity: 0.6;
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

[data-theme='hud'] .acp-mode-trigger {
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
