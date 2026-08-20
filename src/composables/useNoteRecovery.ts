import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';

export type NoteRecoveryReason = 'conflict' | 'save-failed' | 'external-delete';

export interface NoteRecoverySummary {
  id: string;
  workspacePath: string;
  notePath: string;
  generation: number;
  documentMtime: string | null;
  createdAt: string;
  reason: NoteRecoveryReason | string;
  errorMessage: string | null;
}

export interface NoteRecoverySnapshot extends NoteRecoverySummary {
  content: string;
}

export interface NoteRecoverySnapshotInput {
  notePath: string;
  content: string;
  generation: number;
  documentMtime: string | null;
  reason: NoteRecoveryReason;
  errorMessage?: string | null;
}

export interface NoteRecoveryRestoreResult {
  mtime: string;
  snapshotDeleted: boolean;
}

export async function saveNoteRecovery(input: NoteRecoverySnapshotInput) {
  return invoke<NoteRecoverySummary>('save_note_recovery', {
    notePath: input.notePath,
    content: input.content,
    generation: input.generation,
    documentMtime: input.documentMtime,
    reason: input.reason,
    errorMessage: input.errorMessage ?? null,
  });
}

export function listNoteRecoveries() {
  return invoke<NoteRecoverySummary[]>('list_note_recoveries');
}

export function deleteNoteRecovery(id: string) {
  return invoke<void>('delete_note_recovery', { id });
}

export function readNoteRecovery(id: string) {
  return invoke<NoteRecoverySnapshot>('read_note_recovery', { id });
}

export function restoreNoteRecovery(id: string) {
  return invoke<NoteRecoveryRestoreResult>('restore_note_recovery', { id });
}
