<script setup lang="ts">
import { ref, nextTick, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { ChatMessage, FocusSuggestion, OverdueSuggestion } from '../types';

// ── 状态 ──────────────────────────────

const messages = ref<ChatMessage[]>([]);
const inputText = ref('');
const loading = ref(false);
const chatContainer = ref<HTMLElement | null>(null);

// ── 快捷操作 ─────────────────────────────

interface QuickAction {
  label: string;
  /** SVG path data */
  iconPath: string;
  command?: string;
  prompt?: string;
}

const quickActions: QuickAction[] = [
  {
    label: '今天该做什么',
    iconPath:
      'M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z',
    command: 'ai_daily_focus',
  },
  {
    label: '处理过期任务',
    iconPath: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 6v6l4 2',
    command: 'ai_overdue_suggest',
  },
  {
    label: '任务统计',
    iconPath: 'M18 20V10M12 20V4M6 20v-6',
    prompt: '根据我当前的任务数据，给出一个简短的统计概览（总数、完成率、过期数）。',
  },
  {
    label: '建议排序',
    iconPath: 'M3 6h18M7 12h10M10 18h4',
    prompt: '根据截止日期和重要性，帮我重新排序今天的待办任务。',
  },
];

// ── 滚动 ──────────────────────────────

async function scrollToBottom() {
  await nextTick();
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
  }
}

// ── 发送 ──────────────────────────────

async function sendMessage() {
  const text = inputText.value.trim();
  if (!text || loading.value) return;

  inputText.value = '';
  messages.value.push({ role: 'user', content: text });
  loading.value = true;
  await scrollToBottom();

  try {
    const reply = await invoke<string>('ai_chat', { message: text });
    messages.value.push({ role: 'assistant', content: reply });
  } catch (e: any) {
    const errMsg = typeof e === 'string' ? e : '请求失败';
    messages.value.push({ role: 'assistant', content: `[错误] ${errMsg}` });
  } finally {
    loading.value = false;
    await scrollToBottom();
  }
}

// ── 快捷操作 ──────────────────────────────

async function runQuickAction(action: QuickAction) {
  if (loading.value) return;
  loading.value = true;

  try {
    if (action.command === 'ai_daily_focus') {
      const result = await invoke<FocusSuggestion>('ai_daily_focus');
      messages.value.push({ role: 'assistant', content: formatFocus(result) });
    } else if (action.command === 'ai_overdue_suggest') {
      const suggestions = await invoke<OverdueSuggestion[]>('ai_overdue_suggest');
      messages.value.push({ role: 'assistant', content: formatOverdue(suggestions) });
    } else if (action.prompt) {
      messages.value.push({ role: 'user', content: action.prompt });
      const reply = await invoke<string>('ai_chat', { message: action.prompt });
      messages.value.push({ role: 'assistant', content: reply });
    }
  } catch (e: any) {
    const errMsg = typeof e === 'string' ? e : '请求失败';
    messages.value.push({ role: 'assistant', content: `[错误] ${errMsg}` });
  } finally {
    loading.value = false;
    await scrollToBottom();
  }
}

// ── 格式化 ──────────────────────────────

function formatFocus(result: FocusSuggestion): string {
  if (!result.items || result.items.length === 0) {
    return '当前没有待办任务，享受清闲时光。';
  }
  const lines = result.items.map((item, i) => `${i + 1}. **${item.reason}**`);
  return `${result.summary}\n\n${lines.join('\n')}`;
}

function formatOverdue(suggestions: OverdueSuggestion[]): string {
  if (!suggestions || suggestions.length === 0) {
    return '没有过期任务，一切尽在掌控！';
  }
  const labels: Record<string, string> = {
    reschedule: '重新安排',
    abandon: '建议放弃',
    decompose: '建议拆解',
  };
  const lines = suggestions.map((s) => `- ${labels[s.action] || s.action}：${s.reason}`);
  return `发现 ${suggestions.length} 个过期任务：\n\n${lines.join('\n')}`;
}

/** 是否有对话内容 */
const hasMessages = computed(() => messages.value.length > 0);
</script>

