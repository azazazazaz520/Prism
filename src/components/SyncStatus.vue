<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useAuth } from '../composables/useAuth';
import { useTaskStore } from '../composables/useTaskStore';

const { isLoggedIn } = useAuth();
const { syncStatus, isSyncing, syncError, lastSyncAt, offlineQueueCount } = useTaskStore();
const expanded = ref(false);

const statusLabel: Record<string, string> = {
  idle: '已同步',
  syncing: '同步中',
  error: '同步异常',
  offline: '离线',
  unauthorized: '未授权',
};

function forceSync() {
  // trigger reload which includes pullAndMerge
  window.dispatchEvent(new CustomEvent('prism:force-sync'));
}

function onClickOutside(event: MouseEvent) {
  const target = event.target as Node | null;
  if (expanded.value && target && !(target as HTMLElement).closest('.sync-status-wrapper')) {
    expanded.value = false;
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside));
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside));

function formatSyncTime(value: string | null): string {
  if (!value) return '尚未同步';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  );
}

const displayStatus = computed(() => (isSyncing.value ? 'syncing' : syncStatus.value));
const displayLabel = computed(() => {
  if (syncError.value) return '同步失败';
  return statusLabel[displayStatus.value] || displayStatus.value;
});
</script>

<template>
  <div v-if="isLoggedIn" class="sync-status-wrapper">
    <button
      type="button"
      class="sync-status"
      :aria-expanded="expanded"
      :aria-label="`同步状态：${displayLabel}`"
      @click="expanded = !expanded"
    >
      <span class="sync-indicator" :class="displayStatus"></span>
      <span class="sync-label">{{ displayLabel }}</span>
    </button>
    <div v-if="expanded" class="sync-details" role="status">
      <div class="sync-detail-row">
        <span>上次同步</span>
        <strong>{{ formatSyncTime(lastSyncAt) }}</strong>
      </div>
      <div class="sync-detail-row">
        <span>待同步</span>
        <strong>{{ offlineQueueCount }} 项</strong>
      </div>
      <p v-if="syncError" class="sync-error">{{ syncError }}</p>
      <button type="button" class="sync-retry" :disabled="isSyncing" @click="forceSync">
        {{ isSyncing ? '同步中…' : '重新同步' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.sync-status-wrapper {
  position: relative;
}

.sync-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s;
  border: 0;
  font: inherit;
}

[data-theme='hud'] .sync-status,
[data-theme='hud'] .sync-status {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.5px;
  border-radius: 0;
}

.sync-status:hover {
  background: var(--bg-subtle);
}

.sync-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sync-indicator.idle {
  background: var(--accent);
}

[data-theme='hud'] .sync-indicator.idle,
[data-theme='hud'] .sync-indicator.idle {
  box-shadow: 0 0 6px var(--accent);
  animation: breathe 3s ease-in-out infinite;
}

.sync-indicator.syncing {
  background: var(--accent);
  animation: spin 1s linear infinite;
}

[data-theme='hud'] .sync-indicator.syncing,
[data-theme='hud'] .sync-indicator.syncing {
  animation: heartbeat 1.5s ease-in-out infinite;
}

.sync-indicator.error,
.sync-indicator.unauthorized {
  background: var(--danger, #e53e3e);
}

.sync-indicator.offline {
  background: var(--text-secondary);
}

@keyframes spin {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
  100% {
    opacity: 1;
  }
}

@keyframes heartbeat {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  12% {
    opacity: 0.25;
    transform: scale(0.85);
  }
  22% {
    opacity: 1;
    transform: scale(1.05);
  }
  32% {
    opacity: 0.35;
    transform: scale(0.9);
  }
  42% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.sync-label {
  white-space: nowrap;
}

.sync-details {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 20;
  width: 220px;
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.18));
}

.sync-detail-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-sm);
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.sync-detail-row + .sync-detail-row {
  margin-top: var(--space-sm);
}

.sync-detail-row strong {
  color: var(--text-primary);
  font-weight: 600;
}

.sync-error {
  margin: var(--space-sm) 0 0;
  color: var(--danger, #e53e3e);
  font-size: var(--text-xs);
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.sync-retry {
  width: 100%;
  margin-top: var(--space-md);
  padding: 6px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--accent);
  cursor: pointer;
}

.sync-retry:disabled {
  cursor: default;
  opacity: 0.6;
}
</style>
