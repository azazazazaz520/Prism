<script setup lang="ts">
import { ref, nextTick, computed, onMounted, onUnmounted } from 'vue';
import type { Task } from '../types';

const props = defineProps<{
  task: Task;
  isDailyCompleted: boolean;
  aiEnabled?: boolean;
}>();

const emit = defineEmits<{
  toggle: [id: string];
  toggleDaily: [id: string, date: string];
  update: [id: string, title: string];
  delete: [id: string];
  updateMeta: [id: string, tags: string[], important: boolean, pinned: boolean];
  decompose: [id: string];
}>();

const editing = ref(false);
const editTitle = ref('');
const showMenu = ref(false);
const menuTags = ref<string[]>([]);
const menuNewTag = ref('');

function openMenu() {
  menuTags.value = [...props.task.tags];
  menuNewTag.value = '';
  showMenu.value = true;
}

function closeMenu() {
  showMenu.value = false;
}

function toggleMenuImportant() {
  emit('updateMeta', props.task.id, [...menuTags.value], !props.task.important, props.task.pinned);
  showMenu.value = false;
}

function toggleMenuPinned() {
  emit('updateMeta', props.task.id, [...menuTags.value], props.task.important, !props.task.pinned);
  showMenu.value = false;
}

function addMenuTag() {
  const t = menuNewTag.value.trim();
  if (t && !menuTags.value.includes(t)) {
    menuTags.value.push(t);
    emit('updateMeta', props.task.id, [...menuTags.value], props.task.important, props.task.pinned);
  }
  menuNewTag.value = '';
}

function removeMenuTag(tag: string) {
  menuTags.value = menuTags.value.filter((tg) => tg !== tag);
  emit('updateMeta', props.task.id, [...menuTags.value], props.task.important, props.task.pinned);
}

function onClickOutside(e: MouseEvent) {
  if (showMenu.value) {
    const el = e.target as HTMLElement;
    if (!el.closest('.menu-wrapper')) {
      showMenu.value = false;
    }
  }
}

onMounted(() => document.addEventListener('click', onClickOutside));
onUnmounted(() => document.removeEventListener('click', onClickOutside));

function startEdit() {
  editTitle.value = props.task.title;
  editing.value = true;
  nextTick(() => {
    const input = document.getElementById(`edit-${props.task.id}`) as HTMLInputElement;
    input?.focus();
    input?.select();
  });
}

function confirmEdit() {
  const trimmed = editTitle.value.trim();
  if (trimmed && trimmed !== props.task.title) {
    emit('update', props.task.id, trimmed);
  }
  editing.value = false;
}

function cancelEdit() {
  editing.value = false;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffHr < 24) return `${diffHr} 小时前`;
  if (diffDay < 7) return `${diffDay} 天前`;
  return date.toLocaleDateString('zh-CN');
}

const displayCompleted = computed(() => {
  if (props.task.is_daily) return props.isDailyCompleted;
  return props.task.completed;
});

function handleToggle() {
  if (props.task.is_daily) {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    emit('toggleDaily', props.task.id, `${y}-${m}-${d}`);
  } else {
    emit('toggle', props.task.id);
  }
}

const dueStatus = computed<'overdue' | 'today' | 'upcoming' | null>(() => {
  if (!props.task.due_date) return null;
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;
  if (props.task.due_date < todayStr) return 'overdue';
  if (props.task.due_date === todayStr) return 'today';
  return 'upcoming';
});

const dueLabel = computed(() => {
  if (!props.task.due_date) return '';
  if (dueStatus.value === 'today') return '今天到期';
  if (dueStatus.value === 'overdue') return '已过期';
  return props.task.due_date;
});
</script>

<template>
  <div
    :class="[
      'task-item',
      {
        completed: displayCompleted,
        editing: editing,
        [dueStatus || '']: !displayCompleted && dueStatus,
      },
    ]"
  >
    <input
      type="checkbox"
      class="task-checkbox"
      :checked="displayCompleted"
      @change="handleToggle"
    />

    <div class="task-body" @dblclick="startEdit">
      <template v-if="!editing">
        <div class="task-title-row">
          <span :class="['task-title', { done: displayCompleted }]">{{ task.title }}</span>
          <svg
            v-if="task.important && !displayCompleted"
            class="icon-star"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polygon
              points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
            />
          </svg>
          <svg
            v-if="task.is_daily"
            class="icon-daily"
            :class="{ done: displayCompleted }"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </div>
        <div class="task-meta">
          <span class="task-time">{{ formatTime(task.created_at) }}</span>
          <span v-if="dueLabel && !displayCompleted" :class="['due-badge', dueStatus]">{{
            dueLabel
          }}</span>
          <span v-for="tag in task.tags" :key="tag" class="tag-badge">{{ tag }}</span>
        </div>
      </template>
      <template v-else>
        <input
          :id="`edit-${task.id}`"
          v-model="editTitle"
          type="text"
          class="task-edit-input"
          @keydown.enter="confirmEdit"
          @keydown.escape="cancelEdit"
          @blur="confirmEdit"
        />
      </template>
    </div>

    <div v-if="!editing" class="task-actions">
      <button
        v-if="props.aiEnabled"
        class="task-decompose-btn"
        title="AI 拆解为子任务"
        @click.stop="emit('decompose', task.id)"
      >
        🧩
      </button>
      <div class="menu-wrapper">
        <button class="task-menu-btn" title="更多操作" @click.stop="openMenu">⋯</button>
        <div v-if="showMenu" class="task-menu" @click.stop>
          <div class="menu-item" @click="toggleMenuImportant">
            <span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polygon
                  points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                />
              </svg>
              重要
            </span>
            <span :class="['menu-toggle', { on: task.important }]">{{
              task.important ? '开' : '关'
            }}</span>
          </div>
          <div class="menu-item" @click="toggleMenuPinned">
            <span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 17v-7" />
                <path d="M8 10l4-4 4 4" />
                <path d="M5 21h14" />
              </svg>
              置顶
            </span>
            <span :class="['menu-toggle', { on: task.pinned }]">{{
              task.pinned ? '开' : '关'
            }}</span>
          </div>
          <div class="menu-divider"></div>
          <div class="menu-tags">
            <div class="menu-tags-header">🏷 标签</div>
            <div class="menu-tags-list">
              <span v-for="tag in menuTags" :key="tag" class="menu-tag-chip">
                {{ tag }}
                <button class="menu-tag-x" @click="removeMenuTag(tag)">×</button>
              </span>
            </div>
            <div class="menu-tag-input-row">
              <input
                v-model="menuNewTag"
                type="text"
                class="menu-tag-input"
                placeholder="新标签"
                @keydown.enter.prevent="addMenuTag"
              />
              <button class="menu-tag-add" @click="addMenuTag">+</button>
            </div>
          </div>
        </div>
      </div>
      <button class="task-delete-btn" title="删除" @click="emit('delete', task.id)">×</button>
    </div>
  </div>
