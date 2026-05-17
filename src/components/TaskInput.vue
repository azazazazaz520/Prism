<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  add: [title: string];
}>();

const title = ref('');
const showError = ref(false);

function handleSubmit() {
  const trimmed = title.value.trim();
  if (!trimmed) {
    showError.value = true;
    setTimeout(() => { showError.value = false; }, 2000);
    return;
  }
  emit('add', trimmed);
  title.value = '';
  showError.value = false;
}
</script>

<template>
  <div class="task-input">
    <input
      v-model="title"
      type="text"
      placeholder="输入新任务..."
      :class="['task-input-field', { error: showError }]"
      @keydown.enter="handleSubmit"
    />
    <button class="task-input-btn" @click="handleSubmit">添加</button>
  </div>
</template>

<style scoped>
.task-input {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.task-input-field {
  flex: 1;
  padding: 10px 14px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s;
}

.task-input-field:focus {
  border-color: #4a90d9;
}

.task-input-field.error {
  border-color: #e74c3c;
}

.task-input-btn {
  padding: 10px 20px;
  background: #4a90d9;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  cursor: pointer;
  transition: background 0.2s;
}

.task-input-btn:hover {
  background: #357abd;
}
</style>
