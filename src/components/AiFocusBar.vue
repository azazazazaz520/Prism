<script setup lang="ts">
import { ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { Task, FocusSuggestion } from '../types';

const props = defineProps<{
  tasks: Task[];
}>();

/** 聚焦建议数据 */
const suggestion = ref<FocusSuggestion | null>(null);
const loading = ref(false);
const expanded = ref(false);
const error = ref('');

/** 从后端获取今日聚焦建议 */
async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    suggestion.value = await invoke<FocusSuggestion>('ai_daily_focus');
    expanded.value = true;
  } catch (e: any) {
    error.value = typeof e === 'string' ? e : '获取聚焦建议失败';
  } finally {
    loading.value = false;
  }
}

/** 将 task_id 映射为标题 */
function taskTitle(taskId: string): string {
  const task = props.tasks.find((t) => t.id === taskId);
  return task ? task.title : taskId;
}

const hasItems = computed(() => (suggestion.value?.items?.length ?? 0) > 0);
</script>

<template>
  <div class="focus-bar" v-if="suggestion || error">
    <!-- 错误提示 -->
    <div v-if="error" class="focus-error" @click="error = ''">
      <svg
        class="error-icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      {{ error }}
    </div>

    <!-- 聚焦建议内容 -->
    <div v-if="suggestion" class="focus-content">
      <div class="focus-header" @click="expanded = !expanded">
        <svg
          class="focus-icon"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span class="focus-summary">{{ suggestion.summary }}</span>
        <button class="focus-refresh" :disabled="loading" title="刷新建议" @click.stop="refresh">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>

      <div v-if="expanded && hasItems" class="focus-items">
        <div v-for="item in suggestion.items" :key="item.task_id" class="focus-item">
          <span class="focus-index">{{ suggestion.items.indexOf(item) + 1 }}</span>
          <span class="focus-title">{{ taskTitle(item.task_id) }}</span>
          <span class="focus-reason">{{ item.reason }}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- 初始状态：加载按钮 -->
  <div v-else class="focus-trigger" @click="refresh">
    <span v-if="loading"> AI 分析中...</span>
    <span v-else>
      <svg
        class="trigger-icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      今日聚焦建议
    </span>
  </div>
</template>

<style scoped>
.focus-bar {
  margin-bottom: var(--space-xs);
}

.focus-trigger {
  font-size: var(--text-sm);
  color: var(--text-muted);
  padding: 6px 0;
  cursor: pointer;
  transition: color var(--transition-fast);
  user-select: none;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.trigger-icon {
  flex-shrink: 0;
}
.focus-trigger:hover {
  color: var(--accent);
}

.focus-error {
  font-size: var(--text-xs);
  color: var(--danger);
  padding: 6px 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.error-icon {
  flex-shrink: 0;
}

.focus-content {
  background: var(--accent-light);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.focus-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  cursor: pointer;
  user-select: none;
}

.focus-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.focus-summary {
  flex: 1;
  font-size: var(--text-sm);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.focus-refresh {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: var(--text-sm);
  cursor: pointer;
  padding: 2px;
  line-height: 1;
  transition: color var(--transition-fast);
  flex-shrink: 0;
}
.focus-refresh:hover {
  color: var(--accent);
}
.focus-refresh:disabled {
  opacity: 0.4;
  cursor: wait;
}

.focus-items {
  padding: 0 var(--space-md) var(--space-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.focus-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  padding: var(--space-xs) 0;
  border-top: 1px solid var(--border-light);
}

.focus-index {
  font-size: var(--text-xs);
  color: var(--accent);
  font-weight: 600;
  min-width: 16px;
  flex-shrink: 0;
}

.focus-title {
  font-size: var(--text-sm);
  color: var(--text-primary);
  flex-shrink: 0;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.focus-reason {
  font-size: var(--text-xs);
  color: var(--text-muted);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
