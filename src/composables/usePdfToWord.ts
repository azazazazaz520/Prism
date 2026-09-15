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
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);

function toMessage(error: unknown): string {
  return String(error)
    .replace(/^[A-Z0-9_]+:\s*/, '')
    .replace(/（HTTP \d+）$/, '')
    .trim();
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

  async function invokeWithServiceAuth<T>(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const authToken = await getAccessToken();
    return invoke<T>(command, { ...args, authToken });
  }

  function stopPolling() {
    pollGeneration += 1;
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

  function schedulePoll(jobId: string, generation: number) {
    pollTimer = setTimeout(() => {
      void pollJob(jobId, generation);
    }, POLL_DELAY_MS);
  }

  async function pollJob(jobId: string, generation: number) {
    if (generation !== pollGeneration) return;
    try {
      const current = await invokeWithServiceAuth<PdfToWordJob>('pdf_to_word_get_job', { jobId });
      if (generation !== pollGeneration) return;
      job.value = current;
      if (TERMINAL_STATUSES.has(current.status)) {
        pollTimer = null;
        return;
      }
      schedulePoll(jobId, generation);
    } catch (error) {
      if (generation !== pollGeneration) return;
      pollTimer = null;
      errorMessage.value = toMessage(error);
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
    stopPolling();
    isLoading.value = true;
    errorMessage.value = '';
    try {
      job.value = await invokeWithServiceAuth<PdfToWordJob>('pdf_to_word_cancel_job', {
        jobId: job.value.jobId,
      });
    } catch (error) {
      errorMessage.value = toMessage(error);
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
