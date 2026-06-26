<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  visible: boolean;
  title: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
}>();

const emit = defineEmits<{
  confirm: [value: string];
  cancel: [];
}>();

const inputValue = ref('');

// 当弹窗打开时，初始化输入值
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      inputValue.value = props.defaultValue || '';
    }
  },
);

function handleConfirm() {
  const value = inputValue.value.trim();
  if (!value) return; // 空值不允许提交
  emit('confirm', value);
}

function handleCancel() {
  emit('cancel');
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleConfirm();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    handleCancel();
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div v-if="visible" class="dialog-overlay" @click.self="handleCancel">
        <div class="dialog-container">
          <div class="dialog-header">
            <h3 class="dialog-title">{{ title }}</h3>
          </div>
          <div class="dialog-body">
            <label class="dialog-label">{{ label }}</label>
            <input
              ref="inputRef"
              v-model="inputValue"
              type="text"
              class="dialog-input"
              :placeholder="placeholder"
              @keydown="handleKeydown"
              autofocus
            />
          </div>
          <div class="dialog-footer">
            <button class="dialog-btn dialog-btn-cancel" @click="handleCancel">取消</button>
            <button
              class="dialog-btn dialog-btn-confirm"
              :disabled="!inputValue.trim()"
              @click="handleConfirm"
            >
              确定
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
  min-width: 400px;
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

.dialog-label {
  display: block;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-bottom: var(--space-sm);
}

.dialog-input {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: var(--bg-primary);
  outline: none;
  transition: border-color 0.15s;
}

.dialog-input:focus {
  border-color: var(--accent);
}

.dialog-input::placeholder {
  color: var(--text-disabled);
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

.dialog-btn-confirm {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.dialog-btn-confirm:hover:not(:disabled) {
  background: var(--accent-dark);
  border-color: var(--accent-dark);
}

.dialog-btn-cancel:hover {
  background: var(--bg-hover);
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
