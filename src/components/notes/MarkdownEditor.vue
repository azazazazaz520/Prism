<script setup lang="ts">
/**
 * Markdown 编辑器组件，基于 CodeMirror 6 封装。
 *
 * 双向同步机制：父组件通过 v-model（:modelValue + @update:modelValue）
 * 传入初始内容并接收编辑变更。组件内部通过最近一次发出的内容防止
 * 「外部写入 → 内容同步 → 触发 update 事件 → 再次写入」的无限循环。
 * 支持动态明暗主题切换、Ctrl+S 手动保存、光标行列位置上报，并通过
 * defineExpose 暴露文本操作 API（插入、包裹选中、行首插入等）。
 */
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { EditorState, Compartment, RangeSetBuilder } from '@codemirror/state';
import type { LanguageDescription } from '@codemirror/language';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  dropCursor,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { oneDarkTheme } from '@codemirror/theme-one-dark';
import { replaceEditorDocument } from './editor-document-sync';
import { createMarkdownSupport } from '../../notes/markdown-syntax';
import { createSyntaxTreeViewPlugin } from '../../notes/syntax-tree-view-plugin';
import { parseTaskReferences } from '../../notes/task-references';
import {
  buildTableDecorations,
  moveToNextCell,
  moveToNextRow,
  moveToPreviousCell,
} from './table-preview';

// ── Props & Emits ──────────────────────────

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    disabled?: boolean;
  }>(),
  {
    placeholder: '',
    disabled: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'cursor-change': [line: number, col: number];
  save: [];
}>();

// ── 状态 ───────────────────────────────────

const editorRef = ref<HTMLDivElement | null>(null);
const pendingSearchMatch = ref<{
  line: number;
  columnUtf16: number;
  lengthUtf16: number;
} | null>(null);
let view: EditorView | null = null;
/** 标记位：防止 modelValue watch 触发的双向绑定写回循环。
 *  当 EditorView 内部修改文档时设 true，watch 检测到此标记会跳过回写。 */
let lastEmittedValue: string | null = null;

/** 文档切换时重建撤销历史，避免多个笔记共享撤销栈。 */
const historyComp = new Compartment();

// ── 主题检测 ───────────────────────────────

function isDark(): boolean {
  const attr = document.documentElement.dataset.theme || 'auto';
  if (attr === 'dark' || attr === 'hud') return true;
  if (attr === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 动态主题 Compartment */
const themeComp = new Compartment();

// ── 自定义主题（布局/间距，叠加在 oneDark/default 之上） ──

const customTheme = EditorView.theme({
  '&': {
    fontSize: '16px',
    fontFamily: "'Segoe UI', 'Microsoft YaHei', sans-serif",
    lineHeight: '1.8',
    color: 'var(--text-primary)',
    backgroundColor: 'var(--bg-primary)',
    border: 'none',
    outline: 'none',
    width: '100%',
    height: '100%',
    minWidth: '0',
    minHeight: '0',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '& .cm-content::selection, & .cm-content *::selection, & .cm-line::selection, & .cm-line *::selection':
    {
      backgroundColor: 'var(--editor-selection-bg) !important',
      color: 'var(--editor-selection-text) !important',
    },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    overflowY: 'auto',
    overflowX: 'hidden',
    width: '100%',
    height: '100%',
    minWidth: '0',
    minHeight: '0',
    display: 'block',
  },
  '.cm-content': {
    width: 'min(100%, 820px)',
    maxWidth: '820px',
    boxSizing: 'border-box',
    padding: '28px 32px 120px',
    fontFamily: 'inherit',
    caretColor: 'var(--accent)',
    margin: '0 auto',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  '.cm-line': {
    padding: '0',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  },
  '.cm-gutters': {
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    borderRight: '1px solid var(--border-subtle)',
    fontSize: '11px',
    userSelect: 'none',
  },
  '.cm-gutterElement': {
    padding: '0 8px 0 6px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
});

// ── Ctrl+S 手动保存 ────────────────────────

const saveKeymap = keymap.of([
  {
    key: 'Mod-s',
    run: () => {
      emit('save');
      return true;
    },
    preventDefault: true,
  },
]);

const tableNavigationKeymap = keymap.of([
  {
    key: 'Tab',
    run: (target) => moveToNextCell(target),
    shift: (target) => moveToPreviousCell(target),
  },
  {
    key: 'Enter',
    run: (target) => moveToNextRow(target),
  },
]);

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget) {
    return other.checked === this.checked && other.from === this.from;
  }

  toDOM(view: EditorView) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-task-checkbox';
    button.textContent = this.checked ? '✓' : '';
    button.setAttribute('aria-label', this.checked ? '标记为未完成' : '标记为已完成');
    button.setAttribute('aria-pressed', String(this.checked));
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        changes: {
          from: this.from,
          to: this.from + 3,
          insert: this.checked ? '[ ]' : '[x]',
        },
      });
    });
    return button;
  }

  ignoreEvent() {
    return true;
  }
}

