<script setup lang="ts">
defineProps<{ title: string }>();
const emit = defineEmits<{ back: [] }>();
</script>

<template>
  <div class="tool-shell">
    <div class="tool-header">
      <button class="tool-back" @click="emit('back')">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        返回工具箱
      </button>
      <span class="tool-title">{{ title }}</span>
    </div>
    <div class="tool-body">
      <slot />
    </div>
    <div v-if="$slots.footer" class="tool-footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.tool-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
}

.tool-header {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: 0 var(--space-lg);
  height: 40px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.tool-back {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-sm);
  flex-shrink: 0;
}

.tool-back:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tool-title {
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.tool-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-lg);
}

.tool-footer {
  border-top: 1px solid var(--border-subtle);
  padding: var(--space-sm) var(--space-lg);
  display: flex;
  gap: var(--space-sm);
  flex-shrink: 0;
}
</style>
