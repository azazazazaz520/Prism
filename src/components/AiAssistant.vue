<script setup lang="ts">
import { ref, nextTick, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { ChatMessage, FocusSuggestion, OverdueSuggestion } from '../types';

// ── 对话状态 ──────────────────────────────

/** 对话消息列表（仅内存，不持久化） */
const messages = ref<ChatMessage[]>([]);
const inputText = ref('');
const loading = ref(false);
const chatContainer = ref<HTMLElement | null>(null);

// ── 快捷提问预设 ──────────────────────────────

interface QuickAction {
  label: string;
  icon: string;
  /** 直接执行命令的名称，为 null 则发送文本消息 */
  command?: string;
  prompt?: string;
}

const quickActions: QuickAction[] = [
  {
    label: '今日聚焦',
    icon: '🎯',
    command: 'ai_daily_focus',
  },
  {
    label: '处理过期',
    icon: '⏰',
    command: 'ai_overdue_suggest',
  },
  {
    label: '统计概览',
    icon: '📊',
    prompt: '根据我当前的任务数据，给出一个简短的统计概览（总数、完成率、过期数、标签分布）。',
  },
  {
    label: '建议排序',
    icon: '📋',
    prompt: '根据截止日期和重要性，帮我重新排序今天的待办任务。',
  },
];

// ── 滚动到底部 ──────────────────────────────

async function scrollToBottom() {
  await nextTick();
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
  }
}

// ── 执行快捷命令 ──────────────────────────────

async function runQuickAction(action: QuickAction) {
  if (loading.value) return;
  loading.value = true;

  try {
    if (action.command === 'ai_daily_focus') {
      const result = await invoke<FocusSuggestion>('ai_daily_focus');
      const text = formatFocusResult(result);
      messages.value.push({ role: 'assistant', content: text });
    } else if (action.command === 'ai_overdue_suggest') {
      const suggestions = await invoke<OverdueSuggestion[]>('ai_overdue_suggest');
      const text = formatOverdueResult(suggestions);
      messages.value.push({ role: 'assistant', content: text });
    } else if (action.prompt) {
      messages.value.push({ role: 'user', content: action.prompt });
      const reply = await invoke<string>('ai_chat', { message: action.prompt });
      messages.value.push({ role: 'assistant', content: reply });
    }
  } catch (e: any) {
    const errMsg = typeof e === 'string' ? e : '请求失败，请检查 AI 配置';
    messages.value.push({ role: 'assistant', content: `⚠️ ${errMsg}` });
  } finally {
    loading.value = false;
    await scrollToBottom();
  }
}

// ── 发送消息 ──────────────────────────────

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
    const errMsg = typeof e === 'string' ? e : '请求失败，请检查 AI 配置';
    messages.value.push({ role: 'assistant', content: `⚠️ ${errMsg}` });
  } finally {
    loading.value = false;
    await scrollToBottom();
  }
}

// ── 格式化函数 ──────────────────────────────

function formatFocusResult(result: FocusSuggestion): string {
  if (!result.items || result.items.length === 0) {
    return '📭 当前没有待办任务，享受清闲时光 ☀️';
  }
  const lines = result.items.map(
    (item, i) => `${i + 1}. **${item.reason}**`
  );
  return `🔍 ${result.summary}\n\n${lines.join('\n')}`;
}

function formatOverdueResult(suggestions: OverdueSuggestion[]): string {
  if (!suggestions || suggestions.length === 0) {
    return '✅ 没有过期任务，一切尽在掌控！';
  }
  const actionLabels: Record<string, string> = {
    reschedule: '📅 重新安排',
    abandon: '🗑️ 建议放弃',
    decompose: '🧩 建议拆解',
  };
  const lines = suggestions.map(
    (s) => `- ${actionLabels[s.action] || s.action}：${s.reason}`
  );
  return `⏰ 发现 ${suggestions.length} 个过期任务：\n\n${lines.join('\n')}`;
}

// ── 组件卸载时清空对话 ──────────────────────────────
// （Vue 的 onUnmounted 由组件生命周期自动处理，reactive 数据随之释放）
</script>

