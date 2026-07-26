import { describe, expect, it } from 'vitest';
import { buildTaskReferenceIndex, updateTaskReferences } from '../notes/task-references';

describe('笔记任务同步边界', () => {
  it('保留 CRLF 换行并更新同一任务的全部引用', () => {
    const markdown =
      '- [ ] 旧标题 <!-- prism-task:t1 -->\r\n\r\n  * [ ] 旧标题 <!-- prism-task:t1 -->';
    expect(updateTaskReferences(markdown, { id: 't1', title: '新标题', completed: true })).toBe(
      '- [x] 新标题 <!-- prism-task:t1 -->\r\n\r\n  * [x] 新标题 <!-- prism-task:t1 -->',
    );
  });

  it('为 CRLF 笔记提供准确的字符偏移量', async () => {
    const { parseTaskReferences } = await import('../notes/task-references');
    const reference = parseTaskReferences('标题\r\n- [ ] 任务 <!-- prism-task:t1 -->', 'a.md')[0];
    expect(reference.lineStart).toBe(4);
    expect(reference.lineEnd).toBe(35);
  });

  it('能够从索引中得到跨笔记引用', () => {
    const index = buildTaskReferenceIndex({
      'a.md': '- [ ] 任务 <!-- prism-task:t1 -->',
      'b.md': '- [x] 任务 <!-- prism-task:t1 -->',
    });
    expect(index.byTaskId.get('t1')).toHaveLength(2);
  });
});
