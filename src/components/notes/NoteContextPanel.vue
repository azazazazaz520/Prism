<script setup lang="ts">
/**
 * 笔记上下文面板：展示当前笔记的任务引用、反向链接与大纲。
 */
import type { Task } from '../../types';
import type { TaskReference } from '../../notes/task-references';
import type { NoteOutlineItem } from '../../utils/note-editor';

const props = defineProps<{
  visible: boolean;
  activeNotePath: string | null;
  taskReferences: TaskReference[];
  tasks: Task[];
  backlinkPaths: string[];
  outline: NoteOutlineItem[];
  outlinePanelLabel: string;
}>();

const emit = defineEmits<{
  'toggle-task': [taskId: string];
  'add-task': [];
  'open-path': [path: string];
  'navigate-outline': [line: number];
}>();

function taskForReference(reference: TaskReference): Task | undefined {
  return props.tasks.find((task) => task.id === reference.taskId);
}
</script>

<template>
  <aside v-if="visible" class="note-context-panel">
    <template v-if="activeNotePath">
      <div class="context-heading">
        <div>
          <span class="context-eyebrow">CONTEXT</span>
          <h2>当前笔记</h2>
        </div>
        <span class="context-count">{{ taskReferences.length }}</span>
      </div>
      <section class="context-section">
        <div class="context-section-title">本页任务</div>
        <button
          v-for="reference in taskReferences"
          :key="`context-${reference.taskId}-${reference.line}`"
          type="button"
          class="context-task"
          :class="{ completed: taskForReference(reference)?.completed }"
          @click="emit('toggle-task', reference.taskId)"
        >
          <span class="context-task-box">{{
            taskForReference(reference)?.completed ? '✓' : ''
          }}</span>
          <span>{{ taskForReference(reference)?.title || reference.title }}</span>
        </button>
        <button type="button" class="context-add-task" @click="emit('add-task')">
          + 新建正式任务
        </button>
      </section>
      <section v-if="backlinkPaths.length > 0" class="context-section">
        <div class="context-section-title">反向链接 · {{ backlinkPaths.length }}</div>
        <button
          v-for="path in backlinkPaths"
          :key="path"
          type="button"
          class="context-link"
          @click="emit('open-path', path)"
        >
          <span>{{ path.split('/').pop() }}</span>
          <small>{{ path }}</small>
        </button>
      </section>
      <section v-if="outline.length > 0" class="context-section">
        <div class="context-section-title">{{ outlinePanelLabel }}</div>
        <button
          v-for="item in outline"
          :key="item.line"
          type="button"
          class="outline-item"
          :style="{ paddingLeft: `${(item.level - 1) * 12}px` }"
          @click="emit('navigate-outline', item.line)"
        >
          {{ item.title }}
        </button>
      </section>
    </template>
    <div v-else class="context-empty">
      <span class="context-eyebrow">CONTEXT</span>
      <h2>工作区概览</h2>
      <p>选择一篇笔记后，这里会显示任务、反向链接和笔记大纲。</p>
    </div>
  </aside>
</template>

<style scoped>
/* ═══ 上下文面板 ═══ */

.note-context-panel {
  width: 260px;
  flex: 0 0 260px;
  overflow-y: auto;
  padding: 24px 18px;
  border-left: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

.context-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 20px;
}

.context-eyebrow {
  display: block;
  margin-bottom: 6px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.context-heading h2,
.context-empty h2 {
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 700;
}

.context-count {
  display: inline-flex;
  min-width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--accent-muted);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
}

.context-section {
  padding: 16px 0;
  border-top: 1px solid var(--border-subtle);
}

.context-section-title {
  margin-bottom: 10px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
}

.context-task,
.context-link,
.context-add-task {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 0;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
  font: inherit;
  font-size: 12px;
}

.context-task:hover,
.context-link:hover,
.context-add-task:hover {
  color: var(--accent);
}

.context-task.completed {
  color: var(--text-muted);
  text-decoration: line-through;
}

.context-task-box {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  color: var(--accent);
  font-size: 10px;
}

.context-task.completed .context-task-box {
  border-color: var(--accent);
  background: var(--accent-muted);
}

.context-add-task {
  margin-top: 5px;
  color: var(--accent);
  font-size: 11px;
}

.context-link {
  flex-direction: column;
  gap: 1px;
}

.context-link small {
  color: var(--text-muted);
  font-size: 10px;
}

.outline-item {
  display: block;
  width: 100%;
  padding-top: 5px;
  padding-bottom: 5px;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.outline-item:hover,
.outline-item:focus-visible {
  background: var(--bg-hover);
  color: var(--accent);
  outline: none;
}

.context-empty {
  padding-top: 12px;
}

.context-empty p {
  margin-top: 12px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.7;
}

@media (max-width: 1180px) {
  .note-context-panel {
    display: none;
  }
}
</style>