</template>

<style scoped>
.task-item {
  display: flex;
  align-items: center;
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--border-light);
  transition: background var(--transition-fast);
}

.task-item:hover {
  background: var(--bg-secondary);
}
.task-item.completed {
  background: var(--bg-secondary);
}

.task-checkbox {
  width: 16px;
  height: 16px;
  margin-right: var(--space-sm);
  cursor: pointer;
  accent-color: var(--gray-900);
  flex-shrink: 0;
}

.task-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  cursor: default;
}

.task-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.task-title {
  font-size: var(--text-base);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-title.done {
  text-decoration: line-through;
  color: var(--text-disabled);
}

.icon-star {
  flex-shrink: 0;
  color: var(--warning);
}
.icon-daily {
  flex-shrink: 0;
  color: var(--warning);
}
.icon-daily.done {
  opacity: 0.4;
}

.task-meta {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-top: 2px;
  flex-wrap: wrap;
}

.task-time {
  font-size: var(--text-xs);
  color: var(--text-disabled);
}

.due-badge {
  font-size: var(--text-xs);
  padding: 0 5px;
  border-radius: var(--radius-sm);
  font-weight: 500;
}

.due-badge.overdue {
  color: var(--danger);
}
.due-badge.today {
  color: var(--warning);
}
.due-badge.upcoming {
  color: var(--gray-600);
}

.tag-badge {
  font-size: var(--text-xs);
  color: var(--text-muted);
  padding: 0 var(--space-xs);
}

.task-edit-input {
  font-size: var(--text-base);
  padding: 3px 6px;
  border: 1px solid var(--gray-600);
  border-radius: var(--radius-sm);
  outline: none;
  width: 100%;
}

.task-delete-btn {
  background: none;
  border: none;
  color: var(--gray-400);
  font-size: 18px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  flex-shrink: 0;
  transition: color var(--transition-fast);
}

.task-delete-btn:hover {
  color: var(--danger);
}

.task-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.menu-wrapper {
  position: relative;
}

.task-menu-btn {
  background: none;
  border: none;
  color: var(--gray-400);
  font-size: 14px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  transition: color var(--transition-fast);
}

.task-menu-btn:hover {
  color: var(--gray-700);
}

.task-decompose-btn {
  background: none;
  border: none;
  font-size: 13px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  opacity: 0.5;
  transition: opacity var(--transition-fast);
}

.task-decompose-btn:hover {
  opacity: 1;
}

.task-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: var(--space-xs);
  background: var(--bg-primary);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  box-shadow: 0 2px var(--space-sm) rgba(0, 0, 0, 0.08);
  padding: var(--space-xs);
  z-index: 10;
  width: 180px;
}

.menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px var(--space-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-sm);
}

.menu-item:hover {
  background: var(--bg-hover);
}

.menu-toggle {
  font-size: var(--text-xs);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-muted);
}

.menu-toggle.on {
  background: var(--gray-900);
  color: white;
}

.menu-divider {
  height: 1px;
  background: var(--border-light);
  margin: 2px 0;
}

.menu-tags {
  padding: var(--space-xs) var(--space-sm);
}

.menu-tags-header {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-bottom: 3px;
}

.menu-tags-list {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
  margin-bottom: var(--space-xs);
}

.menu-tag-chip {
  font-size: var(--text-xs);
  background: var(--bg-tertiary);
  color: var(--gray-700);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  gap: 2px;
}

.menu-tag-x {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: var(--text-xs);
  padding: 0;
  line-height: 1;
}

.menu-tag-input-row {
  display: flex;
  gap: 3px;
}

.menu-tag-input {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  outline: none;
}

.menu-tag-input:focus {
  border-color: var(--gray-600);
}

.menu-tag-add {
  background: var(--gray-900);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  padding: 3px 6px;
  cursor: pointer;
}
</style>