class HorizontalRuleWidget extends WidgetType {
  constructor(private readonly from: number) {
    super();
  }

  eq(other: HorizontalRuleWidget) {
    return other.from === this.from;
  }

  toDOM(view: EditorView) {
    const divider = document.createElement('div');
    divider.className = 'cm-live-divider';
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-label', 'Markdown 分割线');
    divider.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.focus();
      view.dispatch({ selection: { anchor: this.from } });
    });
    return divider;
  }

  ignoreEvent() {
    return true;
  }
}

const taskCheckboxPlugin = ViewPlugin.fromClass(
  class {
    decorations;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: { view: EditorView; docChanged: boolean }) {
      if (update.docChanged) this.decorations = this.build(update.view);
    }

    build(view: EditorView) {
      const builder = new RangeSetBuilder<Decoration>();
      for (const reference of parseTaskReferences(view.state.doc.toString(), '')) {
        const line = view.state.doc.line(reference.line);
        const match = /\[([ xX])\]/.exec(line.text);
        if (!match) continue;
        const checkboxFrom = line.from + match.index;
        builder.add(
          checkboxFrom,
          checkboxFrom + 3,
          Decoration.replace({
            widget: new TaskCheckboxWidget(match[2].toLowerCase() === 'x', checkboxFrom),
          }),
        );
      }
      return builder.finish();
    }
  },
  { decorations: (value) => value.decorations },
);

interface PreviewRange {
  from: number;
  to: number;
  className: string;
  tokenFrom: number;
  tokenTo: number;
}

function collectInlineDecorations(
  state: EditorState,
  tree: ReturnType<typeof syntaxTree>,
): PreviewRange[] {
  const ranges: PreviewRange[] = [];
  const add = (from: number, to: number, className: string, tokenFrom: number, tokenTo: number) => {
    if (to > from) ranges.push({ from, to, className, tokenFrom, tokenTo });
  };
  const visit = (parent: ReturnType<typeof syntaxTree>['topNode']) => {
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      const children = [];
      for (let child = node.firstChild; child; child = child.nextSibling) children.push(child);
      const marks = children.filter((child) =>
        ['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark'].includes(child.name),
      );
      const tokenFrom = marks[0]?.from ?? node.from;
      const tokenTo = marks[marks.length - 1]?.to ?? node.to;
      const bodyFrom = marks[0]?.to ?? node.from;
      const bodyTo = marks.length > 1 ? marks[1].from : (marks[marks.length - 1]?.from ?? node.to);
      const className = {
        StrongEmphasis: 'cm-md-bold',
        Emphasis: 'cm-md-italic',
        Strikethrough: 'cm-md-strike',
        InlineCode: 'cm-md-code',
        Link: 'cm-md-link',
        Image: 'cm-md-link',
      }[node.name];
      if (className && node.name !== 'Image' && bodyTo > bodyFrom)
        add(bodyFrom, bodyTo, className, node.from, node.to);
      if (node.name === 'Link' || node.name === 'Image') {
        for (const child of children) {
          if (child.name === 'URL' || child.name === 'LinkTitle')
            add(child.from, child.to, 'cm-md-syntax', node.from, node.to);
        }
      }
      if (className) {
        for (const mark of marks) add(mark.from, mark.to, 'cm-md-syntax', node.from, node.to);
      }
      if (node.name === 'Image' && marks.length > 1) {
        add(marks[0].to, marks[1].from, 'cm-md-link', node.from, node.to);
      }
      if (node.name === 'Task') {
        const findMetadata = (taskNode: ReturnType<typeof syntaxTree>['topNode']) => {
          for (let child = taskNode.firstChild; child; child = child.nextSibling) {
            if (
              child.name === 'Comment' &&
              /<!--\s*prism-task:[A-Za-z0-9_-]+\s*-->/.test(
                state.doc.sliceString(child.from, child.to),
              )
            ) {
              add(child.from, child.to, 'cm-task-meta', node.from, node.to);
            }
            findMetadata(child);
          }
        };
        findMetadata(node);
      }
      visit(node);
    }
  };
  visit(tree.topNode);
  return ranges;
}

