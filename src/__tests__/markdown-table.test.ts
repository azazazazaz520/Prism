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
  getTableContext,
  insertTableRowBelow,
  isTableDataRow,
  isTableDelimiterRow,
  splitTableRow,
  moveToNextCell,
  moveToPreviousCell,
  renderTableCell,
  updateTableCellText,
  type TableLine,
} from '../components/notes/table-preview';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { buildTableDecorations } from '../components/notes/table-preview';

function lines(text: string): TableLine[] {
  let from = 0;
  return text.split('\n').map((lineText, index) => {
    const line = { number: index + 1, text: lineText, from, to: from + lineText.length };
    from = line.to + 1;
    return line;
  });
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

  it('表头与分隔行列数不一致时保留源码', () => {
    const doc = '| 用例 | 预期 |\n| --- | --- | --- | --- | --- |\n| 内容 | 结果 |';
    expect(findTableBlocks(lines(doc))).toHaveLength(0);
    const state = EditorState.create({ doc });
    expect(buildTableDecorations(state).size).toBe(0);
    expect(getTableContext(state, doc.indexOf('内容'))).toBeNull();
  });

  it.each(['```markdown', '~~~markdown', '    '])('代码块中的表格保持代码显示：%s', (fence) => {
    const table = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const doc =
      fence === '    '
        ? table
            .split('\n')
            .map((line) => fence + line)
            .join('\n')
        : `${fence}\n${table}\n${fence.slice(0, 3)}`;
    expect(findTableBlocks(lines(doc))).toHaveLength(0);
    expect(buildTableDecorations(EditorState.create({ doc })).size).toBe(0);
  });

  it('识别单列表格，并在后续标题之前结束', () => {
    const blocks = findTableBlocks(lines('| A |\n| --- |\n| 1 |\n# 标题 | 内容'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].header).toEqual(['A']);
    expect(blocks[0].rows).toEqual([['1']]);
    expect(blocks[0].endLine).toBe(3);
  });

  it('根据连续反斜线的奇偶性区分转义竖线与列分隔符', () => {
    expect(splitTableRow(String.raw`| x\|y | z |`)).toEqual([String.raw`x\|y`, 'z']);
    expect(splitTableRow(String.raw`| x\\| y |`)).toEqual([String.raw`x\\`, 'y']);
    expect(splitTableRow(String.raw`| x\\\|y | z |`)).toEqual([String.raw`x\\\|y`, 'z']);
    expect(splitTableRow(String.raw`A | x\|`)).toEqual(['A', String.raw`x\|`]);
    expect(renderTableCell('\\| **x\\|y** `A\\|B`')).toContain('<code>A|B</code>');
    expect(renderTableCell(String.raw`x\|y`)).toBe('x|y');
  });

  it('表格各行按表头列数渲染，保留多余单元格的源码', () => {
    const parent = document.createElement('div');
    const doc = '| A | B |\n| --- | --- |\n| x |\n| y | z | 保留 |';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          EditorView.decorations.compute(['doc'], (state) => buildTableDecorations(state)),
        ],
      }),
    });
    try {
      const rows = [...parent.querySelectorAll('tr')];
      expect(rows.map((row) => row.children.length)).toEqual([2, 2, 2]);
      expect(rows[1].children[1].textContent?.trim()).toBe('');
      expect(parent.textContent).not.toContain('保留');
      const block = getTableContext(view.state, doc.indexOf('x'))!.block;
      updateTableCellText(view, block, 1, 1, '补全');
      expect(view.state.doc.toString()).toContain('| x | 补全 |');
      expect(view.state.doc.toString()).toContain('| y | z | 保留 |');
    } finally {
      view.destroy();
    }
  });

  it.each([true, false])('转义竖线所在单元格的导航正确，外侧竖线：%s', (outer) => {
    const wrap = (row: string) => (outer ? `| ${row} |` : row);
    const doc = [wrap('A | B'), wrap('--- | ---'), wrap(String.raw`x\|y | z`)].join('\n');
    const parent = document.createElement('div');
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc, selection: { anchor: doc.indexOf('y') } }),
    });
    try {
      expect(getTableContext(view.state, view.state.selection.main.head)?.columnIndex).toBe(0);
      expect(moveToNextCell(view)).toBe(true);
      expect(getTableContext(view.state, view.state.selection.main.head)?.columnIndex).toBe(1);
      expect(view.state.selection.main.head).toBe(doc.indexOf('z') - 1);
      expect(moveToPreviousCell(view)).toBe(true);
      expect(getTableContext(view.state, view.state.selection.main.head)?.columnIndex).toBe(0);
    } finally {
      view.destroy();
    }
  });

  it('输入竖线并执行结构操作后保持单元格内容与列数', () => {
    const parent = document.createElement('div');
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: '| A | B |\n| --- | --- |\n| x | z |' }),
    });
    try {
      let block = getTableContext(view.state, view.state.doc.toString().indexOf('x'))!.block;
      updateTableCellText(view, block, 1, 0, '`x|y`');
      expect(view.state.doc.toString()).toContain('| `x\\|y` | z |');
      block = getTableContext(view.state, view.state.doc.toString().indexOf('x'))!.block;
      expect(block.rows[0]).toEqual(['`x\\|y`', 'z']);
      addTableColumn(view, block);
      block = getTableContext(view.state, view.state.doc.toString().indexOf('x'))!.block;
      expect(block.header).toHaveLength(3);
      expect(block.rows[0]).toEqual(['`x\\|y`', 'z', '']);
    } finally {
      view.destroy();
    }
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
            buildTableDecorations(state, state.selection.main.head),
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
