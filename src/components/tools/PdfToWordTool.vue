<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { open, save as saveFile } from '@tauri-apps/plugin-dialog';
import { usePdfToWord } from '../../composables/usePdfToWord';

const {
  config,
  job,
  errorMessage,
  isLoading,
  isSaving,
  loadConfig,
  createJob,
  cancelJob,
  downloadResult,
  resetJob,
} = usePdfToWord();

const selectedPath = ref('');
const isSelecting = ref(false);
const localMessage = ref('');

const selectedName = computed(() => {
  const parts = selectedPath.value.split(/[\\/]/);
  return parts[parts.length - 1] || '';
});

const isSucceeded = computed(() => job.value?.status === 'succeeded');
const isTerminal = computed(() =>
  ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(job.value?.status ?? ''),
);
const configurationNotice = computed(() => {
  if (!config.value.baseUrl) return '请先在设置的“偏好设置”中填写 PDF 转 Word 服务地址和令牌。';
  if (!config.value.configured)
    return '服务地址已保存，但访问令牌尚未配置，请先返回设置页保存令牌。';
  return '';
});

const statusLabel = computed(() => {
  switch (job.value?.status) {
    case 'queued':
      return '排队中';
    case 'processing':
      return '转换中';
    case 'succeeded':
      return '转换完成';
    case 'failed':
      return '转换失败';
    case 'cancelled':
      return '已取消';
    case 'timed_out':
      return '处理超时';
    default:
      return '';
  }
});

const statusMessage = computed(() => errorMessage.value || job.value?.error || '');

async function choosePdf() {
  if (isSelecting.value || isLoading.value) return;
  isSelecting.value = true;
  localMessage.value = '';
  try {
    const selected = await open({
      multiple: false,
      directory: false,
      title: '选择待转换的 PDF 文件',
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    });
    if (typeof selected !== 'string') return;
    selectedPath.value = selected;
    resetJob();
  } catch {
    localMessage.value = '打开文件选择器失败';
  } finally {
    isSelecting.value = false;
  }
}

async function submit() {
  if (!selectedPath.value || !config.value.configured) return;
  localMessage.value = '';
  try {
    await createJob(selectedPath.value);
  } catch {
    // 错误信息由 composable 提供给界面。
  }
}

async function cancel() {
  try {
    await cancelJob();
  } catch {
    // 错误信息由 composable 提供给界面。
  }
}

async function saveResult() {
  if (!job.value || !isSucceeded.value) return;
  localMessage.value = '';
  const defaultName = selectedName.value.replace(/\.pdf$/i, '') || 'converted';
  try {
    const outputPath = await saveFile({
      title: '保存 Word 文件',
      defaultPath: `${defaultName}.docx`,
      filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    });
    if (!outputPath) return;
    await downloadResult(outputPath);
    localMessage.value = 'Word 文件已保存';
  } catch {
    // 错误信息由 composable 提供给界面。
  }
}

onMounted(() => {
  void loadConfig();
});
</script>

