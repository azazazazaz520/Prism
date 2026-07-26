<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
  actionLabel?: string;
}>();

const emit = defineEmits<{
  action: [];
}>();
</script>

<template>
  <div class="empty-state">
    <div class="empty-title">{{ title }}</div>
    <p v-if="description" class="empty-description">{{ description }}</p>
    <button v-if="actionLabel" type="button" class="empty-action" @click="emit('action')">
      {{ actionLabel }}
    </button>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px var(--space-lg);
  text-align: center;
  color: var(--text-muted);
}

.empty-title {
  color: var(--text-secondary);
  font-size: var(--text-base);
  font-weight: 600;
}

.empty-description {
  max-width: 280px;
  margin: var(--space-sm) 0 0;
  font-size: var(--text-sm);
  line-height: 1.5;
}

.empty-action {
  margin-top: var(--space-md);
  padding: 7px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--accent);
  cursor: pointer;
}
</style>
