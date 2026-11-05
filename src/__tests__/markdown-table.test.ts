import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import {
  addTableColumn,
  buildTableDecorations,
  cycleTableColumnAlignment,
  findTableBlocks,
  getTableContext,
  insertTableRowBelow,
  renderTableCell,
  updateTableCellText,
} from '../components/notes/table-preview';

describe('Markdown 表格解析', () => {
  it('表头与分隔行列数不一致时保留源码', () => {
    const doc = '| 用例 | 预期 |\n| --- | --- | --- | --- | --- |\n| 内容 | 结果 |';
    expect(findTableBlocks(doc)).toHaveLength(0);
    const state = EditorState.create({ doc });
    expect(buildTableDecorations(state).size).toBe(0);
    expect(getTableContext(state, doc.indexOf('内容'))).toBeNull();
  });

  it('单元格写回时转义竖线', () => {
    const pipe = '|';
    const expectedCell = String.raw`a\|b`;
    const parent = document.createElement('div');
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: '| A | B | C |\n| --- | --- | --- |\n| x | y | z |' }),
    });
    try {
      const block = findTableBlocks(view.state.doc.toString())[0];
      updateTableCellText(view, block, 1, 0, `a${pipe}b`);
      const updated = findTableBlocks(view.state.doc.toString())[0];
      expect(view.state.doc.toString()).toBe(
        `| A | B | C |\n| --- | --- | --- |\n| ${expectedCell} | y | z |`,
      );
      expect(updated.rows).toEqual([[expectedCell, 'y', 'z']]);
    } finally {
      view.destroy();
    }
  });

  it('单元格按行内语法渲染并净化 HTML', () => {
    expect(renderTableCell('# title')).toBe('# title');
    expect(renderTableCell('- entry')).toBe('- entry');
    expect(renderTableCell('> quote')).toBe('&gt; quote');
    expect(
      renderTableCell('**bold** _italic_ ~~gone~~ `code` [link](https://example.com)'),
    ).toContain('<strong>bold</strong>');
    expect(renderTableCell('<img src=x onerror=alert(1)>')).not.toContain('onerror');
    expect(renderTableCell('[bad](javascript:alert(1))')).not.toContain('javascript:');
  });

  it('CRLF 表格范围映射保留原始偏移、行结束符和容器前缀', () => {
    const markdown = '1. | A | B |\r\n   | --- | --- |\r\n   | x | y |';
    const [block] = findTableBlocks(markdown);
    expect(block).toMatchObject({
      from: 0,
      to: markdown.length,
      header: ['A', 'B'],
      rows: [['x', 'y']],
      lineEnding: '\r\n',
      linePrefixes: ['1. ', '   ', '   '],
    });
  });

  it('表格动作可以修改 Markdown 源码', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    let view: EditorView | null = null;
    try {
      const state = EditorState.create({
        doc: '| A | B |\n| --- | --- |\n| 1 | 2 |',
      });
      const editor = new EditorView({ state, parent });
      view = editor;

      const tableLinesFor = (targetState: EditorState) => targetState.doc.toString();

      let blocks = findTableBlocks(tableLinesFor(editor.state));
      expect(blocks).toHaveLength(1);
      addTableColumn(editor, blocks[0]);
      expect(editor.state.doc.toString()).toContain('| A | B |  |');

      blocks = findTableBlocks(tableLinesFor(editor.state));
      insertTableRowBelow(editor, blocks[0], 0);
      expect(editor.state.doc.toString()).toContain('|  |  |  |');

      blocks = findTableBlocks(tableLinesFor(editor.state));
      cycleTableColumnAlignment(editor, blocks[0], 0);
      expect(editor.state.doc.toString()).toContain(':---');
    } finally {
      view?.destroy();
      parent.remove();
    }
  });

  it('单元格编辑提交后恢复为普通表格', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    let view: EditorView | null = null;
    try {
      const state = EditorState.create({
        doc: '| A | B |\n| --- | --- |\n| 1 | 2 |',
        extensions: [
          EditorView.decorations.compute(['doc', 'selection'], (state) =>
            buildTableDecorations(state),
          ),
        ],
      });
      view = new EditorView({ state, parent });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const firstCell = parent.querySelector('td');
      expect(firstCell).toBeTruthy();
      firstCell?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(firstCell?.getAttribute('contenteditable')).toBe('true');
      if (firstCell) {
        firstCell.textContent = 'X';
        firstCell.dispatchEvent(new Event('input', { bubbles: true }));
        firstCell.dispatchEvent(new Event('blur', { bubbles: true }));
      }

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(view.state.doc.toString()).toContain('X');
      const cellAfter = parent.querySelector('td');
      expect(cellAfter?.getAttribute('contenteditable')).not.toBe('true');
    } finally {
      view?.destroy();
      parent.remove();
    }
  });

  it('表格前同一行插入文字后，通过当前 DOM 控件编辑有效源码位置', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: 'intro\n\n| A | B |\n| --- | --- |\n| x | y |',
        extensions: [
          EditorView.decorations.compute(['doc', 'selection'], (state) =>
            buildTableDecorations(state),
          ),
        ],
      }),
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      view.dispatch({ changes: { from: 0, insert: '123456' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const firstHeader = parent.querySelector('th')!;
      expect(firstHeader).not.toBeNull();
      firstHeader.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      firstHeader.textContent = 'NEW';
      firstHeader.dispatchEvent(new Event('input', { bubbles: true }));
      firstHeader.dispatchEvent(new Event('blur', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(view.state.doc.toString()).toBe(
        '123456intro\n\n| NEW | B |\n| --- | --- |\n| x | y |',
      );
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it('只点击带行内样式的单元格不会修改 Markdown 源码', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    let view: EditorView | null = null;
    try {
      const markdown = '| 状态 | 处理方式 |\n| --- | --- |\n| **外部删除** | 恢复快照 |';
      let documentChangeCount = 0;
      const state = EditorState.create({
        doc: markdown,
        extensions: [
          EditorView.decorations.compute(['doc', 'selection'], (state) =>
            buildTableDecorations(state),
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) documentChangeCount += 1;
          }),
        ],
      });
      view = new EditorView({ state, parent });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const styledCell = parent.querySelectorAll('td')[0];
      expect(styledCell?.querySelector('strong')).toBeTruthy();
      styledCell?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      styledCell?.dispatchEvent(new Event('blur', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(view.state.doc.toString()).toBe(markdown);
      expect(documentChangeCount).toBe(0);
    } finally {
      view?.destroy();
      parent.remove();
    }
  });
});
