import { computed, onUnmounted, ref } from 'vue';
import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';
import { useAuth } from './useAuth';
import type {
  PdfToWordConfigStatus,
  PdfToWordDownloadResult,
  PdfToWordHealth,
  PdfToWordJob,
} from '../types';

const POLL_DELAY_MS = 1500;
const MAX_POLL_DELAY_MS = 30_000;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);
const TRANSIENT_POLL_ERRORS = new Set([
  'PDF_TO_WORD_NETWORK',
  'PDF_TO_WORD_TIMEOUT',
  'PDF_TO_WORD_SERVER_ERROR',
  'PDF_TO_WORD_QUEUE_FULL',
]);

function toMessage(error: unknown): string {
  return String(error)
    .replace(/^[A-Z0-9_]+:\s*/, '')
    .replace(/（HTTP \d+）$/, '')
    .trim();
}

function isTransientPollError(error: unknown): boolean {
  const code = String(error).match(/PDF_TO_WORD_[A-Z_]+/)?.[0];
  return code !== undefined && TRANSIENT_POLL_ERRORS.has(code);
}

/** 管理 PDF 转 Word 服务配置、远程任务轮询和结果下载。 */
export function usePdfToWord() {
  const { getAccessToken } = useAuth();
  const config = ref<PdfToWordConfigStatus>({ baseUrl: null, configured: false });
  const health = ref<PdfToWordHealth | null>(null);
  const job = ref<PdfToWordJob | null>(null);
  const errorMessage = ref('');
  const isLoading = ref(false);
  const isSaving = ref(false);

  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollGeneration = 0;
  let pollFailureCount = 0;

  async function invokeWithServiceAuth<T>(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const authToken = await getAccessToken();
    return invoke<T>(command, { ...args, authToken });
  }

  function stopPolling() {
    pollGeneration += 1;
    pollFailureCount = 0;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  async function loadConfig() {
    try {
      config.value = await invoke<PdfToWordConfigStatus>('pdf_to_word_get_config');
    } catch (error) {
      errorMessage.value = toMessage(error);
    }
  }

  async function checkHealth() {
    isLoading.value = true;
    errorMessage.value = '';
    try {
      health.value = await invokeWithServiceAuth<PdfToWordHealth>('pdf_to_word_check_health');
      return health.value;
    } catch (error) {
      health.value = null;
      errorMessage.value = toMessage(error);
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  function schedulePoll(jobId: string, generation: number, delay = POLL_DELAY_MS) {
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void pollJob(jobId, generation);
    }, delay);
  }

  async function pollJob(jobId: string, generation: number) {
    if (generation !== pollGeneration) return;
    try {
      const current = await invokeWithServiceAuth<PdfToWordJob>('pdf_to_word_get_job', { jobId });
      if (generation !== pollGeneration) return;
      job.value = current;
      pollFailureCount = 0;
      errorMessage.value = '';
      if (TERMINAL_STATUSES.has(current.status)) {
        return;
      }
      schedulePoll(jobId, generation);
    } catch (error) {
      if (generation !== pollGeneration) return;
      errorMessage.value = toMessage(error);
      if (!isTransientPollError(error)) return;
      pollFailureCount += 1;
      const delay = Math.min(POLL_DELAY_MS * 2 ** Math.min(pollFailureCount, 5), MAX_POLL_DELAY_MS);
      schedulePoll(jobId, generation, delay);
    }
  }

  async function createJob(inputPath: string) {
    stopPolling();
    isLoading.value = true;
    errorMessage.value = '';
    try {
      const created = await invokeWithServiceAuth<PdfToWordJob>('pdf_to_word_create_job', {
        inputPath,
      });
      job.value = created;
      const generation = pollGeneration;
      if (!TERMINAL_STATUSES.has(created.status)) {
        schedulePoll(created.jobId, generation);
      }
      return created;
    } catch (error) {
      errorMessage.value = toMessage(error);
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  async function cancelJob() {
    if (!job.value) return;
    const jobId = job.value.jobId;
    stopPolling();
    isLoading.value = true;
    errorMessage.value = '';
    try {
      job.value = await invokeWithServiceAuth<PdfToWordJob>('pdf_to_word_cancel_job', {
        jobId,
      });
      if (!TERMINAL_STATUSES.has(job.value.status)) schedulePoll(jobId, pollGeneration);
    } catch (error) {
      errorMessage.value = toMessage(error);
      if (job.value?.jobId === jobId && !TERMINAL_STATUSES.has(job.value.status)) {
        schedulePoll(jobId, pollGeneration);
      }
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  async function downloadResult(outputPath: string): Promise<PdfToWordDownloadResult> {
    if (!job.value || job.value.status !== 'succeeded') {
      throw new Error('PDF_TO_WORD_RESULT_UNAVAILABLE: 转换结果尚未就绪');
    }
    isSaving.value = true;
    errorMessage.value = '';
    try {
      return await invokeWithServiceAuth<PdfToWordDownloadResult>('pdf_to_word_download_result', {
        jobId: job.value.jobId,
        outputPath,
      });
    } catch (error) {
      errorMessage.value = toMessage(error);
      throw error;
    } finally {
      isSaving.value = false;
    }
  }

  function resetJob() {
    stopPolling();
    job.value = null;
    errorMessage.value = '';
  }

  onUnmounted(stopPolling);

  return {
    config,
    health,
    job,
    errorMessage,
    isLoading,
    isSaving,
    isConfigured: computed(() => config.value.configured),
    loadConfig,
    checkHealth,
    createJob,
    cancelJob,
    downloadResult,
    resetJob,
  };
}
