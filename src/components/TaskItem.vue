<script setup lang="ts">
import { ref, nextTick, computed, onMounted, onUnmounted } from 'vue';
import type { Task } from '../types';

const props = defineProps<{
  task: Task;
  isDailyCompleted: boolean;
}>();

const emit = defineEmits<{
  toggle: [id: string];
  toggleDaily: [id: string, date: string];
  update: [id: string, title: string];
  delete: [id: string];
  updateMeta: [id: string, tags: string[], important: boolean, pinned: boolean];
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
  menuTags.value = menuTags.value.filter(tg => tg !== tag);
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

function cancelEdit() { editing.value = false; }

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
    :class="['task-item', {
      completed: displayCompleted,
      editing: editing,
      [dueStatus || '']: !displayCompleted && dueStatus
    }]"
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
          <span v-if="task.important && !displayCompleted" class="icon-star">⭐</span>
          <span v-if="task.is_daily" class="icon-daily" :class="{ done: displayCompleted }">☀️</span>
        </div>
        <div class="task-meta">
          <span class="task-time">{{ formatTime(task.created_at) }}</span>
          <span v-if="dueLabel && !displayCompleted" :class="['due-badge', dueStatus]">{{ dueLabel }}</span>
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
      <div class="menu-wrapper">
        <button
          class="task-menu-btn"
          title="更多操作"
          @click.stop="openMenu"
        >
          ⋯
        </button>
        <div v-if="showMenu" class="task-menu" @click.stop>
          <div class="menu-item" @click="toggleMenuImportant">
            <span>⭐ 重要</span>
            <span :class="['menu-toggle', { on: task.important }]">{{ task.important ? '开' : '关' }}</span>
          </div>
          <div class="menu-item" @click="toggleMenuPinned">
            <span>📌 置顶</span>
            <span :class="['menu-toggle', { on: task.pinned }]">{{ task.pinned ? '开' : '关' }}</span>
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
      <button
        class="task-delete-btn"
        title="删除"
        @click="emit('delete', task.id)"
      >
        ×
      </button>
    </div>
  </div>
</template>

<style scoped>
.task-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  border-left: 3px solid transparent;
  transition: background 0.15s;
}

.task-item:hover { background: #f8f9fa; }
.task-item.completed { background: #fafafa; }

.task-item.overdue { border-left-color: #e74c3c; }
.task-item.today { border-left-color: #f39c12; }
.task-item.upcoming { border-left-color: #4a90d9; }

.task-checkbox {
  width: 18px;
  height: 18px;
  margin-right: 12px;
  cursor: pointer;
  accent-color: #4a90d9;
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
  gap: 4px;
}

.task-title {
  font-size: 15px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-title.done { text-decoration: line-through; color: #aaa; }

.icon-star { font-size: 13px; flex-shrink: 0; }
.icon-daily { font-size: 13px; flex-shrink: 0; }
.icon-daily.done { opacity: 0.4; }

.task-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
  flex-wrap: wrap;
}

.task-time {
  font-size: 12px;
  color: #999;
}

.due-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.due-badge.overdue { background: #fde8e8; color: #e74c3c; }
.due-badge.today { background: #fef3e0; color: #e67e22; }
.due-badge.upcoming { background: #e8f0fe; color: #4a90d9; }

.tag-badge {
  font-size: 10px;
  background: #f0f0f0;
  color: #888;
  padding: 1px 5px;
  border-radius: 3px;
}

.task-edit-input {
  font-size: 15px;
  padding: 4px 8px;
  border: 2px solid #4a90d9;
  border-radius: 6px;
  outline: none;
  width: 100%;
}

.task-delete-btn {
  background: none;
  border: none;
  color: #ccc;
  font-size: 20px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.15s;
}

.task-delete-btn:hover { color: #e74c3c; }

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
  color: #ccc;
  font-size: 16px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  transition: color 0.15s;
}

.task-menu-btn:hover { color: #666; }

.task-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 6px;
  z-index: 10;
  width: 200px;
}

.menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.menu-item:hover { background: #f5f5f5; }

.menu-toggle {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 8px;
  background: #eee;
  color: #999;
}

.menu-toggle.on {
  background: #e8f0fe;
  color: #4a90d9;
}

.menu-divider {
  height: 1px;
  background: #f0f0f0;
  margin: 4px 0;
}

.menu-tags {
  padding: 4px 10px;
}

.menu-tags-header {
  font-size: 12px;
  color: #999;
  margin-bottom: 4px;
}

.menu-tags-list {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.menu-tag-chip {
  font-size: 11px;
  background: #e8f0fe;
  color: #4a90d9;
  padding: 1px 6px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 3px;
}

.menu-tag-x {
  background: none;
  border: none;
  color: #4a90d9;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
  line-height: 1;
}

.menu-tag-input-row {
  display: flex;
  gap: 4px;
}

.menu-tag-input {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  font-size: 12px;
  outline: none;
}

.menu-tag-input:focus { border-color: #4a90d9; }

.menu-tag-add {
  background: #4a90d9;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  padding: 4px 8px;
  cursor: pointer;
}
</style>
