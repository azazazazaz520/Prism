import { history } from '@codemirror/commands';
import { Compartment, Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** 将外部加载的全文替换为当前文档，但不把加载动作写入用户撤销历史。 */
export function replaceEditorDocument(
  view: EditorView,
  historyCompartment: Compartment,
  content: string,
): void {
  const current = view.state.doc.toString();
  if (current === content) return;

  view.dispatch({
    changes: { from: 0, to: current.length, insert: content },
    effects: historyCompartment.reconfigure(history()),
    annotations: Transaction.addToHistory.of(false),
  });
}
