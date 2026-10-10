import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { forceParsing, Language, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { Decoration, EditorView } from '@codemirror/view';
import type { MarkdownParser } from '@lezer/markdown';
import { describe, expect, it } from 'vitest';
import { createMarkdownSupport, markdownDocumentParser } from '../notes/markdown-syntax';
import { createSyntaxTreeViewPlugin } from '../notes/syntax-tree-view-plugin';

describe('语法树驱动的编辑器视图更新', () => {
  it('解析完成后刷新装饰，即使文档、选区与视口未变', () => {
    const parent = document.createElement('div');
    const markdown = 'intro\n\n| A | B |\n| --- | --- |\n| x | y |';
    let paused = true;
    const parser = (markdownDocumentParser as MarkdownParser).configure({
      wrap: (inner) => ({
        // CodeMirror 提交当前解析片段时，允许解析器完成 stopAt 指定的范围。
        advance: () => (paused && inner.stoppedAt === null ? null : inner.advance()),
        get parsedPos() {
          return inner.parsedPos;
        },
        get stoppedAt() {
          return inner.stoppedAt;
        },
        stopAt: (position) => inner.stopAt(position),
      }),
    });
    const language = new Language(createMarkdownSupport().language.data, parser);
    const parseUpdates: { docChanged: boolean; selectionSet: boolean; viewportChanged: boolean }[] =
      [];
    const tableDecoration = createSyntaxTreeViewPlugin((view) => {
      const builder = new RangeSetBuilder<Decoration>();
      syntaxTree(view.state).iterate({
        enter(node) {
          if (node.name === 'Table') {
            builder.add(node.from, node.to, Decoration.mark({ class: 'syntax-table' }));
          }
        },
      });
      return builder.finish();
    });
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: markdown,
        extensions: [
          language,
          tableDecoration,
          EditorView.updateListener.of((update) => {
            if (syntaxTree(update.startState) !== syntaxTree(update.state)) {
              parseUpdates.push({
                docChanged: update.docChanged,
                selectionSet: update.selectionSet,
                viewportChanged: update.viewportChanged,
              });
            }
          }),
        ],
      }),
    });
    try {
      expect(parent.querySelector('.syntax-table')).toBeNull();
      expect(syntaxTreeAvailable(view.state, view.state.doc.length)).toBe(false);
      paused = false;
      expect(forceParsing(view, view.state.doc.length, 1000)).toBe(true);
      expect(syntaxTreeAvailable(view.state, view.state.doc.length)).toBe(true);
      expect(parseUpdates).toEqual([
        { docChanged: false, selectionSet: false, viewportChanged: false },
      ]);
      expect(
        [...parent.querySelectorAll('.syntax-table')].map((node) => node.textContent).join('\n'),
      ).toBe(markdown.slice(markdown.indexOf('|')));
    } finally {
      view.destroy();
    }
  });
});
