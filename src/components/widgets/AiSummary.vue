<script setup lang="ts">
import { ref, inject } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { AiExecuteResult } from '../../types';
import { useAiStatus } from '../../composables/useAiStatus';
import { useAiResultCache } from '../../composables/useAiResultCache';

const {
  focusSummary: summary,
  focusHasLoaded: hasLoaded,
  focusTooShort: resultTooShort,
  saveFocusResult,
  clearFocusResult,
} = useAiResultCache();

const MIN_ANALYSIS_LENGTH = 30;
const loading = ref(false);

const { aiEnabled, load: refreshAiStatus } = useAiStatus();
const showAiConfigGuide = inject<() => void>('showAiConfigGuide', () => {});

async function refresh() {
  await refreshAiStatus();
  if (!aiEnabled.value) {
    showAiConfigGuide();
    return;
  }
  loading.value = true;
  resultTooShort.value = false;
  try {
    const result = await invoke<AiExecuteResult>('ai_execute', { mode: 'focus', input: '' });
    const text = (result && result.text ? result.text : '').trim();
    if (!text) {
      saveFocusResult('AI 返回为空，请重试', true);
    } else if (text.length < MIN_ANALYSIS_LENGTH) {
      saveFocusResult(text, true);
    } else {
      saveFocusResult(text, false);
    }
  } catch (e: any) {
    console.error('[AiSummary]', e);
    saveFocusResult(typeof e === 'string' ? e : 'AI 分析失败，请重试', true);
  } finally {
    loading.value = false;
  }
}

function clear() {
  clearFocusResult();
}
</script>

<template>
  <div v-if="loading" class="loading">AI 分析中...</div>

  <div v-else-if="!hasLoaded" class="ai-placeholder">
    <div class="ai-placeholder-text">AI 帮你分析今日任务优先级</div>
    <button class="ai-btn" @click="refresh">开始分析</button>
  </div>

  <template v-else>
    <div class="ai-text">{{ summary }}</div>
    <div v-if="resultTooShort" class="ai-too-short">
      AI 未返回有效分析，可尝试
      <button class="ai-link" @click="refresh">重新分析</button>
    </div>
    <div class="ai-actions">
      <button class="ai-btn" @click="refresh">重新分析</button>
      <button class="ai-btn ai-btn-clear" @click="clear">清除</button>
    </div>
  </template>
</template>

<style scoped>
.loading {
  font-size: 12px;
  color: var(--text-disabled);
}
.ai-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}
.ai-placeholder-text {
  font-size: 12px;
  color: var(--text-muted);
}
.ai-text {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
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
  border-radius: var(--radius-sm);
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
.ai-btn-clear:hover {
  border-color: var(--danger);
  color: var(--danger);
}
.ai-too-short {
  font-size: 11px;
  color: var(--warning);
  margin-top: 6px;
  padding: 6px 10px;
  background: var(--warning-light);
  border-radius: var(--radius-sm);
}
.ai-link {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: inherit;
  font-family: inherit;
  padding: 0;
  text-decoration: underline;
}
</style>
