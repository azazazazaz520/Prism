<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ParsedTask } from '../types';

// ── 扩展 ParsedTask：加入前端选择状态 ──────────────
interface CandidateTask extends ParsedTask {
  selected: boolean;
  expanded: boolean;
}

// ── 状态 ──────────────────────────────
const chatText = ref('');
const parsing = ref(false);
const adding = ref(false);
const success = ref('');
const candidates = ref<CandidateTask[]>([]);
const error = ref('');

// ── 截图模式 ──────────────────────────────
const screenshotImage = ref('');

function checkScreenshot() {
  const win = window as any;
  if (win.__screenshotResult) {
    const data = win.__screenshotResult;
    chatText.value = data.text || '';
    screenshotImage.value = data.image_base64 || '';
    if (data.error) {
      error.value = data.error;
    }
    delete win.__screenshotResult;
  }
}

function clearScreenshot() {
  screenshotImage.value = '';
  chatText.value = '';
}

const allSelected = computed(
  () => candidates.value.length > 0 && candidates.value.every((c) => c.selected),
);
const selectedCount = computed(() => candidates.value.filter((c) => c.selected).length);

onMounted(async () => {
  // 透明窗口
  document.documentElement.style.background = 'transparent';
  document.documentElement.style.overflow = 'hidden';
  document.body.style.margin = '0';
  document.body.style.padding = '0';
  document.body.style.background = 'transparent';
  document.body.style.overflow = 'hidden';

  checkScreenshot();

  const appWindow = getCurrentWindow();
  unlistenFocus = await appWindow.listen('tauri://focus', () => {
    checkScreenshot();
  });
});

let unlistenFocus: (() => void) | null = null;
onUnmounted(() => {
  if (unlistenFocus) unlistenFocus();
});

// ── AI 解析 ──────────────────────────────
async function handleParse() {
  const trimmed = chatText.value.trim();
  if (!trimmed) return;
  parsing.value = true;
  error.value = '';
  try {
    const tasks = await invoke<ParsedTask[]>('ai_parse_wechat', { text: trimmed });
    candidates.value = tasks.map((t) => ({
      ...t,
      selected: true,
      expanded: false,
    }));
  } catch (e: any) {
    error.value = typeof e === 'string' ? e : e.message || '解析失败';
  } finally {
    parsing.value = false;
  }
}

// ── 卡片操作 ──────────────────────────────
function toggleSelect(index: number) {
  candidates.value[index].selected = !candidates.value[index].selected;
}

function toggleExpand(index: number) {
  candidates.value[index].expanded = !candidates.value[index].expanded;
}

function toggleAll() {
  const select = !allSelected.value;
  candidates.value.forEach((c) => (c.selected = select));
}

// ── 添加任务 ──────────────────────────────
async function addSelectedTasks() {
  const selected = candidates.value.filter((c) => c.selected);
  if (selected.length === 0) return;
  adding.value = true;
  error.value = '';
  let added = 0;
  try {
    for (const t of selected) {
      await invoke('add_task', {
        args: {
          title: t.title,
          dueDate: t.due_date,
          tags: t.tags,
          important: t.important,
          pinned: t.pinned,
          isDaily: t.is_daily,
        },
      });
      added++;
    }
    success.value = `已添加 ${added} 项任务`;
    setTimeout(() => closeWindow(), 1000);
  } catch (e: any) {
    error.value = typeof e === 'string' ? e : e.message || '添加失败';
  } finally {
    adding.value = false;
  }
}

// ── 关闭窗口 ──────────────────────────────
async function closeWindow() {
  await invoke('hide_import_window');
  chatText.value = '';
  candidates.value = [];
  error.value = '';
  success.value = '';
  adding.value = false;
}

