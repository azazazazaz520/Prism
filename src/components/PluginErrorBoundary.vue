<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue';
import { diagnosticsLogger } from '../diagnostics/invoke-logged';

const error = ref<Error | null>(null);
const errorInfo = ref<string>('');

onErrorCaptured((err, _instance, info) => {
  error.value = err;
  errorInfo.value = info;
  diagnosticsLogger.error('plugin', 'plugin.component_error', '插件组件异常', err, { info });
  // 阻止向上冒泡，避免整个应用崩溃
  return false;
});

function retry() {
  error.value = null;
  errorInfo.value = '';
}
</script>

<template>
  <div v-if="error" class="plugin-error-boundary">
    <div class="peb-card">
      <div class="peb-icon">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div class="peb-body">
        <div class="peb-title">插件组件异常</div>
        <div class="peb-message">{{ error.message }}</div>
        <div v-if="errorInfo" class="peb-info">{{ errorInfo }}</div>
        <button class="peb-retry" @click="retry">重试</button>
      </div>
    </div>
  </div>
  <slot v-else />
</template>

<style scoped>
.plugin-error-boundary {
  padding: 12px;
}

.peb-card {
  display: flex;
  gap: 12px;
  padding: 16px;
  background: var(--bg-panel, var(--bg-secondary));
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
}

[data-theme='hud'] .peb-card {
  border-radius: 0;
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
  background: var(--bg-elevated);
}

.peb-icon {
  flex-shrink: 0;
  color: var(--danger);
  margin-top: 2px;
}

.peb-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.peb-title {
  font-family: var(--font-heading);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.peb-message {
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-word;
}

.peb-info {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-disabled);
  word-break: break-word;
}

.peb-retry {
  align-self: flex-start;
  margin-top: 8px;
  padding: 4px 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.peb-retry:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-bg);
}

[data-theme='hud'] .peb-retry {
  border-radius: 0;
  clip-path: polygon(
    4px 0%,
    100% 0%,
    100% calc(100% - 4px),
    calc(100% - 4px) 100%,
    0% 100%,
    0% 4px
  );
}
</style>
