import { describe, expect, it, vi } from 'vitest';
import {
  flushOfflineQueueItems,
  normalizeOfflineQueueItem,
  type OfflineQueueItem,
} from '../composables/useSync';

function queueItem(type: OfflineQueueItem['type'], id: string): OfflineQueueItem {
  return { type, table: type === 'delete' ? 'daily_completions' : 'tasks', data: { id } };
}

describe('桌面端离线队列刷新', () => {
  it('恢复 Profile 后补齐启动竞态产生的空 profile_id', () => {
    const item: OfflineQueueItem = {
      type: 'upsert',
      table: 'tasks',
      data: { id: 'task-1', profile_id: null, user_id: 'expired-user' },
    };

    expect(normalizeOfflineQueueItem(item, 'profile-1', 'current-user')).toEqual({
      ...item,
      data: { id: 'task-1', profile_id: 'profile-1', user_id: 'current-user' },
    });
  });

  it('不覆盖已有任务的 Profile 归属', () => {
    const item: OfflineQueueItem = {
      type: 'upsert',
      table: 'tasks',
      data: { id: 'task-1', profile_id: 'profile-old', user_id: 'expired-user' },
    };

    expect(normalizeOfflineQueueItem(item, 'profile-new', 'current-user').data).toEqual({
      id: 'task-1',
      profile_id: 'profile-old',
      user_id: 'current-user',
    });
  });

  it('Supabase 返回 error 时保留对应队列项', async () => {
    const failed = queueItem('upsert', 'task-2');
    const execute = vi.fn(async (item: OfflineQueueItem) =>
      item.data.id === failed.data.id ? { error: new Error('RLS rejected') } : {},
    );

    const remaining = await flushOfflineQueueItems(
      [queueItem('upsert', 'task-1'), failed],
      execute,
    );

    expect(execute).toHaveBeenCalledTimes(2);
    expect(remaining).toEqual([failed]);
  });

  it('适配器抛出异常时保留对应队列项', async () => {
    const failed = queueItem('delete', 'daily-2');
    const remaining = await flushOfflineQueueItems(
      [queueItem('delete', 'daily-1'), failed],
      async (item) => {
        if (item.data.id === failed.data.id) throw new Error('network failed');
        return {};
      },
    );

    expect(remaining).toEqual([failed]);
  });

  it('部分成功时只返回失败项并保持原始顺序', async () => {
    const items = [
      queueItem('upsert', 'task-1'),
      queueItem('delete', 'daily-1'),
      queueItem('upsert', 'task-2'),
    ];

    const remaining = await flushOfflineQueueItems(items, async (item) => {
      if (item.data.id !== 'daily-1') return { error: new Error('temporary failure') };
      return {};
    });

    expect(remaining).toEqual([items[0], items[2]]);
  });

  it('失败项在下一次重试成功后可以被消费', async () => {
    const item = queueItem('upsert', 'task-retry');
    let attempts = 0;

    const firstAttempt = await flushOfflineQueueItems([item], async () => {
      attempts += 1;
      return { error: new Error('temporary failure') };
    });
    expect(firstAttempt).toEqual([item]);

    const secondAttempt = await flushOfflineQueueItems(firstAttempt, async () => {
      attempts += 1;
      return {};
    });

    expect(attempts).toBe(2);
    expect(secondAttempt).toEqual([]);
  });
});
