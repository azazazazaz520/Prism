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

  it('重命名笔记时迁移正文状态而不是创建空文档', () => {
    const store = useNoteDocumentStore();
    store.finishLoading('notes/old-name.md', '正文内容', 'mtime-1');
    store.updateContent('notes/old-name.md', '已编辑正文');

    store.rename('notes/old-name.md', 'notes/new-name.md');

    expect(store.ensure('notes/new-name.md').content).toBe('已编辑正文');
    expect(store.ensure('notes/new-name.md').dirty).toBe(true);
    expect(store.ensure('notes/old-name.md').content).toBe('');
  });

  it('重命名目录时迁移目录下所有笔记状态', () => {
    const store = useNoteDocumentStore();
    store.finishLoading('notes/old-folder/a.md', 'A', 'mtime-a');
    store.finishLoading('notes/old-folder/nested/b.md', 'B', 'mtime-b');

    store.renamePrefix('notes/old-folder', 'notes/new-folder');

    expect(store.ensure('notes/new-folder/a.md').content).toBe('A');
    expect(store.ensure('notes/new-folder/nested/b.md').content).toBe('B');
    expect(store.ensure('notes/old-folder/a.md').content).toBe('');
  });
});
