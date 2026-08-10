<script setup lang="ts">
/** 编辑器底部状态栏（编码、语言、字数、光标位置与保存状态） */
defineProps<{
  wordCount: number;
  cursorLine: number;
  cursorCol: number;
  saving: boolean;
}>();
</script>

<template>
  <div class="editor-statusbar">
    <span>UTF-8</span>
    <span class="statusbar-sep">|</span>
    <span>Markdown</span>
    <span class="statusbar-sep">|</span>
    <span>{{ wordCount }}</span>
    <span class="statusbar-sep">|</span>
    <span>Line {{ cursorLine }}, Col {{ cursorCol }}</span>
    <span v-if="saving" class="statusbar-saving">保存中...</span>
  </div>
</template>

<style scoped>
/* ═══ 状态栏 ═══ */

.editor-statusbar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  height: 28px;
  padding: 0 var(--space-lg);
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-subtle);
  font-size: var(--text-xs);
  color: var(--text-muted);
  flex-shrink: 0;
  user-select: none;
}

.statusbar-sep {
  color: var(--border-default);
}

.statusbar-saving {
  margin-left: auto;
  color: var(--accent);
}
</style>