function buildLivePreview(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  const pending: { from: number; to: number; decoration: Decoration }[] = [];
  const doc = view.state.doc;
  const selections = view.state.selection.ranges;
  const cursorInside = (from: number, to: number) =>
    selections.some((range) => range.from <= to && range.to >= from);
  const visible = (from: number, to: number) =>
    view.visibleRanges.some((range) => range.from <= to && range.to >= from) ||
    selections.some((range) => range.from <= to && range.to >= from);
  const parseThrough = view.visibleRanges.reduce((end, range) => Math.max(end, range.to), 0);
  const tree = ensureSyntaxTree(view.state, parseThrough, 20) ?? syntaxTree(view.state);
  const ranges: PreviewRange[] = [];
  const blockNodes: {
    node: ReturnType<typeof syntaxTree>['topNode'];
    name: string;
    from: number;
    to: number;
  }[] = [];
  const visit = (parent: ReturnType<typeof syntaxTree>['topNode']) => {
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      if (
        /^(?:FencedCode|CodeBlock|ATXHeading[1-6]|SetextHeading[1-2]|HorizontalRule|Blockquote)$/.test(
          node.name,
        )
      ) {
        blockNodes.push({ node, name: node.name, from: node.from, to: node.to });
      }
      visit(node);
    }
  };
  visit(tree.topNode);
  for (const block of blockNodes) {
    if (!visible(block.from, block.to)) continue;
    const startLine = doc.lineAt(block.from);
    const endLine = doc.lineAt(block.to);
    if (block.name === 'FencedCode' || block.name === 'CodeBlock') {
      const codeNode = block.node;
      if (codeNode) {
        const codeChildren = [];
        for (let child = codeNode.firstChild; child; child = child.nextSibling)
          codeChildren.push(child);
        for (const child of codeChildren) {
          if (child.name === 'CodeMark' || child.name === 'CodeInfo') {
            ranges.push({
              from: child.from,
              to: child.to,
              className: 'cm-live-code-fence-syntax',
              tokenFrom: block.from,
              tokenTo: block.to,
            });
          } else if (child.name === 'CodeText') {
            ranges.push({
              from: child.from,
              to: child.to,
              className: 'cm-live-code-content',
              tokenFrom: block.from,
              tokenTo: block.to,
            });
          }
        }
      }
      for (let number = startLine.number; number <= endLine.number; number += 1) {
        const line = doc.line(number);
        const isFenceLine =
          block.name === 'FencedCode' && (number === startLine.number || number === endLine.number);
        pending.push({
          from: line.from,
          to: line.from,
          decoration: Decoration.line({
            class: isFenceLine
              ? `cm-live-code-block cm-live-code-fence-line ${number === startLine.number ? 'cm-live-code-fence-top' : 'cm-live-code-fence-bottom'}`
              : 'cm-live-code-block cm-live-code-content-line',
          }),
        });
      }
      continue;
    }
    if (/^(?:ATXHeading|SetextHeading)/.test(block.name)) {
      const level = Number(block.name.match(/[1-6]$/)?.[0] ?? 1);
      pending.push({
        from: startLine.from,
        to: startLine.from,
        decoration: Decoration.line({
          class: `cm-live-heading cm-live-heading-${level}`,
        }),
      });
      for (let part = block.node.firstChild; part; part = part.nextSibling) {
        if (part.name === 'HeaderMark')
          ranges.push({
            from: part.from,
            to: part.to,
            className: 'cm-md-syntax',
            tokenFrom: block.from,
            tokenTo: block.to,
          });
      }
    } else if (block.name === 'HorizontalRule') {
      pending.push({
        from: startLine.from,
        to: startLine.from,
        decoration: Decoration.line({ class: 'cm-live-divider' }),
      });
      ranges.push({
        from: block.from,
        to: block.to,
        className: 'cm-live-divider-syntax',
        tokenFrom: block.from,
        tokenTo: block.to,
      });
    } else if (block.name === 'Blockquote') {
      for (let number = startLine.number; number <= endLine.number; number += 1) {
        const line = doc.line(number);
        pending.push({
          from: line.from,
          to: line.from,
          decoration: Decoration.line({ class: 'cm-live-blockquote' }),
        });
      }
      for (let child = block.node.firstChild; child; child = child.nextSibling) {
        if (child.name === 'QuoteMark')
          ranges.push({
            from: child.from,
            to: child.to,
            className: 'cm-md-syntax',
            tokenFrom: block.from,
            tokenTo: block.to,
          });
      }
    }
  }
  ranges.push(...collectInlineDecorations(view.state, tree));
  for (const range of ranges.sort((a, b) => a.from - b.from || a.to - b.to)) {
    if (!visible(range.from, range.to) || cursorInside(range.tokenFrom, range.tokenTo)) continue;
    pending.push({
      from: range.from,
      to: range.to,
      decoration: Decoration.mark({ class: range.className }),
    });
  }
  pending.sort(
    (a, b) => a.from - b.from || a.decoration.startSide - b.decoration.startSide || a.to - b.to,
  );
  for (const range of pending) builder.add(range.from, range.to, range.decoration);
  return builder.finish();
}

