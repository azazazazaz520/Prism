import { defaultKeymap, history, historyKeymap, undo } from '@codemirror/commands';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { replaceEditorDocument } from '../components/notes/editor-document-sync';

describe('编辑器文档加载', () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it('加载全文不进入撤销历史，但加载后的用户编辑仍然可以撤销', () => {
    const historyCompartment = new Compartment();
    view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          historyCompartment.of(history()),
          keymap.of([...defaultKeymap, ...historyKeymap]),
        ],
      }),
      parent: document.body,
    });

    replaceEditorDocument(view, historyCompartment, '# 已打开的文件\n正文');
    expect(view.state.doc.toString()).toBe('# 已打开的文件\n正文');
    expect(undo(view)).toBe(false);
    expect(view.state.doc.toString()).toBe('# 已打开的文件\n正文');

    view.dispatch({
      changes: { from: view.state.doc.length, insert: '\n新增内容' },
    });
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('# 已打开的文件\n正文');
  });
});
