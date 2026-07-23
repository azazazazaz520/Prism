import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYNC_TIMEOUT_MS, withTimeout } from '../composables/syncUtils';

describe('同步请求超时', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('统一使用 10 秒超时', async () => {
    vi.useFakeTimers();
    const pending = new Promise<never>(() => {});
    const result = withTimeout(pending);

    vi.advanceTimersByTime(SYNC_TIMEOUT_MS);

    await expect(result).rejects.toThrow('timeout');
    expect(SYNC_TIMEOUT_MS).toBe(10_000);
  });
});
