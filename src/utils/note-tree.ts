import type { FileEntry } from '../types';

/**
 * 将连续的单子目录链合并为一个展示节点。
 *
 * 节点的 path 保留链首目录路径，便于复用已有的展开、重命名和删除逻辑；
 * 子节点仍然使用后端返回的真实路径。
 */
export function compactFileTree(entries: FileEntry[]): FileEntry[] {
  return entries.map((entry) => compactEntry(entry));
}

function compactEntry(entry: FileEntry): FileEntry {
  if (!entry.isDir || !entry.children) return entry;

  const originalChildren = entry.children;
  const children = originalChildren.map((child) => compactEntry(child));

  if (originalChildren.length === 1 && originalChildren[0].isDir) {
    const child = children[0];
    const displayName = `${entry.name}\\${child.displayName ?? child.name}`;
    const displayPath = `${entry.path}\\${child.displayPath ?? child.name}`;

    return {
      ...child,
      path: entry.path,
      name: entry.name,
      displayName,
      displayPath,
      createPath: entry.path,
      segments: [
        { name: entry.name, path: entry.path },
        ...(child.segments ?? [{ name: child.name, path: child.path }]),
      ],
    };
  }

  return { ...entry, children };
}
