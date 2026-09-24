import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';

const { invokeMock, accessTokenMock, openMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  accessTokenMock: vi.fn().mockResolvedValue('test-jwt'),
  openMock: vi.fn(),
}));

vi.mock('../diagnostics/invoke-logged', () => ({
  invokeWithDiagnostics: invokeMock,
}));

vi.mock('../composables/useAuth', () => ({
  useAuth: () => ({ getAccessToken: accessTokenMock }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: openMock,
  save: vi.fn(),
}));

import { usePdfToWord } from '../composables/usePdfToWord';
import PdfToWordTool from '../components/tools/PdfToWordTool.vue';

const job = (status: 'queued' | 'processing' | 'succeeded') => ({
  jobId: 'job-1',
  filename: 'sample.pdf',
  status,
  progress: status === 'queued' ? 0 : status === 'processing' ? 50 : 100,
  route: 'text',
  routeReason: null,
  tableCount: 0,
  pageCount: 1,
  error: null,
  createdAt: null,
  startedAt: null,
  finishedAt: null,
});

describe('usePdfToWord', () => {
  let mountedApp: App<Element> | null = null;

  afterEach(() => {
    mountedApp?.unmount();
    mountedApp = null;
    document.body.innerHTML = '';
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    invokeMock.mockReset();
    openMock.mockReset();
    accessTokenMock.mockReset();
    accessTokenMock.mockResolvedValue('test-jwt');
  });

  it('创建任务后轮询，并在终态停止', async () => {
    vi.useFakeTimers();
    invokeMock
      .mockResolvedValueOnce(job('queued'))
      .mockResolvedValueOnce(job('processing'))
      .mockResolvedValueOnce(job('succeeded'));
    const state = usePdfToWord();

    await state.createJob('C:\\sample.pdf');
    expect(state.job.value?.status).toBe('queued');

    await vi.advanceTimersByTimeAsync(1500);
    expect(state.job.value?.status).toBe('processing');
    await vi.advanceTimersByTimeAsync(1500);
    expect(state.job.value?.status).toBe('succeeded');

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'pdf_to_word_create_job', {
      inputPath: 'C:\\sample.pdf',
      authToken: 'test-jwt',
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'pdf_to_word_get_job', {
      jobId: 'job-1',
      authToken: 'test-jwt',
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'pdf_to_word_get_job', {
      jobId: 'job-1',
      authToken: 'test-jwt',
    });
  });

  it('组件卸载前重置任务时会停止后续轮询', async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValueOnce(job('queued'));
    const state = usePdfToWord();

    await state.createJob('C:\\sample.pdf');
    state.resetJob();
    await vi.advanceTimersByTimeAsync(1500);

    expect(state.job.value).toBeNull();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('临时网络失败后按退避间隔继续查询并清除旧错误', async () => {
    vi.useFakeTimers();
    invokeMock
      .mockResolvedValueOnce(job('queued'))
      .mockRejectedValueOnce('PDF_TO_WORD_NETWORK: 无法连接 PDF 转 Word 服务')
      .mockResolvedValueOnce(job('succeeded'));
    const state = usePdfToWord();

    await state.createJob('C:\\sample.pdf');
    await vi.advanceTimersByTimeAsync(1500);
    expect(state.errorMessage.value).toContain('无法连接');
    await vi.advanceTimersByTimeAsync(3000);

    expect(state.job.value?.status).toBe('succeeded');
    expect(state.errorMessage.value).toBe('');
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });

  it('身份错误后停止轮询', async () => {
    vi.useFakeTimers();
    invokeMock
      .mockResolvedValueOnce(job('queued'))
      .mockRejectedValueOnce('PDF_TO_WORD_AUTH_INVALID: 服务访问令牌无效');
    const state = usePdfToWord();

    await state.createJob('C:\\sample.pdf');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(state.errorMessage.value).toContain('令牌无效');
  });

  it('取消请求失败时恢复当前任务轮询', async () => {
    vi.useFakeTimers();
    invokeMock
      .mockResolvedValueOnce(job('queued'))
      .mockRejectedValueOnce('PDF_TO_WORD_NETWORK: 无法连接 PDF 转 Word 服务')
      .mockResolvedValueOnce(job('processing'));
    const state = usePdfToWord();

    await state.createJob('C:\\sample.pdf');
    await expect(state.cancelJob()).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(1500);

    expect(state.job.value?.status).toBe('processing');
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'pdf_to_word_cancel_job', {
      jobId: 'job-1',
      authToken: 'test-jwt',
    });
    state.resetJob();
  });

  it('选择新文件前取消仍在处理的远程任务', async () => {
    openMock.mockResolvedValueOnce('C:\\old.pdf').mockResolvedValueOnce('C:\\new.pdf');
    invokeMock
      .mockResolvedValueOnce({ baseUrl: 'https://example.com', configured: true })
      .mockResolvedValueOnce(job('queued'))
      .mockResolvedValueOnce({ ...job('queued'), status: 'cancelled' });
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountedApp = createApp(PdfToWordTool);
    mountedApp.mount(host);

    const picker = host.querySelector<HTMLButtonElement>('.pdf-file-picker')!;
    picker.click();
    await vi.waitFor(() => expect(picker.textContent).toContain('old.pdf'));
    host.querySelector<HTMLButtonElement>('.pdf-primary')!.click();
    await vi.waitFor(() => expect(host.querySelector('.pdf-progress')).not.toBeNull());
    picker.click();
    await vi.waitFor(() => expect(picker.textContent).toContain('new.pdf'));

    expect(invokeMock).toHaveBeenNthCalledWith(3, 'pdf_to_word_cancel_job', {
      jobId: 'job-1',
      authToken: 'test-jwt',
    });
    expect(host.querySelector('.pdf-progress')).toBeNull();
  });
});
