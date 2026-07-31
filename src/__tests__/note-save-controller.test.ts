import { describe, expect, it, vi } from 'vitest';
import { useNoteSaveController, type NoteSaveSnapshot } from '../composables/useNoteSaveController';

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
});
