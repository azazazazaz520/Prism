<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted } from 'vue';
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
const inputRef = ref<HTMLInputElement | null>(null);
const dateBtnRef = ref<HTMLElement | null>(null);

// ── 展开/收起 ──────────────────────────────
const expanded = ref(false);

function onInputFocus() {
  expanded.value = true;
}

function onClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest('.task-input')) {
    // 有内容或已选属性 → 保持展开；空输入 → 收起
    if (
      !title.value.trim() &&
      !dueDate.value &&
      tags.value.length === 0 &&
      !important.value &&
      !pinned.value &&
      !isDaily.value
    ) {
      expanded.value = false;
      showPicker.value = false;
      showTagInput.value = false;
    }
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside));
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside));

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
  showTagInput.value = false;
  // 提交后收起
  expanded.value = false;
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
    <!-- 输入行：始终可见 -->
    <div class="input-row">
      <input
        ref="inputRef"
        v-model="title"
        type="text"
        aria-label="新任务标题"
        placeholder="输入新任务..."
        :class="['task-input-field', { error: showError }]"
        @keydown.enter="handleSubmit"
        @focus="onInputFocus"
      />
    </div>

    <!-- 展开面板：聚焦后显示 -->
    <Transition name="expand">
      <div v-if="expanded" class="input-panel">
        <!-- 快捷属性按钮行 -->
        <div class="quick-actions">
          <button
            type="button"
            :class="['qa-btn', { active: important }]"
            :aria-pressed="important"
            aria-label="标记为重要"
            @click="important = !important"
          >
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
          </button>
          <button
            type="button"
            :class="['qa-btn', { active: pinned }]"
            :aria-pressed="pinned"
            aria-label="置顶任务"
            @click="pinned = !pinned"
          >
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
          </button>
          <button
            type="button"
            :class="['qa-btn', { active: isDaily }]"
            :aria-pressed="isDaily"
            aria-label="设置为每日任务"
            @click="isDaily = !isDaily"
          >
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
          </button>
          <button
            type="button"
            :class="['qa-btn', { active: showTagInput || tags.length > 0 }]"
            :aria-expanded="showTagInput"
            aria-label="编辑任务标签"
            @click="toggleTagInput"
          >
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
            标签
          </button>
          <div class="quick-actions-right">
            <div class="date-btn-wrapper">
              <button
                ref="dateBtnRef"
                type="button"
                :class="['qa-btn', 'date-btn', 'date-btn-inline', { active: dueDate }]"
                title="截止日期"
                :aria-expanded="showPicker"
                @click="showPicker = !showPicker"
              >
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
                <span class="date-label">{{ dueDate ? formatDueDate(dueDate) : '日期' }}</span>
              </button>
              <DatePicker :visible="showPicker" :anchor-el="dateBtnRef" @select="onDateSelect" />
            </div>
            <button type="button" class="task-input-btn" @click="handleSubmit">添加</button>
          </div>
        </div>

        <!-- 标签输入行 -->
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

        <!-- 标签预览 -->
        <div v-if="tags.length > 0" class="tag-preview">
          <span v-for="tag in tags" :key="tag" class="tag-chip">
            {{ tag }}
            <button class="tag-chip-x" @click="removeTag(tag)">×</button>
          </span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.task-input {
  position: relative;
}

/* ── 输入行 ──────────────────────────── */
.input-row {
  display: flex;
}

.task-input-field {
  flex: 1;
  min-width: 0;
  padding: 14px var(--space-xl);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  font-size: var(--text-base);
  outline: none;
  transition: all var(--transition-fast);
  background: var(--bg-primary);
  color: var(--text-primary);
}

.task-input-field::placeholder {
  color: var(--text-muted);
}

[data-theme='hud'] .task-input-field,
[data-theme='hud'] .task-input-field {
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

[data-theme='hud'] .task-input-field:focus,
[data-theme='hud'] .task-input-field:focus {
  border-color: var(--accent);
  box-shadow: 0 0 12px var(--accent-glow);
}

.task-input-field.error {
  border-color: var(--danger);
}

/* ── 展开面板 ────────────────────────── */
.input-panel {
  margin-top: var(--space-sm);
}

/* ── 展开/收起动画 ──────────────────── */
.expand-enter-active {
  animation: expand-in 0.2s ease-out;
}
.expand-leave-active {
  animation: expand-in 0.15s ease-in reverse;
}
@keyframes expand-in {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ── 快捷属性按钮 ────────────────────── */
.quick-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: center;
}

/* ── 标签输入 ────────────────────────── */
.qa-btn {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px var(--space-sm);
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-full);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition-fast);
  color: var(--text-secondary);
}

[data-theme='hud'] .qa-btn,
[data-theme='hud'] .qa-btn {
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
  color: var(--accent);
}

.qa-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.qa-btn.active:hover {
  color: #fff;
}

[data-theme='hud'] .qa-btn.active {
  color: #0f1118;
  box-shadow: 0 0 8px var(--accent-glow);
}

/* ── 标签输入 ────────────────────────── */
.tag-input-row {
  display: flex;
  gap: 3px;
  margin-top: var(--space-xs);
}

.tag-input {
  flex: 1;
  padding: 4px var(--space-sm);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: var(--text-xs);
  outline: none;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.tag-input:focus {
  border-color: var(--gray-600);
}

[data-theme='hud'] .tag-input,
[data-theme='hud'] .tag-input {
  background: var(--bg-secondary);
  border-color: var(--border-subtle);
}

.tag-add-btn {
  padding: 4px var(--space-md);
  background: var(--gray-900);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--text-xs);
  cursor: pointer;
}

[data-theme='hud'] .tag-add-btn {
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

/* ── 标签预览 ────────────────────────── */
.tag-preview {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
  margin-top: var(--space-xs);
}

.tag-chip {
  font-size: 10px;
  background: var(--bg-tertiary);
  color: var(--gray-700);
  padding: 1px var(--space-sm);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: 2px;
}

[data-theme='hud'] .tag-chip,
[data-theme='hud'] .tag-chip {
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

/* ── 快捷行右侧组 ────────────────────── */
.quick-actions-right {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-left: auto;
}

.date-btn-wrapper {
  position: relative;
  display: flex;
}

.date-btn-inline {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px var(--space-sm);
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-full);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition-fast);
  color: var(--text-secondary);
}

.date-btn-inline:hover {
  border-color: var(--accent);
  color: var(--accent);
}

[data-theme='hud'] .date-btn-inline {
  background: transparent;
  border-color: var(--border-subtle);
  border-radius: 0;
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

[data-theme='hud'] .date-btn-inline.active {
  background: var(--accent-glow-s);
  border-color: var(--accent);
  color: var(--accent);
  box-shadow: 0 0 12px var(--accent-glow);
}

.date-label {
  font-family: var(--font-heading);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  white-space: nowrap;
}

/* ── 添加按钮 ────────────────────────── */
.task-input-btn {
  padding: 10px var(--space-xl);
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-full);
  font-family: var(--font-heading);
  font-size: var(--text-base);
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

[data-theme='hud'] .task-input-btn {
  color: #0f1118;
  border-radius: 0;
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
    0 0 12px var(--accent-glow);
}

.task-input-btn:hover {
  background: var(--accent-hover);
}

[data-theme='hud'] .task-input-btn:hover {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.2),
    0 0 24px var(--accent-glow);
}
</style>
