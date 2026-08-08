<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { FileEntry } from '../../types';

const props = withDefaults(
  defineProps<{
    visible: boolean;
    tree: FileEntry[];
    openTabs?: string[];
    selectedPath?: string | null;
    recentPaths?: string[];
  }>(),
  { openTabs: () => [], selectedPath: null, recentPaths: () => [] },
);

const emit = defineEmits<{
  select: [path: string];
  cancel: [];
}>();

const query = ref('');
const highlightedIndex = ref(0);
const searchInput = ref<HTMLInputElement | null>(null);

interface NoteOption {
  path: string;
  name: string;
  group: 'open' | 'recent' | 'file';
}

function flattenTree(entries: FileEntry[]): NoteOption[] {
  return entries.flatMap((entry) =>
    entry.isDir
      ? flattenTree(entry.children ?? [])
      : [{ path: entry.path, name: entry.name, group: 'file' as const }],
  );
}

const allFiles = computed(() => flattenTree(props.tree));
const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase());

const options = computed(() => {
  const filesByPath = new Map(allFiles.value.map((item) => [item.path, item]));
  const result: NoteOption[] = [];
  const seen = new Set<string>();
  const search = normalizedQuery.value;

  function add(path: string, group: NoteOption['group']) {
    const item = filesByPath.get(path);
    if (!item || seen.has(path)) return;
    if (
      search &&
      !item.name.toLocaleLowerCase().includes(search) &&
      !item.path.toLocaleLowerCase().includes(search)
    ) {
      return;
    }
    seen.add(path);
    result.push({ ...item, group });
  }

  for (const path of props.openTabs) add(path, 'open');
  if (!search) {
    for (const path of props.recentPaths) add(path, 'recent');
  }
  for (const item of allFiles.value) add(item.path, 'file');

  return result;
});

const groupedOptions = computed(() => {
  const groups: { key: NoteOption['group']; label: string; items: NoteOption[] }[] = [];
  for (const item of options.value) {
    let group = groups.find((candidate) => candidate.key === item.group);
    if (!group) {
      group = {
        key: item.group,
        label: item.group === 'open' ? '已打开' : item.group === 'recent' ? '最近打开' : '文件',
        items: [],
      };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
});

function optionIndex(path: string) {
  return options.value.findIndex((item) => item.path === path);
}

function selectPath(path: string) {
  emit('select', path);
}

function moveHighlight(offset: number) {
  const total = options.value.length;
  if (total === 0) return;
  highlightedIndex.value = (highlightedIndex.value + offset + total) % total;
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('cancel');
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveHighlight(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveHighlight(-1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const option = options.value[highlightedIndex.value];
    if (option) selectPath(option.path);
  }
}

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) return;
    query.value = '';
    highlightedIndex.value = 0;
    await nextTick();
    searchInput.value?.focus();
  },
);

watch(normalizedQuery, () => {
  highlightedIndex.value = 0;
});
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="note-switcher-layer" @mousedown.self="emit('cancel')">
      <section
        class="note-switcher"
        role="dialog"
        aria-modal="true"
        aria-label="快速切换笔记"
        @mousedown.stop
      >
        <div class="note-switcher-search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <input
            ref="searchInput"
            v-model="query"
            type="search"
            autocomplete="off"
            placeholder="搜索笔记标题或路径"
            aria-label="搜索笔记标题或路径"
            @keydown="handleKeydown"
          />
          <kbd>Esc</kbd>
        </div>

        <div class="note-switcher-list" role="listbox" aria-label="笔记结果">
          <div v-if="options.length === 0" class="note-switcher-empty">没有找到匹配的笔记</div>
          <template v-for="group in groupedOptions" :key="group.key">
            <div class="note-switcher-group-label">{{ group.label }}</div>
            <button
              v-for="item in group.items"
              :key="`${group.key}-${item.path}`"
              type="button"
              class="note-switcher-item"
              :class="{ highlighted: highlightedIndex === optionIndex(item.path) }"
              role="option"
              :aria-selected="highlightedIndex === optionIndex(item.path)"
              @mouseenter="highlightedIndex = optionIndex(item.path)"
              @click="selectPath(item.path)"
            >
              <span class="note-switcher-file-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20z" />
                  <path d="M14 3.5v4h4" />
                </svg>
              </span>
              <span class="note-switcher-copy">
                <span class="note-switcher-name">{{ item.name }}</span>
                <span class="note-switcher-path">{{ item.path }}</span>
              </span>
              <span v-if="item.path === selectedPath" class="note-switcher-current">当前</span>
              <span v-else-if="item.group === 'open'" class="note-switcher-current">已打开</span>
            </button>
          </template>
        </div>

        <footer class="note-switcher-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd>选择</span>
          <span><kbd>Enter</kbd>打开</span>
          <span><kbd>Esc</kbd>关闭</span>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.note-switcher-layer {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: min(18vh, 180px);
  background: color-mix(in srgb, var(--bg-primary) 18%, transparent);
}

.note-switcher {
  width: min(560px, calc(100vw - 32px));
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated, var(--bg-primary));
  box-shadow: var(--shadow-lg, 0 16px 40px rgba(0, 0, 0, 0.22));
}

.note-switcher-search {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.note-switcher-search svg,
.note-switcher-file-icon svg {
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
  fill: none;
  stroke: var(--text-muted);
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.note-switcher-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-sm);
}

.note-switcher-search input::placeholder,
.note-switcher-path,
.note-switcher-group-label,
.note-switcher-current {
  color: var(--text-muted);
}

kbd {
  padding: 2px 5px;
  border: 1px solid var(--border-light);
  border-radius: 4px;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.2;
  white-space: nowrap;
}

.note-switcher-list {
  max-height: min(420px, 56vh);
  overflow-y: auto;
  padding: 6px;
}

.note-switcher-group-label {
  padding: 8px 10px 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.note-switcher-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.note-switcher-item:hover,
.note-switcher-item.highlighted {
  background: var(--bg-hover);
}

.note-switcher-file-icon {
  display: inline-flex;
  flex: 0 0 auto;
}

.note-switcher-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.note-switcher-name,
.note-switcher-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-switcher-name {
  font-size: var(--text-sm);
}

.note-switcher-path,
.note-switcher-current {
  font-size: var(--text-xs);
}

.note-switcher-current {
  flex: 0 0 auto;
}

.note-switcher-empty {
  padding: 32px 12px;
  color: var(--text-muted);
  font-size: var(--text-sm);
  text-align: center;
}

.note-switcher-footer {
  display: flex;
  gap: 14px;
  padding: 8px 14px;
  border-top: 1px solid var(--border-subtle);
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.note-switcher-footer span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
