import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureOutboxReady,
  deliverNext,
  normalizeOperation,
  type QueueOperation,
} from '../composables/useOutbox';
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
  it('恢复身份时补齐空归属，并保留已有 Profile', () => {
    expect(normalizeOperation(operation, 'profile-1', 'uid').data.profile_id).toBe('profile-1');
    expect(
      normalizeOperation({ ...operation, data: { profile_id: 'old' } }, 'new', 'uid').data
        .profile_id,
    ).toBe('old');
  });

  it('保存导入结果前中断时保留原始键，重试后完成一次性转换', async () => {
    localStorage.setItem('prism_offline_queue', JSON.stringify([operation]));
    let saved = false;
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'get_task_snapshot') return { legacyQueueImported: saved };
      if (command === 'import_legacy_queue' && !saved) throw new Error('disk failed');
    });
    await expect(ensureOutboxReady()).rejects.toThrow('disk failed');
    expect(localStorage.getItem('prism_offline_queue')).not.toBeNull();
    saved = true;
    await ensureOutboxReady();
    expect(localStorage.getItem('prism_offline_queue')).toBeNull();
  });

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

  it('已保存完成标记时跳过残留键解析及重复导入', async () => {
    vi.resetModules();
    const { ensureOutboxReady: convert } = await import('../composables/useOutbox');
    localStorage.setItem('prism_offline_queue', 'invalid-json');
    mocks.invoke.mockResolvedValueOnce({ legacyQueueImported: true });
    await convert();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
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

  it('Supabase 返回 error 时释放领取且保留持久队列项', async () => {
    mocks.invoke.mockResolvedValueOnce(delivery).mockResolvedValueOnce(undefined);
    await expect(deliverNext(async () => ({ error: new Error('RLS rejected') }))).rejects.toThrow(
      'RLS rejected',
    );
    expect(mocks.invoke).toHaveBeenLastCalledWith('finish_outbox', {
      id: 'operation-1',
      token: 'claim-1',
      success: false,
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

  it('已有其他窗口领取时不发送请求', async () => {
    mocks.invoke.mockResolvedValueOnce(null);
    const execute = vi.fn();
    expect(await deliverNext(execute)).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
