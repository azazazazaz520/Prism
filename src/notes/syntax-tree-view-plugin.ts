import { syntaxTree } from '@codemirror/language';
import type { DecorationSet } from '@codemirror/view';
import { EditorView, ViewPlugin } from '@codemirror/view';

/** 在文档、选区、视口或语法树变化后重建视图装饰。 */
export function createSyntaxTreeViewPlugin(build: (view: EditorView) => DecorationSet) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      syntaxTree: ReturnType<typeof syntaxTree>;

      constructor(view: EditorView) {
        this.syntaxTree = syntaxTree(view.state);
        this.decorations = build(view);
      }

      update(update: {
        view: EditorView;
        state: EditorView['state'];
        docChanged: boolean;
        selectionSet: boolean;
        viewportChanged: boolean;
      }) {
        const nextSyntaxTree = syntaxTree(update.state);
        const syntaxTreeChanged = nextSyntaxTree !== this.syntaxTree;
        this.syntaxTree = nextSyntaxTree;
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          syntaxTreeChanged
        ) {
          this.decorations = build(update.view);
        }
      }
    },
    { decorations: (value) => value.decorations },
  );
}