function formatDate(d: string | null): string {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${parseInt(m)}/${parseInt(day)}`;
}
</script>

<template>
  <div class="import-window">
    <!-- 顶部拖拽栏 -->
    <div class="topbar" data-tauri-drag-region>
      <span class="topbar-title">Import</span>
      <button class="close-btn" @click.stop="closeWindow">&times;</button>
    </div>

    <!-- 输入区 -->
    <div class="input-section">
      <!-- 截图预览 -->
      <div v-if="screenshotImage" class="screenshot-preview">
        <img :src="'data:image/png;base64,' + screenshotImage" class="screenshot-img" />
        <button class="clear-screenshot-btn" @click="clearScreenshot">清除截图</button>
      </div>
      <textarea
        v-model="chatText"
        class="chat-textarea"
        :placeholder="screenshotImage ? '截图已加载（可手动输入文本）...' : '在此粘贴聊天记录...'"
        rows="4"
      ></textarea>
      <div class="input-actions">
        <button class="parse-btn" :disabled="!chatText.trim() || parsing" @click="handleParse">
          <svg
            v-if="!parsing"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path
              d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
            />
          </svg>
          <span v-else class="spinner"></span>
          {{ parsing ? '解析中...' : 'AI 解析' }}
        </button>
      </div>
      <div v-if="error" class="error-msg">{{ error }}</div>
    </div>

    <!-- 结果列表 -->
    <div v-if="candidates.length > 0" class="results-section">
      <div class="results-header">
        <span class="results-count">{{ candidates.length }} 项候选任务</span>
        <button class="toggle-all-btn" @click="toggleAll">
          {{ allSelected ? '取消全选' : '全选' }}
        </button>
      </div>

      <div class="card-list">
        <div
          v-for="(task, i) in candidates"
          :key="i"
          :class="['card', { expanded: task.expanded }]"
        >
          <!-- 卡片摘要行 -->
          <div class="card-summary" @click="toggleExpand(i)">
            <input
              type="checkbox"
              :checked="task.selected"
              class="card-check"
              @click.stop
              @change="toggleSelect(i)"
            />
            <span class="card-title">{{ task.title }}</span>
            <span v-if="task.due_date" class="card-date">{{ formatDate(task.due_date) }}</span>
            <span v-if="task.important" class="card-badge important">重要</span>
            <span v-for="tag in task.tags" :key="tag" class="card-badge tag">{{ tag }}</span>
            <svg
              class="expand-arrow"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline :points="task.expanded ? '6 15 12 9 18 15' : '6 9 12 15 18 9'" />
            </svg>
          </div>

          <!-- 展开编辑区 -->
          <div v-if="task.expanded" class="card-detail">
            <div class="field">
              <label>标题</label>
              <input v-model="task.title" type="text" class="field-input" />
            </div>
            <div class="field">
              <label>截止日期</label>
              <input v-model="task.due_date" type="date" class="field-input" />
            </div>
            <div class="field">
              <label>标签（逗号分隔）</label>
              <input
                :value="task.tags.join(', ')"
                type="text"
                class="field-input"
                placeholder="工作, 学习"
                @input="
                  task.tags = ($event.target as HTMLInputElement).value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                "
              />
            </div>
            <div class="field-row">
              <label class="toggle-label">
                <input v-model="task.important" type="checkbox" />
                重要
              </label>
              <label class="toggle-label">
                <input v-model="task.pinned" type="checkbox" />
                置顶
              </label>
              <label class="toggle-label">
                <input v-model="task.is_daily" type="checkbox" />
                每日
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部操作栏 -->
      <div class="bottom-bar">
        <span v-if="success" class="success-hint">{{ success }}</span>
        <span v-else class="selected-hint">已选 {{ selectedCount }}/{{ candidates.length }}</span>
        <button
          class="add-btn"
          :disabled="selectedCount === 0 || adding || !!success"
          @click="addSelectedTasks"
        >
          <span v-if="adding" class="spinner"></span>
          <template v-else-if="success">
            <svg
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
          </template>
          {{ adding ? '添加中...' : success ? '完成' : `添加到待办 (${selectedCount})` }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.import-window {
  width: 400px;
  max-height: 560px;
  display: flex;
  flex-direction: column;
  background: rgba(22, 22, 28, 0.96);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  clip-path: inset(0 round 16px);
  filter: drop-shadow(0 2px 16px rgba(0, 0, 0, 0.35));
  overflow: hidden;
  font-family: var(--font-sans);
  user-select: none;
}

/* ── 顶部栏 ────────────────────── */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  cursor: move;
  -webkit-app-region: drag;
}

.topbar-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  letter-spacing: 0.5px;
}

.close-btn {
  position: relative;
  z-index: 1;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  font-size: 18px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1;
  -webkit-app-region: no-drag;
  transition: all 0.15s;
}
.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
}

/* ── 输入区 ────────────────────── */
.input-section {
  padding: 12px 14px;
  flex-shrink: 0;
}

.chat-textarea {
  width: 100%;
  min-height: 72px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.85);
  font-size: 13px;
  padding: 10px 12px;
  resize: vertical;
  outline: none;
  font-family: var(--font-sans);
  line-height: 1.5;
}
.chat-textarea:focus {
  border-color: var(--accent);
}
.chat-textarea::placeholder {
  color: rgba(255, 255, 255, 0.25);
}

/* ── 截图预览 ────────────────────── */
.screenshot-preview {
  position: relative;
  margin-bottom: 8px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.screenshot-img {
  width: 100%;
  max-height: 180px;
  object-fit: contain;
  display: block;
  background: rgba(0, 0, 0, 0.3);
}

.clear-screenshot-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(0, 0, 0, 0.6);
  border: none;
  color: rgba(255, 255, 255, 0.6);
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}
.clear-screenshot-btn:hover {
  background: rgba(231, 76, 60, 0.6);
  color: #fff;
}

.input-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.parse-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}
.parse-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}
.parse-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-msg {
  margin-top: 8px;
  font-size: 12px;
  color: var(--danger);
  padding: 6px 10px;
  background: rgba(243, 139, 168, 0.12);
  border-radius: 6px;
}

/* ── 结果列表 ────────────────────── */
.results-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.results-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.02);
}

.results-count {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

.toggle-all-btn {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
  transition: all 0.15s;
}
.toggle-all-btn:hover {
  background: rgba(45, 212, 191, 0.12);
}

.card-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 14px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
}

/* ── 卡片 ────────────────────── */
.card {
  margin-bottom: 4px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.2s;
  overflow: hidden;
}
.card:hover {
  background: rgba(255, 255, 255, 0.05);
}
.card.expanded {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
}

.card-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
}

.card-check {
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
  cursor: pointer;
  flex-shrink: 0;
}

.card-title {
  flex: 1;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-date {
  font-size: 11px;
  color: var(--accent);
  white-space: nowrap;
  flex-shrink: 0;
}

.card-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}
.card-badge.important {
  background: rgba(250, 179, 135, 0.2);
  color: var(--warning);
}
.card-badge.tag {
  background: rgba(45, 212, 191, 0.15);
  color: var(--accent);
}

.expand-arrow {
  color: rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
}

/* ── 展开编辑区 ────────────────────── */
.card-detail {
  padding: 6px 12px 10px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.field {
  margin-bottom: 8px;
}
.field label {
  display: block;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  margin-bottom: 3px;
}
.field-input {
  width: 100%;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 12px;
  outline: none;
  font-family: var(--font-sans);
}
.field-input:focus {
  border-color: var(--accent);
}

.field-row {
  display: flex;
  gap: 16px;
}
.toggle-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
}
.toggle-label input {
  accent-color: var(--accent);
}

/* ── 底部操作栏 ────────────────────── */
.bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  flex-shrink: 0;
}

.selected-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}

.success-hint {
  font-size: 12px;
  color: var(--success);
  font-weight: 500;
}

.add-btn {
  padding: 8px 18px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}
.add-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}
.add-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
