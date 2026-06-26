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
  border: 1px solid var(--gray-300);
  background: none;
  color: var(--gray-600);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.tag-chip:hover {
  border-color: var(--gray-600);
  color: var(--text-secondary);
}

.tag-chip.active {
  background: var(--gray-900);
  color: white;
  border-color: var(--gray-900);
}

.tag-chip.add {
  border-style: dashed;
  color: var(--text-disabled);
}

.tag-input-inline {
  font-size: var(--text-xs);
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--gray-600);
  border-radius: var(--radius-md);
  outline: none;
  min-width: 70px;
}
</style>
