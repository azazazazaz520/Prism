import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import type { Task } from '../types';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: [] as Array<(event: { payload: number }) => void>,
}));
vi.mock('../diagnostics/invoke-logged', () => ({
  invokeWithDiagnostics: mocks.invoke,
  diagnosticsLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event: string, handler: (event: { payload: number }) => void) => {
    mocks.listeners.push(handler);
    return vi.fn();
  }),
}));
vi.mock('../composables/useAuth', () => ({
  useAuth: () => ({ isLoggedIn: ref(false), initAuth: vi.fn() }),
}));
vi.mock('../composables/useSyncCode', () => ({ useSyncCode: () => ({}) }));
vi.mock('../composables/useOutbox', () => ({
  ensureOutboxReady: vi.fn().mockResolvedValue(undefined),
  outboxCount: ref(0),
}));
vi.mock('../composables/useSync', () => ({
  useSync: () => ({ syncStatus: ref('offline'), getProfileId: () => null }),
}));

function task(): Task {
  return {
    id: 'task',
    title: '原标题',
    tags: [],
    completed: false,
    is_daily: false,
    pinned: false,
    important: false,
    due_date: null,
    created_at: '2026-10-13T00:00:00Z',
    updated_at: '2026-10-13T00:00:00Z',
    completed_at: null,
    parent_id: null,
    is_deleted: false,
  };
}

beforeEach(() => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.listeners.length = 0;
});

describe('独立窗口任务缓存', () => {
  it('旧窗口修改标签仅提交该字段，并通过通知恢复另一窗口的缓存', async () => {
    let revision = 1;
    let latest = task();
    mocks.invoke.mockImplementation(
      async (command: string, payload?: { args: Record<string, unknown> }) => {
        if (command === 'get_task_snapshot')
          return {
            revision,
            tasks: [structuredClone(latest)],
            dailyCompletions: [],
            outboxCount: 0,
          };
        if (command === 'update_task') {
          latest = { ...latest, ...payload!.args };
          revision++;
        }
      },
    );
    const first = (await import('../composables/useTaskStore')).useTaskStore();
    await first.loadAll();
    vi.resetModules();
    const second = (await import('../composables/useTaskStore')).useTaskStore();
    await second.loadAll();
    await first.updateTask('task', '新标题');
    expect(second.tasks.value[0].title).toBe('原标题');
    await second.updateTaskMeta('task', { tags: ['新标签'] });
    expect(mocks.invoke).toHaveBeenCalledWith('update_task', {
      args: { id: 'task', tags: ['新标签'] },
    });
    expect(latest.title).toBe('新标题');
    for (const listener of mocks.listeners) listener({ payload: revision });
    await nextTick();
    await nextTick();
    expect(first.tasks.value[0].tags).toEqual(['新标签']);
    expect(second.tasks.value[0].title).toBe('新标题');
  });

  it('完成状态操作提交明确目标状态', async () => {
    mocks.invoke.mockImplementation(async (command: string) =>
      command === 'get_task_snapshot'
        ? { revision: 1, tasks: [task()], dailyCompletions: [], outboxCount: 0 }
        : undefined,
    );
    const store = (await import('../composables/useTaskStore')).useTaskStore();
    await store.loadAll();
    await store.toggleTask('task');
    expect(mocks.invoke).toHaveBeenCalledWith('toggle_task', { id: 'task', completed: true });
  });
});
