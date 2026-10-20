import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('../diagnostics/invoke-logged', () => ({
  invokeWithDiagnostics: invoke,
  diagnosticsLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { useNoteDocumentStore } from '../composables/useNoteDocumentStore';
import { useNoteTaskSync } from '../composables/useNoteTaskSync';

const REFERENCE = '- [ ] 旧标题 <!-- prism-task:t1 -->';

describe('笔记任务投影暂停', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) => {
      if (command === 'get_note_mtime') return 'mtime-1';
      if (command === 'write_note') return 'mtime-2';
      if (command === 'read_note_meta') return { content: '', mtime: 'mtime-1' };
      return null;
    });
    useNoteTaskSync().resetNotes();
  });

  it('冻结期间暂缓任务投影，解除后补发并完成写入', async () => {
    const documentStore = useNoteDocumentStore();
    const sync = useNoteTaskSync(documentStore);
    sync.setNoteContent('a.md', REFERENCE);

    await sync.setProjectionPaused(true);
    await sync.projectTask({ id: 't1', title: '新标题', completed: true });

    expect(invoke).not.toHaveBeenCalled();

    await sync.setProjectionPaused(false);

    expect(invoke.mock.calls.some(([command]) => command === 'write_note')).toBe(true);
    const document = documentStore.ensure('a.md');
    expect(document.content).toContain('- [x] 新标题');
    expect(document.dirty).toBe(false);
  });

  it('冻结期间重复投影同一任务只补发一次', async () => {
    const documentStore = useNoteDocumentStore();
    const sync = useNoteTaskSync(documentStore);
    sync.setNoteContent('a.md', REFERENCE);

    await sync.setProjectionPaused(true);
    await sync.projectTask({ id: 't1', title: '第一次标题', completed: false });
    await sync.projectTask({ id: 't1', title: '第二次标题', completed: true });
    expect(invoke).not.toHaveBeenCalled();

    await sync.setProjectionPaused(false);

    const writeCalls = invoke.mock.calls.filter(([command]) => command === 'write_note');
    expect(writeCalls).toHaveLength(1);
    expect(documentStore.ensure('a.md').content).toContain('- [x] 第二次标题');
  });
  it('settleProjections 等待已接受的任务投影写入结束', async () => {
    const documentStore = useNoteDocumentStore();
    const sync = useNoteTaskSync(documentStore);
    sync.setNoteContent('a.md', REFERENCE);

    const pending = sync.projectTask({ id: 't1', title: '新标题', completed: true });
    await sync.settleProjections();

    expect(invoke.mock.calls.some(([command]) => command === 'write_note')).toBe(true);
    await pending;
    expect(documentStore.ensure('a.md').dirty).toBe(false);
  });
});