const livePreviewPlugin = createSyntaxTreeViewPlugin(buildLivePreview);

// ── 构建扩展 ───────────────────────────────

function buildExtensions(codeLanguages: readonly LanguageDescription[] = []) {
  return [
    historyComp.of(history()),
    // 使用浏览器原生文字选区，避免 Live Preview 的块级装饰把选区扩展成整块背景。
    dropCursor(),
    bracketMatching(),
    createMarkdownSupport(codeLanguages),
    tableNavigationKeymap,
    keymap.of([...defaultKeymap, ...historyKeymap]),
    taskCheckboxPlugin,
    livePreviewPlugin,
    EditorView.decorations.compute(['doc', 'selection'], (state) => buildTableDecorations(state)),
    saveKeymap,
    themeComp.of(isDark() ? oneDarkTheme : []),
    customTheme,
    EditorView.updateListener.of((update) => {
      // 内容变更 → 通知父组件
      if (update.docChanged) {
        lastEmittedValue = update.state.doc.toString();
        emit('update:modelValue', lastEmittedValue);
      }
      // 光标/选区变更 → 上报行列
      if (update.selectionSet || update.docChanged) {
        const pos = update.state.selection.main.head;
        const line = update.state.doc.lineAt(pos);
        emit('cursor-change', line.number, pos - line.from + 1);
      }
    }),
  ];
}

// ── 外部内容同步（打开新文件） ──────────────

watch(
  () => props.modelValue,
  (newVal) => {
    if (!view) return;
    if (newVal === lastEmittedValue) {
      lastEmittedValue = null;
      return;
    }
    const current = view.state.doc.toString();
    if (newVal !== current) {
      replaceEditorDocument(view, historyComp, newVal);
    }
    lastEmittedValue = null;
  },
);

// ── 生命周期 ───────────────────────────────

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

function handleThemeChange() {
  if (!view) return;
  view.dispatch({
    effects: themeComp.reconfigure(isDark() ? oneDarkTheme : []),
  });
}

const themeObserver = new MutationObserver(() => {
  handleThemeChange();
});

onMounted(async () => {
  if (!editorRef.value) return;

  // 将语言描述移出首屏主包，具体语言仍由 CodeMirror 在需要时动态加载。
  const { languages } = await import('@codemirror/language-data');
  if (!editorRef.value) return;

  const state = EditorState.create({
    doc: props.modelValue,
    extensions: buildExtensions(languages),
  });

  view = new EditorView({
    state,
    parent: editorRef.value,
  });
  if (pendingSearchMatch.value) {
    const pending = pendingSearchMatch.value;
    pendingSearchMatch.value = null;
    revealSearchMatch(pending.line, pending.columnUtf16, pending.lengthUtf16);
  }

  // 监听 <html data-theme=""> 属性变化
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  // 监听系统颜色方案变化
  mediaQuery.addEventListener('change', handleThemeChange);
});

onUnmounted(() => {
  view?.destroy();
  view = null;
  themeObserver.disconnect();
  mediaQuery.removeEventListener('change', handleThemeChange);
});

// ── 公开方法（方向二工具栏使用） ────────────

/** 在光标位置插入文本，替换当前选区（若有选中内容）。
 *  插入后自动聚焦编辑器。 */
function insertText(text: string) {
  if (!view) return;
  view.dispatch(view.state.replaceSelection(text));
  view.focus();
}

/** 用指定的 before/after 文本包裹当前选区。
 *  若无选区（光标仅闪烁），则在光标位置插入 before + after。
 *  包裹后重新选中 between 之间的内容，方便连续操作（如加粗后继续输入）。 */
