import type { FileEntry } from '../types';

export interface NoteOutlineItem {
  level: number;
  title: string;
  /** Markdown 源码中从 1 开始的行号。 */
  line: number;
}

/** 按名称筛选文件树，同时保留命中的目录路径。 */
export function filterFileTree(entries: FileEntry[], query: string): FileEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return entries;

  return entries.flatMap((entry) => {
    if (entry.isDir) {
      const children = filterFileTree(entry.children ?? [], normalizedQuery);
      return children.length > 0 ? [{ ...entry, children }] : [];
    }
    return entry.name.toLocaleLowerCase().includes(normalizedQuery) ? [entry] : [];
  });
}

/** 统计中文字符和英文单词数量。 */
export function countNoteWords(text: string): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return chineseChars + englishWords;
}

/** 解析 Markdown 各级标题，忽略围栏代码块中的内容。 */
export function parseNoteOutline(markdown: string): NoteOutlineItem[] {
  const codeFenceRe = /^\s{0,3}(`{3,}|~{3,})/;
  const result: NoteOutlineItem[] = [];
  let inCodeFence = false;
  let fenceChar = '';
  let fenceLength = 0;

  for (const [lineIndex, line] of markdown.split(/\r?\n/).entries()) {
    const fence = codeFenceRe.exec(line);
    if (fence) {
      if (!inCodeFence) {
        inCodeFence = true;
        fenceChar = fence[1][0];
        fenceLength = fence[1].length;
      } else if (fence[1][0] === fenceChar && fence[1].length >= fenceLength) {
        inCodeFence = false;
      }
      continue;
    }
    if (inCodeFence) continue;

    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      result.push({ level: match[1].length, title: match[2], line: lineIndex + 1 });
    }
  }

  return result;
}

/** 将标签从原位置移动到目标位置，并返回新的标签顺序。 */
export function moveTabInList(tabs: string[], fromIndex: number, targetIndex: number): string[] {
  const nextTabs = [...tabs];
  const [movedTab] = nextTabs.splice(fromIndex, 1);
  const adjustedIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
  nextTabs.splice(Math.max(0, adjustedIndex), 0, movedTab);
  return nextTabs;
}

/** 规范化工作区路径，用于比较 Windows 路径。 */
export function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase();
}

/** 判断路径是否等于目录，或位于该目录的子路径中。 */
export function isPathInside(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`);
}

/** 将路径前缀替换为新前缀。 */
export function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  return path === oldPrefix ? newPrefix : `${newPrefix}${path.slice(oldPrefix.length)}`;
}

/** 在文件树中递归查找指定路径。 */
export function findNoteEntry(entries: FileEntry[], targetPath: string): FileEntry | null {
  for (const entry of entries) {
    if (entry.path === targetPath) return entry;
    if (entry.children) {
      const found = findNoteEntry(entry.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

/** 从文件树中移除指定节点，同时保留其余节点的结构。 */
export function removeNoteEntry(entries: FileEntry[], targetPath: string): FileEntry[] {
  return entries
    .filter((entry) => entry.path !== targetPath)
    .map((entry) =>
      entry.isDir && entry.children
        ? { ...entry, children: removeNoteEntry(entry.children, targetPath) }
        : entry,
    );
}

/** 统计目录下的后代节点数量。 */
export function countDescendantEntries(entry: FileEntry): number {
  if (!entry.children) return 0;
  return entry.children.reduce((count, child) => count + 1 + countDescendantEntries(child), 0);
}
