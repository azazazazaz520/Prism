<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted, nextTick } from 'vue';
import {
  diagnosticsLogger,
  invokeWithDiagnostics as invoke,
} from '../../diagnostics/invoke-logged';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit, listen } from '@tauri-apps/api/event';
import { initTheme } from '../../composables/useTheme';
import type {
  AddTasksBatchResult,
  ImportDraft,
  ImportSource,
  OcrResult,
  ParsedTask,
  ScreenshotCapturePayload,
} from '../../types';

/**
 * 导入悬浮窗 — 从剪贴板截图或聊天记录文本中批量提取任务。
 * 管线：粘贴内容 → AI 解析 → 任务列表预览 → 确认导入。
 */

// ── 扩展 ParsedTask：加入前端选择状态 ──────────────
interface CandidateTask extends ParsedTask {
  selected: boolean;
  expanded: boolean;
}

type CandidateField = 'title' | 'due_date';

interface CandidateFieldError {
  candidateIndex: number;
  field: CandidateField;
  message: string;
}

// ── 导入草稿 ──────────────────────────────
function createDraft(): ImportDraft {
  return {
    source: 'text',
    text: '',
    screenshotText: '',
    screenshot: null,
    ocr: {
      status: 'idle',
      result: null,
      message: '',
    },
  };
}

const draft = reactive<ImportDraft>(createDraft());
const parsing = ref(false);
const adding = ref(false);
const success = ref('');
const candidates = ref<CandidateTask[]>([]);
const error = ref('');
const sourceRevision = ref(0);
const parsedRevision = ref<number | null>(null);
const parseAttempted = ref(false);
const candidateFieldError = ref<CandidateFieldError | null>(null);

const activeText = computed({
  get: () => (draft.source === 'text' ? draft.text : draft.screenshotText),
  set: (value: string) => {
    const current = draft.source === 'text' ? draft.text : draft.screenshotText;
    if (value === current) return;
    if (draft.source === 'text') draft.text = value;
    else draft.screenshotText = value;
    markSourceChanged();
  },
});

const screenshotImage = computed(() => draft.screenshot?.image_base64 || '');
const ocrStatusLabel = computed(() => {
  switch (draft.ocr.status) {
    case 'processing':
      return '识别中…';
    case 'success':
      return '识别完成';
    case 'unavailable':
      return '识别引擎不可用';
    case 'error':
      return '识别失败';
    default:
      return '等待识别';
  }
});

function resetDraft() {
  Object.assign(draft, createDraft());
  sourceRevision.value = 0;
  parsedRevision.value = null;
  parseAttempted.value = false;
  candidateFieldError.value = null;
}

function markSourceChanged() {
  sourceRevision.value += 1;
  parseAttempted.value = false;
  candidateFieldError.value = null;
  success.value = '';
}

function clearCandidateState() {
  candidates.value = [];
  parsedRevision.value = null;
  parseAttempted.value = false;
  candidateFieldError.value = null;
}

function getErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function isScreenshotCapturePayload(value: unknown): value is ScreenshotCapturePayload {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    data.source === 'region' &&
    typeof data.image_base64 === 'string' &&
    typeof data.width === 'number' &&
    typeof data.height === 'number'
  );
}

function checkScreenshot() {
  const win = window as Window & { __screenshotResult?: unknown };
  const data = win.__screenshotResult;
  if (data === undefined) return;
  delete win.__screenshotResult;

  if (!isScreenshotCapturePayload(data)) {
    error.value = '截图数据无效，请重新截图。';
    return;
  }

  draft.source = 'screenshot';
  draft.screenshotText = data.text;
  draft.screenshot = data;
  draft.ocr = { status: 'idle', result: null, message: '' };
  markSourceChanged();
  clearCandidateState();
  error.value = '';
}

function clearScreenshot() {
  draft.source = 'screenshot';
  draft.screenshot = null;
  draft.screenshotText = '';
  draft.ocr = { status: 'idle', result: null, message: '' };
  markSourceChanged();
  clearCandidateState();
  error.value = '';
}

function selectSource(source: ImportSource) {
  if (draft.source === source) return;
  draft.source = source;
  markSourceChanged();
  error.value = '';
}

