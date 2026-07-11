<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { ParsedTask } from '../types';
import DatePicker from './DatePicker.vue';

const props = defineProps<{
  aiEnabled?: boolean;
}>();

const emit = defineEmits<{
  add: [
    title: string,
    due_date: string | null,
    tags: string[],
    important: boolean,
    pinned: boolean,
    is_daily: boolean,
  ];
}>();

const title = ref('');
const showError = ref(false);
const dueDate = ref<string | null>(null);
const showPicker = ref(false);
const important = ref(false);
const pinned = ref(false);
const isDaily = ref(false);
const tags = ref<string[]>([]);
const showTagInput = ref(false);
const newTag = ref('');
const tagInputRef = ref<HTMLInputElement | null>(null);

// ── AI 解析状态 ──────────────────────────────
/** 是否正在 AI 解析中 */
const aiParsing = ref(false);
/** AI 解析后的预览结果 */
const aiPreview = ref<ParsedTask | null>(null);

/** AI 自然语言解析 */
async function handleAiParse() {
  const trimmed = title.value.trim();
  if (!trimmed) return;
  aiParsing.value = true;
  try {
    const parsed = await invoke<ParsedTask>('ai_parse_input', { text: trimmed });
    aiPreview.value = parsed;
    // 自动填充到快捷开关
    if (parsed.due_date) dueDate.value = parsed.due_date;
    if (parsed.tags.length > 0) tags.value = parsed.tags;
    important.value = parsed.important;
    pinned.value = parsed.pinned;
    isDaily.value = parsed.is_daily;
    title.value = parsed.title;
  } catch (e) {
    showError.value = true;
    setTimeout(() => {
      showError.value = false;
    }, 2000);
  } finally {
    aiParsing.value = false;
  }
}

function handleSubmit() {
  const trimmed = title.value.trim();
  if (!trimmed) {
    showError.value = true;
    setTimeout(() => {
      showError.value = false;
    }, 2000);
    return;
  }
  emit(
    'add',
    trimmed,
    dueDate.value,
    [...tags.value],
    important.value,
    pinned.value,
    isDaily.value,
  );
  title.value = '';
  dueDate.value = null;
  showPicker.value = false;
  important.value = false;
  pinned.value = false;
  isDaily.value = false;
  tags.value = [];
  showError.value = false;
  aiPreview.value = null;
}

function onDateSelect(date: string | null) {
  dueDate.value = date;
  showPicker.value = false;
}

function addTag() {
  const t = newTag.value.trim();
  if (t && !tags.value.includes(t)) {
    tags.value.push(t);
  }
  newTag.value = '';
}

function toggleTagInput() {
  showTagInput.value = !showTagInput.value;
  if (showTagInput.value) {
    nextTick(() => {
      tagInputRef.value?.focus();
    });
  }
}

function removeTag(tag: string) {
  tags.value = tags.value.filter((t) => t !== tag);
}

function formatDueDate(d: string): string {
  const [y, m, day] = d.split('-');
  return `${m}/${day}`;
}
</script>

