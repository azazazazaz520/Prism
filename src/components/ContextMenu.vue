<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  action: () => void | Promise<void>;
}

const props = withDefaults(
  defineProps<{
    visible: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
  }>(),
  { visible: false, x: 0, y: 0, items: () => [] },
);

const emit = defineEmits<{
  close: [];
}>();

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible) {
    emit('close');
  }
}

function onDocumentClick(e: MouseEvent) {
  if (props.visible) {
    const target = e.target as HTMLElement;
    if (!target.closest('.context-menu')) {
      emit('close');
    }
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('click', onDocumentClick);
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('click', onDocumentClick);
});

function handleItemClick(item: ContextMenuItem) {
  item.action();
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="context-menu" :style="{ left: x + 'px', top: y + 'px' }" @click.stop>
      <button
        v-for="item in items"
        :key="item.id"
        class="context-menu-item"
        @click="handleItemClick(item)"
      >
        <span v-if="item.icon" class="context-menu-icon" v-html="item.icon"></span>
        <span class="context-menu-label">{{ item.label }}</span>
      </button>
      <div v-if="items.length === 0" class="context-menu-empty">无可用操作</div>
    </div>
  </Teleport>
</template>

<style>
/* 全局样式（非 scoped，因为 Teleport 到 body 后 scoped 不生效） */
.context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 180px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: var(--space-xs);
  display: flex;
  flex-direction: column;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-sm);
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast);
}

.context-menu-item:hover {
  background: var(--bg-hover);
}

.context-menu-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.context-menu-icon svg {
  width: 14px;
  height: 14px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.5;
}

.context-menu-label {
  flex: 1;
  white-space: nowrap;
}

.context-menu-empty {
  padding: var(--space-sm) var(--space-md);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

/* HUD 主题适配 */
[data-theme='hud'] .context-menu {
  border-radius: 0;
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
}
[data-theme='hud'] .context-menu-item {
  border-radius: 0;
}
</style>