<template>
  <div class="pdf-tool">
    <div v-if="configurationNotice" class="pdf-notice">
      <div class="pdf-notice-title">需要完成配置</div>
      <p>{{ configurationNotice }}</p>
    </div>

    <section class="pdf-panel">
      <div class="pdf-panel-heading">
        <div>
          <h3>PDF 转 Word</h3>
          <p>调用远程服务转换 PDF，完成后下载可编辑的 Word 文档。</p>
        </div>
        <span v-if="config.configured" class="pdf-configured">服务已配置</span>
      </div>

      <button class="pdf-file-picker" type="button" :disabled="isSelecting" @click="choosePdf">
        <span class="pdf-file-icon" aria-hidden="true">PDF</span>
        <span class="pdf-file-copy">
          <strong>{{ selectedName || '选择 PDF 文件' }}</strong>
          <small>{{ selectedName ? '点击重新选择文件' : '仅支持 PDF 格式' }}</small>
        </span>
        <span class="pdf-file-action">{{ isSelecting ? '打开中…' : '选择' }}</span>
      </button>

      <div v-if="job" class="pdf-progress" aria-live="polite">
        <div class="pdf-progress-heading">
          <span>{{ statusLabel }}</span>
          <span>{{ job.progress }}%</span>
        </div>
        <div class="pdf-progress-track">
          <div class="pdf-progress-value" :style="{ width: `${job.progress}%` }" />
        </div>
        <div class="pdf-meta">
          <span v-if="job.pageCount">{{ job.pageCount }} 页</span>
          <span v-if="job.tableCount">{{ job.tableCount }} 个表格</span>
          <span v-if="job.route">{{ job.route }}</span>
        </div>
      </div>

      <p v-if="statusMessage" class="pdf-message" role="alert">{{ statusMessage }}</p>
      <p v-if="localMessage" class="pdf-success" role="status">{{ localMessage }}</p>

      <div class="pdf-actions">
        <button
          v-if="!job"
          class="pdf-primary"
          type="button"
          :disabled="!selectedPath || !config.configured || isLoading"
          @click="submit"
        >
          {{ isLoading ? '提交中…' : '开始转换' }}
        </button>
        <button
          v-if="job && !isTerminal"
          class="pdf-secondary"
          type="button"
          :disabled="isLoading"
          @click="cancel"
        >
          取消任务
        </button>
        <button
          v-if="isSucceeded"
          class="pdf-primary"
          type="button"
          :disabled="isSaving"
          @click="saveResult"
        >
          {{ isSaving ? '保存中…' : '保存 Word 文件' }}
        </button>
        <button v-if="job && isTerminal" class="pdf-secondary" type="button" @click="resetJob">
          重新转换
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pdf-tool {
  max-width: 680px;
  padding: var(--space-xl) var(--space-2xl) var(--space-2xl);
  color: var(--text-primary);
}

.pdf-notice {
  padding: var(--space-md) var(--space-lg);
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border-light));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent) 7%, var(--bg-secondary));
  margin-bottom: var(--space-lg);
}

.pdf-notice-title {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
}

.pdf-notice p,
.pdf-panel-heading p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1.6;
}

.pdf-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.pdf-panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
}

.pdf-panel-heading h3 {
  margin: 0;
  font-size: var(--text-lg);
}

.pdf-configured {
  flex-shrink: 0;
  padding: 4px 9px;
  border-radius: var(--radius-full);
  color: var(--success, #2e9b68);
  background: color-mix(in srgb, var(--success, #2e9b68) 12%, transparent);
  font-size: var(--text-xs);
}

.pdf-file-picker {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  width: 100%;
  padding: var(--space-lg);
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  background: var(--bg-secondary);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast);
}

.pdf-file-picker:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.pdf-file-picker:disabled {
  cursor: wait;
  opacity: 0.7;
}

.pdf-file-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: var(--radius-md);
  color: var(--accent);
  background: var(--accent-bg);
  font-size: 10px;
  font-weight: 700;
}

.pdf-file-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.pdf-file-copy strong {
  overflow: hidden;
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pdf-file-copy small,
.pdf-meta {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.pdf-file-action {
  color: var(--accent);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
}

.pdf-progress {
  padding: var(--space-md) var(--space-lg);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
}

.pdf-progress-heading,
.pdf-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}

.pdf-progress-heading {
  margin-bottom: var(--space-sm);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
}

.pdf-progress-track {
  height: 6px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--border-light);
}

.pdf-progress-value {
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 300ms ease;
}

.pdf-meta {
  justify-content: flex-start;
  margin-top: var(--space-sm);
}

.pdf-message,
.pdf-success {
  margin: 0;
  font-size: var(--text-sm);
  line-height: 1.5;
}

.pdf-message {
  color: var(--danger, #c44747);
}

.pdf-success {
  color: var(--success, #2e9b68);
}

.pdf-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.pdf-primary,
.pdf-secondary {
  min-height: 34px;
  padding: 0 var(--space-lg);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  cursor: pointer;
}

.pdf-primary {
  border: 1px solid var(--accent);
  color: var(--accent-contrast, #fff);
  background: var(--accent);
}

.pdf-secondary {
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  background: var(--bg-primary);
}

.pdf-primary:disabled,
.pdf-secondary:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>
