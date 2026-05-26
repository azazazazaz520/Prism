<script setup lang="ts">
import { ref, nextTick } from 'vue';
import DatePicker from './DatePicker.vue';

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
.task-input { margin-bottom: 16px; }

.input-row {
  display: flex;
  gap: 8px;
}

.task-input-field {
  flex: 1;
  padding: 10px 14px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s;
}

.task-input-field:focus { border-color: #4a90d9; }
.task-input-field.error { border-color: #e74c3c; }

.date-btn-wrapper { position: relative; }

.date-btn {
  padding: 10px;
  background: none;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  transition: border-color 0.2s;
}

.date-btn:hover, .date-btn.active { border-color: #4a90d9; }

.task-input-btn {
  padding: 10px 20px;
  background: #4a90d9;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.task-input-btn:hover { background: #357abd; }

.quick-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.qa-btn {
  padding: 4px 10px;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  color: #999;
}

.qa-btn:hover { border-color: #4a90d9; color: #4a90d9; }

.qa-btn.active {
  background: #e8f0fe;
  border-color: #4a90d9;
  color: #4a90d9;
}

.tag-input-row {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.tag-input {
  flex: 1;
  padding: 5px 10px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
}

.tag-input:focus { border-color: #4a90d9; }

.tag-add-btn {
  padding: 5px 12px;
  background: #4a90d9;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.tag-preview {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.tag-chip {
  font-size: 11px;
  background: #e8f0fe;
  color: #4a90d9;
  padding: 2px 8px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.tag-chip-x {
  background: none;
  border: none;
  color: #4a90d9;
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  line-height: 1;
}

.summary {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #f0f0f0;
  font-size: 12px;
  color: #999;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