async function recognizeScreenshot() {
  if (!draft.screenshot || draft.ocr.status === 'processing') return;
  draft.ocr = { status: 'processing', result: null, message: '' };
  error.value = '';
  try {
    const result = await invoke<OcrResult>('ocr_image', {
      imageBase64: draft.screenshot.image_base64,
    });
    draft.screenshotText = result.text;
    markSourceChanged();
    draft.ocr = {
      status: 'success',
      result,
      message: result.warnings.join('；'),
    };
  } catch (value) {
    const message = getErrorMessage(value);
    const unavailable = message.includes('尚未配置') || message.includes('不可用');
    draft.ocr = {
      status: unavailable ? 'unavailable' : 'error',
      result: null,
      message,
    };
  }
}

const allSelected = computed(
  () => candidates.value.length > 0 && candidates.value.every((c) => c.selected),
);
const selectedCount = computed(() => candidates.value.filter((c) => c.selected).length);
const candidatesStale = computed(
  () => candidates.value.length > 0 && parsedRevision.value !== sourceRevision.value,
);

onMounted(async () => {
  document.documentElement.style.background = 'transparent';
  document.documentElement.style.overflow = 'hidden';
  document.body.style.margin = '0';
  document.body.style.padding = '0';
  document.body.style.background = 'transparent';
  document.body.style.overflow = 'hidden';

  // 加载主题（首次显示时自仓库读取）
  await initTheme();
  checkScreenshot();

  const appWindow = getCurrentWindow();
  unlistenFocus = await appWindow.listen('tauri://focus', () => {
    checkScreenshot();
  });
  // 监听主窗口主题变更
  unlistenTheme = await listen<string>('theme-changed', (event) => {
    document.documentElement.setAttribute('data-theme', event.payload);
  });
});

let unlistenFocus: (() => void) | null = null;
let unlistenTheme: (() => void) | null = null;
onUnmounted(() => {
  if (unlistenFocus) unlistenFocus();
  if (unlistenTheme) unlistenTheme();
});

// ── AI 解析 ──────────────────────────────
/** 将输入文本发送至 AI 解析（ai_parse_wechat 模式），返回候选任务列表 */
async function handleParse() {
  const trimmed = activeText.value.trim();
  if (!trimmed) {
    error.value =
      draft.source === 'screenshot' ? '请先识别文字或手动输入文字。' : '请先粘贴聊天记录。';
    return;
  }
  const requestRevision = sourceRevision.value;
  parsing.value = true;
  parseAttempted.value = false;
  error.value = '';
  try {
    const tasks = await invoke<ParsedTask[]>('ai_parse_wechat', { text: trimmed });
    if (requestRevision !== sourceRevision.value) {
      error.value = '内容已变化，请重新解析。';
      return;
    }
    candidates.value = tasks.map((t) => ({
      ...t,
      selected: true,
      expanded: false,
    }));
    parsedRevision.value = requestRevision;
    parseAttempted.value = true;
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

function clearCandidateFieldError(index: number, field: CandidateField) {
  const current = candidateFieldError.value;
  if (!current || current.candidateIndex !== index || current.field !== field) return;
  candidateFieldError.value = null;
  error.value = '';
}

function locateBatchFieldError(message: string, selected: CandidateTask[]): boolean {
  const match = message.match(/^第 (\d+) 项任务(标题为空|日期格式无效)$/);
  if (!match) return false;

  const selectedTask = selected[Number(match[1]) - 1];
  const candidateIndex = candidates.value.indexOf(selectedTask);
  if (!selectedTask || candidateIndex < 0) return false;

  const field: CandidateField = match[2] === '标题为空' ? 'title' : 'due_date';
  selectedTask.expanded = true;
  candidateFieldError.value = { candidateIndex, field, message };
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(
      `[data-candidate-index="${candidateIndex}"] [data-field="${field}"]`,
    );
    if (typeof input?.scrollIntoView === 'function') {
      input.scrollIntoView({ block: 'center' });
    }
    input?.focus();
  });
  return true;
}

function toggleAll() {
  const select = !allSelected.value;
  candidates.value.forEach((c) => (c.selected = select));
}

