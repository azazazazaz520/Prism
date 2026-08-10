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
import { markdown } from '@codemirror/lang-markdown';
import { bracketMatching } from '@codemirror/language';
import { oneDarkTheme } from '@codemirror/theme-one-dark';
import { replaceEditorDocument } from './editor-document-sync';

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

const taskReferenceLine =
  /^(\s*[-*+]\s+)\[([ xX])\](?=\s+.*<!--\s*prism-task:[A-Za-z0-9_-]+\s*-->)/;
const thematicBreakLine = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const codeFenceLine = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const blockquotePrefix = /^(\s{0,3}(?:>\s?)+)/;

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

class CodeFenceWidget extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly closing: boolean,
  ) {
    super();
  }

  eq(other: CodeFenceWidget) {
    return other.from === this.from && other.closing === this.closing;
  }

  toDOM(view: EditorView) {
    const fence = document.createElement('div');
    fence.className = `cm-live-code-fence${this.closing ? ' cm-live-code-fence-bottom' : ' cm-live-code-fence-top'}`;
    fence.setAttribute('role', 'separator');
    fence.setAttribute('aria-label', 'Markdown 代码块边界');
    fence.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.focus();
      view.dispatch({ selection: { anchor: this.from } });
    });
    return fence;
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
      for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
        const line = view.state.doc.line(lineNumber);
        const match = taskReferenceLine.exec(line.text);
        if (!match) continue;
        const checkboxFrom = line.from + match[1].length;
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

interface InlineDecoration {
  from: number;
  to: number;
  className: string;
  tokenFrom: number;
  tokenTo: number;
}

