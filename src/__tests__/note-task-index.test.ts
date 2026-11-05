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
});
