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

// 每日任务用 toggleDaily（按日期记录），普通任务用 toggle（直接完成状态切换）
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
      <svg
        v-if="props.aiEnabled"
        class="task-decompose-btn"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        title="AI 拆解为子任务"
        @click.stop="emit('decompose', task.id)"
      >
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
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
            <div class="menu-tags-header">标签</div>
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
  align-items: flex-start;
  padding: var(--space-md) var(--space-lg);
  border-radius: var(--radius-lg);
  transition: all var(--transition-fast);
  gap: var(--space-sm);
  background: var(--bg-primary);
  margin-bottom: var(--space-xs);
}

[data-theme='dark'] .task-item,
[data-theme='auto'] .task-item {
  background: transparent;
  border-radius: 0;
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
  border: 1px solid transparent;
  animation: fadeSlideIn 0.3s ease both;
}

[data-theme='dark'] .task-item:nth-child(2),
[data-theme='auto'] .task-item:nth-child(2) {
  animation-delay: 0.05s;
}
[data-theme='dark'] .task-item:nth-child(3),
[data-theme='auto'] .task-item:nth-child(3) {
  animation-delay: 0.1s;
}
[data-theme='dark'] .task-item:nth-child(4),
[data-theme='auto'] .task-item:nth-child(4) {
  animation-delay: 0.15s;
}
[data-theme='dark'] .task-item:nth-child(5),
[data-theme='auto'] .task-item:nth-child(5) {
  animation-delay: 0.2s;
}

@keyframes fadeSlideIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.task-item:hover {
  background: var(--bg-secondary);
  box-shadow: var(--shadow-sm);
}

[data-theme='dark'] .task-item:hover,
[data-theme='auto'] .task-item:hover {
  background: var(--bg-panel-hover);
  border-color: var(--border-subtle);
  box-shadow: none;
}

.task-item.completed {
  opacity: 0.5;
}

.task-checkbox {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  cursor: pointer;
  flex-shrink: 0;
  border-radius: 50%;
  border: 2px solid var(--gray-400);
  background: transparent;
  transition: all var(--transition-fast);
  position: relative;
}

[data-theme='dark'] .task-checkbox,
[data-theme='auto'] .task-checkbox {
  border-color: var(--text-tertiary);
  clip-path: polygon(
    3px 0%,
    100% 0%,
    100% calc(100% - 3px),
    calc(100% - 3px) 100%,
    0% 100%,
    0% 3px
  );
  border-radius: 0;
}

.task-checkbox:hover {
  border-color: var(--accent);
}

.task-checkbox:checked {
  background: var(--accent);
  border-color: var(--accent);
}

.task-checkbox:checked::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 1px;
  width: 5px;
  height: 9px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

[data-theme='dark'] .task-checkbox:checked::after,
[data-theme='auto'] .task-checkbox:checked::after {
  border-color: var(--bg-void, #08090c);
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

[data-theme='dark'] .task-title,
[data-theme='auto'] .task-title {
  font-family: var(--font-heading);
  font-size: 13px;
  font-weight: 500;
}

.task-title.done {
  text-decoration: line-through;
  color: var(--text-disabled);
}

.icon-star {
  flex-shrink: 0;
  color: var(--warning);
}

[data-theme='dark'] .icon-star,
[data-theme='auto'] .icon-star {
  color: var(--status-danger);
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
  margin-top: 4px;
  flex-wrap: wrap;
}

.task-time {
  font-size: var(--text-xs);
  color: var(--text-disabled);
}

[data-theme='dark'] .task-time,
[data-theme='auto'] .task-time {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-tertiary);
}

.due-badge {
  font-size: var(--text-xs);
  padding: 0 5px;
  border-radius: var(--radius-sm);
  font-weight: 500;
}

[data-theme='dark'] .due-badge,
[data-theme='auto'] .due-badge {
  font-family: var(--font-mono);
  font-size: 9px;
  border-radius: 0;
}

.due-badge.overdue {
  color: var(--danger);
  background: var(--danger-light);
}
.due-badge.today {
  color: var(--warning);
  background: var(--warning-light);
}
.due-badge.upcoming {
  color: var(--gray-600);
}

.tag-badge {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  padding: 2px var(--space-sm);
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  font-weight: 500;
  transition: all var(--transition-fast);
}

[data-theme='dark'] .tag-badge,
[data-theme='auto'] .tag-badge {
  background: rgba(245, 197, 24, 0.12);
  border: 1px solid rgba(245, 197, 24, 0.3);
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 500;
  border-radius: 0;
  color: #e8e6e1;
}

.tag-badge:hover {
  background: var(--accent-light);
  color: var(--accent);
}

[data-theme='dark'] .tag-badge:hover,
[data-theme='auto'] .tag-badge:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-glow);
}

.task-edit-input {
  font-size: var(--text-base);
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--gray-600);
  border-radius: var(--radius-md);
  outline: none;
  width: 100%;
}

.task-delete-btn {
  background: none;
  border: none;
  color: var(--gray-400);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 6px;
  line-height: 1;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}

.task-delete-btn:hover {
  color: var(--danger);
  background: var(--danger-light);
}

.task-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.task-item:hover .task-actions {
  opacity: 1;
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
  padding: 4px 6px;
  line-height: 1;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}

.task-menu-btn:hover {
  color: var(--gray-700);
  background: var(--bg-hover);
}

.task-decompose-btn {
  color: var(--gray-400);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0.5;
  transition:
    opacity var(--transition-fast),
    color var(--transition-fast);
}

.task-decompose-btn:hover {
  opacity: 1;
  color: var(--accent);
}

.task-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: var(--space-xs);
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
  box-shadow: 0 4px var(--space-lg) rgba(0, 0, 0, 0.08);
  padding: var(--space-sm);
  z-index: 10;
  width: 200px;
}

[data-theme='dark'] .task-menu,
[data-theme='auto'] .task-menu {
  background: var(--bg-elevated);
  border-color: var(--border-line);
}

.menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-sm) var(--space-md);
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
  padding: 2px var(--space-sm);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  gap: 3px;
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
  padding: var(--space-xs) var(--space-sm);
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
  padding: var(--space-xs) var(--space-sm);
  cursor: pointer;
}
</style>
