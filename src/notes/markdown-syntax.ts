import { commonmarkLanguage, markdown } from '@codemirror/lang-markdown';
import type { LanguageDescription } from '@codemirror/language';
import { GFM } from '@lezer/markdown';

/** 使用 CommonMark 与 GFM 扩展创建编辑器 Markdown 支持。 */
export function createMarkdownSupport(codeLanguages: readonly LanguageDescription[] = []) {
  return markdown({ base: commonmarkLanguage, extensions: GFM, codeLanguages });
}

/** 用于离线解析与编辑器共享同一套 Markdown 语法。 */
export const markdownDocumentParser = createMarkdownSupport().language.parser;

/** 解析 Markdown 并提供从标准化语法位置到原始文本位置的映射。 */
export function parseMarkdownDocument(source: string) {
  const normalized = source.replace(/\r\n/g, '\n');
  const tree = markdownDocumentParser.parse(normalized);
  const sourceOffsets = new Array<number>(normalized.length + 1);
  let sourceOffset = 0;
  let normalizedOffset = 0;
  sourceOffsets[0] = 0;
  while (sourceOffset < source.length) {
    const crlf = source[sourceOffset] === '\r' && source[sourceOffset + 1] === '\n';
    sourceOffset += crlf ? 2 : 1;
    normalizedOffset += 1;
    sourceOffsets[normalizedOffset] = sourceOffset;
  }
  return {
    tree,
    toSourceOffset(offset: number) {
      return sourceOffsets[offset] ?? source.length;
    },
  };
}

export interface MarkdownHeading {
  from: number;
  to: number;
  level: number;
  title: string;
}

function headingLevel(name: string): number | null {
  const match = /^(?:ATXHeading|SetextHeading)([1-6])$/.exec(name);
  return match ? Number(match[1]) : null;
}

/** 从 Markdown 语法树提取标题范围和去除定界符的文本。 */
export function findMarkdownHeadings(source: string): MarkdownHeading[] {
  const { tree, toSourceOffset } = parseMarkdownDocument(source);
  const headings: MarkdownHeading[] = [];
  const visit = (node: typeof tree.topNode) => {
    const level = headingLevel(node.name);
    if (level !== null) {
      const content = source
        .slice(toSourceOffset(node.from), toSourceOffset(node.to))
        .replace(/^ {0,3}#{1,6}\s+/, '')
        .replace(/\s+#+\s*$/, '')
        .replace(/\r?\n\s*(?:=+|-+)\s*$/, '')
        .trim();
      headings.push({
        from: toSourceOffset(node.from),
        to: toSourceOffset(node.to),
        level,
        title: content,
      });
    }
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
  };
  visit(tree.topNode);
  return headings;
}

/** 返回语法树确认的任务列表节点范围。 */
export function findMarkdownTaskRanges(source: string): { from: number; to: number }[] {
  const { tree, toSourceOffset } = parseMarkdownDocument(source);
  const ranges: { from: number; to: number }[] = [];
  const visit = (node: typeof tree.topNode) => {
    if (node.name === 'Task')
      ranges.push({ from: toSourceOffset(node.from), to: toSourceOffset(node.to) });
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
  };
  visit(tree.topNode);
  return ranges;
}
