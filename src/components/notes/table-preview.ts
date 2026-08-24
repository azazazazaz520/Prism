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

function tableLinesFromDoc(doc: EditorState['doc']): TableLine[] {
  const result: TableLine[] = [];
  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    result.push({ number: line.number, text: line.text, from: line.from, to: line.to });
  }
  return result;
}

export interface TableCursorContext {
  block: MarkdownTableBlock;
  rowIndex: number;
  columnIndex: number;
}

export function getTableContext(
  state: EditorState,
  cursorPosition: number,
): TableCursorContext | null {
  const lines = tableLinesFromDoc(state.doc);
  const blocks = findTableBlocks(lines);
  const block = blocks.find(
    (candidate) => cursorPosition >= candidate.from && cursorPosition <= candidate.to,
  );
  if (!block) return null;

  const line = state.doc.lineAt(cursorPosition);
  const lineNumber = line.number;
  let rowIndex = -1;
  if (lineNumber === block.startLine) {
    rowIndex = 0;
  } else if (lineNumber > block.startLine + 1) {
    rowIndex = lineNumber - block.startLine - 1;
  }

  const before = line.text.slice(0, Math.max(0, cursorPosition - line.from));
  const pipeCount = (before.match(/\|/g) ?? []).length;
  const columnIndex = Math.max(0, pipeCount - 1);

  return { block, rowIndex, columnIndex };
}

function cellAnchor(
  state: EditorState,
  block: MarkdownTableBlock,
  rowIndex: number,
  columnIndex: number,
): number | null {
  if (rowIndex < 0) return null;
  const lineNumber = rowIndex === 0 ? block.startLine : block.startLine + 1 + rowIndex;
  if (lineNumber > block.endLine) return null;
  const line = state.doc.line(lineNumber);
  const pipeIndexes: number[] = [];
  for (let index = 0; index < line.text.length; index += 1) {
    if (line.text[index] === '|') pipeIndexes.push(index);
  }
  const startsWithPipe = line.text.startsWith('|');
  let start = 0;
  if (columnIndex > 0) {
    const separator = startsWithPipe ? pipeIndexes[columnIndex] : pipeIndexes[columnIndex - 1];
    if (separator === undefined) return null;
    start = separator + 1;
  } else {
    start = startsWithPipe ? 1 : 0;
  }
  return line.from + Math.min(start, line.length);
}

export function moveToNextCell(view: EditorView): boolean {
  const context = getTableContext(view.state, view.state.selection.main.head);
  if (!context) return false;
  const { block, rowIndex, columnIndex } = context;
  if (columnIndex + 1 < block.header.length) {
    const next = cellAnchor(view.state, block, rowIndex, columnIndex + 1);
    if (next !== null) {
      view.dispatch({ selection: { anchor: next } });
      view.focus();
      return true;
    }
  }
  if (rowIndex === 0 && block.rows.length > 0) {
    const next = cellAnchor(view.state, block, 1, 0);
    if (next !== null) {
      view.dispatch({ selection: { anchor: next } });
      view.focus();
      return true;
    }
  }
  if (rowIndex > 0 && rowIndex < block.rows.length) {
    const next = cellAnchor(view.state, block, rowIndex + 1, 0);
    if (next !== null) {
      view.dispatch({ selection: { anchor: next } });
      view.focus();
      return true;
    }
  }
  return moveToNewRow(view, block);
}

export function moveToPreviousCell(view: EditorView): boolean {
  const context = getTableContext(view.state, view.state.selection.main.head);
  if (!context) return false;
  const { block, rowIndex, columnIndex } = context;
  if (columnIndex > 0) {
    const previous = cellAnchor(view.state, block, rowIndex, columnIndex - 1);
    if (previous !== null) {
      view.dispatch({ selection: { anchor: previous } });
      view.focus();
      return true;
    }
  }
  if (rowIndex > 0) {
    const previous = cellAnchor(view.state, block, rowIndex - 1, block.header.length - 1);
    if (previous !== null) {
      view.dispatch({ selection: { anchor: previous } });
      view.focus();
      return true;
    }
  }
  if (rowIndex === 0 && block.header.length > 0) {
    const previous = cellAnchor(view.state, block, 0, 0);
    if (previous !== null) {
      view.dispatch({ selection: { anchor: previous } });
      view.focus();
      return true;
    }
  }
  return false;
}

