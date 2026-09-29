import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('../diagnostics/invoke-logged', () => ({
  invokeWithDiagnostics: mocks.invoke,
}));

import { useNoteTaskSync } from '../composables/useNoteTaskSync';

describe('笔记任务引用后台索引', () => {
  const sync = useNoteTaskSync();

  beforeEach(() => {
    mocks.invoke.mockReset();
    sync.resetNotes();
  });

  afterEach(() => sync.resetNotes());

  it('逐层发现目录并分批建立完整引用索引', async () => {
    mocks.invoke.mockImplementation(async (command: string, args?: { path?: string }) => {
      if (command === 'list_note_dir' && args?.path === '') {
        return [
          { path: 'inbox', name: 'inbox', isDir: true },
          { path: 'root.md', name: 'root.md', isDir: false },
        ];
      }
      if (command === 'list_note_dir' && args?.path === 'inbox') {
        return [{ path: 'inbox/ref.md', name: 'ref.md', isDir: false }];
      }
      if (command === 'list_note_dir') return [];
      if (command === 'read_note') return '- [ ] 任务 <!-- prism-task:task-1 -->';
      throw new Error(`意外命令：${command}`);
    });

    await sync.refreshIndex();

    expect(mocks.invoke).not.toHaveBeenCalledWith('list_note_tree');
    expect(sync.referenceIndex.value.byTaskId.get('task-1')).toHaveLength(2);
    expect(sync.isIndexing.value).toBe(false);
    expect(sync.indexError.value).toBeNull();
  });

  it('重新创建索引服务实例后会重新扫描工作区', async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'list_note_dir') {
        return [{ path: 'ref.md', name: 'ref.md', isDir: false }];
      }
      if (command === 'read_note') return '- [ ] 任务 <!-- prism-task:task-1 -->';
      throw new Error(`意外命令：${command}`);
    });

    await sync.refreshIndex();
    const remountedSync = useNoteTaskSync();
    await remountedSync.refreshIndex();

    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'list_note_dir')).toHaveLength(
      2,
    );
    expect(remountedSync.referenceIndex.value.byTaskId.get('task-1')).toHaveLength(1);
    remountedSync.cancelIndex();
  });

  it('取消扫描后丢弃尚未返回的正文读取结果', async () => {
    let finishRead!: (content: string) => void;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'list_note_dir') {
        return Promise.resolve([{ path: 'late.md', name: 'late.md', isDir: false }]);
      }
      if (command === 'read_note') return new Promise<string>((resolve) => (finishRead = resolve));
      throw new Error(`意外命令：${command}`);
    });

    const scan = sync.refreshIndex();
    await vi.waitFor(() => expect(finishRead).toBeTypeOf('function'));
    sync.resetNotes();
    finishRead('- [ ] 旧工作区任务 <!-- prism-task:task-old -->');
    await scan;

    expect(sync.noteContents.value).toEqual({});
    expect(sync.referenceIndex.value.byTaskId.size).toBe(0);
  });

  it('等待完整索引期间取消时拒绝继续执行', async () => {
    let finishRead!: (content: string) => void;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'list_note_dir') {
        return Promise.resolve([{ path: 'pending.md', name: 'pending.md', isDir: false }]);
      }
      if (command === 'read_note') return new Promise<string>((resolve) => (finishRead = resolve));
      throw new Error(`意外命令：${command}`);
    });

    const ready = sync.ensureIndexReady();
    await vi.waitFor(() => expect(finishRead).toBeTypeOf('function'));
    sync.cancelIndex();
    finishRead('- [ ] 任务 <!-- prism-task:task-1 -->');

    await expect(ready).rejects.toThrow('任务引用索引已取消');
    expect(sync.referenceIndex.value.byTaskId.size).toBe(0);
  });
});