// ── 添加任务 ──────────────────────────────
/** 将勾选的候选任务通过原子批量命令写入主任务列表。 */
async function addSelectedTasks() {
  if (candidatesStale.value) {
    error.value = '原始内容已变化，请重新解析后再导入。';
    return;
  }
  const selected = candidates.value.filter((c) => c.selected);
  if (selected.length === 0) return;
  adding.value = true;
  error.value = '';
  candidateFieldError.value = null;
  try {
    const result = await invoke<AddTasksBatchResult>('add_tasks_batch', {
      args: {
        tasks: selected.map((task) => ({
          title: task.title,
          dueDate: task.due_date,
          tags: task.tags,
          important: task.important,
          pinned: task.pinned,
          isDaily: task.is_daily,
        })),
      },
    });
    success.value = `已导入 ${result.created.length} 项任务`;

    try {
      await emit('tasks-imported', result.created);
    } catch (eventError) {
      diagnosticsLogger.warn('task', 'task.import_event_failed', '通知主窗口更新导入任务失败', {
        task_count: result.created.length,
        error: getErrorMessage(eventError),
      });
    }

    setTimeout(() => {
      void closeWindow();
    }, 1000);
  } catch (e: any) {
    const message = typeof e === 'string' ? e : e.message || '导入失败';
    error.value = message;
    locateBatchFieldError(message, selected);
  } finally {
    adding.value = false;
  }
}

