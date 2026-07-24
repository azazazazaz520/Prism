<script setup lang="ts">
defineProps<{
  message: string;
  actionLabel?: string;
}>();

const emit = defineEmits<{
  action: [];
}>();
</script>

<template>
  <Transition name="toast">
    <div v-if="message" class="toast" role="status" aria-live="polite">
      <span>{{ message }}</span>
      <button v-if="actionLabel" type="button" class="toast-action" @click="emit('action')">
        {{ actionLabel }}
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: var(--space-md);
  max-width: min(420px, calc(100vw - 32px));
  padding: 10px 14px;
  transform: translateX(-50%);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.18));
  font-size: var(--text-sm);
}

.toast-action {
  flex-shrink: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-weight: 600;
}

.toast-action:hover {
  text-decoration: underline;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
