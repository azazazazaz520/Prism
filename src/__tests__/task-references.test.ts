import { describe, expect, it } from 'vitest';
import {
  buildTaskReferenceIndex,
  parseTaskReferences,
  renderTaskReference,
  updateTaskReferenceLine,
  updateTaskReferences,
} from '../notes/task-references';

describe('task references', () => {
  it('解析带稳定 ID 的 Markdown 任务引用', () => {
    const markdown = '# 项目\n\n  * [x] 确认方案 <!-- prism-task:task-123 -->';
    const [reference] = parseTaskReferences(markdown, '项目.md');

    expect(reference).toMatchObject({
      taskId: 'task-123',
      notePath: '项目.md',
      line: 3,
      title: '确认方案',
      completed: true,
      indent: '  ',
      marker: '*',
    });
    expect(reference.lineStart).toBe(6);
  });

  it('忽略没有 Prism 任务 ID 的普通复选框', () => {
    expect(parseTaskReferences('- [ ] 普通清单', '项目.md')).toEqual([]);
  });

  it('排除围栏代码、缩进代码和行内代码中的任务示例', () => {
    const markdown = [
      '- [ ] 正式任务 <!-- prism-task:task-1 -->',
      '',
      '```md',
      '- [ ] 围栏示例 <!-- prism-task:task-1 -->',
      '```',
      '',
      '    - [ ] 缩进示例 <!-- prism-task:task-1 -->',
      '',
      '`- [ ] 行内示例 <!-- prism-task:task-1 -->`',
    ].join('\n');
    expect(parseTaskReferences(markdown, '项目.md').map((item) => item.title)).toEqual([
      '正式任务',
    ]);
  });

  it('只接受任务语法节点中的真实 HTML 注释元数据', () => {
    const markdown = [
      String.raw`- [ ] escaped \<!-- prism-task:task-1 -->`,
      '- [ ] valid <!-- prism-task:task-2 -->',
    ].join('\n');
    expect(parseTaskReferences(markdown, '项目.md').map((item) => item.taskId)).toEqual(['task-2']);
    expect(
      updateTaskReferences(markdown, { id: 'task-1', title: 'changed', completed: true }),
    ).toBe(markdown);
    expect(
      updateTaskReferences(markdown, { id: 'task-2', title: 'changed', completed: true }),
    ).toBe(
      [
        String.raw`- [ ] escaped \<!-- prism-task:task-1 -->`,
        '- [x] changed <!-- prism-task:task-2 -->',
      ].join('\n'),
    );
  });

  it('CRLF 文档中的多个引用保持准确行号和原始范围', () => {
    const markdown =
      '- [ ] 第一项 <!-- prism-task:task-1 -->\r\n\r\n- [x] 第二项 <!-- prism-task:task-1 -->';
    const references = parseTaskReferences(markdown, '项目.md');
    expect(references.map(({ line, lineStart, lineEnd }) => [line, lineStart, lineEnd])).toEqual([
      [1, 0, markdown.indexOf('\r\n')],
      [3, markdown.lastIndexOf('- [x]'), markdown.length],
    ]);
    expect(updateTaskReferences(markdown, { id: 'task-1', title: '更新', completed: true })).toBe(
      '- [x] 更新 <!-- prism-task:task-1 -->\r\n\r\n- [x] 更新 <!-- prism-task:task-1 -->',
    );
  });

  it('为多篇笔记建立按任务和按笔记索引', () => {
    const index = buildTaskReferenceIndex({
      '项目.md': '- [ ] 方案 <!-- prism-task:task-1 -->',
      '会议.md':
        '- [ ] 方案 <!-- prism-task:task-1 -->\n- [ ] 另一个任务 <!-- prism-task:task-2 -->',
    });

    expect(index.byTaskId.get('task-1')).toHaveLength(2);
    expect(index.byNotePath.get('会议.md')).toHaveLength(2);
  });

  it('更新单个引用时保留缩进和列表符号', () => {
    const line = '    * [ ] 旧标题 <!-- prism-task:task-1 -->';
    expect(updateTaskReferenceLine(line, { id: 'task-1', title: '新标题', completed: true })).toBe(
      '    * [x] 新标题 <!-- prism-task:task-1 -->',
    );
  });

  it('更新笔记中的全部同任务引用', () => {
    const markdown =
      '- [ ] 旧标题 <!-- prism-task:task-1 -->\n\n- [ ] 旧标题 <!-- prism-task:task-1 -->';
    expect(updateTaskReferences(markdown, { id: 'task-1', title: '新标题', completed: true })).toBe(
      '- [x] 新标题 <!-- prism-task:task-1 -->\n\n- [x] 新标题 <!-- prism-task:task-1 -->',
    );
  });

  it('生成标准任务引用', () => {
    expect(renderTaskReference({ id: 'task-1', title: '新任务', completed: false })).toBe(
      '- [ ] 新任务 <!-- prism-task:task-1 -->',
    );
  });
});
