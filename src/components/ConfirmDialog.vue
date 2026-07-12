<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';

const props = withDefaults(
  defineProps<{
    visible: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    /** 是否为危险操作（删除等），确认按钮显示红色 */
    danger?: boolean;
  }>(),
  {
    confirmText: '确定',
    cancelText: '取消',
    danger: false,
  },
);

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

/** 取消按钮的 DOM 引用，默认聚焦防止误触 Enter 直接确认 */
const cancelBtnRef = ref<HTMLButtonElement | null>(null);

watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      await nextTick();
      cancelBtnRef.value?.focus();
    }
  },
);

function handleConfirm() {
  emit('confirm');
}

function handleCancel() {
  emit('cancel');
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    handleCancel();
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div
        v-if="visible"
        class="dialog-overlay"
        @click.self="handleCancel"
        @keydown="handleKeydown"
      >
        <div class="dialog-container">
          <div class="dialog-header">
            <h3 class="dialog-title">{{ title }}</h3>
          </div>
          <div class="dialog-body">
            <p class="dialog-message">{{ message }}</p>
          </div>
          <div class="dialog-footer">
            <button ref="cancelBtnRef" class="dialog-btn dialog-btn-cancel" @click="handleCancel">
              {{ cancelText }}
            </button>
            <button
              :class="['dialog-btn', danger ? 'dialog-btn-danger' : 'dialog-btn-confirm']"
              @click="handleConfirm"
            >
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.dialog-container {
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  min-width: 380px;
  max-width: 90vw;
  animation: dialog-slide 0.2s ease-out;
}

@keyframes dialog-slide {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.dialog-header {
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
}

.dialog-title {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.dialog-body {
  padding: var(--space-lg);
}

.dialog-message {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.6;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg);
  border-top: 1px solid var(--border-subtle);
}

.dialog-btn {
  padding: var(--space-sm) var(--space-md);
  font-size: var(--text-sm);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid var(--border-default);
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.dialog-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.dialog-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dialog-btn-cancel:hover {
  background: var(--bg-hover);
}

.dialog-btn-confirm {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.dialog-btn-confirm:hover:not(:disabled) {
  background: var(--accent-dark);
  border-color: var(--accent-dark);
}

.dialog-btn-danger {
  background: #e74c3c;
  color: #fff;
  border-color: #e74c3c;
}

.dialog-btn-danger:hover:not(:disabled) {
  background: #c0392b;
  border-color: #c0392b;
}

[data-theme='hud'] .dialog-container,
[data-theme='hud'] .dialog-container {
  background: var(--bg-elevated);
  border: 1px solid var(--border-line);
  clip-path: polygon(
    12px 0%,
    100% 0%,
    100% calc(100% - 12px),
    calc(100% - 12px) 100%,
    0% 100%,
    0% 12px
  );
  border-radius: 0;
}

[data-theme='hud'] .dialog-btn,
[data-theme='hud'] .dialog-btn {
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
  border-radius: 0;
  background: var(--bg-secondary);
  border-color: var(--border-line);
}

[data-theme='hud'] .dialog-btn-confirm,
[data-theme='hud'] .dialog-btn-confirm {
  background: var(--accent);
  color: #0f1118;
  border-color: var(--accent);
}

[data-theme='hud'] .dialog-btn-confirm:hover:not(:disabled),
[data-theme='hud'] .dialog-btn-confirm:hover:not(:disabled) {
  background: var(--accent-hover);
  box-shadow: 0 0 12px var(--accent-glow);
}

[data-theme='hud'] .dialog-btn-danger,
[data-theme='hud'] .dialog-btn-danger {
  background: transparent;
  border-color: var(--status-danger);
  color: var(--status-danger);
}

/* 过渡动画 */
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.2s;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}
</style>
