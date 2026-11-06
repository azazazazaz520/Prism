import { describe, expect, it, vi } from 'vitest';
import { shouldScheduleNoteSave, useNoteDocumentStore } from '../composables/useNoteDocumentStore';
import {
  createNoteSaveController,
  useNoteSaveController,
  type NoteSaveSnapshot,
} from '../composables/useNoteSaveController';
import {
  beginNoteSelfWrite,
  completeNoteSelfWrite,
  endNoteSelfWrite,
  isNoteSelfWriting,
  matchesNoteSelfWrite,
  noteContentDigest,
} from '../composables/useNoteSelfWriteTracker';

describe('笔记文档保存门禁', () => {
  it('新文档在异步加载完成前不得保存临时空内容', async () => {
    const store = useNoteDocumentStore();
    const document = store.ensure('notes/example.md');

    expect(shouldScheduleNoteSave(document)).toBe(false);

    store.beginLoading('notes/example.md');
    expect(shouldScheduleNoteSave(document)).toBe(false);

    store.finishLoading('notes/example.md', '# 已加载内容', 'mtime-1');
    await Promise.resolve();
    expect(shouldScheduleNoteSave(document)).toBe(false);

    store.updateContent('notes/example.md', '# 用户修改');
    expect(shouldScheduleNoteSave(document)).toBe(true);
  });

  it('外部冲突同时保留本地内容与磁盘内容', () => {
    const store = useNoteDocumentStore();
    store.finishLoading('notes/example.md', '本地初始内容', 'mtime-1');
    store.updateContent('notes/example.md', '本地编辑内容');

    store.setConflict('notes/example.md', '磁盘新内容', 'mtime-2');
    const document = store.ensure('notes/example.md');
    expect(document.conflict).toEqual({
      localContent: '本地编辑内容',
      diskContent: '磁盘新内容',
      diskMtime: 'mtime-2',
    });
    expect(document.content).toBe('本地编辑内容');

    store.acceptConflictForOverwrite('notes/example.md');
    expect(store.ensure('notes/example.md').mtime).toBe('mtime-2');
    expect(store.ensure('notes/example.md').content).toBe('本地编辑内容');
  });
});

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

  it('flushAll 保留失败结果用于退出前检查', async () => {
    const controller = createNoteSaveController(0);
    controller.scheduleResult({
      path: 'notes/a.md',
      snapshot: { content: '内容', expectedMtime: null },
      source: 'editor',
      write: async () => {
        throw new Error('写入失败');
      },
    });

    const results = await controller.flushAll();

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('failed');
    controller.dispose();
  });
});

describe('笔记自身写入标识', () => {
  it('写入完成后可关联延迟到达的同正文事件', () => {
    const path = `notes/self-write-delayed-${Date.now()}.md`;
    const token = beginNoteSelfWrite(path, { content: '正文' });

    completeNoteSelfWrite(path, token, { mtime: 'mtime-2', content: '正文' });
    endNoteSelfWrite(path, token);

    expect(
      matchesNoteSelfWrite(path, {
        mtime: 'mtime-2',
        contentDigest: noteContentDigest('正文'),
      }),
    ).toBe(true);
    expect(
      matchesNoteSelfWrite(path, {
        mtime: 'mtime-2',
        contentDigest: noteContentDigest('正文'),
      }),
    ).toBe(true);
    expect(isNoteSelfWriting(path)).toBe(false);
  });

  it('版本不匹配时不吞掉可能来自外部的事件', () => {
    const path = `notes/self-write-external-${Date.now()}.md`;
    const token = beginNoteSelfWrite(path, { content: '本地正文' });
    completeNoteSelfWrite(path, token, { mtime: 'mtime-local', content: '本地正文' });
    endNoteSelfWrite(path, token);

    expect(matchesNoteSelfWrite(path, { mtime: 'mtime-external' })).toBe(false);
  });
});
