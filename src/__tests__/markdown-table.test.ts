import { describe, expect, it } from 'vitest';
import {
  findTableBlocks,
  isTableDataRow,
  isTableDelimiterRow,
  splitTableRow,
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
});
