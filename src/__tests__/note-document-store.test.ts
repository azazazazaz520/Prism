import { describe, expect, it } from 'vitest';
import { shouldScheduleNoteSave, useNoteDocumentStore } from '../composables/useNoteDocumentStore';

describe('笔记文档保存门禁', () => {
  it('新文档在异步加载完成前不得保存临时空内容', async () => {
    const store = useNoteDocumentStore();
    const document = store.ensure('notes/example.md');

    expect(shouldScheduleNoteSave(document)).toBe(false);

    store.beginLoading('notes/example.md');
    expect(shouldScheduleNoteSave(document)).toBe(false);

    store.finishLoading('notes/example.md', '# 已加载内容', 'mtime-1');
    await Promise.resolve();
    expect(shouldScheduleNoteSave(document)).toBe(false);

    store.updateContent('notes/example.md', '# 用户修改');
    expect(shouldScheduleNoteSave(document)).toBe(true);
  });
});
