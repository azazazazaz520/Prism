<script setup lang="ts">
import { ref } from 'vue';

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

function toggleTag(tag: string) {
  emit('toggleTag', tag);
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
        @click="showInput = true"
      >
        +
      </button>
      <input
        v-else
        v-model="newTagName"
        type="text"
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
  margin-bottom: 12px;
}

.tag-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}

.tag-chip {
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 12px;
  border: 1px solid #e0e0e0;
  background: white;
  color: #666;
  cursor: pointer;
  transition: all 0.15s;
}

.tag-chip:hover {
  border-color: #4a90d9;
  color: #4a90d9;
}

.tag-chip.active {
  background: #4a90d9;
  color: white;
  border-color: #4a90d9;
}

.tag-chip.add {
  border-style: dashed;
  color: #bbb;
}

.tag-input-inline {
  font-size: 12px;
  padding: 4px 8px;
  border: 1px solid #4a90d9;
  border-radius: 12px;
  outline: none;
  width: 80px;
}
</style>
