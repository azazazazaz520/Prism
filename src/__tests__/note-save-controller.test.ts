import { describe, expect, it, vi } from 'vitest';
import {
  createNoteSaveController,
  useNoteSaveController,
  type NoteSaveSnapshot,
} from '../composables/useNoteSaveController';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('笔记保存队列', () => {
  it('前一次写入未完成时，后续快照会在其完成后串行写入', async () => {
    vi.useFakeTimers();
    const controller = useNoteSaveController(0);
    const firstWrite = deferred<string>();
    const secondWrite = deferred<string>();
    const writes: NoteSaveSnapshot[] = [];
    const saved: string[] = [];

    const write = vi.fn((snapshot: NoteSaveSnapshot) => {
      writes.push(snapshot);
      return writes.length === 1 ? firstWrite.promise : secondWrite.promise;
    });

    controller.schedule(
      'notes/example.md',
      { content: '第一版', expectedMtime: 'mtime-1' },
      write,
      (_mtime, snapshot) => saved.push(snapshot.content),
      () => undefined,
    );
    await vi.runOnlyPendingTimersAsync();

    controller.schedule(
      'notes/example.md',
      { content: '第二版', expectedMtime: 'mtime-1' },
      write,
      (_mtime, snapshot) => saved.push(snapshot.content),
      () => undefined,
    );
    await vi.runOnlyPendingTimersAsync();

    expect(write).toHaveBeenCalledTimes(1);
    firstWrite.resolve('mtime-2');
    await vi.runAllTimersAsync();

    expect(write).toHaveBeenCalledTimes(2);
    expect(writes.map((snapshot) => snapshot.content)).toEqual(['第一版', '第二版']);
    expect(writes[1].expectedMtime).toBe('mtime-2');

    secondWrite.resolve('mtime-3');
    await vi.runAllTimersAsync();
    expect(saved).toEqual(['第二版']);

    controller.dispose();
    vi.useRealTimers();
  });

  it('flush 会等待当前写入并立即写入最新待处理快照', async () => {
    vi.useFakeTimers();
    const controller = useNoteSaveController(500);
    const firstWrite = deferred<string>();
    const secondWrite = deferred<string>();
    const writes: string[] = [];

    controller.schedule(
      'notes/example.md',
      { content: '第一版', expectedMtime: null },
      async (snapshot) => {
        writes.push(snapshot.content);
        return firstWrite.promise;
      },
      () => undefined,
      () => undefined,
    );
    const flushPromise = controller.flush('notes/example.md');
    await vi.runAllTimersAsync();
    expect(writes).toEqual(['第一版']);

    controller.schedule(
      'notes/example.md',
      { content: '第二版', expectedMtime: null },
      async (snapshot) => {
        writes.push(snapshot.content);
        return secondWrite.promise;
      },
      () => undefined,
      () => undefined,
    );
    firstWrite.resolve('mtime-2');
    await vi.runAllTimersAsync();
    expect(writes).toEqual(['第一版', '第二版']);

    secondWrite.resolve('mtime-3');
    await flushPromise;
    controller.dispose();
    vi.useRealTimers();
  });

  it('写入结束时调用收尾回调，释放自身写入标识', async () => {
    const controller = useNoteSaveController(0);
    const settled = vi.fn();

    controller.schedule(
      'notes/example.md',
      { content: '内容', expectedMtime: 'mtime-1' },
      async () => 'mtime-2',
      () => undefined,
      () => undefined,
      settled,
    );

    await controller.flush('notes/example.md');

    expect(settled).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('返回带 generation 和双方内容的外部冲突结果', async () => {
    const controller = createNoteSaveController(0);
    const generation = controller.scheduleResult({
      path: 'notes/example.md',
      snapshot: { content: '本地版本', expectedMtime: 'mtime-1' },
      source: 'editor',
      write: async () => {
        throw new Error('FILE_CHANGED_EXTERNALLY');
      },
      readConflict: async () => ({ diskContent: '磁盘版本', diskMtime: 'mtime-2' }),
    });

    const result = await controller.flush('notes/example.md');

    expect(result).toEqual({
      status: 'conflict',
      path: 'notes/example.md',
      generation,
      localContent: '本地版本',
      diskContent: '磁盘版本',
      diskMtime: 'mtime-2',
    });
    controller.dispose();
  });

  it('任务投影可以基于编辑器尚未写入的最新快照排队', async () => {
    const controller = createNoteSaveController(0);
    const writes: string[] = [];

    controller.scheduleResult({
      path: 'notes/example.md',
      snapshot: { content: '编辑器最新正文', expectedMtime: 'mtime-1' },
      source: 'editor',
      write: async (request) => {
        writes.push(request.content);
        return 'mtime-2';
      },
    });

    const latest = controller.getLatestSnapshot('notes/example.md');
    expect(latest?.content).toBe('编辑器最新正文');

    controller.scheduleResult({
      path: 'notes/example.md',
      snapshot: {
        content: `${latest?.content}\n任务状态：已完成`,
        expectedMtime: latest?.expectedMtime ?? null,
      },
      source: 'task-projection',
      write: async (request) => {
        writes.push(request.content);
        return 'mtime-3';
      },
    });

    await controller.flush('notes/example.md');
    expect(writes).toEqual(['编辑器最新正文\n任务状态：已完成']);
    controller.dispose();
  });
});
