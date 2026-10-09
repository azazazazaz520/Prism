export interface NoteSearchMatch {
  line: number;
  columnUtf16: number;
  lengthUtf16: number;
  excerpt: string;
}

export interface NoteSearchFileResult {
  path: string;
  fileNameMatched: boolean;
  matchCount: number;
  matches: NoteSearchMatch[];
  mtime: string | null;
  isUnsaved?: boolean;
}

export interface NoteSearchResponse {
  requestId: number;
  files: NoteSearchFileResult[];
  matchedFileCount: number;
  scannedFileCount: number;
  failedPathCount: number;
  truncated: boolean;
}

export interface NoteSearchPosition {
  line: number;
  columnUtf16: number;
  lengthUtf16: number;
}

export interface HighlightPart {
  text: string;
  matched: boolean;
}

const TASK_MARKER = /<!--\s*prism-task:[A-Za-z0-9_-]+\s*-->/g;
const MAX_FILES = 200;
const MAX_MATCHES_PER_FILE = 3;

/** 在未保存的编辑器正文中执行与本地文件搜索一致的字面匹配。 */
export function searchNoteContent(
  path: string,
  content: string,
  query: string,
  mtime: string | null,
): NoteSearchFileResult | null {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return null;

  const queryLower = normalizedQuery.toLowerCase();
  const fileName = path.split('/').pop() ?? path;
  const fileNameMatched = fileName.toLowerCase().includes(queryLower);
  let matchCount = 0;
  const matches: NoteSearchMatch[] = [];
  const lines = content.split(/\r\n|\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const markerRanges = taskMarkerRanges(line);
    let segmentStart = 0;
    let lineUtf16Offset = 0;

    for (const segmentEnd of [...markerRanges.map(([start]) => start), line.length]) {
      if (segmentEnd > segmentStart) {
        const segment = line.slice(segmentStart, segmentEnd);
        const found = findVisibleRanges(segment, queryLower, MAX_MATCHES_PER_FILE - matches.length);
        matchCount += found.count;
        for (const range of found.ranges) {
          if (matches.length >= MAX_MATCHES_PER_FILE) break;
          matches.push({
            line: index + 1,
            columnUtf16: lineUtf16Offset + range.start,
            lengthUtf16: range.end - range.start,
            excerpt: makeExcerpt(segment, range.start, range.end),
          });
        }
      }

      const marker = markerRanges.find(([start]) => start === segmentEnd);
      segmentStart = marker?.[1] ?? segmentEnd;
      lineUtf16Offset = segmentStart;
    }
  }

  if (!fileNameMatched && matchCount === 0) return null;
  return { path, fileNameMatched, matchCount, matches, mtime, isUnsaved: true };
}

/** 在当前正文中按原位置或邻近行查找关键词，供结果定位前校验。 */
export function findNoteSearchPosition(
  content: string,
  query: string,
  expectedLine: number,
  expectedColumnUtf16: number,
): NoteSearchPosition | null {
  const queryLower = query.trim().toLowerCase();
  if (!queryLower) return null;

  const lines = content.split(/\r\n|\n/);
  const candidates: NoteSearchPosition[] = [];
  const firstLine = Math.max(1, expectedLine - 3);
  const lastLine = Math.min(lines.length, expectedLine + 3);

  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
    const line = lines[lineNumber - 1];
    const markerRanges = taskMarkerRanges(line);
    let segmentStart = 0;
    for (const segmentEnd of [...markerRanges.map(([start]) => start), line.length]) {
      if (segmentEnd > segmentStart) {
        const segment = line.slice(segmentStart, segmentEnd);
        for (const range of findVisibleRanges(segment, queryLower).ranges) {
          candidates.push({
            line: lineNumber,
            columnUtf16: segmentStart + range.start,
            lengthUtf16: range.end - range.start,
          });
        }
      }
      const marker = markerRanges.find(([start]) => start === segmentEnd);
      segmentStart = marker?.[1] ?? segmentEnd;
    }
  }

  candidates.sort((left, right) => {
    return (
      Math.abs(left.line - expectedLine) - Math.abs(right.line - expectedLine) ||
      Math.abs(left.columnUtf16 - expectedColumnUtf16) -
        Math.abs(right.columnUtf16 - expectedColumnUtf16)
    );
  });
  return candidates[0] ?? null;
}

