<script setup lang="ts">
import type { NoteRecoverySummary } from '../../composables/useNoteRecovery';

const props = defineProps<{
  visible: boolean;
  loading: boolean;
  snapshots: NoteRecoverySummary[];
}>();

const emit = defineEmits<{
  close: [];
  restore: [id: string];
  remove: [id: string];
}>();

function reasonLabel(reason: string) {
  if (reason === 'conflict') return '保存冲突';
  if (reason === 'external-delete') return '文件被外部删除';
  if (reason === 'save-failed') return '保存失败';
  return reason;
}

function createdAtLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
</script>

<template>
  <Teleport to="body">
    <Transition name="motion-dialog">
      <div
        v-if="props.visible"
        class="recovery-layer"
        role="presentation"
        @mousedown.self="emit('close')"
      >
        <section
          class="recovery-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="note-recovery-title"
          @mousedown.stop
        >
          <header class="recovery-header">
            <div>
              <h2 id="note-recovery-title">笔记恢复</h2>
              <p>保存失败、冲突或外部删除时保留的本地内容。</p>
            </div>
            <button type="button" class="recovery-close" aria-label="关闭" @click="emit('close')">
              ×
            </button>
          </header>

          <div class="recovery-body">
            <div v-if="props.loading" class="recovery-empty">正在读取恢复记录…</div>
            <div v-else-if="props.snapshots.length === 0" class="recovery-empty">
              当前工作区没有可恢复的笔记。
            </div>
            <ul v-else class="recovery-list">
              <li v-for="snapshot in props.snapshots" :key="snapshot.id" class="recovery-item">
                <div class="recovery-item-copy">
                  <strong>{{ snapshot.notePath }}</strong>
                  <span
                    >{{ reasonLabel(snapshot.reason) }} ·
                    {{ createdAtLabel(snapshot.createdAt) }}</span
                  >
                  <small v-if="snapshot.errorMessage">{{ snapshot.errorMessage }}</small>
                </div>
                <div class="recovery-item-actions">
                  <button
                    type="button"
                    class="recovery-button recovery-button-primary"
                    @click="emit('restore', snapshot.id)"
                  >
                    恢复
                  </button>
                  <button
                    type="button"
                    class="recovery-button"
                    @click="emit('remove', snapshot.id)"
                  >
                    删除
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.recovery-layer {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg);
  background: rgba(0, 0, 0, 0.38);
}

.recovery-panel {
  width: min(680px, 92vw);
  max-height: min(620px, 84vh);
  overflow: hidden;
  background: var(--bg-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.2);
}

.recovery-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
}

.recovery-header h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-lg);
}

.recovery-header p {
  margin: var(--space-xs) 0 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.recovery-close {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.recovery-close:hover {
  color: var(--text-primary);
}

.recovery-body {
  max-height: calc(min(620px, 84vh) - 100px);
  overflow-y: auto;
  padding: var(--space-md) var(--space-lg) var(--space-lg);
}

.recovery-empty {
  padding: var(--space-xl) var(--space-md);
  color: var(--text-muted);
  text-align: center;
}

.recovery-list {
  display: grid;
  gap: var(--space-sm);
  margin: 0;
  padding: 0;
  list-style: none;
}

.recovery-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
}

.recovery-item-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.recovery-item-copy strong,
.recovery-item-copy span,
.recovery-item-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recovery-item-copy strong {
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.recovery-item-copy span,
.recovery-item-copy small {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.recovery-item-actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--space-xs);
}

.recovery-button {
  padding: 5px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
}

.recovery-button:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.recovery-button-primary {
  border-color: var(--accent);
  color: var(--accent);
}

@media (max-width: 560px) {
  .recovery-item {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
