import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { sendOutboxOperation } from '../composables/useSync';

describe('发件箱远端写入', () => {
  it('延迟重放旧任务时保留远端新版本，相同版本重复发送保持幂等', async () => {
    let remote = { id: 'task', title: '远端新标题', updated_at: '2026-10-13T10:00:00Z' };
    const client = createClient('https://outbox-test.invalid', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'outbox-task-test' },
      global: {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (init?.method === 'GET') return Response.json([{ updated_at: remote.updated_at }]);
          const incoming = JSON.parse(String(init?.body)) as typeof remote;
          if (init?.method === 'PATCH') {
            const maximum = url.searchParams.get('updated_at')?.replace('lte.', '');
            if (!maximum) throw new Error('缺少更新时间条件');
            if (Date.parse(remote.updated_at) <= Date.parse(maximum)) {
              remote = incoming;
              return Response.json([{ id: remote.id, updated_at: remote.updated_at }]);
            }
            return Response.json([]);
          }
          return new Response(null, { status: 204 });
        },
      },
    });
    const signal = new AbortController().signal;
    await sendOutboxOperation(
      client,
      {
        type: 'upsert',
        table: 'tasks',
        data: { id: 'task', title: '旧标题', updated_at: '2026-10-13T09:00:00Z' },
      },
      signal,
    );
    expect(remote.title).toBe('远端新标题');
    const latest = { id: 'task', title: '最新标题', updated_at: '2026-10-13T11:00:00Z' };
    await sendOutboxOperation(client, { type: 'upsert', table: 'tasks', data: latest }, signal);
    await sendOutboxOperation(client, { type: 'upsert', table: 'tasks', data: latest }, signal);
    expect(remote).toEqual(latest);
    const next = { ...latest, title: '后续离线修改', updated_at: '2026-10-13T11:05:00Z' };
    await sendOutboxOperation(client, { type: 'upsert', table: 'tasks', data: next }, signal);
    expect(remote).toEqual(next);
  });

  it('条件更新未匹配且远端没有更新版本时保留操作', async () => {
    const client = createClient('https://outbox-test.invalid', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'outbox-unmatched-test' },
      global: {
        fetch: async (_input, init) =>
          init?.method === 'POST' ? new Response(null, { status: 204 }) : Response.json([]),
      },
    });
    await expect(
      sendOutboxOperation(
        client,
        {
          type: 'upsert',
          table: 'tasks',
          data: { id: 'task', title: '离线修改', updated_at: '2026-10-13T10:00:00Z' },
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('远端任务尚未确认写入');
  });
});
