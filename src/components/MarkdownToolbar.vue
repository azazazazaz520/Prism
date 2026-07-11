<script setup lang="ts">
/** MarkdownEditor 对外暴露的方法 */
interface EditorAPI {
  wrapSelection: (before: string, after: string) => void;
  insertText: (text: string) => void;
  prependToLine: (text: string) => void;
  getSelection: () => string;
  focus: () => void;
}

const props = defineProps<{
  editorRef: EditorAPI | null;
}>();

// ── 内联格式 ──────────────────────────────

function bold() {
  props.editorRef?.wrapSelection('**', '**');
}
function italic() {
  props.editorRef?.wrapSelection('_', '_');
}
function strikethrough() {
  props.editorRef?.wrapSelection('~~', '~~');
}
function inlineCode() {
  props.editorRef?.wrapSelection('`', '`');
}

// ── 标题 ──────────────────────────────────

function h1() {
  props.editorRef?.prependToLine('# ');
}
function h2() {
  props.editorRef?.prependToLine('## ');
}
function h3() {
  props.editorRef?.prependToLine('### ');
}

// ── 块级元素 ──────────────────────────────

function bulletList() {
  props.editorRef?.prependToLine('- ');
}
function orderedList() {
  props.editorRef?.prependToLine('1. ');
}
function blockquote() {
  props.editorRef?.prependToLine('> ');
}
function codeBlock() {
  props.editorRef?.insertText('```\n\n```');
}

// ── 插入 ──────────────────────────────────

function insertLink() {
  const sel = props.editorRef?.getSelection?.();
  if (sel) {
    props.editorRef?.wrapSelection('[', '](url)');
  } else {
    props.editorRef?.insertText('[text](url)');
  }
}
function insertImage() {
  props.editorRef?.insertText('![alt](url)');
}
function horizontalRule() {
  props.editorRef?.insertText('\n---\n');
}
</script>

<template>
  <div class="md-toolbar">
    <!-- 内联格式 -->
    <div class="md-toolbar-group">
      <button class="md-toolbar-btn" title="粗体 Ctrl+B" @click="bold">
        <span class="md-label-bold">B</span>
      </button>
      <button class="md-toolbar-btn" title="斜体 Ctrl+I" @click="italic">
        <span class="md-label-italic">I</span>
      </button>
      <button class="md-toolbar-btn" title="删除线" @click="strikethrough">
        <span class="md-label-strike">S</span>
      </button>
      <button class="md-toolbar-btn" title="行内代码 Ctrl+E" @click="inlineCode">
        <span class="md-label-mono">&lt;/&gt;</span>
      </button>
    </div>

    <div class="md-toolbar-divider" />

    <!-- 标题 -->
    <div class="md-toolbar-group">
      <button class="md-toolbar-btn" title="一级标题 Ctrl+1" @click="h1">H1</button>
      <button class="md-toolbar-btn" title="二级标题 Ctrl+2" @click="h2">H2</button>
      <button class="md-toolbar-btn" title="三级标题 Ctrl+3" @click="h3">H3</button>
    </div>

    <div class="md-toolbar-divider" />

    <!-- 块级 -->
    <div class="md-toolbar-group">
      <button class="md-toolbar-btn" title="无序列表" @click="bulletList">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </button>
      <button class="md-toolbar-btn" title="有序列表" @click="orderedList">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <line x1="10" y1="6" x2="21" y2="6" />
          <line x1="10" y1="12" x2="21" y2="12" />
          <line x1="10" y1="18" x2="21" y2="18" />
          <path d="M4 6h1v4" />
          <path d="M4 10h2" />
          <path d="M6 14H4c0 1.5.44 2 2 2" />
          <path d="M4 14c.44 0 1 .5 1 1v2H4" />
        </svg>
      </button>
      <button class="md-toolbar-btn" title="引用块" @click="blockquote">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <path
            d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"
          />
          <path
            d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"
          />
        </svg>
      </button>
      <button class="md-toolbar-btn" title="代码块" @click="codeBlock">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      </button>
    </div>

    <div class="md-toolbar-divider" />

    <!-- 插入 -->
    <div class="md-toolbar-group">
      <button class="md-toolbar-btn" title="链接" @click="insertLink">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
        </svg>
      </button>
      <button class="md-toolbar-btn" title="图片" @click="insertImage">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </button>
      <button class="md-toolbar-btn" title="分割线" @click="horizontalRule">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <line x1="4" y1="12" x2="20" y2="12" />
          <polyline points="8 8 4 12 8 16" />
          <polyline points="16 8 20 12 16 16" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.md-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.md-toolbar-group {
  display: flex;
  align-items: center;
  gap: 1px;
}

.md-toolbar-divider {
  width: 1px;
  height: 18px;
  background: var(--border-light);
  margin: 0 4px;
  flex-shrink: 0;
}

.md-toolbar-btn {
  background: none;
  border: 1px solid transparent;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-family: inherit;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 26px;
  white-space: nowrap;
}

.md-toolbar-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.md-toolbar-btn:active {
  background: var(--bg-active);
}

/* 内联格式标签 */
.md-label-bold {
  font-weight: var(--font-weight-bold);
}
.md-label-italic {
  font-style: italic;
}
.md-label-strike {
  text-decoration: line-through;
}
.md-label-mono {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 10px;
}

[data-theme='dark'] .md-toolbar-btn,
[data-theme='auto'] .md-toolbar-btn {
  color: var(--text-tertiary);
}

[data-theme='dark'] .md-toolbar-btn:hover,
[data-theme='auto'] .md-toolbar-btn:hover {
  background: var(--bg-panel-hover);
  color: var(--text-primary);
  border-color: var(--border-line);
}

[data-theme='dark'] .md-toolbar-divider,
[data-theme='auto'] .md-toolbar-divider {
  background: var(--border-subtle);
}
</style>
