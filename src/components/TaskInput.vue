<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { ParsedTask } from '../types';
import DatePicker from './DatePicker.vue';

const props = defineProps<{
  aiEnabled?: boolean;
}>();

const emit = defineEmits<{
  add: [title: string, due_date: string | null, tags: string[], important: boolean, pinned: boolean, is_daily: boolean];
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
    setTimeout(() => { showError.value = false; }, 2000);
  } finally {
    aiParsing.value = false;
  }
}

function handleSubmit() {
  const trimmed = title.value.trim();
  if (!trimmed) {
    showError.value = true;
    setTimeout(() => { showError.value = false; }, 2000);
    return;
  }
  emit('add', trimmed, dueDate.value, [...tags.value], important.value, pinned.value, isDaily.value);
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
  tags.value = tags.value.filter(t => t !== tag);
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
          📅
        </button>
        <DatePicker
          :visible="showPicker"
          @select="onDateSelect"
        />
      </div>
      <button
        v-if="props.aiEnabled"
        :class="['ai-btn', { parsing: aiParsing }]"
        :disabled="aiParsing"
        title="AI 解析自然语言"
        @click="handleAiParse"
      >
        {{ aiParsing ? '…' : '✨' }}
      </button>
      <button class="task-input-btn" @click="handleSubmit">添加</button>
    </div>

    <div class="quick-actions">
      <button
        :class="['qa-btn', { active: important }]"
        @click="important = !important"
      >
        ⭐ 重要
      </button>
      <button
        :class="['qa-btn', { active: pinned }]"
        @click="pinned = !pinned"
      >
        📌 置顶
      </button>
      <button
        :class="['qa-btn', { active: isDaily }]"
        @click="isDaily = !isDaily"
      >
        ☀️ 每日
      </button>
      <button
        :class="['qa-btn', { active: showTagInput || tags.length > 0 }]"
        @click="toggleTagInput"
      >
        🏷 标签
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
      <span v-if="dueDate">📅 截止 {{ formatDueDate(dueDate) }}</span>
      <span v-if="important"> ⭐ 重要</span>
      <span v-if="pinned"> 📌 置顶</span>
      <span v-if="isDaily"> ☀️ 每日</span>
      <span v-if="tags.length > 0"> 🏷 {{ tags.join(', ') }}</span>
    </div>
  </div>
</template>

<style scoped>
.task-input { margin-bottom: 12px; }

.input-row {
  display: flex;
  gap: 6px;
}

.task-input-field {
  flex: 1;
  padding: 7px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}

.task-input-field:focus { border-color: #888; }
.task-input-field.error { border-color: #e74c3c; }

.date-btn-wrapper { position: relative; }

.date-btn {
  padding: 7px 8px;
  background: none;
  border: 1px solid #ddd;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  transition: border-color 0.2s;
}

.date-btn:hover, .date-btn.active { border-color: #888; }

.task-input-btn {
  padding: 7px 16px;
  background: #333;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.task-input-btn:hover { background: #555; }

.ai-btn {
  padding: 7px 8px;
  background: none;
  border: 1px solid #ddd;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  transition: all 0.2s;
}

.ai-btn:hover { border-color: #4a90d9; background: #f0f6ff; }
.ai-btn.parsing { opacity: 0.5; cursor: wait; }

.quick-actions {
  display: flex;
  gap: 4px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.qa-btn {
  padding: 3px 8px;
  background: none;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
  color: #999;
}

.qa-btn:hover { border-color: #888; color: #555; }

.qa-btn.active {
  background: #f5f5f5;
  border-color: #888;
  color: #333;
}

.tag-input-row {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}

.tag-input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 12px;
  outline: none;
}

.tag-input:focus { border-color: #888; }

.tag-add-btn {
  padding: 4px 10px;
  background: #333;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.tag-preview {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.tag-chip {
  font-size: 10px;
  background: #f0f0f0;
  color: #666;
  padding: 1px 6px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  gap: 3px;
}

.tag-chip-x {
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
  line-height: 1;
}

.summary {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid #f0f0f0;
  font-size: 11px;
  color: #999;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
