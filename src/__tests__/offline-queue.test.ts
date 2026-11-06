import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverNext, type QueueOperation } from '../composables/useOutbox';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../diagnostics/invoke-logged', () => ({
  invokeWithDiagnostics: mocks.invoke,
  diagnosticsLogger: { warn: vi.fn() },
}));

const operation: QueueOperation = {
  type: 'delete',
  table: 'daily_completions',
  data: { task_id: 'task-1', date: '2026-10-13', profile_id: null },
};
const delivery = { token: 'claim-1', item: { ...operation, id: 'operation-1', sequence: 1 } };

beforeEach(() => {
  mocks.invoke.mockReset();
  localStorage.clear();
});

describe('共享发件箱', () => {
  it('一次性导入保存完整删除操作，成功后清理旧键', async () => {
    vi.resetModules();
    const { ensureOutboxReady: convert } = await import('../composables/useOutbox');
    localStorage.setItem('prism_offline_queue', JSON.stringify([operation]));
    mocks.invoke
      .mockResolvedValueOnce({ legacyQueueImported: false })
      .mockResolvedValueOnce(undefined);
    await Promise.all([convert(), convert()]);
    expect(mocks.invoke).toHaveBeenCalledWith('import_legacy_queue', { operations: [operation] });
    expect(
      mocks.invoke.mock.calls.filter(([command]) => command === 'import_legacy_queue'),
    ).toHaveLength(1);
    expect(localStorage.getItem('prism_offline_queue')).toBeNull();
  });

  it('只有发送成功后才确认对应操作 ID', async () => {
    mocks.invoke.mockResolvedValueOnce(delivery).mockResolvedValueOnce(undefined);
    const execute = vi.fn().mockResolvedValue({});
    expect(await deliverNext(execute)).toBe(true);
    expect(mocks.invoke).toHaveBeenLastCalledWith('finish_outbox', {
      id: 'operation-1',
      token: 'claim-1',
      success: true,
    });
  });

  it('网络抛出异常时保留当前项，下一次可以重试', async () => {
    mocks.invoke.mockResolvedValueOnce(delivery).mockResolvedValueOnce(undefined);
    await expect(
      deliverNext(async () => {
        throw new Error('network');
      }),
    ).rejects.toThrow('network');
    mocks.invoke.mockResolvedValueOnce(delivery).mockResolvedValueOnce(undefined);
    expect(await deliverNext(async () => ({}))).toBe(true);
  });
});
