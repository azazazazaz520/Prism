import { describe, expect, it, vi } from 'vitest';
import { markdownDocumentParser } from '../notes/markdown-syntax';
import {
  addTableColumn,
  cycleTableColumnAlignment,
  formatTable,
  moveTableColumn,
  moveTableRow,
  sortTableRows,
  findTableBlocks,
  getTableContext,
  insertTableRowBelow,
  moveToNextCell,
  moveToPreviousCell,
  renderTableCell,
  updateTableCellText,
} from '../components/notes/table-preview';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { buildTableDecorations } from '../components/notes/table-preview';

describe('Markdown 表格解析', () => {
  it('可以从连续行中解析表格块', () => {
    const doc = [
      '| 服务 | 作用 |',
      '| --- | --- |',
      '| API | 接口 |',
      '| Worker | 后台任务 |',
      '',
      '普通段落',
    ].join('\n');

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
    const doc = ['| A | B | C |', '| :--- | :---: | ---: |', '| 1 | 2 | 3 |'].join('\n');
    const blocks = findTableBlocks(doc);
    expect(blocks[0].alignments).toEqual(['left', 'center', 'right']);
  });

  it('不会把没有分隔行的文本当成表格', () => {
    const doc = ['| A | B |', '| 1 | 2 |'].join('\n');
    expect(findTableBlocks(doc)).toHaveLength(0);
  });

  it('表头与分隔行列数不一致时保留源码', () => {
    const doc = '| 用例 | 预期 |\n| --- | --- | --- | --- | --- |\n| 内容 | 结果 |';
    expect(findTableBlocks(doc)).toHaveLength(0);
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
    expect(findTableBlocks(doc)).toHaveLength(0);
    expect(buildTableDecorations(EditorState.create({ doc })).size).toBe(0);
  });

  it('识别单列表格，并在后续标题之前结束', () => {
    const blocks = findTableBlocks('| A |\n| --- |\n| 1 |\n# 标题 | 内容');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].header).toEqual(['A']);
    expect(blocks[0].rows).toEqual([['1']]);
    expect(blocks[0].endLine).toBe(3);
  });

  it('从语法树取得转义竖线所在单元格的源码范围', () => {
    const block = findTableBlocks(
      String.raw`| A | B |` + '\n' + '| --- | --- |' + '\n' + String.raw`| x\|y | z |`,
    )[0];
    expect(block.rowCells[0].map((cell) => cell.text)).toEqual([String.raw`x\|y`, 'z']);
    expect(block.rowCells[0][0].to).toBe(block.rowCells[0][0].from + String.raw`x\|y`.length);
    expect(renderTableCell('\\| **x\\|y** `A\\|B`')).toContain('<code>A|B</code>');
    expect(renderTableCell(String.raw`x\|y`)).toBe('x|y');
  });

  it.each([
    ['|', String.raw`a\|b`],
    ['||', String.raw`a\|\|b`],
    [String.raw`\|`, String.raw`a\|b`],
    [String.raw`\\|`, String.raw`a\\\|b`],
  ])('单元格写回正确转义管道与前置反斜杠：%s', (pipe, expectedCell) => {
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

  it.each([
    ['外侧竖线', '| A | B | C |\n| --- | --- | --- |\n| x |'],
    ['无外侧竖线', 'A | B | C\n--- | --- | ---\nx'],
  ])('%s表格中的缺失尾部单元格可编辑并保留所有列', (label, markdown) => {
    const parent = document.createElement('div');
    const view = new EditorView({ parent, state: EditorState.create({ doc: markdown }) });
    try {
      const block = findTableBlocks(markdown)[0];
      expect(block.header).toHaveLength(3);
      expect(block.rowCells[0]).toHaveLength(3);
      expect(block.rowCells[0][2]).toMatchObject({ from: block.rowCells[0][2].to, text: '' });
      expect(() => updateTableCellText(view, block, 1, 2, 'third')).not.toThrow();
      expect(findTableBlocks(view.state.doc.toString())[0].rows[0]).toEqual(['x', '', 'third']);
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
      expect(view.state.selection.main.head).toBe(doc.indexOf('z'));
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

  it.each([
    { label: '引用', prefixes: ['> ', '> ', '> '] },
    { label: '无序列表', prefixes: ['- ', '  ', '  '] },
    { label: '有序列表', prefixes: ['1. ', '   ', '   '] },
    { label: '嵌套引用', prefixes: ['> > ', '> > ', '> > '] },
  ])('$label 中的表格新增列后保留容器、内容和对齐', ({ prefixes }) => {
    const markdown = [
      `${prefixes[0]}| A | B |`,
      `${prefixes[1]}| :--- | ---: |`,
      `${prefixes[2]}| x | y |`,
    ].join('\n');
    const view = new EditorView({
      parent: document.createElement('div'),
      state: EditorState.create({ doc: markdown }),
    });
    try {
      const [block] = findTableBlocks(markdown);
      expect(block.alignments).toEqual(['left', 'right']);
      addTableColumn(view, block);
      expect(view.state.doc.toString()).toBe(
        [
          `${prefixes[0]}| A | B |  |`,
          `${prefixes[1]}| :--- | ---: | --- |`,
          `${prefixes[2]}| x | y |  |`,
        ].join('\n'),
      );
      const updated = findTableBlocks(view.state.doc.toString());
      expect(updated).toHaveLength(1);
      expect(updated[0]).toMatchObject({
        header: ['A', 'B', ''],
        rows: [['x', 'y', '']],
        alignments: ['left', 'right', null],
        linePrefixes: prefixes,
      });
    } finally {
      view.destroy();
    }
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

  it('同一文档上的选区更新复用表格语法结果', () => {
    const parse = vi.spyOn(markdownDocumentParser, 'parse');
    const source = '| 缓存测试 | 值 |\n| --- | --- |\n| 条目 | 1 |';
    const state = EditorState.create({ doc: source });
    try {
      buildTableDecorations(state);
      const selectionState = state.update({ selection: { anchor: source.indexOf('1') } }).state;
      getTableContext(selectionState, selectionState.selection.main.head);
      buildTableDecorations(selectionState);
      expect(parse).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockRestore();
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

      const tableLinesFor = (targetState: EditorState) => targetState.doc.toString();

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

      const tableLinesFor = (targetState: EditorState) => targetState.doc.toString();

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
