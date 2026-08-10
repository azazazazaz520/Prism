import { describe, expect, it } from 'vitest';
import {
  countDescendantEntries,
  countNoteWords,
  filterFileTree,
  findNoteEntry,
  isPathInside,
  moveTabInList,
  normalizeWorkspacePath,
  parseNoteOutline,
  removeNoteEntry,
  replacePathPrefix,
} from '../utils/note-editor';
import type { FileEntry } from '../types';

function dir(name: string, path: string, children: FileEntry[]): FileEntry {
  return { name, path, isDir: true, children };
}

function file(name: string, path: string): FileEntry {
  return { name, path, isDir: false };
}

describe('note-editor utilities', () => {
  it('筛选文件树时保留命中文件的目录路径', () => {
    const tree = [
      dir('docs', 'docs', [file('Guide.md', 'docs/Guide.md'), file('Todo.md', 'docs/Todo.md')]),
    ];

    expect(filterFileTree(tree, 'guide')).toEqual([
      dir('docs', 'docs', [file('Guide.md', 'docs/Guide.md')]),
    ]);
  });

  it('解析各级标题、源码行号并忽略代码围栏内的标题', () => {
    expect(parseNoteOutline('# 开始\n```md\n# 忽略\n```\n## 继续\n\n###### 结束')).toEqual([
      { level: 1, title: '开始', line: 1 },
      { level: 2, title: '继续', line: 5 },
      { level: 6, title: '结束', line: 7 },
    ]);
  });

  it('为重复标题保留不同的源码行号', () => {
    expect(parseNoteOutline('## 相同\n\n## 相同')).toEqual([
      { level: 2, title: '相同', line: 1 },
      { level: 2, title: '相同', line: 3 },
    ]);
  });

  it('提供笔记文本统计和标签移动规则', () => {
    expect(countNoteWords('你好 Prism')).toBe(3);
    expect(moveTabInList(['a', 'b', 'c'], 0, 3)).toEqual(['b', 'c', 'a']);
  });

  it('集中处理路径比较和文件树操作', () => {
    const tree = [dir('docs', 'docs', [file('Guide.md', 'docs/Guide.md')])];

    expect(normalizeWorkspacePath('C:\\Notes\\')).toBe('c:/notes');
    expect(isPathInside('docs/Guide.md', 'docs')).toBe(true);
    expect(replacePathPrefix('docs/Guide.md', 'docs', 'archive')).toBe('archive/Guide.md');
    expect(findNoteEntry(tree, 'docs/Guide.md')?.name).toBe('Guide.md');
    expect(removeNoteEntry(tree, 'docs/Guide.md')[0].children).toEqual([]);
    expect(countDescendantEntries(tree[0])).toBe(1);
  });
});
