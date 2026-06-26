<script setup lang="ts">
import { ref, onMounted } from 'vue';

const uuid = ref('');
const copied = ref(false);

onMounted(generate);
function generate() {
  uuid.value = crypto.randomUUID();
}
async function copy() {
  await navigator.clipboard.writeText(uuid.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div class="uuid-tool">
    <pre class="uuid-display">{{ uuid }}</pre>
    <div class="tool-actions">
      <button class="btn btn-primary" @click="generate">生成新 UUID</button>
      <button class="btn" @click="copy">复制</button>
      <span v-if="copied" class="copied-hint">已复制</span>
    </div>
  </div>
</template>

<style scoped>
.uuid-tool {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  align-items: center;
}
.uuid-display {
  padding: var(--space-lg);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  font-family: monospace;
  font-size: 18px;
  letter-spacing: 1px;
  color: var(--text-primary);
  text-align: center;
}
.tool-actions {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}
.btn {
  padding: 6px 16px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  cursor: pointer;
  border: 1px solid var(--border-default);
  background: var(--bg-primary);
  color: var(--text-secondary);
}
.btn:hover {
  background: var(--bg-hover);
}
.btn-primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.btn-primary:hover {
  background: var(--accent-hover);
}
.copied-hint {
  font-size: var(--text-xs);
  color: var(--success);
}
</style>
