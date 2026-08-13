<script setup lang="ts">
/** 编辑器底部状态栏（编码、语言、字数、光标位置与保存状态） */
const props = withDefaults(
  defineProps<{
    wordCount: number;
    cursorLine: number;
    cursorCol: number;
    saving: boolean;
    saveStatus?: 'idle' | 'scheduled' | 'saving' | 'saved' | 'failed' | 'conflict';
    saveError?: string | null;
  }>(),
  {
    saveStatus: 'idle',
    saveError: null,
  },
);

const emit = defineEmits<{
  /** 保存失败后用户点击“重试”按钮，由父组件立即重新保存 */
  retry: [];
}>();
</script>

<template>
  <div class="editor-statusbar">
    <span>UTF-8</span>
    <span class="statusbar-sep">|</span>
    <span>Markdown</span>
    <span class="statusbar-sep">|</span>
    <span>{{ props.wordCount }}</span>
    <span class="statusbar-sep">|</span>
    <span>Line {{ props.cursorLine }}, Col {{ props.cursorCol }}</span>
    <span v-if="props.saving || props.saveStatus === 'saving'" class="statusbar-saving"
      >保存中...</span
    >
    <span v-else-if="props.saveStatus === 'scheduled'" class="statusbar-pending">等待保存</span>
    <span v-else-if="props.saveStatus === 'saved'" class="statusbar-saved">已保存</span>
    <span v-else-if="props.saveStatus === 'failed'" class="statusbar-error">
      保存失败{{ props.saveError ? `：${props.saveError}` : '' }}
    </span>
    <span v-else-if="props.saveStatus === 'conflict'" class="statusbar-error"
      >存在外部修改冲突</span
    >
    <button
      v-if="props.saveStatus === 'failed'"
      type="button"
      class="statusbar-retry"
      @click="emit('retry')"
    >
      重试
    </button>
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

.statusbar-pending,
.statusbar-saved,
.statusbar-error {
  margin-left: auto;
}

.statusbar-pending {
  color: var(--text-muted);
}

.statusbar-saved {
  color: var(--accent);
}

.statusbar-error {
  color: var(--danger, #c2410c);
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.statusbar-retry {
  flex-shrink: 0;
  margin-left: var(--space-sm);
  padding: 1px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
  transition:
    color var(--motion-duration-hover) var(--motion-ease-standard),
    border-color var(--motion-duration-hover) var(--motion-ease-standard),
    background-color var(--motion-duration-hover) var(--motion-ease-standard);
}

.statusbar-retry:hover {
  border-color: var(--accent);
  background: var(--accent-light);
  color: var(--accent-hover);
}
</style>
