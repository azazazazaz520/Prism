<script setup lang="ts">
/**
 * Markdown 编辑器组件，基于 CodeMirror 6 封装。
 *
 * 双向同步机制：父组件通过 v-model（:modelValue + @update:modelValue）
 * 传入初始内容并接收编辑变更。组件内部通过 suppressExternal 标记位防止
 * 「外部写入 → 内容同步 → 触发 update 事件 → 再次写入」的无限循环。
 * 支持动态明暗主题切换、Ctrl+S 手动保存、光标行列位置上报，并通过
 * defineExpose 暴露文本操作 API（插入、包裹选中、行首插入等）。
 */
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, dropCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { bracketMatching, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';

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
let suppressExternal = false;

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
    fontSize: 'var(--text-sm)',
    fontFamily: "'Cascadia Code', 'Fira Code', monospace",
    lineHeight: '1.7',
    color: 'var(--text-primary)',
    backgroundColor: 'var(--bg-primary)',
    border: 'none',
    outline: 'none',
    height: '100%',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    overflow: 'auto',
    width: '100%',
  },
  '.cm-content': {
    padding: 'var(--space-lg)',
    fontFamily: 'inherit',
    caretColor: 'var(--accent)',
  },
  '.cm-line': {
    padding: '0',
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

// ── 构建扩展 ───────────────────────────────

function buildExtensions() {
  return [
    lineNumbers(),
    history(),
    drawSelection(),
    dropCursor(),
    bracketMatching(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    markdown({ codeLanguages: languages }),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    saveKeymap,
    themeComp.of(isDark() ? oneDark : []),
    customTheme,
    EditorView.updateListener.of((update) => {
      // 内容变更 → 通知父组件
      if (update.docChanged) {
        suppressExternal = true;
        emit('update:modelValue', update.state.doc.toString());
        nextTick(() => {
          suppressExternal = false;
        });
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
    if (suppressExternal || !view) return;
    const current = view.state.doc.toString();
    if (newVal !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: newVal },
      });
    }
  },
);

// ── 生命周期 ───────────────────────────────

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

function handleThemeChange() {
  if (!view) return;
  view.dispatch({
    effects: themeComp.reconfigure(isDark() ? oneDark : []),
  });
}

const themeObserver = new MutationObserver(() => {
  handleThemeChange();
});

onMounted(() => {
  if (!editorRef.value) return;

  const state = EditorState.create({
    doc: props.modelValue,
    extensions: buildExtensions(),
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

defineExpose({
  insertText,
  wrapSelection,
  focus,
  getSelection,
  replaceSelection,
  prependToLine,
});
</script>

<template>
  <div ref="editorRef" class="codemirror-wrapper"></div>
</template>

<style scoped>
.codemirror-wrapper {
  flex: 1;
  overflow: hidden;
}
</style>