/** 以安全文本片段结构返回搜索词高亮结果。 */
export function splitHighlightedText(text: string, query: string): HighlightPart[] {
  const ranges = findVisibleRanges(text, query.trim().toLowerCase()).ranges;
  if (ranges.length === 0) return [{ text, matched: false }];

  const parts: HighlightPart[] = [];
  let offset = 0;
  for (const range of ranges) {
    if (range.start < offset) continue;
    if (range.start > offset) parts.push({ text: text.slice(offset, range.start), matched: false });
    parts.push({ text: text.slice(range.start, range.end), matched: true });
    offset = range.end;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), matched: false });
  return parts;
}

/** 合并磁盘扫描结果与当前编辑器中的未保存文档。 */
export function mergeNoteSearchResults(
  disk: NoteSearchResponse,
  unsaved: NoteSearchFileResult[],
  requestId: number,
  unsavedScannedFileCount = unsaved.length,
): NoteSearchResponse {
  const unsavedPaths = new Set(unsaved.map((file) => normalizePath(file.path)));
  const replacedDiskFiles = disk.files.filter((file) => unsavedPaths.has(normalizePath(file.path)));
  const files = [
    ...disk.files.filter((file) => !unsavedPaths.has(normalizePath(file.path))),
    ...unsaved,
  ];
  files.sort((left, right) => {
    const leftPath = left.path.toLowerCase();
    const rightPath = right.path.toLowerCase();
    return (
      Number(right.fileNameMatched) - Number(left.fileNameMatched) ||
      compareText(leftPath, rightPath) ||
      compareText(left.path, right.path)
    );
  });
  return {
    requestId,
    files: files.slice(0, MAX_FILES),
    matchedFileCount:
      Math.max(0, disk.matchedFileCount - replacedDiskFiles.length) + unsaved.length,
    scannedFileCount: disk.scannedFileCount + unsavedScannedFileCount,
    failedPathCount: disk.failedPathCount,
    truncated: disk.truncated || files.length > MAX_FILES,
  };
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return isWindows() ? normalized.toLowerCase() : normalized;
}

function isWindows(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win');
}

function taskMarkerRanges(line: string): Array<[number, number]> {
  TASK_MARKER.lastIndex = 0;
  return [...line.matchAll(TASK_MARKER)].map((match) => {
    const start = match.index ?? 0;
    return [start, start + match[0].length] as [number, number];
  });
}

function findVisibleRanges(
  segment: string,
  queryLower: string,
  maxRanges = Number.POSITIVE_INFINITY,
): { count: number; ranges: Array<{ start: number; end: number }> } {
  if (!queryLower) return { count: 0, ranges: [] };

  let lowered = '';
  const sourcePositions: Array<{ start: number; end: number }> = [];
  let sourceOffset = 0;
  for (const character of segment) {
    const lowerCharacter = character.toLowerCase();
    lowered += lowerCharacter;
    for (let index = 0; index < lowerCharacter.length; index += 1) {
      sourcePositions.push({ start: sourceOffset, end: sourceOffset + character.length });
    }
    sourceOffset += character.length;
  }

  const ranges: Array<{ start: number; end: number }> = [];
  let count = 0;
  let searchFrom = 0;
  while (searchFrom < lowered.length) {
    const start = lowered.indexOf(queryLower, searchFrom);
    if (start < 0) break;
    const end = start + queryLower.length;
    const first = sourcePositions[start];
    const last = sourcePositions[end - 1];
    if (first && last) {
      count += 1;
      if (ranges.length < maxRanges) ranges.push({ start: first.start, end: last.end });
    }
    searchFrom = start + 1;
  }
  return { count, ranges };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function makeExcerpt(segment: string, start: number, end: number): string {
  const boundaries = [0];
  for (const character of segment)
    boundaries.push(boundaries[boundaries.length - 1] + character.length);
  const leftTarget = Math.max(0, start - 64);
  const rightTarget = Math.min(segment.length, end + 96);
  let leftIndex = 0;
  while (leftIndex + 1 < boundaries.length && boundaries[leftIndex + 1] <= leftTarget) {
    leftIndex += 1;
  }
  const rightIndex = boundaries.findIndex((boundary) => boundary >= rightTarget);
  const excerpt = segment.slice(boundaries[leftIndex], boundaries[rightIndex]);
  return `${leftIndex > 0 ? '…' : ''}${excerpt}${rightIndex < boundaries.length - 1 ? '…' : ''}`;
}
