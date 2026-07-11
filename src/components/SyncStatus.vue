<script setup lang="ts">
import { useAuth } from '../composables/useAuth';
import { useTaskStore } from '../composables/useTaskStore';

const { isLoggedIn } = useAuth();
const { syncStatus } = useTaskStore();

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
</script>

<template>
  <div v-if="isLoggedIn" class="sync-status" @click="forceSync">
    <span class="sync-indicator" :class="syncStatus"></span>
    <span class="sync-label">{{ statusLabel[syncStatus] || syncStatus }}</span>
  </div>
</template>

<style scoped>
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
}

[data-theme='dark'] .sync-status,
[data-theme='auto'] .sync-status {
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

[data-theme='dark'] .sync-indicator.idle,
[data-theme='auto'] .sync-indicator.idle {
  box-shadow: 0 0 6px var(--accent);
  animation: breathe 3s ease-in-out infinite;
}

.sync-indicator.syncing {
  background: var(--accent);
  animation: spin 1s linear infinite;
}

[data-theme='dark'] .sync-indicator.syncing,
[data-theme='auto'] .sync-indicator.syncing {
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
</style>
