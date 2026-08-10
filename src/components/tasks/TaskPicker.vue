<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { Task } from '../../types';

const props = withDefaults(
  defineProps<{
    visible: boolean;
    tasks: Task[];
    currentTaskIds?: string[];
  }>(),
  { currentTaskIds: () => [] },
);

const emit = defineEmits<{
  select: [task: Task];
  create: [title: string];
  cancel: [];
}>();

const query = ref('');
const highlightedIndex = ref(0);
const searchInput = ref<HTMLInputElement | null>(null);

const currentTaskIdSet = computed(() => new Set(props.currentTaskIds));
const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase());

const filteredTasks = computed(() => {
  const search = normalizedQuery.value;
  const visible = props.tasks.filter((task) => {
    if (task.is_deleted) return false;
    if (!search) return true;
    return (
      task.title.toLocaleLowerCase().includes(search) ||
      task.id.toLocaleLowerCase().includes(search) ||
      task.tags.some((tag) => tag.toLocaleLowerCase().includes(search))
    );
  });

  return [...visible].sort((a, b) => {
    const aCurrent = currentTaskIdSet.value.has(a.id);
    const bCurrent = currentTaskIdSet.value.has(b.id);
    if (aCurrent !== bCurrent) return aCurrent ? 1 : -1;
    if (search) {
      const aPrefix = a.title.toLocaleLowerCase().startsWith(search);
      const bPrefix = b.title.toLocaleLowerCase().startsWith(search);
      if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
    }
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return b.created_at.localeCompare(a.created_at);
  });
});

const canCreate = computed(() => normalizedQuery.value.length > 0);

function taskMeta(task: Task): string {
  const parts: string[] = [];
  if (task.completed) parts.push('已完成');
  else if (task.due_date) parts.push(formatDueDate(task.due_date));
  else parts.push('未完成');
  if (task.tags.length > 0) parts.push(`#${task.tags[0]}`);
  if (task.is_daily) parts.push('每日');
  return parts.join(' · ');
}

function formatDueDate(value: string): string {
  if (value === new Date().toISOString().slice(0, 10)) return '今天';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
}

function selectTask(task: Task) {
  emit('select', task);
}

function createTask() {
  if (canCreate.value) emit('create', query.value.trim());
}

function moveHighlight(offset: number) {
  const total = filteredTasks.value.length + (canCreate.value ? 1 : 0);
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
    const task = filteredTasks.value[highlightedIndex.value];
    if (task) selectTask(task);
    else if (canCreate.value) createTask();
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
    <div v-if="visible" class="task-picker-layer" @mousedown.self="emit('cancel')">
      <section
        class="task-picker"
        role="dialog"
        aria-modal="true"
        aria-label="插入正式任务"
        @mousedown.stop
      >
        <div class="task-picker-search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <input
            ref="searchInput"
            v-model="query"
            type="search"
            autocomplete="off"
            placeholder="搜索任务标题或标签"
            aria-label="搜索任务标题或标签"
            @keydown="handleKeydown"
          />
          <kbd>Esc</kbd>
        </div>

        <div class="task-picker-list" role="listbox" aria-label="任务结果">
          <div v-if="filteredTasks.length === 0 && !canCreate" class="task-picker-empty">
            没有可关联的任务
          </div>
          <button
            v-for="(task, index) in filteredTasks"
            :key="task.id"
            type="button"
            class="task-picker-item"
            :class="{
              highlighted: highlightedIndex === index,
              linked: currentTaskIdSet.has(task.id),
            }"
            role="option"
            :aria-selected="highlightedIndex === index"
            @mouseenter="highlightedIndex = index"
            @click="selectTask(task)"
          >
            <span class="task-picker-checkbox" :class="{ checked: task.completed }">
              {{ task.completed ? '✓' : '' }}
            </span>
            <span class="task-picker-copy">
              <span class="task-picker-title">{{ task.title }}</span>
              <span class="task-picker-meta">{{ taskMeta(task) }}</span>
            </span>
            <span v-if="currentTaskIdSet.has(task.id)" class="task-picker-state">已在本页</span>
          </button>

          <button
            v-if="canCreate"
            type="button"
            class="task-picker-create"
            :class="{ highlighted: highlightedIndex === filteredTasks.length }"
            @mouseenter="highlightedIndex = filteredTasks.length"
            @click="createTask"
          >
            <span class="task-picker-create-icon">＋</span>
            <span>创建“{{ query.trim() }}”为新任务</span>
          </button>
        </div>

        <footer class="task-picker-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd>选择</span>
          <span><kbd>Enter</kbd>插入</span>
          <span><kbd>Esc</kbd>关闭</span>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.task-picker-layer {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: min(18vh, 180px);
  background: color-mix(in srgb, var(--bg-primary) 18%, transparent);
}

.task-picker {
  width: min(520px, calc(100vw - 32px));
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated, var(--bg-primary));
  box-shadow: var(--shadow-lg, 0 16px 40px rgba(0, 0, 0, 0.22));
}

.task-picker-search {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.task-picker-search svg {
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
  fill: none;
  stroke: var(--text-muted);
  stroke-width: 1.7;
  stroke-linecap: round;
}

.task-picker-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-sm);
}

.task-picker-search input::placeholder {
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

.task-picker-list {
  max-height: min(390px, 52vh);
  overflow-y: auto;
  padding: 6px;
}

.task-picker-item,
.task-picker-create {
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

.task-picker-item:hover,
.task-picker-item.highlighted,
.task-picker-create:hover,
.task-picker-create.highlighted {
  background: var(--bg-hover);
}

.task-picker-item.linked {
  opacity: 0.52;
}

.task-picker-checkbox {
  display: inline-flex;
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  color: var(--accent);
  font-size: 11px;
}

.task-picker-checkbox.checked {
  border-color: var(--accent);
}

.task-picker-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.task-picker-title {
  overflow: hidden;
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-picker-meta,
.task-picker-state {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.task-picker-state {
  flex: 0 0 auto;
}

.task-picker-create {
  margin-top: 4px;
  border-top: 1px solid var(--border-subtle);
  border-radius: 0;
  color: var(--accent);
}

.task-picker-create-icon {
  width: 15px;
  flex: 0 0 auto;
  text-align: center;
  font-size: 16px;
}

.task-picker-empty {
  padding: 28px 12px;
  color: var(--text-muted);
  font-size: var(--text-sm);
  text-align: center;
}

.task-picker-footer {
  display: flex;
  gap: 14px;
  padding: 8px 14px;
  border-top: 1px solid var(--border-subtle);
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.task-picker-footer span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