function collectInlineDecorations(text: string, offset: number): InlineDecoration[] {
  const decorations: InlineDecoration[] = [];
  const add = (from: number, to: number, className: string, tokenFrom: number, tokenTo: number) => {
    if (to > from) {
      decorations.push({
        from: offset + from,
        to: offset + to,
        className,
        tokenFrom: offset + tokenFrom,
        tokenTo: offset + tokenTo,
      });
    }
  };

  for (const match of text.matchAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g)) {
    const start = match.index ?? 0;
    const labelStart = start + 1;
    const labelEnd = labelStart + match[1].length;
    const tokenEnd = start + match[0].length;
    add(start, labelStart, 'cm-md-syntax', start, tokenEnd);
    add(labelStart, labelEnd, 'cm-md-link', start, tokenEnd);
    add(labelEnd, tokenEnd, 'cm-md-syntax', start, tokenEnd);
  }

  for (const match of text.matchAll(/(\*\*|__)(.+?)\1/g)) {
    const start = match.index ?? 0;
    const bodyStart = start + match[1].length;
    const bodyEnd = bodyStart + match[2].length;
    const tokenEnd = start + match[0].length;
    add(start, bodyStart, 'cm-md-syntax', start, tokenEnd);
    add(bodyStart, bodyEnd, 'cm-md-bold', start, tokenEnd);
    add(bodyEnd, tokenEnd, 'cm-md-syntax', start, tokenEnd);
  }

  for (const match of text.matchAll(/~~(.+?)~~/g)) {
    const start = match.index ?? 0;
    const bodyStart = start + 2;
    const bodyEnd = bodyStart + match[1].length;
    const tokenEnd = start + match[0].length;
    add(start, bodyStart, 'cm-md-syntax', start, tokenEnd);
    add(bodyStart, bodyEnd, 'cm-md-strike', start, tokenEnd);
    add(bodyEnd, tokenEnd, 'cm-md-syntax', start, tokenEnd);
  }

  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const start = match.index ?? 0;
    const bodyStart = start + 1;
    const bodyEnd = bodyStart + match[1].length;
    const tokenEnd = start + match[0].length;
    add(start, bodyStart, 'cm-md-syntax', start, tokenEnd);
    add(bodyStart, bodyEnd, 'cm-md-code', start, tokenEnd);
    add(bodyEnd, tokenEnd, 'cm-md-syntax', start, tokenEnd);
  }

  for (const match of text.matchAll(/(?<![*_])([*_])([^*_\n]+?)\1(?![*_])/g)) {
    const start = match.index ?? 0;
    const bodyStart = start + 1;
    const bodyEnd = bodyStart + match[2].length;
    const tokenEnd = start + match[0].length;
    add(start, bodyStart, 'cm-md-syntax', start, tokenEnd);
    add(bodyStart, bodyEnd, 'cm-md-italic', start, tokenEnd);
    add(bodyEnd, tokenEnd, 'cm-md-syntax', start, tokenEnd);
  }

  return decorations;
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations;
    activeLine = 1;

    constructor(view: EditorView) {
      this.activeLine = view.state.doc.lineAt(view.state.selection.main.head).number;
      this.decorations = this.build(view);
    }

    update(update: { view: EditorView; docChanged: boolean; selectionSet: boolean }) {
      const nextLine = update.view.state.doc.lineAt(update.view.state.selection.main.head).number;
      if (update.docChanged || (update.selectionSet && nextLine !== this.activeLine)) {
        this.activeLine = nextLine;
        this.decorations = this.build(update.view);
      }
    }

    build(view: EditorView) {
      const builder = new RangeSetBuilder<Decoration>();
      const activeLine = view.state.doc.lineAt(view.state.selection.main.head).number;
      const cursorPosition = view.state.selection.main.head;
      const cursorInside = (from: number, to: number) =>
        cursorPosition >= from && cursorPosition <= to;
      const editableCodeLines = new Set<number>();
      let scanFence: { character: string; length: number; start: number } | null = null;
      for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
        const line = view.state.doc.line(lineNumber);
        const fenceMatch = codeFenceLine.exec(line.text);
        if (!fenceMatch) continue;

        const isClosingFence = Boolean(
          scanFence &&
          fenceMatch[1][0] === scanFence.character &&
          fenceMatch[1].length >= scanFence.length,
        );
        if (!scanFence) {
          scanFence = {
            character: fenceMatch[1][0],
            length: fenceMatch[1].length,
            start: lineNumber,
          };
        } else if (isClosingFence) {
          if (activeLine >= scanFence.start && activeLine <= lineNumber) {
            for (
              let editableLine = scanFence.start;
              editableLine <= lineNumber;
              editableLine += 1
            ) {
              editableCodeLines.add(editableLine);
            }
          }
          scanFence = null;
        }
      }
      if (scanFence && activeLine >= scanFence.start) {
        for (
          let editableLine = scanFence.start;
          editableLine <= view.state.doc.lines;
          editableLine += 1
        ) {
          editableCodeLines.add(editableLine);
        }
      }

      let codeFence: { character: string; length: number; firstContent: boolean } | null = null;
      for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
        const line = view.state.doc.line(lineNumber);
        const editingCodeBlock = editableCodeLines.has(lineNumber);

        const fenceMatch = codeFenceLine.exec(line.text);
        const isClosingFence: boolean = Boolean(
          codeFence &&
          fenceMatch &&
          fenceMatch[1][0] === codeFence.character &&
          fenceMatch[1].length >= codeFence.length,
        );
        if (fenceMatch && (!codeFence || isClosingFence)) {
          const fenceClasses = editingCodeBlock
            ? [
                'cm-live-code-block',
                'cm-live-code-editing-fence',
                isClosingFence ? 'cm-live-code-editing-bottom' : 'cm-live-code-editing-top',
              ].join(' ')
            : 'cm-live-code-fence-line';
          builder.add(line.from, line.from, Decoration.line({ class: fenceClasses }));
          if (!editingCodeBlock) {
            builder.add(
              line.from,
              line.to,
              Decoration.replace({
                widget: new CodeFenceWidget(line.from, isClosingFence),
              }),
            );
          }

          codeFence = isClosingFence
            ? null
            : { character: fenceMatch[1][0], length: fenceMatch[1].length, firstContent: true };
          continue;
        }

        if (codeFence) {
          const nextLine =
            lineNumber < view.state.doc.lines ? view.state.doc.line(lineNumber + 1) : null;
          const nextFence = nextLine ? codeFenceLine.exec(nextLine.text) : null;
          const nextIsClosingFence = Boolean(
            nextFence &&
            nextFence[1][0] === codeFence.character &&
            nextFence[1].length >= codeFence.length,
          );
          const contentClasses = [
            'cm-live-code-block',
            'cm-live-code-content-line',
            ...(codeFence.firstContent && !editingCodeBlock ? ['cm-live-code-content-first'] : []),
            ...(nextIsClosingFence && !editingCodeBlock ? ['cm-live-code-content-last'] : []),
          ].join(' ');
          builder.add(line.from, line.from, Decoration.line({ class: contentClasses }));
          builder.add(line.from, line.to, Decoration.mark({ class: 'cm-live-code-content' }));
          codeFence.firstContent = false;
          continue;
        }

        const heading = /^(#{1,6})\s+/.exec(line.text);
        if (heading) {
          builder.add(
            line.from,
            line.from,
            Decoration.line({ class: `cm-live-heading cm-live-heading-${heading[1].length}` }),
          );
          if (!cursorInside(line.from, line.to)) {
            builder.add(
              line.from,
              line.from + heading[1].length,
              Decoration.mark({ class: 'cm-md-syntax' }),
            );
          }
        }

        if (thematicBreakLine.test(line.text) && !cursorInside(line.from, line.to)) {
          builder.add(line.from, line.from, Decoration.line({ class: 'cm-live-divider' }));
          builder.add(line.from, line.to, Decoration.mark({ class: 'cm-live-divider-syntax' }));
        }

        const quote = blockquotePrefix.exec(line.text);
        if (quote) {
          builder.add(line.from, line.from, Decoration.line({ class: 'cm-live-blockquote' }));
          if (!cursorInside(line.from, line.from + quote[1].length)) {
            builder.add(
              line.from,
              line.from + quote[1].length,
              Decoration.mark({ class: 'cm-md-syntax' }),
            );
          }
        }

        const inlineDecorations = collectInlineDecorations(line.text, line.from)
          .filter((decoration) => !cursorInside(decoration.tokenFrom, decoration.tokenTo))
          .sort((a, b) => a.from - b.from || b.to - a.to);
        let lastTo = -1;
        for (const decoration of inlineDecorations) {
          if (decoration.from < lastTo) continue;
          builder.add(
            decoration.from,
            decoration.to,
            Decoration.mark({ class: decoration.className }),
          );
          lastTo = decoration.to;
        }

        const taskMetaStart = line.text.indexOf('<' + '!-- prism-task:');
        if (
          taskMetaStart >= 0 &&
          line.text.endsWith('-->') &&
          !cursorInside(line.from + taskMetaStart, line.to)
        ) {
          builder.add(
            line.from + taskMetaStart,
            line.to,
            Decoration.mark({ class: 'cm-task-meta' }),
          );
        }
      }
      return builder.finish();
    }
  },
  { decorations: (value) => value.decorations },
);