function wrapSelection(before: string, after: string) {
  if (!view) return;
  const { from, to } = view.state.selection.main;
  const selected = view.state.doc.sliceString(from, to);
  view.dispatch(view.state.replaceSelection(before + selected + after));
  // 重新选中 between before/after 之间的内容
  view.dispatch({
    selection: { anchor: from + before.length, head: from + before.length + selected.length },
  });
  view.focus();
}

function focus() {
  view?.focus();
}

function getSelection(): string {
  if (!view) return '';
  const { from, to } = view.state.selection.main;
  return view.state.doc.sliceString(from, to);
}

function selectAll() {
  if (!view) return;
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  view.focus();
}

function replaceSelection(text: string) {
  if (!view) return;
  view.dispatch(view.state.replaceSelection(text));
  view.focus();
}

/** 在当前行首插入文本，用于标题（#）、列表（-）、引用（>）等行级
 *  Markdown 标记操作。插入后自动聚焦编辑器。 */
function prependToLine(text: string) {
  if (!view) return;
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  view.dispatch({
    changes: { from: line.from, insert: text },
  });
  view.focus();
}

/** 将编辑器滚动到指定 Markdown 源码行，并将光标放到该行开头。 */
function scrollToLine(lineNumber: number): boolean {
  if (!view) return false;

  const line = Number.isFinite(lineNumber)
    ? Math.min(Math.max(Math.trunc(lineNumber), 1), view.state.doc.lines)
    : 1;
  const target = view.state.doc.line(line);
  view.dispatch({
    selection: { anchor: target.from },
    effects: EditorView.scrollIntoView(target.from, {
      y: 'start',
      yMargin: 24,
    }),
  });
  view.focus();
  return true;
}

/** 滚动到正文命中位置并选中对应的 UTF-16 文本范围。 */
function revealSearchMatch(lineNumber: number, columnUtf16: number, lengthUtf16: number): boolean {
  if (!view) {
    pendingSearchMatch.value = { line: lineNumber, columnUtf16, lengthUtf16 };
    return true;
  }

  const lineNumberClamped = Math.min(Math.max(Math.trunc(lineNumber), 1), view.state.doc.lines);
  const line = view.state.doc.line(lineNumberClamped);
  const column = Math.min(Math.max(Math.trunc(columnUtf16), 0), line.length);
  const from = line.from + column;
  const to = Math.min(line.to, from + Math.max(0, Math.trunc(lengthUtf16)));
  view.dispatch({
    selection: { anchor: from, head: to },
    effects: EditorView.scrollIntoView(from, { y: 'start', yMargin: 24 }),
  });
  view.focus();
  return true;
}

defineExpose({
  insertText,
  wrapSelection,
  focus,
  getSelection,
  replaceSelection,
  selectAll,
  prependToLine,
  scrollToLine,
  revealSearchMatch,
});
</script>

<template>
  <div ref="editorRef" class="codemirror-wrapper"></div>
</template>

<style scoped>
.codemirror-wrapper {
  display: flex;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.codemirror-wrapper :deep(.cm-md-table td[contenteditable='true']),
.codemirror-wrapper :deep(.cm-md-table th[contenteditable='true']) {
  outline: none;
  caret-color: currentColor;
}

.codemirror-wrapper :deep(.cm-md-table td),
.codemirror-wrapper :deep(.cm-md-table th) {
  cursor: text;
}

.codemirror-wrapper :deep(.cm-task-checkbox) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  margin: 0 4px 0 1px;
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: 3px;
  background: var(--bg-primary);
  color: var(--accent);
  font-size: 11px;
  line-height: 1;
  vertical-align: -2px;
  cursor: pointer;
}

.codemirror-wrapper :deep(.cm-task-checkbox:hover) {
  border-color: var(--accent);
}

.codemirror-wrapper :deep(.cm-live-heading) {
  font-weight: 700;
  letter-spacing: -0.025em;
}

.codemirror-wrapper :deep(.cm-live-heading-1) {
  font-size: 2em;
  line-height: 1.35;
}

.codemirror-wrapper :deep(.cm-live-heading-2) {
  font-size: 1.5em;
  line-height: 1.45;
}

.codemirror-wrapper :deep(.cm-live-heading-3) {
  font-size: 1.2em;
  line-height: 1.55;
}

.codemirror-wrapper :deep(.cm-live-divider) {
  display: block;
  width: 100%;
  height: 1.75em;
  margin: 0;
  background: linear-gradient(
    to bottom,
    transparent calc(50% - 0.5px),
    var(--border-default) calc(50% - 0.5px),
    var(--border-default) calc(50% + 0.5px),
    transparent calc(50% + 0.5px)
  );
  box-sizing: border-box;
  cursor: text;
}

