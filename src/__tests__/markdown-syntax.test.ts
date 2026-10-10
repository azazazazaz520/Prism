import { describe, expect, it } from 'vitest';
import { markdownDocumentParser } from '../notes/markdown-syntax';

function nodeNames(source: string) {
  const names: string[] = [];
  const tree = markdownDocumentParser.parse(source);
  tree.iterate({
    enter: (node) => {
      names.push(node.name);
    },
  });
  return names;
}

describe('共享 Markdown 语法配置', () => {
  it('识别 GFM 表格、任务列表、删除线与围栏代码', () => {
    const source = [
      '| A | B |',
      '| --- | --- |',
      '| x | y |',
      '',
      '- [ ] task ~~strike~~',
      '',
      '```md',
      '| code | table |',
      '| --- | --- |',
      '```',
    ].join('\n');
    const names = nodeNames(source);

    expect(names).toContain('Table');
    expect(names).toContain('Task');
    expect(names).toContain('Strikethrough');
    expect(names).toContain('FencedCode');
    expect(names.filter((name) => name === 'Table')).toHaveLength(1);
  });
});