<template>
  <div class="ai-assistant">
    <!-- 快捷操作栏 -->
    <div class="quick-bar">
      <button
        v-for="action in quickActions"
        :key="action.label"
        class="quick-btn"
        :disabled="loading"
        @click="runQuickAction(action)"
      >
        <span class="quick-icon">{{ action.icon }}</span>
        <span class="quick-label">{{ action.label }}</span>
      </button>
    </div>

    <!-- 对话消息区 -->
    <div ref="chatContainer" class="chat-messages">
      <div v-if="messages.length === 0" class="chat-empty">
        <div class="empty-icon">💬</div>
        <div class="empty-title">AI 助手</div>
        <div class="empty-desc">基于你的任务数据提供智能建议<br />选择一个快捷操作或直接提问</div>
      </div>

      <div
        v-for="(msg, idx) in messages"
        :key="idx"
        :class="['chat-bubble', msg.role]"
      >
        <div class="bubble-avatar">{{ msg.role === 'user' ? '👤' : '🤖' }}</div>
        <div class="bubble-content">
          <!-- 简单支持 markdown 换行和加粗 -->
          <template v-for="(line, li) in msg.content.split('\n')" :key="li">
            <span
              v-if="line"
              v-html="line
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/`(.+?)`/g, '<code>$1</code>')
              "
            />
            <br v-if="line === '' && li < msg.content.split('\n').length - 1" />
          </template>
        </div>
      </div>

      <!-- 加载指示器 -->
      <div v-if="loading" class="chat-bubble assistant">
        <div class="bubble-avatar">🤖</div>
        <div class="bubble-content typing">
          <span class="dot" />
          <span class="dot" />
          <span class="dot" />
        </div>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="chat-input-area">
      <input
        v-model="inputText"
        type="text"
        class="chat-input"
        placeholder="问我任何关于任务的问题…"
        :disabled="loading"
        @keydown.enter="sendMessage"
      />
      <button
        class="chat-send-btn"
        :disabled="!inputText.trim() || loading"
        @click="sendMessage"
      >
        ↑
      </button>
    </div>
  </div>
</template>

<style scoped>
.ai-assistant {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── 快捷操作栏 ─────────────────────── */

.quick-bar {
  display: flex;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid #eee;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.quick-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  background: #f5f5f5;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  color: #555;
}

.quick-btn:hover {
  background: #eef3ff;
  border-color: #4a90d9;
  color: #4a90d9;
}

.quick-btn:disabled {
  opacity: 0.5;
  cursor: wait;
}

.quick-icon {
  font-size: 13px;
}

.quick-label {
  font-size: 12px;
}

/* ── 对话消息区 ─────────────────────── */

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #bbb;
  text-align: center;
}

.empty-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: #999;
  margin-bottom: 4px;
}

.empty-desc {
  font-size: 12px;
  line-height: 1.6;
}

/* ── 聊天气泡 ─────────────────────── */

.chat-bubble {
  display: flex;
  gap: 8px;
  max-width: 85%;
}

.chat-bubble.user {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.chat-bubble.assistant {
  align-self: flex-start;
}

.bubble-avatar {
  font-size: 18px;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bubble-content {
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-word;
}

.chat-bubble.user .bubble-content {
  background: #333;
  color: white;
  border-bottom-right-radius: 2px;
}

.chat-bubble.assistant .bubble-content {
  background: #f0f0f0;
  color: #333;
  border-bottom-left-radius: 2px;
}

/* markdown 增强 */
.bubble-content :deep(strong) {
  font-weight: 600;
  color: inherit;
}

.bubble-content :deep(code) {
  background: rgba(0,0,0,0.06);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

/* ── 打字动画 ─────────────────────── */

.typing {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 10px 16px;
}

.dot {
  width: 5px;
  height: 5px;
  background: #999;
  border-radius: 50%;
  animation: bounce 1.2s infinite ease-in-out;
}

.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes bounce {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

/* ── 输入区 ─────────────────────── */

.chat-input-area {
  display: flex;
  gap: 6px;
  padding: 8px 16px 12px;
  border-top: 1px solid #eee;
  flex-shrink: 0;
}

.chat-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}

.chat-input:focus {
  border-color: #888;
}

.chat-send-btn {
  width: 36px;
  height: 36px;
  background: #333;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  cursor: pointer;
  transition: background 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.chat-send-btn:hover {
  background: #555;
}

.chat-send-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}
</style>