.codemirror-wrapper :deep(.cm-live-divider-syntax) {
  color: transparent;
}

.codemirror-wrapper :deep(.cm-live-blockquote) {
  padding-left: 14px;
  border-left: 3px solid var(--accent-muted);
  color: var(--text-secondary);
}

.codemirror-wrapper :deep(.cm-live-code-fence-line) {
  height: 1.55em;
  padding: 0 14px !important;
  color: var(--text-muted);
  font-family: var(--font-mono);
  line-height: 1.55;
}

.codemirror-wrapper :deep(.cm-live-code-fence-syntax) {
  color: transparent;
}

.codemirror-wrapper :deep(.cm-live-code-content-line) {
  padding: 0 14px;
  line-height: 1.55;
}

.codemirror-wrapper :deep(.cm-live-code-fence-top) {
  border-top: 1px solid var(--border-subtle);
  border-top-left-radius: var(--radius-sm);
  border-top-right-radius: var(--radius-sm);
}

.codemirror-wrapper :deep(.cm-live-code-fence-bottom) {
  border-bottom: 1px solid var(--border-subtle);
  border-bottom-left-radius: var(--radius-sm);
  border-bottom-right-radius: var(--radius-sm);
}

.codemirror-wrapper :deep(.cm-live-code-block) {
  box-sizing: border-box;
  background: var(--bg-tertiary);
  border-left: 1px solid var(--border-subtle);
  border-right: 1px solid var(--border-subtle);
}

.codemirror-wrapper :deep(.cm-live-code-content) {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.9em;
}

.codemirror-wrapper :deep(.cm-md-table-shell) {
  display: block;
  width: 100%;
  max-width: 100%;
  padding: 0.9em 0;
  box-sizing: border-box;
  font-size: 0.92em;
  overflow-x: auto;
}

.codemirror-wrapper :deep(.cm-md-table) {
  width: 100%;
  max-width: 100%;
  margin: 0;
  border-collapse: collapse;
  font-size: inherit;
  line-height: 1.6;
}

.codemirror-wrapper :deep(.cm-md-table th),
.codemirror-wrapper :deep(.cm-md-table td) {
  padding: 6px 12px;
  border: 1px solid var(--border-subtle);
  text-align: left;
  vertical-align: top;
}

.codemirror-wrapper :deep(.cm-md-table th) {
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-weight: 600;
}

.codemirror-wrapper :deep(.cm-md-table tr:nth-child(even) td) {
  background: var(--bg-secondary);
}

.codemirror-wrapper :deep(.cm-live-table-line) {
  font-variant-numeric: tabular-nums;
}

.codemirror-wrapper :deep(.cm-task-meta) {
  display: none;
}

.codemirror-wrapper :deep(.cm-md-syntax) {
  display: none;
}

.codemirror-wrapper :deep(.cm-md-bold) {
  font-weight: 700;
}

.codemirror-wrapper :deep(.cm-md-italic) {
  font-style: italic;
}

.codemirror-wrapper :deep(.cm-md-strike) {
  color: var(--text-muted);
  text-decoration: line-through;
}

.codemirror-wrapper :deep(.cm-md-code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 0.92em;
}

.codemirror-wrapper :deep(.cm-md-link) {
  color: var(--accent);
  text-decoration: underline;
  text-decoration-color: var(--accent-muted);
  text-underline-offset: 3px;
}

@media (max-width: 720px) {
  .codemirror-wrapper :deep(.cm-content) {
    padding: 24px 20px 96px;
  }
}
</style>

<style>
.cm-md-table-context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 180px;
  padding: 6px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated, var(--bg-primary));
  box-shadow: var(--shadow-lg, 0 12px 32px rgba(0, 0, 0, 0.22));
  color: var(--text-primary);
  font-size: var(--text-sm);
  user-select: none;
}

.cm-md-table-context-item {
  position: relative;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
}

.cm-md-table-context-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.cm-md-table-context-parent::after {
  content: '›';
  position: absolute;
  right: 10px;
  color: var(--text-muted);
}

.cm-md-table-context-submenu {
  display: none;
  position: absolute;
  left: calc(100% - 2px);
  top: -6px;
  min-width: 180px;
  padding: 6px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated, var(--bg-primary));
  box-shadow: var(--shadow-lg, 0 12px 32px rgba(0, 0, 0, 0.22));
}

.cm-md-table-context-parent:hover > .cm-md-table-context-submenu {
  display: block;
}
</style>
