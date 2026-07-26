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
