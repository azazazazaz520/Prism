import { describe, expect, it } from 'vitest';
import { compactFileTree } from '../utils/note-tree';
import type { FileEntry } from '../types';

function dir(name: string, path: string, children: FileEntry[]): FileEntry {
  return { name, path, isDir: true, children };
}

function file(name: string, path: string): FileEntry {
  return { name, path, isDir: false };
}

describe('compactFileTree', () => {
  it('合并只有单个子文件夹的连续目录链', () => {
    const tree = compactFileTree([
      dir('.github', '.github', [
        dir('workflows', '.github/workflows', [file('ci.yml', '.github/workflows/ci.yml')]),
      ]),
    ]);

    expect(tree[0]).toMatchObject({
      name: '.github',
      displayName: '.github\\workflows',
      displayPath: '.github\\workflows',
      createPath: '.github',
      segments: [
        { name: '.github', path: '.github' },
        { name: 'workflows', path: '.github/workflows' },
      ],
      path: '.github',
      isDir: true,
    });
    expect(tree[0].children?.[0].path).toBe('.github/workflows/ci.yml');
  });

  it('目录存在直接文件或多个子目录时不合并', () => {
    const tree = compactFileTree([
      dir('docs', 'docs', [
        file('README.md', 'docs/README.md'),
        dir('plans', 'docs/plans', [file('one.md', 'docs/plans/one.md')]),
      ]),
    ]);

    expect(tree[0].displayName).toBeUndefined();
    expect(tree[0].children?.[1].displayName).toBeUndefined();
  });
});
