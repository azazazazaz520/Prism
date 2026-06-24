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
  const task = props.tasks.find(t => t.id === taskId);
  return task ? task.title : taskId;
}

const hasItems = computed(() => (suggestion.value?.items?.length ?? 0) > 0);
</script>

<template>
  <div class="focus-bar" v-if="suggestion || error">
    <!-- 错误提示 -->
    <div v-if="error" class="focus-error" @click="error = ''">
      ⚠️ {{ error }}
    </div>

    <!-- 聚焦建议内容 -->
    <div v-if="suggestion" class="focus-content">
      <div class="focus-header" @click="expanded = !expanded">
        <span class="focus-icon">🔍</span>
        <span class="focus-summary">{{ suggestion.summary }}</span>
        <button
          class="focus-refresh"
          :disabled="loading"
          title="刷新建议"
          @click.stop="refresh"
        >
          {{ loading ? '⟳' : '↻' }}
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
    <span v-if="loading">⟳ AI 分析中...</span>
    <span v-else>🔍 今日聚焦建议</span>
  </div>
</template>

<style scoped>
.focus-bar {
  margin-bottom: 6px;
}

.focus-trigger {
  font-size: 12px;
  color: #999;
  padding: 6px 0;
  cursor: pointer;
  transition: color 0.15s;
  user-select: none;
}
.focus-trigger:hover {
  color: #4a90d9;
}

.focus-error {
  font-size: 11px;
  color: #e74c3c;
  padding: 6px 0;
  cursor: pointer;
}

.focus-content {
  background: #f8f9fb;
  border: 1px solid #e8eaed;
  border-radius: 8px;
  overflow: hidden;
}

.focus-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
}

.focus-icon {
  font-size: 13px;
  flex-shrink: 0;
}

.focus-summary {
  flex: 1;
  font-size: 12px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.focus-refresh {
  background: none;
  border: none;
  color: #999;
  font-size: 14px;
  cursor: pointer;
  padding: 2px;
  line-height: 1;
  transition: color 0.15s;
  flex-shrink: 0;
}
.focus-refresh:hover { color: #4a90d9; }
.focus-refresh:disabled { opacity: 0.4; cursor: wait; }

.focus-items {
  padding: 0 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.focus-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
  border-top: 1px solid #eef0f2;
}

.focus-index {
  font-size: 11px;
  color: #4a90d9;
  font-weight: 600;
  min-width: 16px;
  flex-shrink: 0;
}

.focus-title {
  font-size: 12px;
  color: #222;
  flex-shrink: 0;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.focus-reason {
  font-size: 11px;
  color: #999;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
