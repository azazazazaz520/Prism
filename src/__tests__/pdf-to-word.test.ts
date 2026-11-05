import { afterEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, accessTokenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  accessTokenMock: vi.fn().mockResolvedValue('test-jwt'),
}));

vi.mock('../diagnostics/invoke-logged', () => ({
  invokeWithDiagnostics: invokeMock,
}));

vi.mock('../composables/useAuth', () => ({
  useAuth: () => ({ getAccessToken: accessTokenMock }),
}));

import { usePdfToWord } from '../composables/usePdfToWord';

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
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    invokeMock.mockReset();
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
});
