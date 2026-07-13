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
  font-size: 12px;
  color: var(--text-disabled);
}
.ai-text {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.ai-high {
  color: var(--accent);
  font-weight: 600;
}
.ai-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.ai-btn {
  font-family: var(--font-heading);
  font-size: 9px;
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 4px 10px;
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}
[data-theme='hud'] .ai-btn {
  border-color: var(--border-line);
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
}
</style>