export function moveToNextRow(view: EditorView): boolean {
  const context = getTableContext(view.state, view.state.selection.main.head);
  if (!context) return false;
  const { block, rowIndex, columnIndex } = context;
  if (rowIndex === 0 && block.rows.length > 0) {
    const next = cellAnchor(view.state, block, 1, columnIndex);
    if (next !== null) {
      view.dispatch({ selection: { anchor: next } });
      view.focus();
      return true;
    }
  }
  if (rowIndex > 0 && rowIndex < block.rows.length) {
    const next = cellAnchor(view.state, block, rowIndex + 1, columnIndex);
    if (next !== null) {
      view.dispatch({ selection: { anchor: next } });
      view.focus();
      return true;
    }
  }
  return moveToNewRow(view, block);
}

function tableBlockAfterChange(
  view: EditorView,
  originalStartLine: number,
): MarkdownTableBlock | null {
  const lines = tableLinesFromDoc(view.state.doc);
  const blocks = findTableBlocks(lines);
  return blocks.find((block) => block.startLine === originalStartLine) ?? blocks[0] ?? null;
}

function moveToNewRow(view: EditorView, block: MarkdownTableBlock): boolean {
  insertTableRowBelow(view, block, Math.max(0, block.rows.length - 1));
  const nextBlock = tableBlockAfterChange(view, block.startLine);
  if (!nextBlock) return false;
  const newRow = block.rows.length + 1;
  const next = cellAnchor(view.state, nextBlock, newRow, 0);
  if (next === null) return false;
  view.dispatch({ selection: { anchor: next } });
  view.focus();
  return true;
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

function buildMarkdownTable(
  header: string[],
  rows: string[][],
  alignments: TableAlignment[],
): string {
  const normalizeCellText = (text: string) =>
    text.replace(/\r\n?|\n/g, ' ').replace(/\u00a0/g, ' ');
  const alignMarker = (alignment: TableAlignment) => {
    if (alignment === 'left') return ':---';
    if (alignment === 'center') return ':---:';
    if (alignment === 'right') return '---:';
    return '---';
  };
  const headerRow = `| ${header.map(normalizeCellText).join(' | ')} |`;
  const delimiterRow = `| ${alignments.map(alignMarker).join(' | ')} |`;
  const bodyRows = rows.map((row) => `| ${row.map(normalizeCellText).join(' | ')} |`);
  return [headerRow, delimiterRow, ...bodyRows].join('\n');
}

function dispatchTableChange(
  view: EditorView,
  block: MarkdownTableBlock,
  next: { header: string[]; rows: string[][]; alignments: TableAlignment[] },
) {
  const insert = buildMarkdownTable(next.header, next.rows, next.alignments);
  view.dispatch({
    changes: { from: block.from, to: block.to, insert },
  });
  view.focus();
}

export function insertTableRowBelow(view: EditorView, block: MarkdownTableBlock, rowIndex: number) {
  const rows = [...block.rows];
  const index = Math.min(rowIndex + 1, rows.length);
  rows.splice(index, 0, Array(block.header.length).fill(''));
  dispatchTableChange(view, block, { header: block.header, rows, alignments: block.alignments });
}

export function deleteTableRow(view: EditorView, block: MarkdownTableBlock, rowIndex: number) {
  if (block.rows.length <= 1) return;
  const rows = block.rows.filter((_, index) => index !== rowIndex);
  dispatchTableChange(view, block, { header: block.header, rows, alignments: block.alignments });
}

export function addTableColumn(view: EditorView, block: MarkdownTableBlock) {
  const header = [...block.header, ''];
  const rows = block.rows.map((row) => [...row, '']);
  const alignments = [...block.alignments, null];
  dispatchTableChange(view, block, { header, rows, alignments });
}

export function deleteTableColumn(
  view: EditorView,
  block: MarkdownTableBlock,
  columnIndex: number,
) {
  if (block.header.length <= 1) return;
  const header = block.header.filter((_, index) => index !== columnIndex);
  const rows = block.rows.map((row) => row.filter((_, index) => index !== columnIndex));
  const alignments = block.alignments.filter((_, index) => index !== columnIndex);
  dispatchTableChange(view, block, { header, rows, alignments });
}

export function cycleTableColumnAlignment(
  view: EditorView,
  block: MarkdownTableBlock,
  columnIndex: number,
) {
  const order: TableAlignment[] = ['left', 'center', 'right', null];
  const current = block.alignments[columnIndex] ?? null;
  const nextAlignment = order[(order.indexOf(current) + 1) % order.length];
  const alignments = block.alignments.map((alignment, index) =>
    index === columnIndex ? nextAlignment : alignment,
  );
  dispatchTableChange(view, block, { header: block.header, rows: block.rows, alignments });
}

export function setTableColumnAlignment(
  view: EditorView,
  block: MarkdownTableBlock,
  columnIndex: number,
  alignment: TableAlignment,
) {
  const alignments = block.alignments.map((current, index) =>
    index === columnIndex ? alignment : current,
  );
  dispatchTableChange(view, block, { header: block.header, rows: block.rows, alignments });
}

export function insertTableRowAbove(view: EditorView, block: MarkdownTableBlock, rowIndex: number) {
  const rows = [...block.rows];
  const index = rowIndex <= 1 ? 0 : rowIndex - 1;
  rows.splice(index, 0, Array(block.header.length).fill(''));
  dispatchTableChange(view, block, { header: block.header, rows, alignments: block.alignments });
}

export function insertTableColumnBefore(
  view: EditorView,
  block: MarkdownTableBlock,
  columnIndex: number,
) {
  const header = [...block.header];
  const alignments = [...block.alignments];
  const rows = block.rows.map((row) => [...row]);
  header.splice(columnIndex, 0, '');
  alignments.splice(columnIndex, 0, null);
  rows.forEach((row) => row.splice(columnIndex, 0, ''));
  dispatchTableChange(view, block, { header, rows, alignments });
}

export function insertTableColumnAfter(
  view: EditorView,
  block: MarkdownTableBlock,
  columnIndex: number,
) {
  const header = [...block.header];
  const alignments = [...block.alignments];
  const rows = block.rows.map((row) => [...row]);
  const target = columnIndex + 1;
  header.splice(target, 0, '');
  alignments.splice(target, 0, null);
  rows.forEach((row) => row.splice(target, 0, ''));
  dispatchTableChange(view, block, { header, rows, alignments });
}

export function copyTableRow(view: EditorView, block: MarkdownTableBlock, rowIndex: number) {
  if (rowIndex <= 0) return;
  const rows = [...block.rows];
  const source = rows[rowIndex - 1];
  rows.splice(rowIndex, 0, [...source]);
  dispatchTableChange(view, block, { header: block.header, rows, alignments: block.alignments });
}

export function copyTableColumn(view: EditorView, block: MarkdownTableBlock, columnIndex: number) {
  const header = [...block.header];
  const alignments = [...block.alignments];
  const rows = block.rows.map((row) => [...row]);
  const target = columnIndex + 1;
  header.splice(target, 0, header[columnIndex]);
  alignments.splice(target, 0, alignments[columnIndex]);
  rows.forEach((row) => row.splice(target, 0, row[columnIndex]));
  dispatchTableChange(view, block, { header, rows, alignments });
}

export function moveTableRow(
  view: EditorView,
  block: MarkdownTableBlock,
  rowIndex: number,
  direction: -1 | 1,
) {
  if (rowIndex <= 0) return;
  const targetIndex = rowIndex - 1 + direction;
  if (targetIndex < 0 || targetIndex >= block.rows.length) return;
  const rows = [...block.rows];
  const current = rows[rowIndex - 1];
  rows[rowIndex - 1] = rows[targetIndex];
  rows[targetIndex] = current;
  dispatchTableChange(view, block, { header: block.header, rows, alignments: block.alignments });
}

export function moveTableColumn(
  view: EditorView,
  block: MarkdownTableBlock,
  columnIndex: number,
  direction: -1 | 1,
) {
  const targetIndex = columnIndex + direction;
  if (targetIndex < 0 || targetIndex >= block.header.length) return;
  const header = [...block.header];
  const alignments = [...block.alignments];
  const rows = block.rows.map((row) => [...row]);
  const swap = <T>(list: T[]) => {
    const current = list[columnIndex];
    list[columnIndex] = list[targetIndex];
    list[targetIndex] = current;
  };
  swap(header);
  swap(alignments);
  rows.forEach(swap);
  dispatchTableChange(view, block, { header, rows, alignments });
}

export function sortTableRows(
  view: EditorView,
  block: MarkdownTableBlock,
  columnIndex: number,
  direction: 'asc' | 'desc',
) {
  const rows = [...block.rows];
  rows.sort((rowA, rowB) => {
    const valueA = rowA[columnIndex] ?? '';
    const valueB = rowB[columnIndex] ?? '';
    const result = valueA.localeCompare(valueB, undefined, { numeric: true });
    return direction === 'asc' ? result : -result;
  });
  dispatchTableChange(view, block, { header: block.header, rows, alignments: block.alignments });
}

export function formatTable(view: EditorView, block: MarkdownTableBlock) {
  const size = block.header.length;
  const header = block.header.map((cell) => cell.trim());
  const rows = block.rows.map((row) => {
    const normalized = row.map((cell) => cell.trim());
    while (normalized.length < size) normalized.push('');
    return normalized.slice(0, size);
  });
  const alignments = block.alignments.slice(0, size);
  while (alignments.length < size) alignments.push(null);
  dispatchTableChange(view, block, { header, rows, alignments });
}

let pendingCellFocus: { startLine: number; rowIndex: number; columnIndex: number } | null = null;

export function updateTableCellText(
  view: EditorView,
  block: MarkdownTableBlock,
  rowIndex: number,
  columnIndex: number,
  text: string,
) {
  const header = [...block.header];
  const rows = block.rows.map((row) => [...row]);
  const target = rowIndex === 0 ? header : rows[rowIndex - 1];
  if (!target || columnIndex < 0 || columnIndex >= target.length) return;
  target[columnIndex] = text;
  dispatchTableChange(view, block, { header, rows, alignments: block.alignments });
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
    const shell = document.createElement('div');
    shell.className = 'cm-md-table-shell';
    const table = document.createElement('table');
    table.className = 'cm-md-table';
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', 'Markdown 表格');

    let activeCellCommit: (() => boolean) | null = null;

    const startCellEdit = (
      cell: HTMLElement,
      rowIndex: number,
      columnIndex: number,
      initialText: string,
    ) => {
      if (cell.getAttribute('contenteditable') === 'true') return;
      if (activeCellCommit) {
        const commitActiveCell = activeCellCommit;
        activeCellCommit = null;
        pendingCellFocus = {
          startLine: this.block.startLine,
          rowIndex,
          columnIndex,
        };
        commitActiveCell();
        if (!table.isConnected) return;
        pendingCellFocus = null;
      }

      cell.contentEditable = 'true';
      cell.setAttribute('contenteditable', 'true');
      cell.spellcheck = false;

      let committed = false;
      let hasInput = false;
      const commit = (nextRow?: number, nextColumn?: number): boolean => {
        if (committed) return false;
        committed = true;
        if (activeCellCommit === commit) activeCellCommit = null;
        cell.contentEditable = 'false';
        cell.setAttribute('contenteditable', 'false');
        const textContent = cell.textContent ?? '';
        const value = textContent === '\u00a0' ? '' : textContent;
        if (!hasInput || value === initialText) {
          cell.innerHTML = renderTableCell(initialText) || '&nbsp;';
          if (nextRow !== undefined && nextColumn !== undefined) {
            const targetCell = table.querySelector<HTMLElement>(
              `[data-table-row="${nextRow}"][data-table-column="${nextColumn}"]`,
            );
            if (targetCell) {
              const nextContent =
                nextRow === 0
                  ? (this.block.header[nextColumn] ?? '')
                  : (this.block.rows[nextRow - 1]?.[nextColumn] ?? '');
              startCellEdit(targetCell, nextRow, nextColumn, nextContent);
            }
          }
          return false;
        }
        if (nextRow !== undefined && nextColumn !== undefined) {
          pendingCellFocus = {
            startLine: this.block.startLine,
            rowIndex: nextRow,
            columnIndex: nextColumn,
          };
        }
        updateTableCellText(view, this.block, rowIndex, columnIndex, value);
        return true;
      };

      const cancel = () => {
        if (committed) return;
        committed = true;
        if (activeCellCommit === commit) activeCellCommit = null;
        cell.contentEditable = 'false';
        cell.setAttribute('contenteditable', 'false');
        cell.innerHTML = renderTableCell(initialText) || '&nbsp;';
      };

      activeCellCommit = commit;
      cell.addEventListener('input', () => {
        hasInput = true;
      });
      cell.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const nextRow = rowIndex === 0 ? 1 : rowIndex + 1;
          commit(nextRow, columnIndex);
        } else if (event.key === 'Tab') {
          event.preventDefault();
          const nextColumn = columnIndex + 1;
          if (nextColumn < this.block.header.length) {
            commit(rowIndex, nextColumn);
          } else {
            const nextRow = rowIndex === 0 ? 1 : rowIndex + 1;
            commit(nextRow, 0);
          }
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      });

      cell.addEventListener('blur', () => commit(), { once: true });
      cell.focus();
    };

    const closeTableMenu = () => {
      document.querySelector('.cm-md-table-context-menu')?.remove();
      document.removeEventListener('mousedown', handleOutsideClose);
      document.removeEventListener('keydown', handleEscape);
    };

    const handleOutsideClose = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('.cm-md-table-context-menu')) {
        closeTableMenu();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeTableMenu();
    };

    const openTableMenu = (event: MouseEvent, rowIndex: number, columnIndex: number) => {
      event.preventDefault();
      event.stopPropagation();
      closeTableMenu();

      const menu = document.createElement('div');
      menu.className = 'cm-md-table-context-menu';

      const addLeaf = (label: string, action: () => void) => {
        const item = document.createElement('div');
        item.className = 'cm-md-table-context-item';
        item.textContent = label;
        item.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          action();
          closeTableMenu();
        });
        return item;
      };

      const addSubmenu = (label: string, items: { label: string; action: () => void }[]) => {
        const item = document.createElement('div');
        item.className = 'cm-md-table-context-item cm-md-table-context-parent';
        const text = document.createElement('span');
        text.textContent = label;
        item.appendChild(text);
        const submenu = document.createElement('div');
        submenu.className = 'cm-md-table-context-submenu';
        items.forEach((entry) => submenu.appendChild(addLeaf(entry.label, entry.action)));
        item.appendChild(submenu);
        return item;
      };

      menu.appendChild(
        addSubmenu('行', [
          {
            label: '在上方新增行',
            action: () => insertTableRowAbove(view, this.block, rowIndex),
          },
          {
            label: '在下方新增行',
            action: () => insertTableRowBelow(view, this.block, rowIndex - 1),
          },
          {
            label: '向上移动行',
            action: () => moveTableRow(view, this.block, rowIndex, -1),
          },
          {
            label: '向下移动行',
            action: () => moveTableRow(view, this.block, rowIndex, 1),
          },
          {
            label: '复制行',
            action: () => copyTableRow(view, this.block, rowIndex),
          },
          {
            label: '删除行',
            action: () => deleteTableRow(view, this.block, rowIndex - 1),
          },
        ]),
      );

      menu.appendChild(
        addSubmenu('列', [
          {
            label: '在左侧新增列',
            action: () => insertTableColumnBefore(view, this.block, columnIndex),
          },
          {
            label: '在右侧新增列',
            action: () => insertTableColumnAfter(view, this.block, columnIndex),
          },
          {
            label: '向左移动列',
            action: () => moveTableColumn(view, this.block, columnIndex, -1),
          },
          {
            label: '向右移动列',
            action: () => moveTableColumn(view, this.block, columnIndex, 1),
          },
          {
            label: '复制列',
            action: () => copyTableColumn(view, this.block, columnIndex),
          },
          {
            label: '删除列',
            action: () => deleteTableColumn(view, this.block, columnIndex),
          },
        ]),
      );

      menu.appendChild(
        addSubmenu('排序', [
          {
            label: '按升序排列 (A-Z)',
            action: () => sortTableRows(view, this.block, columnIndex, 'asc'),
          },
          {
            label: '按降序排列 (Z-A)',
            action: () => sortTableRows(view, this.block, columnIndex, 'desc'),
          },
        ]),
      );

      menu.appendChild(
        addSubmenu('对齐', [
          {
            label: '左对齐',
            action: () => setTableColumnAlignment(view, this.block, columnIndex, 'left'),
          },
          {
            label: '居中对齐',
            action: () => setTableColumnAlignment(view, this.block, columnIndex, 'center'),
          },
          {
            label: '右对齐',
            action: () => setTableColumnAlignment(view, this.block, columnIndex, 'right'),
          },
        ]),
      );

      menu.style.left = `${Math.min(event.clientX, window.innerWidth - 240)}px`;
      menu.style.top = `${Math.min(event.clientY, window.innerHeight - 320)}px`;
      document.body.appendChild(menu);
      document.addEventListener('mousedown', handleOutsideClose);
      document.addEventListener('keydown', handleEscape);
    };

    const createBodyCell = (content: string, rowIndex: number, columnIndex: number) => {
      const cell = document.createElement('td');
      cell.dataset.tableRow = String(rowIndex);
      cell.dataset.tableColumn = String(columnIndex);
      cell.innerHTML = renderTableCell(content) || '&nbsp;';
      const alignment = this.block.alignments[columnIndex] ?? null;
      if (alignment) cell.style.textAlign = alignment;
      cell.addEventListener('mousedown', (event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
        startCellEdit(cell, rowIndex, columnIndex, content);
      });
      cell.addEventListener('contextmenu', (event) => {
        openTableMenu(event, rowIndex, columnIndex);
      });
      return cell;
    };

    const createHeaderCell = (content: string, column: number) => {
      const cell = document.createElement('th');
      cell.dataset.tableRow = '0';
      cell.dataset.tableColumn = String(column);
      cell.innerHTML = renderTableCell(content) || '&nbsp;';
      const alignment = this.block.alignments[column] ?? null;
      if (alignment) cell.style.textAlign = alignment;

      cell.addEventListener('mousedown', (event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
        startCellEdit(cell, 0, column, content);
      });
      cell.addEventListener('contextmenu', (event) => {
        openTableMenu(event, 0, column);
      });
      return cell;
    };

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    this.block.header.forEach((cellText, column) => {
      headerRow.appendChild(createHeaderCell(cellText, column));
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    this.block.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      row.forEach((cellText, column) => {
        tr.appendChild(createBodyCell(cellText, rowIndex + 1, column));
      });

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    if (pendingCellFocus && pendingCellFocus.startLine === this.block.startLine) {
      const target = pendingCellFocus;
      pendingCellFocus = null;
      requestAnimationFrame(() => {
        const targetCell = table.querySelector<HTMLElement>(
          `[data-table-row="${target.rowIndex}"][data-table-column="${target.columnIndex}"]`,
        );
        if (!targetCell) return;
        const nextContent =
          target.rowIndex === 0
            ? (this.block.header[target.columnIndex] ?? '')
            : (this.block.rows[target.rowIndex - 1]?.[target.columnIndex] ?? '');
        startCellEdit(targetCell, target.rowIndex, target.columnIndex, nextContent);
      });
    }

    shell.appendChild(table);
    return shell;
  }

  ignoreEvent() {
    return true;
  }
}