// ── 关闭窗口 ──────────────────────────────
async function closeWindow() {
  if (adding.value) return;
  await invoke('hide_import_window');
  resetDraft();
  candidates.value = [];
  error.value = '';
  success.value = '';
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
      <span class="topbar-title">导入</span>
      <button class="close-btn" :disabled="adding" @click.stop="closeWindow">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <!-- 输入区 -->
    <div class="input-section">
      <div class="source-tabs" role="tablist" aria-label="导入方式">
        <button
          class="source-tab"
          :class="{ active: draft.source === 'text' }"
          type="button"
          role="tab"
          :aria-selected="draft.source === 'text'"
          :disabled="adding"
          @click="selectSource('text')"
        >
          粘贴文字
        </button>
        <button
          class="source-tab"
          :class="{ active: draft.source === 'screenshot' }"
          type="button"
          role="tab"
          :aria-selected="draft.source === 'screenshot'"
          :disabled="adding"
          @click="selectSource('screenshot')"
        >
          截图识别
        </button>
      </div>

      <div class="shortcut-hint" aria-label="区域截图快捷键">
        <span class="shortcut-hint-label">区域截图</span>
        <kbd>Ctrl+Alt+I</kbd>
        <span class="shortcut-hint-description">截取屏幕区域并识别文字</span>
      </div>

      <div v-if="draft.source === 'screenshot' && !screenshotImage" class="screenshot-empty">
        <div class="screenshot-empty-title">尚未载入截图</div>
        <div class="screenshot-empty-hint">按上方快捷键选择屏幕区域，或切换到“粘贴文字”。</div>
      </div>

      <div v-if="draft.source === 'screenshot' && screenshotImage" class="screenshot-preview">
        <img :src="'data:image/png;base64,' + screenshotImage" class="screenshot-img" />
        <button class="clear-screenshot-btn" :disabled="adding" @click="clearScreenshot">
          清除截图
        </button>
      </div>

      <div v-if="draft.source === 'screenshot' && screenshotImage" class="ocr-actions">
        <span class="ocr-status" :class="`status-${draft.ocr.status}`">
          {{ ocrStatusLabel }}
        </span>
        <button
          class="secondary-btn"
          type="button"
          :disabled="draft.ocr.status === 'processing' || adding"
          @click="recognizeScreenshot"
        >
          {{ draft.ocr.status === 'success' ? '重新识别' : '识别文字' }}
        </button>
      </div>
      <div
        v-if="draft.source === 'screenshot' && draft.ocr.message"
        class="ocr-message"
        :class="`message-${draft.ocr.status}`"
      >
        {{ draft.ocr.message }}
      </div>

      <textarea
        v-model="activeText"
        class="chat-textarea"
        :disabled="adding"
        :placeholder="
          draft.source === 'screenshot'
            ? '识别结果会显示在这里，也可以手动输入或修改...'
            : '在此粘贴聊天记录...'
        "
        rows="4"
      ></textarea>
      <div class="input-actions">
        <button
          class="parse-btn"
          :disabled="!activeText.trim() || parsing || adding"
          @click="handleParse"
        >
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
      <div v-else-if="parseAttempted && candidates.length === 0" class="empty-result-msg">
        未从这段文字中识别到任务，请修改内容后重新解析。
      </div>
    </div>

    <!-- 结果列表 -->
    <div v-if="candidates.length > 0" class="results-section">
      <div v-if="candidatesStale" class="stale-result-msg" role="status">
        原始内容已变化，请重新解析后再导入。
      </div>
      <div class="results-header">
        <span class="results-count">{{ candidates.length }} 项候选任务</span>
        <button class="toggle-all-btn" :disabled="candidatesStale || adding" @click="toggleAll">
          {{ allSelected ? '取消全选' : '全选' }}
        </button>
      </div>

      <div class="card-list">
        <div
          v-for="(task, i) in candidates"
          :key="i"
          :data-candidate-index="i"
          :class="[
            'card',
            {
              expanded: task.expanded,
              'has-error': candidateFieldError?.candidateIndex === i,
            },
          ]"
        >
          <div class="card-summary" @click="toggleExpand(i)">
            <input
              type="checkbox"
              :checked="task.selected"
              class="card-check"
              :disabled="candidatesStale || adding"
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

          <div v-if="task.expanded" class="card-detail">
            <div class="field">
              <label>标题</label>
              <input
                v-model="task.title"
                type="text"
                data-field="title"
                :class="[
                  'field-input',
                  {
                    'field-error':
                      candidateFieldError?.candidateIndex === i &&
                      candidateFieldError.field === 'title',
                  },
                ]"
                @input="clearCandidateFieldError(i, 'title')"
              />
              <span
                v-if="
                  candidateFieldError?.candidateIndex === i && candidateFieldError.field === 'title'
                "
                class="field-error-message"
              >
                {{ candidateFieldError.message }}
              </span>
            </div>
            <div class="field">
              <label>截止日期</label>
              <input
                v-model="task.due_date"
                type="date"
                data-field="due_date"
                :class="[
                  'field-input',
                  {
                    'field-error':
                      candidateFieldError?.candidateIndex === i &&
                      candidateFieldError.field === 'due_date',
                  },
                ]"
                @input="clearCandidateFieldError(i, 'due_date')"
              />
              <span
                v-if="
                  candidateFieldError?.candidateIndex === i &&
                  candidateFieldError.field === 'due_date'
                "
                class="field-error-message"
              >
                {{ candidateFieldError.message }}
              </span>
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
          :disabled="selectedCount === 0 || candidatesStale || adding || !!success"
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
          {{ adding ? '导入中...' : success ? '完成' : `添加到待办 (${selectedCount})` }}
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
  background: var(--bg-secondary);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  clip-path: inset(0 round var(--radius-lg));
  filter: drop-shadow(0 2px 16px rgba(0, 0, 0, 0.35));
  overflow: hidden;
  font-family: var(--font-sans);
  user-select: none;
  color: var(--text-primary);
}

/* ── 顶部栏 ────────────────────── */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--bg-hover);
  border-bottom: 1px solid var(--border-subtle);
  cursor: move;
  -webkit-app-region: drag;
}

.topbar-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.5px;
  font-family: var(--font-heading);
}