<template>
  <div class="task-input">
    <div class="input-row">
      <input
        v-model="title"
        type="text"
        placeholder="输入新任务..."
        :class="['task-input-field', { error: showError }]"
        @keydown.enter="handleSubmit"
      />
      <div class="date-btn-wrapper">
        <button
          :class="['date-btn', { active: dueDate }]"
          title="设置截止日期"
          @click="showPicker = !showPicker"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
        <DatePicker :visible="showPicker" @select="onDateSelect" />
      </div>
      <button
        v-if="props.aiEnabled"
        :class="['ai-btn', { parsing: aiParsing }]"
        :disabled="aiParsing"
        title="AI 解析自然语言"
        @click="handleAiParse"
      >
        {{ aiParsing ? '' : '' }}
        <svg
          v-if="!aiParsing"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
          />
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
          <line x1="12" y1="2" x2="12" y2="6" />
          <line x1="12" y1="18" x2="12" y2="22" />
          <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
          <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
          <line x1="2" y1="12" x2="6" y2="12" />
          <line x1="18" y1="12" x2="22" y2="12" />
        </svg>
      </button>
      <button class="task-input-btn" @click="handleSubmit">添加</button>
    </div>

    <div class="quick-actions">
      <button :class="['qa-btn', { active: important }]" @click="important = !important">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polygon
            points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
          />
        </svg>
        重要
      </button>
      <button :class="['qa-btn', { active: pinned }]" @click="pinned = !pinned">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 17v-7" />
          <path d="M8 10l4-4 4 4" />
          <path d="M5 21h14" />
        </svg>
        置顶
      </button>
      <button :class="['qa-btn', { active: isDaily }]" @click="isDaily = !isDaily">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        每日
      </button>
      <button
        :class="['qa-btn', { active: showTagInput || tags.length > 0 }]"
        @click="toggleTagInput"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"
          />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
        标签
      </button>
    </div>

    <div v-if="showTagInput" class="tag-input-row">
      <input
        ref="tagInputRef"
        v-model="newTag"
        type="text"
        placeholder="输入标签名..."
        class="tag-input"
        @keydown.enter.prevent="addTag"
        @keydown.escape="showTagInput = false"
      />
      <button class="tag-add-btn" @click="addTag">添加</button>
    </div>

    <div v-if="tags.length > 0" class="tag-preview">
      <span v-for="tag in tags" :key="tag" class="tag-chip">
        {{ tag }}
        <button class="tag-chip-x" @click="removeTag(tag)">×</button>
      </span>
    </div>

    <div v-if="dueDate || important || pinned || isDaily || tags.length > 0" class="summary">
      <span v-if="dueDate" class="summary-item">
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        截止 {{ formatDueDate(dueDate) }}
      </span>
      <span v-if="important" class="summary-item">
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polygon
            points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
          />
        </svg>
        重要
      </span>
      <span v-if="pinned" class="summary-item">
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 17v-7" />
          <path d="M8 10l4-4 4 4" />
          <path d="M5 21h14" />
        </svg>
        置顶
      </span>
      <span v-if="isDaily" class="summary-item">
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        每日
      </span>
      <span v-if="tags.length > 0" class="summary-item">
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"
          />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
        {{ tags.join(', ') }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.task-input {
  margin-bottom: var(--space-lg);
}

.input-row {
  display: flex;
  gap: var(--space-sm);
}

.task-input-field {
  flex: 1;
  padding: 12px var(--space-lg);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  font-size: var(--text-base);
  outline: none;
  transition: all var(--transition-fast);
  background: var(--bg-primary);
}

[data-theme='dark'] .task-input-field,
[data-theme='auto'] .task-input-field {
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  clip-path: polygon(
    var(--cut-lg) 0%,
    100% 0%,
    100% calc(100% - var(--cut-lg)),
    calc(100% - var(--cut-lg)) 100%,
    0% 100%,
    0% var(--cut-lg)
  );
}

.task-input-field:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-muted);
}

[data-theme='dark'] .task-input-field:focus,
[data-theme='auto'] .task-input-field:focus {
  border-color: var(--accent);
  box-shadow: 0 0 12px var(--accent-glow);
}
.task-input-field.error {
  border-color: var(--danger);
}

.date-btn-wrapper {
  position: relative;
}

.date-btn {
  padding: 10px var(--space-md);
  background: var(--bg-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  cursor: pointer;
  font-size: var(--text-sm);
  line-height: 1;
  transition: all var(--transition-fast);
}

[data-theme='dark'] .date-btn,
[data-theme='auto'] .date-btn {
  background: var(--bg-secondary);
  border-color: var(--border-subtle);
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
}

.date-btn:hover,
.date-btn.active {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent);
}

[data-theme='dark'] .date-btn:hover,
[data-theme='auto'] .date-btn:hover,
[data-theme='dark'] .date-btn.active,
[data-theme='auto'] .date-btn.active {
  background: var(--accent-glow-s);
}

