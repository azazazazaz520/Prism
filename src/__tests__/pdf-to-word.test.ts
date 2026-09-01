import { afterEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('../diagnostics/invoke-logged', () => ({
  invokeWithDiagnostics: invokeMock,
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
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'pdf_to_word_get_job', { jobId: 'job-1' });
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'pdf_to_word_get_job', { jobId: 'job-1' });
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
});