.close-btn {
  position: relative;
  z-index: 1;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  line-height: 1;
  -webkit-app-region: no-drag;
  transition:
    background-color var(--motion-duration-hover) var(--motion-ease-standard),
    color var(--motion-duration-hover) var(--motion-ease-standard);
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.close-btn:disabled,
.source-tab:disabled,
.clear-screenshot-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* ── 输入区 ────────────────────── */
.input-section {
  padding: 12px 14px;
  flex-shrink: 0;
}

.source-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: var(--space-sm);
  padding: 3px;
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.source-tab {
  flex: 1;
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: var(--text-sm);
  cursor: pointer;
  transition:
    background-color var(--motion-duration-hover) var(--motion-ease-standard),
    color var(--motion-duration-hover) var(--motion-ease-standard);
}

.source-tab:hover {
  color: var(--text-primary);
}

.source-tab.active {
  background: var(--bg-active);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

.shortcut-hint {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 28px;
  margin: calc(var(--space-sm) * -1) 0 var(--space-sm);
  padding: 0 4px;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.shortcut-hint-label {
  color: var(--text-secondary);
  font-weight: 600;
}

.shortcut-hint kbd {
  padding: 2px 6px;
  background: var(--bg-active);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.2;
  white-space: nowrap;
}

.shortcut-hint-description {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-textarea {
  width: 100%;
  min-height: 72px;
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--text-base);
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
  color: var(--text-disabled);
}

.chat-textarea:disabled {
  cursor: wait;
  opacity: 0.7;
}

/* ── 截图预览 ────────────────────── */
.screenshot-preview {
  position: relative;
  margin-bottom: var(--space-sm);
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 1px solid var(--border-subtle);
}

.screenshot-img {
  width: 100%;
  max-height: 180px;
  object-fit: contain;
  display: block;
  background: var(--bg-tertiary);
}

.screenshot-empty {
  padding: 18px 14px;
  margin-bottom: var(--space-sm);
  text-align: center;
  background: var(--bg-hover);
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-md);
}

.screenshot-empty-title {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.screenshot-empty-hint {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1.5;
}

.ocr-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}

.ocr-status {
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ocr-status.status-success {
  color: var(--success);
}

.ocr-status.status-unavailable,
.ocr-status.status-error {
  color: var(--warning);
}

.secondary-btn {
  flex-shrink: 0;
  padding: 6px 10px;
  background: var(--bg-active);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  cursor: pointer;
}

.secondary-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text-primary);
}

.secondary-btn:disabled {
  cursor: wait;
  opacity: 0.55;
}

.ocr-message {
  margin: calc(var(--space-sm) * -1) 0 var(--space-sm);
  font-size: var(--text-xs);
  line-height: 1.5;
}

.ocr-message.message-unavailable,
.ocr-message.message-error {
  color: var(--warning);
}

.ocr-message.message-success {
  color: var(--text-muted);
}

.clear-screenshot-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(0, 0, 0, 0.55);
  border: none;
  color: var(--text-secondary);
  font-size: 11px;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background-color var(--motion-duration-hover) var(--motion-ease-standard),
    color var(--motion-duration-hover) var(--motion-ease-standard);
}

.clear-screenshot-btn:hover {
  background: var(--danger);
  color: #fff;
}

.input-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-sm);
}

.parse-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--text-base);
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--motion-duration-hover) var(--motion-ease-standard),
    color var(--motion-duration-hover) var(--motion-ease-standard),
    opacity var(--motion-duration-hover) var(--motion-ease-standard);
  font-family: var(--font-heading);
  letter-spacing: 0.5px;
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
  animation: motion-spin var(--motion-duration-loading) linear infinite;
}

.error-msg {
  margin-top: var(--space-sm);
  font-size: var(--text-sm);
  color: var(--danger);
  padding: 6px 10px;
  background: var(--danger-light);
  border-radius: var(--radius-sm);
}

.empty-result-msg,
.stale-result-msg {
  padding: 7px 10px;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: 1.5;
}

.empty-result-msg {
  margin-top: var(--space-sm);
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.stale-result-msg {
  color: var(--warning);
  background: var(--warning-light);
  border-bottom: 1px solid var(--border-subtle);
}

/* ── 结果列表 ────────────────────── */
.results-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-top: 1px solid var(--border-subtle);
}

.results-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--bg-hover);
}

.results-count {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.toggle-all-btn {
  background: none;
  border: none;
  color: var(--accent);
  font-size: var(--text-xs);
  cursor: pointer;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  transition:
    background-color var(--motion-duration-hover) var(--motion-ease-standard),
    color var(--motion-duration-hover) var(--motion-ease-standard);
}

.toggle-all-btn:hover {
  background: var(--accent-muted);
}

.toggle-all-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.card-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 14px;
  scrollbar-width: thin;
  scrollbar-color: var(--border-default) transparent;
}

/* ── 卡片 ────────────────────── */
.card {
  margin-bottom: 4px;
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  transition:
    background-color var(--motion-duration-hover) var(--motion-ease-standard),
    border-color var(--motion-duration-hover) var(--motion-ease-standard);
  overflow: hidden;
}

