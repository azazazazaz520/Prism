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

  it('外部冲突同时保留本地内容与磁盘内容', () => {
    const store = useNoteDocumentStore();
    store.finishLoading('notes/example.md', '本地初始内容', 'mtime-1');
    store.updateContent('notes/example.md', '本地编辑内容');

    store.setConflict('notes/example.md', '磁盘新内容', 'mtime-2');
    const document = store.ensure('notes/example.md');
    expect(document.conflict).toEqual({
      localContent: '本地编辑内容',
      diskContent: '磁盘新内容',
      diskMtime: 'mtime-2',
    });
    expect(document.content).toBe('本地编辑内容');

    store.acceptConflictForOverwrite('notes/example.md');
    expect(store.ensure('notes/example.md').mtime).toBe('mtime-2');
    expect(store.ensure('notes/example.md').content).toBe('本地编辑内容');
  });
});
