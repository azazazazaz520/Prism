<script setup lang="ts">
import { ref, nextTick } from 'vue';

const props = defineProps<{
  tags: string[];
  selected: string[];
}>();

const emit = defineEmits<{
  toggleTag: [tag: string];
  addTag: [tag: string];
}>();

const showInput = ref(false);
const newTagName = ref('');
const tagInputRef = ref<HTMLInputElement | null>(null);

function toggleTag(tag: string) {
  emit('toggleTag', tag);
}

function openAddTag() {
  showInput.value = true;
  nextTick(() => {
    tagInputRef.value?.focus();
  });
}

function handleAddTag() {
  const trimmed = newTagName.value.trim();
  if (trimmed && !props.tags.includes(trimmed)) {
    emit('addTag', trimmed);
  }
  newTagName.value = '';
  showInput.value = false;
}
</script>

<template>
  <div class="tag-filter">
    <div class="tag-chips">
      <button
        :class="['tag-chip', { active: selected.length === 0 }]"
        @click="emit('toggleTag', '')"
      >
        全部
      </button>
      <button
        v-for="tag in tags"
        :key="tag"
        :class="['tag-chip', { active: selected.includes(tag) }]"
        @click="toggleTag(tag)"
      >
        {{ tag }}
      </button>
      <button v-if="!showInput" class="tag-chip add" @click="openAddTag">+</button>
      <input
        v-else
        v-model="newTagName"
        type="text"
        ref="tagInputRef"
        class="tag-input-inline"
        placeholder="新标签"
        @keydown.enter="handleAddTag"
        @keydown.escape="showInput = false"
        @blur="handleAddTag"
      />
    </div>
  </div>
</template>

<style scoped>
.tag-filter {
  margin-bottom: 0;
}

.tag-chips {
  display: flex;
  gap: var(--space-xs);
  flex-wrap: wrap;
  align-items: center;
}

.tag-chip {
  font-size: var(--text-xs);
  padding: var(--space-xs) var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

[data-theme='hud'] .tag-chip,
[data-theme='hud'] .tag-chip {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  color: #c8cacf;
  border-radius: 0;
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
  border-color: rgba(245, 197, 24, 0.25);
}

.tag-chip:hover {
  border-color: var(--accent-muted);
  color: var(--text-primary);
  background: var(--bg-hover);
}

[data-theme='hud'] .tag-chip:hover,
[data-theme='hud'] .tag-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(245, 197, 24, 0.1);
}

.tag-chip.active {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

[data-theme='hud'] .tag-chip.active,
[data-theme='hud'] .tag-chip.active {
  color: #0f1118;
  background: var(--accent);
  border-color: var(--accent);
  font-weight: 600;
}

.tag-chip.add {
  border-style: dashed;
  color: var(--text-disabled);
}

.tag-input-inline {
  font-size: var(--text-xs);
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  outline: none;
  min-width: 70px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.tag-input-inline:focus {
  border-color: var(--accent);
}
</style>
