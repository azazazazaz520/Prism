<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import {
  splitHighlightedText,
  type NoteSearchFileResult,
  type NoteSearchMatch,
  type NoteSearchResponse,
} from '../../notes/note-search';

const props = defineProps<{
  query: string;
  response: NoteSearchResponse | null;
  searching: boolean;
  stale: boolean;
  error: string | null;
  displayedQuery: string;
}>();

const emit = defineEmits<{
  'update:query': [query: string];
  search: [];
  clear: [];
  retry: [];
  escape: [];
  'open-match': [path: string, match: NoteSearchMatch | null];
}>();

const input = ref<HTMLInputElement | null>(null);
const hasQuery = computed(() => Boolean(props.query.trim()));

function updateQuery(event: Event) {
  emit('update:query', (event.target as HTMLInputElement).value);
}

function clearQuery() {
  emit('clear');
  void nextTick(() => input.value?.focus());
}

function fileName(file: NoteSearchFileResult) {
  return file.path.split('/').pop() || file.path;
}

function parentPath(file: NoteSearchFileResult) {
  const separator = file.path.lastIndexOf('/');
  return separator < 0 ? '' : file.path.slice(0, separator);
}

function highlightParts(excerpt: string) {
  return splitHighlightedText(excerpt, props.displayedQuery || props.query);
}

defineExpose({ focusInput: () => input.value?.focus() });
</script>

<template>
  <section class="note-search-panel" aria-label="笔记全文搜索">
    <div class="note-search-input-row">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </svg>
      <input
        ref="input"
        :value="query"
        type="search"
        placeholder="搜索笔记内容"
        aria-label="搜索笔记内容"
        @input="updateQuery"
        @keydown.enter.prevent="emit('search')"
        @keydown.esc.prevent="emit('escape')"
      />
      <button
        v-if="hasQuery"
        type="button"
        class="note-search-clear"
        aria-label="清空搜索"
        title="清空搜索"
        @click="clearQuery"
      >
        ×
      </button>
    </div>

    <div v-if="!hasQuery" class="note-search-help">
      <p>搜索当前工作区内所有 Markdown 文件名和正文。</p>
    </div>

    <template v-else>
      <div v-if="searching" class="note-search-status" role="status">
        正在搜索…
        <span v-if="displayedQuery && displayedQuery !== query"
          >上次搜索：{{ displayedQuery }}</span
        >
      </div>

      <div v-if="stale" class="note-search-stale" role="status">
        <span>搜索结果可能已变化</span>
        <button type="button" @click="emit('retry')">重新搜索</button>
      </div>

      <div v-if="error" class="note-search-error" role="alert">
        <span>无法读取笔记工作区：{{ error }}</span>
        <button type="button" @click="emit('retry')">重试</button>
      </div>

      <template v-if="response">
        <div class="note-search-summary">
          <template v-if="displayedQuery && displayedQuery !== query">
            “{{ displayedQuery }}”找到 {{ response.matchedFileCount }} 篇笔记
          </template>
          <template v-else>找到 {{ response.matchedFileCount }} 篇笔记</template>
          <span v-if="response.truncated">· 已展示前 200 篇</span>
        </div>

        <div v-if="response.failedPathCount" class="note-search-warning" role="status">
          有 {{ response.failedPathCount }} 个文件或目录未能搜索
          <button type="button" @click="emit('retry')">重试</button>
        </div>

        <div v-if="response.files.length" class="note-search-results">
          <article v-for="file in response.files" :key="file.path" class="note-search-file">
            <button
              type="button"
              class="note-search-file-title"
              :title="file.path"
              @click="emit('open-match', file.path, null)"
            >
              <span class="note-search-file-name">{{ fileName(file) }}</span>
              <span v-if="parentPath(file)" class="note-search-file-path">
                {{ parentPath(file) }}
              </span>
              <span v-if="file.fileNameMatched" class="note-search-file-name-hit">文件名命中</span>
              <span v-if="file.isUnsaved" class="note-search-unsaved">含未保存修改</span>
              <span v-if="file.matchCount" class="note-search-match-count">
                {{ file.matchCount }} 处
              </span>
            </button>

            <button
              v-for="(match, index) in file.matches"
              :key="`${file.path}:${match.line}:${match.columnUtf16}:${index}`"
              type="button"
              class="note-search-match"
              @click="emit('open-match', file.path, match)"
            >
              <span class="note-search-line">{{ match.line }} 行</span>
              <span class="note-search-excerpt">
                <template
                  v-for="(part, partIndex) in highlightParts(match.excerpt)"
                  :key="partIndex"
                >
                  <mark v-if="part.matched">{{ part.text }}</mark>
                  <span v-else>{{ part.text }}</span>
                </template>
              </span>
            </button>
          </article>
        </div>

        <div
          v-else-if="!searching && !error && response.failedPathCount === 0"
          class="note-search-empty"
        >
          当前工作区未找到匹配内容
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.note-search-panel {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.note-search-input-row {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-sm);
  margin: var(--space-sm) var(--space-md);
  padding: 0 var(--space-sm);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-muted);
}

.note-search-input-row > svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
}

.note-search-input-row input {
  width: 100%;
  min-width: 0;
  padding: 8px 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-sm);
}

.note-search-input-row input::placeholder {
  color: var(--text-muted);
}

.note-search-input-row input::-webkit-search-cancel-button {
  display: none;
}

.note-search-clear,
.note-search-stale button,
.note-search-warning button,
.note-search-error button {
  flex-shrink: 0;
  padding: 2px 6px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
}

.note-search-clear:hover,
.note-search-stale button:hover,
.note-search-warning button:hover,
.note-search-error button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.note-search-help,
.note-search-empty {
  padding: var(--space-md);
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1.7;
}

.note-search-help p {
  margin: 0 0 var(--space-xs);
}

.note-search-status,
.note-search-summary,
.note-search-stale,
.note-search-warning,
.note-search-error {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: 6px var(--space-md);
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.note-search-status span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-search-stale,
.note-search-warning {
  color: var(--warning, var(--text-secondary));
}

.note-search-error {
  color: var(--danger, var(--text-secondary));
}

.note-search-results {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 0 var(--space-sm) var(--space-md);
}

.note-search-file {
  padding: 5px 0;
}

.note-search-file-title,
.note-search-match {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: baseline;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
  font: inherit;
}

.note-search-file-title {
  padding: 5px 7px;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
}

.note-search-file-title:hover,
.note-search-match:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.note-search-file-name {
  flex-shrink: 0;
  color: var(--text-primary);
  font-weight: 600;
}

.note-search-file-path {
  overflow: hidden;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-search-file-name-hit,
.note-search-unsaved,
.note-search-match-count {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 0.9em;
}

.note-search-unsaved {
  color: var(--accent);
}

.note-search-match {
  align-items: flex-start;
  padding: 4px 7px 4px 14px;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  line-height: 1.5;
}

.note-search-line {
  flex-shrink: 0;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.note-search-excerpt {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
}

.note-search-excerpt mark {
  border-radius: 2px;
  background: color-mix(in srgb, var(--accent) 25%, transparent);
  color: var(--text-primary);
}
</style>
