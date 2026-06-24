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
      <button
        v-if="!showInput"
        class="tag-chip add"
        @click="openAddTag"
      >
        +
      </button>
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
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}

.tag-chip {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 4px;
  border: 1px solid #e0e0e0;
  background: none;
  color: #888;
  cursor: pointer;
  transition: all 0.15s;
}

.tag-chip:hover {
  border-color: #888;
  color: #555;
}

.tag-chip.active {
  background: #333;
  color: white;
  border-color: #333;
}

.tag-chip.add {
  border-style: dashed;
  color: #bbb;
}

.tag-input-inline {
  font-size: 11px;
  padding: 3px 6px;
  border: 1px solid #888;
  border-radius: 4px;
  outline: none;
  min-width: 70px;
}
</style>
