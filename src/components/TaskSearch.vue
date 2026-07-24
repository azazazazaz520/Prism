<script setup lang="ts">
defineProps<{
  modelValue: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

function clear() {
  emit('update:modelValue', '');
}
</script>

<template>
  <div class="task-search">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
    <input
      :value="modelValue"
      type="search"
      aria-label="搜索任务"
      placeholder="搜索任务"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @keydown.escape="clear"
    />
    <button v-if="modelValue" type="button" aria-label="清空搜索" @click="clear">×</button>
  </div>
</template>

<style scoped>
.task-search {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin: 0 var(--space-md) var(--space-sm);
  padding: 0 var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
}

.task-search:focus-within {
  border-color: var(--accent-muted);
}

.task-search svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  flex-shrink: 0;
}

.task-search input {
  min-width: 0;
  flex: 1;
  padding: 7px 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-xs);
}

.task-search input::-webkit-search-cancel-button {
  display: none;
}

.task-search button {
  width: 24px;
  height: 24px;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 16px;
}
</style>