<template>
  <div class="ai-assistant">
    <!-- 对话消息区 -->
    <div ref="chatContainer" class="chat-messages">
      <!-- 空状态 -->
      <div v-if="!hasMessages" class="empty-state">
        <div class="empty-title">准备好了，随时开始</div>
      </div>

      <!-- 消息列表 -->
      <div v-for="(msg, idx) in messages" :key="idx" :class="['msg-row', msg.role]">
        <svg
          v-if="msg.role === 'assistant'"
          class="msg-avatar"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v4" />
          <line x1="8" y1="16" x2="8.01" y2="16" />
          <line x1="16" y1="16" x2="16.01" y2="16" />
        </svg>
        <div class="msg-bubble">
          <template v-for="(line, li) in msg.content.split('\n')" :key="li">
            <span
              v-if="line"
              v-html="
                line
                  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                  .replace(/`(.+?)`/g, '<code>$1</code>')
              "
            />
            <br v-if="line === '' && li < msg.content.split('\n').length - 1" />
          </template>
        </div>
      </div>

      <!-- 打字指示器 -->
      <div v-if="loading" class="msg-row assistant">
        <svg
          class="msg-avatar"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v4" />
          <line x1="8" y1="16" x2="8.01" y2="16" />
          <line x1="16" y1="16" x2="16.01" y2="16" />
        </svg>
        <div class="msg-bubble typing">
          <span class="dot" /><span class="dot" /><span class="dot" />
        </div>
      </div>
    </div>

    <!-- 底部输入区 -->
    <div class="input-area">
      <!-- 快捷操作（仅空状态显示） -->
      <div v-if="!hasMessages" class="quick-actions">
        <button
          v-for="action in quickActions"
          :key="action.label"
          class="quick-btn"
          :disabled="loading"
          @click="runQuickAction(action)"
        >
          <svg
            class="quick-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path :d="action.iconPath" />
          </svg>
          <span>{{ action.label }}</span>
        </button>
      </div>

      <!-- 输入框 -->
      <div class="input-row">
        <button class="input-plus" title="添加附件">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <input
          v-model="inputText"
          type="text"
          class="chat-input"
          placeholder="问问你的任务…"
          :disabled="loading"
          @keydown.enter="sendMessage"
        />
        <button class="send-btn" :disabled="!inputText.trim() || loading" @click="sendMessage">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ai-assistant {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
}

/* ── 消息区 ─────────────────────── */

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2xl) 40px var(--space-lg);
  display: flex;
  flex-direction: column;
}

/* ── 空状态 ─────────────────────── */

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-title {
  font-size: var(--text-lg);
  font-weight: 500;
  color: var(--text-primary);
  letter-spacing: 0.5px;
}

/* ── 消息行 ─────────────────────── */

.msg-row {
  display: flex;
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
  max-width: 80%;
}

.msg-row.user {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.msg-row.assistant {
  align-self: flex-start;
}

.msg-avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.msg-bubble {
  padding: var(--space-sm) 14px;
  border-radius: var(--space-md);
  font-size: var(--text-base);
  line-height: 1.7;
  word-break: break-word;
}

.msg-row.user .msg-bubble {
  background: var(--text-primary);
  color: var(--bg-primary);
  border-bottom-right-radius: 3px;
}

.msg-row.assistant .msg-bubble {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-bottom-left-radius: 3px;
}

.msg-bubble :deep(strong) {
  font-weight: 600;
}

.msg-bubble :deep(code) {
  background: rgba(0, 0, 0, 0.06);
  padding: 1px var(--space-xs);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}

/* ── 打字动画 ────────────────────── */

.typing {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-md) 18px;
}

.dot {
  width: 6px;
  height: 6px;
  background: var(--text-muted);
  border-radius: 50%;
  animation: bounce 1.2s infinite ease-in-out;
}

.dot:nth-child(2) {
  animation-delay: 0.2s;
}
.dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes bounce {
  0%,
  80%,
  100% {
    opacity: 0.3;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}

/* ── 底部输入区 ─────────────────────── */

.input-area {
  padding: 0 40px var(--space-2xl);
  flex-shrink: 0;
}

/* ── 快捷操作 ─────────────────────── */

.quick-actions {
  display: flex;
  justify-content: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
  flex-wrap: wrap;
}

.quick-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px var(--space-lg);
  background: var(--bg-primary);
  border: 1px solid var(--gray-300);
  border-radius: var(--radius-full);
  font-size: var(--text-base);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.quick-btn:hover {
  border-color: var(--text-primary);
  color: var(--text-primary);
  background: var(--bg-secondary);
}

.quick-btn:disabled {
  opacity: 0.4;
  cursor: wait;
}

.quick-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

/* ─ 输入框 ────────────────────── */

.input-row {
  display: flex;
  align-items: center;
  background: var(--bg-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  padding: var(--space-xs) 6px var(--space-xs) var(--space-lg);
  transition: border-color var(--transition-normal);
}

.input-row:focus-within {
  border-color: var(--text-primary);
}

.input-plus {
  width: 28px;
  height: 28px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: color var(--transition-fast);
  padding: 0;
}

.input-plus:hover {
  color: var(--text-primary);
}

.chat-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: var(--text-sm);
  padding: var(--space-sm) var(--space-md);
  background: transparent;
  color: var(--text-primary);
}

.chat-input::placeholder {
  color: var(--text-disabled);
}

.send-btn {
  width: 36px;
  height: 36px;
  background: var(--text-primary);
  color: var(--bg-primary);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background var(--transition-fast);
}

.send-btn:hover {
  background: var(--text-secondary);
}

.send-btn:disabled {
  background: var(--border-default);
  color: var(--bg-primary);
  cursor: not-allowed;
}
</style>