// ── 构建扩展 ───────────────────────────────

function buildExtensions(codeLanguages: readonly LanguageDescription[] = []) {
  return [
    historyComp.of(history()),
    // 使用浏览器原生文字选区，避免 Live Preview 的块级装饰把选区扩展成整块背景。
    dropCursor(),
    bracketMatching(),
    markdown({ codeLanguages }),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    taskCheckboxPlugin,
    livePreviewPlugin,
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

defineExpose({
  insertText,
  wrapSelection,
  focus,
  getSelection,
  replaceSelection,
  selectAll,
  prependToLine,
  scrollToLine,
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

.codemirror-wrapper :deep(.cm-live-code-fence) {
  display: block;
  width: 100%;
  height: 8px;
  box-sizing: border-box;
  background: transparent;
  cursor: text;
}

.codemirror-wrapper :deep(.cm-live-code-fence-line) {
  height: 8px;
  padding: 0 !important;
  line-height: 8px;
  background: transparent;
}

.codemirror-wrapper :deep(.cm-live-code-content-line) {
  padding: 0 14px;
  line-height: 1.55;
}

.codemirror-wrapper :deep(.cm-live-code-editing-fence) {
  min-height: 1.55em;
  padding: 0 14px !important;
  color: var(--text-muted);
  font-family: var(--font-mono);
  line-height: 1.55;
}

.codemirror-wrapper :deep(.cm-live-code-editing-top) {
  border-top: 1px solid var(--border-subtle);
  border-top-left-radius: var(--radius-sm);
  border-top-right-radius: var(--radius-sm);
}

.codemirror-wrapper :deep(.cm-live-code-editing-bottom) {
  border-bottom: 1px solid var(--border-subtle);
  border-bottom-left-radius: var(--radius-sm);
  border-bottom-right-radius: var(--radius-sm);
}

.codemirror-wrapper :deep(.cm-live-code-fence-top) {
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}

.codemirror-wrapper :deep(.cm-live-code-fence-bottom) {
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
}

.codemirror-wrapper :deep(.cm-live-code-block) {
  box-sizing: border-box;
  background: var(--bg-tertiary);
  border-left: 1px solid var(--border-subtle);
  border-right: 1px solid var(--border-subtle);
}

.codemirror-wrapper :deep(.cm-live-code-content-first) {
  border-top: 1px solid var(--border-subtle);
  border-top-left-radius: var(--radius-sm);
  border-top-right-radius: var(--radius-sm);
}

.codemirror-wrapper :deep(.cm-live-code-content-last) {
  border-bottom: 1px solid var(--border-subtle);
  border-bottom-left-radius: var(--radius-sm);
  border-bottom-right-radius: var(--radius-sm);
}

.codemirror-wrapper :deep(.cm-live-code-content) {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.9em;
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
  font-family: 'Cascadia Code', 'Fira Code', monospace;
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
