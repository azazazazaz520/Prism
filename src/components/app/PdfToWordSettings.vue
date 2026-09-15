<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { usePdfToWord } from '../../composables/usePdfToWord';

const { config, health, errorMessage, isLoading, loadConfig, checkHealth } = usePdfToWord();

const tip = ref('');

const serviceStatus = computed(() => {
  if (isLoading.value && !health.value) {
    return { tone: 'checking', label: '检测中…', detail: '正在连接 PDF 转 Word 服务' };
  }
  if (health.value?.status === 'ok') {
    return {
      tone: 'available',
      label: '服务正常',
      detail: health.value.engine || '转换引擎已就绪',
    };
  }
  if (errorMessage.value) {
    return { tone: 'unavailable', label: '服务不可用', detail: '请稍后重新检测' };
  }
  return { tone: 'unknown', label: '尚未检测', detail: '点击重新检测服务状态' };
});

async function refresh() {
  tip.value = '';
  await loadConfig();
  if (!config.value.baseUrl) return;

  try {
    await checkHealth();
    tip.value = '服务状态已更新';
  } catch {
    // 错误信息由 composable 提供给界面。
  }
}

onMounted(() => {
  void refresh();
});
</script>

<template>
  <div class="settings-group pdf-settings-card">
    <div class="group-title pdf-settings-title">PDF 转 Word 服务</div>
    <div class="pdf-settings-status">
      <div class="pdf-settings-status-copy">
        <span :class="['pdf-settings-status-dot', `is-${serviceStatus.tone}`]" aria-hidden="true" />
        <div>
          <strong>{{ serviceStatus.label }}</strong>
          <p>{{ serviceStatus.detail }}</p>
        </div>
      </div>
      <button type="button" class="pdf-settings-refresh" :disabled="isLoading" @click="refresh">
        {{ isLoading ? '检测中…' : '重新检测' }}
      </button>
    </div>
    <p v-if="tip" class="pdf-settings-success" role="status">{{ tip }}</p>
    <p v-if="errorMessage" class="pdf-settings-error" role="alert">{{ errorMessage }}</p>
  </div>
</template>

<style scoped>
.pdf-settings-title {
  margin-bottom: var(--space-md);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
}

.pdf-settings-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm) 0;
}

.pdf-settings-status-copy {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}

.pdf-settings-status-copy strong {
  display: block;
  color: var(--text-primary);
  font-size: var(--text-base);
  font-weight: var(--font-weight-medium);
}

.pdf-settings-status-copy p {
  margin: 3px 0 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.pdf-settings-status-dot {
  width: 9px;
  height: 9px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--text-muted);
}

.pdf-settings-status-dot.is-checking {
  background: var(--accent);
}

.pdf-settings-status-dot.is-available {
  background: var(--success, #2e9b68);
}

.pdf-settings-status-dot.is-unavailable {
  background: var(--danger, #c44747);
}

.pdf-settings-refresh {
  box-sizing: border-box;
  flex-shrink: 0;
  padding: 4px 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-sm);
  line-height: 1.4;
  white-space: nowrap;
  cursor: pointer;
  transition:
    transform 160ms var(--easing-standard),
    border-color var(--transition-fast) var(--easing-standard),
    color var(--transition-fast) var(--easing-standard);
}

.pdf-settings-refresh:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.pdf-settings-refresh:active:not(:disabled) {
  transform: scale(0.97);
}

.pdf-settings-refresh:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.pdf-settings-refresh:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.pdf-settings-success,
.pdf-settings-error {
  margin: var(--space-sm) 0 0;
  font-size: var(--text-xs);
  line-height: 1.5;
}

.pdf-settings-success {
  color: var(--success, #2e9b68);
}

.pdf-settings-error {
  color: var(--danger, #c44747);
}

@media (max-width: 560px) {
  .pdf-settings-status {
    align-items: flex-start;
    flex-direction: column;
  }
}

[data-theme='hud'] .pdf-settings-title {
  color: var(--accent-dim);
  font-family: var(--font-heading);
  letter-spacing: 2px;
  text-transform: uppercase;
}

[data-theme='hud'] .pdf-settings-refresh {
  border-radius: 0;
  clip-path: polygon(
    4px 0%,
    100% 0%,
    100% calc(100% - 4px),
    calc(100% - 4px) 100%,
    0% 100%,
    0% 4px
  );
  background: var(--bg-secondary);
  border-color: var(--border-line);
}
</style>
