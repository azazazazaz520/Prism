import { describe, expect, it } from 'vitest';
import {
  findNoteSearchPosition,
  mergeNoteSearchResults,
  searchNoteContent,
  type NoteSearchResponse,
} from '../notes/note-search';

const sharedContent =
  '计划 Project PROJECT 计划 <!-- prism-task:task_1 -->\n- [ ] 任务标题 <!-- prism-task:task_2 -->\n😀命中';

describe('笔记全文搜索匹配规则', () => {
  it('匹配连续中文关键词和同一行的多处结果', () => {
    const result = searchNoteContent('计划.md', sharedContent, '计划', null);

    expect(result?.matchCount).toBe(2);
    expect(result?.matches.map((match) => match.columnUtf16)).toEqual([0, 19]);
  });

  it('英文匹配不区分大小写并保留 UTF-16 列位置', () => {
    const english = searchNoteContent('计划.md', sharedContent, 'project', null);
    const emoji = searchNoteContent('计划.md', sharedContent, '命中', null);

    expect(english?.matchCount).toBe(2);
    expect(english?.matches.map((match) => match.columnUtf16)).toEqual([3, 11]);
    expect(emoji?.matches[0]).toMatchObject({ line: 3, columnUtf16: 2 });
  });

  it('忽略 Prism 任务标记并保留同一行的任务标题', () => {
    expect(searchNoteContent('tasks.md', sharedContent, 'task_1', null)).toBeNull();
    expect(searchNoteContent('tasks.md', sharedContent, '任务标题', null)?.matchCount).toBe(1);
  });

  it('在原行内容变化后只从邻近行重新定位关键词', () => {
    expect(findNoteSearchPosition('已调整的内容\n  计划\n后续内容', '计划', 1, 0)).toEqual({
      line: 2,
      columnUtf16: 2,
      lengthUtf16: 2,
    });
    expect(findNoteSearchPosition('没有匹配内容', '计划', 1, 0)).toBeNull();
  });
});

describe('笔记全文搜索结果合并', () => {
  it('以未保存正文覆盖相同路径的磁盘结果，并按文件名命中优先排序', () => {
    const disk: NoteSearchResponse = {
      requestId: 4,
      files: [
        {
          path: 'zeta.md',
          fileNameMatched: false,
          matchCount: 1,
          matches: [],
          mtime: 'mtime-z',
        },
        {
          path: 'alpha.md',
          fileNameMatched: false,
          matchCount: 1,
          matches: [],
          mtime: 'mtime-old',
        },
      ],
      matchedFileCount: 2,
      scannedFileCount: 5,
      failedPathCount: 0,
      truncated: false,
    };
    const unsaved = {
      path: 'alpha.md',
      fileNameMatched: true,
      matchCount: 0,
      matches: [],
      mtime: 'mtime-new',
      isUnsaved: true,
    };

    const result = mergeNoteSearchResults(disk, [unsaved], 5, 1);

    expect(result.files.map((file) => file.path)).toEqual(['alpha.md', 'zeta.md']);
    expect(result.files[0]).toMatchObject({ isUnsaved: true, mtime: 'mtime-new' });
    expect(result.matchedFileCount).toBe(2);
    expect(result.scannedFileCount).toBe(6);
  });
});
