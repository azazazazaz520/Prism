import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('../diagnostics/invoke-logged', () => ({
  invokeWithDiagnostics: mocks.invoke,
}));

import {
  deleteNoteRecovery,
  listNoteRecoveries,
  readNoteRecovery,
  restoreNoteRecovery,
} from '../composables/useNoteRecovery';

describe('笔记恢复命令适配', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it('恢复列表、读取、删除和恢复命令使用稳定的 ID 参数', async () => {
    mocks.invoke.mockResolvedValue([]);

    await listNoteRecoveries();
    await readNoteRecovery('recovery-1');
    await deleteNoteRecovery('recovery-1');
    await restoreNoteRecovery('recovery-1');

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'list_note_recoveries');
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'read_note_recovery', { id: 'recovery-1' });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, 'delete_note_recovery', { id: 'recovery-1' });
    expect(mocks.invoke).toHaveBeenNthCalledWith(4, 'restore_note_recovery', { id: 'recovery-1' });
  });
});