.task-input-btn {
  padding: 10px var(--space-xl);
  background: var(--accent);
  color: white;
  border: none;
  border-radius: var(--radius-full);
  font-size: var(--text-base);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
  font-weight: 500;
}

[data-theme='dark'] .task-input-btn,
[data-theme='auto'] .task-input-btn {
  color: #0f1118;
  clip-path: polygon(
    var(--cut-lg) 0%,
    100% 0%,
    100% calc(100% - var(--cut-lg)),
    calc(100% - var(--cut-lg)) 100%,
    0% 100%,
    0% var(--cut-lg)
  );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.15),
    0 0 12px rgba(245, 197, 24, 0.15);
  font-family: var(--font-heading);
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.task-input-btn:hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

[data-theme='dark'] .task-input-btn:hover,
[data-theme='auto'] .task-input-btn:hover {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.2),
    0 0 24px rgba(245, 197, 24, 0.35);
}

.ai-btn {
  padding: 10px var(--space-md);
  background: none;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  cursor: pointer;
  font-size: var(--text-sm);
  line-height: 1;
  transition: all var(--transition-normal);
}

[data-theme='dark'] .ai-btn,
[data-theme='auto'] .ai-btn {
  border-color: var(--border-subtle);
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
}

.ai-btn:hover {
  border-color: var(--accent);
  background: var(--accent-light);
}

[data-theme='dark'] .ai-btn:hover,
[data-theme='auto'] .ai-btn:hover {
  background: var(--accent-glow-s);
  border-color: var(--accent);
}
.ai-btn.parsing {
  opacity: 0.5;
  cursor: wait;
}

.quick-actions {
  display: flex;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
  flex-wrap: wrap;
}

.qa-btn {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-md);
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: all var(--transition-fast);
  color: var(--text-secondary);
}

[data-theme='dark'] .qa-btn,
[data-theme='auto'] .qa-btn {
  background: transparent;
  border-color: var(--border-subtle);
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
  font-family: var(--font-heading);
  letter-spacing: 1px;
}

.qa-btn:hover {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent);
}

.qa-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

[data-theme='dark'] .qa-btn.active,
[data-theme='auto'] .qa-btn.active {
  color: #0f1118;
  box-shadow: 0 0 8px var(--accent-glow);
}

.tag-input-row {
  display: flex;
  gap: var(--space-xs);
  margin-top: var(--space-xs);
}

.tag-input {
  flex: 1;
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  outline: none;
}

.tag-input:focus {
  border-color: var(--gray-600);
}

[data-theme='dark'] .tag-input,
[data-theme='auto'] .tag-input {
  background: var(--bg-secondary);
  border-color: var(--border-subtle);
  color: var(--text-primary);
}

.tag-add-btn {
  padding: var(--space-sm) var(--space-md);
  background: var(--gray-900);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  cursor: pointer;
}

[data-theme='dark'] .tag-add-btn,
[data-theme='auto'] .tag-add-btn {
  background: var(--accent);
  color: #0f1118;
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
}

.tag-preview {
  display: flex;
  gap: var(--space-xs);
  flex-wrap: wrap;
  margin-top: var(--space-xs);
}

.tag-chip {
  font-size: var(--text-xs);
  background: var(--bg-tertiary);
  color: var(--gray-700);
  padding: 2px var(--space-sm);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

[data-theme='dark'] .tag-chip,
[data-theme='auto'] .tag-chip {
  background: rgba(245, 197, 24, 0.12);
  border: 1px solid rgba(245, 197, 24, 0.3);
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
  color: #e8e6e1;
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 500;
}

.tag-chip-x {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: var(--text-sm);
  padding: 0;
  line-height: 1;
}

.summary {
  margin-top: var(--space-sm);
  padding-top: var(--space-sm);
  font-size: var(--text-xs);
  color: var(--text-muted);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

[data-theme='dark'] .summary,
[data-theme='auto'] .summary {
  font-family: var(--font-mono);
  letter-spacing: 0.5px;
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 3px;
}
</style>
