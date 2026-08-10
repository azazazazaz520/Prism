export const NOTE_FILE_DRAG_EVENT = 'prism-note-file-drag';
export const NOTE_FILE_DRAGGING_CLASS = 'prism-note-file-dragging';

export type NoteFileDragPhase = 'start' | 'move' | 'end' | 'cancel';

export interface NoteFileDragDetail {
  phase: NoteFileDragPhase;
  path: string;
  clientX: number;
  clientY: number;
}

/** 发布应用内文件拖动事件，避免依赖 WebView 的原生 HTML5 拖放能力。 */
export function emitNoteFileDrag(detail: NoteFileDragDetail) {
  if (detail.phase === 'start') {
    document.documentElement.classList.add(NOTE_FILE_DRAGGING_CLASS);
  } else if (detail.phase === 'end' || detail.phase === 'cancel') {
    document.documentElement.classList.remove(NOTE_FILE_DRAGGING_CLASS);
  }
  window.dispatchEvent(new CustomEvent<NoteFileDragDetail>(NOTE_FILE_DRAG_EVENT, { detail }));
}
