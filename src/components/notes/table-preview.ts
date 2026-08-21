import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export interface TableLine {
  number: number;
  text: string;
  from: number;
  to: number;
}

export type TableAlignment = 'left' | 'center' | 'right' | null;

export interface MarkdownTableBlock {
  startLine: number;
  endLine: number;
  from: number;
  to: number;
  header: string[];
  rows: string[][];
  alignments: TableAlignment[];
}

/** 将 Markdown 表格行拆成单元格数组。 */
export function splitTableRow(text: string): string[] {
  const trimmed = text.trim();
  const body = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const withoutTail = body.endsWith('|') ? body.slice(0, -1) : body;
  return withoutTail.split('|').map((cell) => cell.trim());
}

/** 判断是否是 GFM 表格分隔行，例如 | --- | :---: | ---: | */
export function isTableDelimiterRow(text: string): boolean {
  const cells = splitTableRow(text);
  return cells.length >= 2 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

/** 判断是否是普通的表格数据行。 */
export function isTableDataRow(text: string): boolean {
  return text.includes('|') && splitTableRow(text).length >= 2;
}

/** 从 CodeMirror 行列表中扫描所有 Markdown 表格块。 */
export function findTableBlocks(lines: TableLine[]): MarkdownTableBlock[] {
  const blocks: MarkdownTableBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const delimiter = lines[index];
    if (!isTableDelimiterRow(delimiter.text)) {
      index += 1;
      continue;
    }

    const headerLine = index > 0 ? lines[index - 1] : null;
    const header = headerLine ? splitTableRow(headerLine.text) : [];
    if (!headerLine || header.length < 2) {
      index += 1;
      continue;
    }

    const delimiterCells = splitTableRow(delimiter.text);
    const alignments: TableAlignment[] = delimiterCells.map((cell) => {
      if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
      if (cell.endsWith(':')) return 'right';
      if (cell.startsWith(':')) return 'left';
      return null;
    });

    const rows: string[][] = [];
    let bodyIndex = index + 1;
    while (
      bodyIndex < lines.length &&
      isTableDataRow(lines[bodyIndex].text) &&
      !isTableDelimiterRow(lines[bodyIndex].text)
    ) {
      rows.push(splitTableRow(lines[bodyIndex].text));
      bodyIndex += 1;
    }

    const endIndex = bodyIndex - 1;
    blocks.push({
      startLine: headerLine.number,
      endLine: lines[endIndex].number,
      from: headerLine.from,
      to: lines[endIndex].to,
      header,
      rows,
      alignments,
    });

    index = bodyIndex;
  }

  return blocks;
}

/** 构建表格块级替换装饰，必须通过 EditorView.decorations 直接提供，不能放在 ViewPlugin 中。 */
export function buildTableDecorations(
  state: EditorState,
  cursorPosition: number | null = null,
): DecorationSet {
  const doc = state.doc;
  const lines: TableLine[] = [];
  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    lines.push({ number: line.number, text: line.text, from: line.from, to: line.to });
  }

  const blocks = findTableBlocks(lines);
  const builder = new RangeSetBuilder<Decoration>();
  for (const block of blocks) {
    if (cursorPosition !== null && cursorPosition >= block.from && cursorPosition <= block.to) {
      continue;
    }
    builder.add(
      block.from,
      block.to,
      Decoration.replace({
        widget: new MarkdownTableWidget(block),
        block: true,
      }),
    );
  }
  return builder.finish();
}

/** 安全渲染单元格里的行内 Markdown（粗体、代码、链接等）。 */
export function renderTableCell(markdown: string): string {
  const raw = marked.parse(markdown, { breaks: true }) as string;
  const clean = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: ['code', 'em', 'strong', 'del', 'a', 'br'],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
  });
  const paragraph = /^<p>([\s\S]*)<\/p>\s*$/.exec(clean);
  return paragraph ? paragraph[1] : clean;
}

/** 渲染 Markdown 表格的 CodeMirror Widget。 */
export class MarkdownTableWidget extends WidgetType {
  constructor(private readonly block: MarkdownTableBlock) {
    super();
  }

  eq(other: MarkdownTableWidget): boolean {
    return (
      this.block.startLine === other.block.startLine &&
      this.block.endLine === other.block.endLine &&
      JSON.stringify(this.block.header) === JSON.stringify(other.block.header) &&
      JSON.stringify(this.block.rows) === JSON.stringify(other.block.rows) &&
      JSON.stringify(this.block.alignments) === JSON.stringify(other.block.alignments)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const table = document.createElement('table');
    table.className = 'cm-md-table';
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', 'Markdown 表格');

    const focusLine = (lineNumber: number) => {
      const line = view.state.doc.line(lineNumber);
      view.dispatch({ selection: { anchor: line.from } });
      view.focus();
    };

    const createCell = (tag: 'th' | 'td', content: string, column: number, lineNumber: number) => {
      const cell = document.createElement(tag);
      cell.innerHTML = renderTableCell(content) || '&nbsp;';
      const alignment = this.block.alignments[column] ?? null;
      if (alignment) cell.style.textAlign = alignment;
      cell.addEventListener('mousedown', (event) => {
        event.preventDefault();
        focusLine(lineNumber);
      });
      return cell;
    };

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    this.block.header.forEach((cellText, column) => {
      headerRow.appendChild(createCell('th', cellText, column, this.block.startLine));
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    this.block.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      const lineNumber = this.block.startLine + 2 + rowIndex;
      row.forEach((cellText, column) => {
        tr.appendChild(createCell('td', cellText, column, lineNumber));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    return table;
  }

  ignoreEvent() {
    return true;
  }
}
