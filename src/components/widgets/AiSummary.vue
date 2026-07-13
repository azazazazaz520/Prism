<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { AiExecuteResult } from '../../types';
import { useAiStatus } from '../../composables/useAiStatus';

const { aiEnabled } = useAiStatus();
const summary = ref('');
const loading = ref(false);

async function refresh() {
  if (!aiEnabled.value) {
    summary.value = 'AI 未配置';
    return;
  }
  loading.value = true;
  try {
    const result = await invoke<AiExecuteResult>('ai_execute', {
      mode: 'focus',
      input: '',
    });
    summary.value = result.text || '暂无建议';
  } catch {
    summary.value = 'AI 分析失败';
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);
</script>

<template>
  <div v-if="loading" class="loading">AI 分析中...</div>
  <div v-else class="ai-text">{{ summary }}</div>
  <div class="ai-actions">
    <button class="ai-btn" @click="refresh">重新分析</button>
  </div>
</template>

<style scoped>
.loading {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-muted);
  letter-spacing: 1px;
}
.ai-text {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.6;
}
.ai-high {
  color: var(--accent);
  font-weight: var(--font-weight-semibold);
}
.ai-actions {
  display: flex;
  gap: var(--space-xs);
  margin-top: var(--space-sm);
}
.ai-btn {
  font-family: var(--font-heading);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 4px 10px;
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}
[data-theme='hud'] .ai-btn {
  font-family: var(--font-mono);
  border-color: var(--border-line);
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
.ai-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-bg);
}
</style>
