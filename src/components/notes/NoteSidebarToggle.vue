<script setup lang="ts">
/** 文件树收起时的展开按钮条 */
const emit = defineEmits<{
  toggle: [];
}>();
</script>

<template>
  <div class="sidebar-toggle-strip">
    <button
      class="tree-header-btn"
      title="展开文件树"
      aria-label="展开文件树"
      @click="emit('toggle')"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      >
        <path d="M7 4l8 8-8 8" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
/* ═══ 侧边栏展开按钮条（收起时） ═══ */

.sidebar-toggle-strip {
  width: 34px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 6px;
  border-right: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

.sidebar-toggle-strip .tree-header-btn {
  width: 28px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sidebar-toggle-strip .tree-header-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sidebar-toggle-strip .tree-header-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