.card:hover {
  background: var(--bg-active);
}

.card.expanded {
  background: var(--bg-active);
  border-color: var(--border-default);
}

.card.has-error {
  border-color: var(--danger);
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
  font-size: var(--text-base);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-date {
  font-size: var(--text-xs);
  color: var(--accent);
  white-space: nowrap;
  flex-shrink: 0;
}

.card-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
  flex-shrink: 0;
}

.card-badge.important {
  background: var(--warning-light);
  color: var(--warning);
}

.card-badge.tag {
  background: var(--accent-muted);
  color: var(--accent);
}

.expand-arrow {
  color: var(--text-disabled);
  flex-shrink: 0;
}

/* ── 展开编辑区 ────────────────────── */
.card-detail {
  padding: 6px 12px 10px 12px;
  border-top: 1px solid var(--border-subtle);
}

.field {
  margin-bottom: var(--space-sm);
}

.field label {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-bottom: 3px;
}

.field-input {
  width: 100%;
  padding: 6px 10px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: var(--text-sm);
  outline: none;
  font-family: var(--font-sans);
}

.field-input:focus {
  border-color: var(--accent);
}

.field-input.field-error {
  border-color: var(--danger);
}

.field-error-message {
  display: block;
  margin-top: 3px;
  color: var(--danger);
  font-size: var(--text-xs);
}

.field-row {
  display: flex;
  gap: 16px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
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
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-hover);
  flex-shrink: 0;
}

.selected-hint {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.success-hint {
  font-size: var(--text-sm);
  color: var(--success);
  font-weight: 500;
}

.add-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 18px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--text-base);
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--motion-duration-hover) var(--motion-ease-standard),
    color var(--motion-duration-hover) var(--motion-ease-standard),
    opacity var(--motion-duration-hover) var(--motion-ease-standard);
  font-family: var(--font-heading);
  letter-spacing: 0.5px;
}

.add-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.add-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* ═══════════════════════════════════════════
   HUD — data-theme="hud"
   ═══════════════════════════════════════════ */

[data-theme='hud'] .import-window {
  clip-path: var(--cut-corner);
  filter: none;
  box-shadow: var(--shadow-lg);
}

[data-theme='hud'] .parse-btn {
  border-radius: 0;
  clip-path: polygon(
    var(--cut-sm) 0%,
    100% 0%,
    100% calc(100% - var(--cut-sm)),
    calc(100% - var(--cut-sm)) 100%,
    0% 100%,
    0% var(--cut-sm)
  );
}

[data-theme='hud'] .add-btn {
  border-radius: 0;
  clip-path: polygon(
    var(--cut-sm) 0%,
    100% 0%,
    100% calc(100% - var(--cut-sm)),
    calc(100% - var(--cut-sm)) 100%,
    0% 100%,
    0% var(--cut-sm)
  );
}

[data-theme='hud'] .close-btn {
  border-radius: 0;
  clip-path: polygon(
    var(--cut-sm) 0%,
    100% 0%,
    100% calc(100% - var(--cut-sm)),
    calc(100% - var(--cut-sm)) 100%,
    0% 100%,
    0% var(--cut-sm)
  );
}

[data-theme='hud'] .chat-textarea {
  border-radius: 0;
  clip-path: polygon(
    var(--cut-sm) 0%,
    100% 0%,
    100% calc(100% - var(--cut-sm)),
    calc(100% - var(--cut-sm)) 100%,
    0% 100%,
    0% var(--cut-sm)
  );
}

[data-theme='hud'] .source-tabs,
[data-theme='hud'] .source-tab,
[data-theme='hud'] .secondary-btn,
[data-theme='hud'] .screenshot-empty,
[data-theme='hud'] .shortcut-hint kbd {
  border-radius: 0;
}

[data-theme='hud'] .source-tab.active {
  clip-path: var(--cut-corner);
}

[data-theme='hud'] .card {
  background: var(--bg-tertiary);
  border-color: var(--border-line);
}

[data-theme='hud'] .topbar {
  border-bottom-color: var(--border-line);
}

[data-theme='hud'] .results-section {
  border-top-color: var(--border-line);
}

[data-theme='hud'] .bottom-bar {
  border-top-color: var(--border-line);
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}
</style>
