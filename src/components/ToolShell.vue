<script setup lang="ts">
defineProps<{ title: string }>();
const emit = defineEmits<{ back: [] }>();
</script>

<template>
  <div class="tool-shell">
    <div class="tool-header">
      <button class="tool-back" aria-label="返回工具箱" @click="emit('back')">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        <span class="tool-back-label">工具箱</span>
      </button>
      <div class="tool-divider" aria-hidden="true"></div>
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

/* ── 头部：面包屑风格导航 ────────────────── */
.tool-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 0 var(--space-xl);
  height: 44px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  background: var(--bg-secondary);
}

.tool-back {
  display: flex;
  align-items: center;
  gap: 5px;
  background: none;
  border: none;
  color: var(--text-muted);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  flex-shrink: 0;
  transition:
    color var(--transition-fast) var(--easing-standard),
    background var(--transition-fast) var(--easing-standard);
}

.tool-back:hover {
  color: var(--accent);
  background: var(--accent-muted);
}

.tool-back-label {
  white-space: nowrap;
}

.tool-divider {
  width: 1px;
  height: 14px;
  background: var(--border-default);
  flex-shrink: 0;
}

.tool-title {
  font-weight: var(--font-weight-semibold);
  font-size: var(--text-sm);
  color: var(--text-primary);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-xl);
}

.tool-footer {
  border-top: 1px solid var(--border-subtle);
  padding: var(--space-sm) var(--space-xl);
  display: flex;
  gap: var(--space-sm);
  flex-shrink: 0;
  background: var(--bg-secondary);
}

[data-theme='dark'] .tool-shell,
[data-theme='auto'] .tool-shell {
  background:
    linear-gradient(
      135deg,
      rgba(245, 197, 24, 0.03) 0%,
      transparent 35%,
      transparent 75%,
      rgba(0, 0, 0, 0.25) 100%
    ),
    var(--bg-void, #08090c);
}

[data-theme='dark'] .tool-header,
[data-theme='auto'] .tool-header {
  background: var(--bg-deep);
  border-bottom-color: var(--border-subtle);
}

[data-theme='dark'] .tool-title,
[data-theme='auto'] .tool-title {
  font-family: var(--font-heading);
  letter-spacing: 1px;
}

[data-theme='dark'] .tool-back:hover,
[data-theme='auto'] .tool-back:hover {
  background: var(--bg-panel-hover);
}

[data-theme='dark'] .tool-footer,
[data-theme='auto'] .tool-footer {
  background: var(--bg-deep);
  border-top-color: var(--border-subtle);
}
</style>
