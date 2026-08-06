<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { ContextMenuItem } from '../../composables/useContextMenu';

export type { ContextMenuItem } from '../../composables/useContextMenu';

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

const openSubmenuId = ref<string | null>(null);

function onKeydown(e: KeyboardEvent) {
  if (!props.visible) return;
  if (e.key === 'Escape') {
    emit('close');
    return;
  }

  if (e.key === 'ArrowRight' && openSubmenuId.value) {
    const firstItem = document.querySelector<HTMLElement>(
      `.context-menu-entry[data-menu-item="${openSubmenuId.value}"] .context-menu-submenu button`,
    );
    firstItem?.focus();
  }
}

function onDocumentClick(e: MouseEvent) {
  if (props.visible) {
    const target = e.target as HTMLElement;
    if (!target.closest('.context-menu')) {
      openSubmenuId.value = null;
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

async function handleItemClick(item: ContextMenuItem) {
  if (item.disabled || !item.action) return;
  try {
    await item.action();
  } finally {
    openSubmenuId.value = null;
    emit('close');
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="context-menu"
      role="menu"
      :style="{ left: x + 'px', top: y + 'px' }"
      @click.stop
      @contextmenu.stop.prevent
    >
      <div
        v-for="item in items"
        :key="item.id"
        class="context-menu-entry"
        :class="{ 'has-separator': item.separatorBefore }"
        :data-menu-item="item.id"
        @mouseenter="item.submenu && (openSubmenuId = item.id)"
      >
        <button
          type="button"
          role="menuitem"
          :class="['context-menu-item', { disabled: item.disabled }]"
          :disabled="item.disabled || (!item.action && !item.submenu)"
          :aria-haspopup="item.submenu ? 'menu' : undefined"
          :aria-expanded="item.submenu ? openSubmenuId === item.id : undefined"
          @click="handleItemClick(item)"
        >
          <span v-if="item.icon" class="context-menu-icon" v-html="item.icon"></span>
          <span class="context-menu-label">{{ item.label }}</span>
          <span v-if="item.submenu" class="context-menu-chevron" aria-hidden="true">›</span>
        </button>
        <div
          v-if="item.submenu && openSubmenuId === item.id"
          class="context-menu-submenu"
          role="menu"
        >
          <div
            v-for="subitem in item.submenu"
            :key="subitem.id"
            class="context-menu-entry"
            :class="{ 'has-separator': subitem.separatorBefore }"
          >
            <button
              type="button"
              role="menuitem"
              :class="['context-menu-item', { disabled: subitem.disabled }]"
              :disabled="subitem.disabled || !subitem.action"
              @click="handleItemClick(subitem)"
            >
              <span v-if="subitem.icon" class="context-menu-icon" v-html="subitem.icon"></span>
              <span class="context-menu-label">{{ subitem.label }}</span>
            </button>
          </div>
        </div>
      </div>
      <div v-if="items.length === 0" class="context-menu-empty">无可用操作</div>
    </div>
  </Teleport>
</template>

<style>
/* 全局样式（非 scoped，因为 Teleport 到 body 后 scoped 不生效） */
.context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 196px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: 6px;
  display: flex;
  flex-direction: column;
}

.context-menu-entry {
  position: relative;
}

.context-menu-entry.has-separator {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid var(--border-subtle);
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 30px;
  padding: 5px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-sm);
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast);
}

.context-menu-item.disabled {
  opacity: 0.42;
  cursor: default;
}

.context-menu-entry.has-separator > .context-menu-item {
  /* 分隔线由条目自身绘制，避免影响按钮的可点击区域。 */
}

.context-menu-item:not(:disabled):hover,
.context-menu-item:not(:disabled):focus-visible {
  background: var(--bg-hover);
  outline: none;
}

.context-menu-submenu {
  position: absolute;
  z-index: 1;
  top: -7px;
  left: calc(100% + 6px);
  min-width: 196px;
  padding: 6px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  box-shadow: var(--shadow-lg);
}

.context-menu-chevron {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 19px;
  line-height: 14px;
}

.context-menu-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.context-menu-icon svg {
  width: 17px;
  height: 17px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
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
