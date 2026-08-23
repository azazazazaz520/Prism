import { describe, expect, it } from 'vitest';
import {
  addTableColumn,
  cycleTableColumnAlignment,
  deleteTableRow,
  formatTable,
  moveTableColumn,
  moveTableRow,
  sortTableRows,
  findTableBlocks,
  insertTableRowBelow,
  isTableDataRow,
  isTableDelimiterRow,
  splitTableRow,
  updateTableCellText,
  type TableLine,
} from '../components/notes/table-preview';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { buildTableDecorations } from '../components/notes/table-preview';

function lines(text: string): TableLine[] {
  return text.split('\n').map((lineText, index) => ({
    number: index + 1,
    text: lineText,
    from: 0,
    to: lineText.length,
  }));
}

describe('Markdown 表格解析', () => {
  it('可以拆分带外边线的表格行', () => {
    expect(splitTableRow('| A | B |')).toEqual(['A', 'B']);
    expect(splitTableRow('A | B')).toEqual(['A', 'B']);
  });

  it('可以识别表格分隔行', () => {
    expect(isTableDelimiterRow('| --- | :---: | ---: |')).toBe(true);
    expect(isTableDelimiterRow('| 服务 | 作用 |')).toBe(false);
  });

  it('可以识别普通表格数据行', () => {
    expect(isTableDataRow('| A | B |')).toBe(true);
    expect(isTableDataRow('普通文本')).toBe(false);
  });

  it('可以从连续行中解析表格块', () => {
    const doc = lines(
      [
        '| 服务 | 作用 |',
        '| --- | --- |',
        '| API | 接口 |',
        '| Worker | 后台任务 |',
        '',
        '普通段落',
      ].join('\n'),
    );

    const blocks = findTableBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].header).toEqual(['服务', '作用']);
    expect(blocks[0].rows).toEqual([
      ['API', '接口'],
      ['Worker', '后台任务'],
    ]);
    expect(blocks[0].startLine).toBe(1);
    expect(blocks[0].endLine).toBe(4);
  });

  it('可以解析对齐方式', () => {
    const doc = lines(['| A | B | C |', '| :--- | :---: | ---: |', '| 1 | 2 | 3 |'].join('\n'));
    const blocks = findTableBlocks(doc);
    expect(blocks[0].alignments).toEqual(['left', 'center', 'right']);
  });

  it('不会把没有分隔行的文本当成表格', () => {
    const doc = lines(['| A | B |', '| 1 | 2 |'].join('\n'));
    expect(findTableBlocks(doc)).toHaveLength(0);
  });

  it('块级表格装饰可通过 EditorView.decorations 使用', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    try {
      const state = EditorState.create({
        doc: '| A | B |\n| --- | --- |\n| 1 | 2 |',
        extensions: [
          EditorView.decorations.compute(['doc', 'selection'], (state) =>
            buildTableDecorations(state, state.selection.main.head),
          ),
        ],
      });
      expect(() => new EditorView({ state, parent })).not.toThrow();
    } finally {
      parent.remove();
    }
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

      const tableLinesFor = (targetState: EditorState) => {
        const targetDoc = targetState.doc;
        const result: TableLine[] = [];
        for (let lineNumber = 1; lineNumber <= targetDoc.lines; lineNumber += 1) {
          const line = targetDoc.line(lineNumber);
          result.push({ number: line.number, text: line.text, from: line.from, to: line.to });
        }
        return result;
      };

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

  it('支持移动、排序和格式化表格', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    let view: EditorView | null = null;
    try {
      const state = EditorState.create({
        doc: '| A | B |\n| --- | --- |\n| 2 | b |\n| 1 | a |',
      });
      const editor = new EditorView({ state, parent });
      view = editor;

      const tableLinesFor = (targetState: EditorState) => {
        const targetDoc = targetState.doc;
        const result: TableLine[] = [];
        for (let lineNumber = 1; lineNumber <= targetDoc.lines; lineNumber += 1) {
          const line = targetDoc.line(lineNumber);
          result.push({ number: line.number, text: line.text, from: line.from, to: line.to });
        }
        return result;
      };

      let blocks = findTableBlocks(tableLinesFor(editor.state));
      sortTableRows(editor, blocks[0], 0, 'asc');
      expect(editor.state.doc.toString()).toContain('| 1 | a |');
      expect(editor.state.doc.toString()).toContain('| 2 | b |');

      blocks = findTableBlocks(tableLinesFor(editor.state));
      moveTableColumn(editor, blocks[0], 0, 1);
      expect(editor.state.doc.toString()).toContain('| B | A |');

      blocks = findTableBlocks(tableLinesFor(editor.state));
      moveTableRow(editor, blocks[0], 2, -1);
      blocks = findTableBlocks(tableLinesFor(editor.state));
      formatTable(editor, blocks[0]);
      expect(editor.state.doc.toString()).toContain('| --- | --- |');
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
            buildTableDecorations(state, state.selection.main.head),
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

  it('单元格内容中的换行不会破坏表格结构', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    let view: EditorView | null = null;
    try {
      const state = EditorState.create({
        doc: '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |',
      });
      const editor = new EditorView({ state, parent });
      view = editor;

      const tableLinesFor = (targetState: EditorState) => {
        const targetDoc = targetState.doc;
        const result: TableLine[] = [];
        for (let lineNumber = 1; lineNumber <= targetDoc.lines; lineNumber += 1) {
          const line = targetDoc.line(lineNumber);
          result.push({ number: line.number, text: line.text, from: line.from, to: line.to });
        }
        return result;
      };

      const block = findTableBlocks(tableLinesFor(editor.state))[0];
      updateTableCellText(editor, block, 1, 0, '第一行\n第二行');

      expect(editor.state.doc.toString()).toContain('| 第一行 第二行 | 2 |');
      expect(findTableBlocks(tableLinesFor(editor.state))).toHaveLength(1);
      expect(findTableBlocks(tableLinesFor(editor.state))[0].rows).toHaveLength(2);
    } finally {
      view?.destroy();
      parent.remove();
    }
  });
});
