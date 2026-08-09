import { describe, expect, it } from 'vitest';
import {
  emitNoteFileDrag,
  NOTE_FILE_DRAG_EVENT,
  NOTE_FILE_DRAGGING_CLASS,
} from '../components/notes/file-drag';

describe('file drag data', () => {
  it('sends a file path and pointer position through the application drag channel', () => {
    const received: unknown[] = [];
    const listener = (event: Event) => received.push((event as CustomEvent).detail);
    window.addEventListener(NOTE_FILE_DRAG_EVENT, listener);

    emitNoteFileDrag({ phase: 'move', path: 'notes/today.md', clientX: 320, clientY: 180 });

    window.removeEventListener(NOTE_FILE_DRAG_EVENT, listener);
    expect(received).toEqual([
      { phase: 'move', path: 'notes/today.md', clientX: 320, clientY: 180 },
    ]);
  });

  it('locks text selection for the duration of a file drag', () => {
    emitNoteFileDrag({ phase: 'start', path: 'notes/today.md', clientX: 320, clientY: 180 });
    expect(document.documentElement.classList.contains(NOTE_FILE_DRAGGING_CLASS)).toBe(true);

    emitNoteFileDrag({ phase: 'end', path: 'notes/today.md', clientX: 640, clientY: 360 });
    expect(document.documentElement.classList.contains(NOTE_FILE_DRAGGING_CLASS)).toBe(false);
  });
});
