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
});
