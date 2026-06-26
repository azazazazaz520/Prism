<script setup lang="ts">
import { ref, onMounted } from 'vue';

const input = ref('#3B82F6');
const output = ref('');
const swatchStyle = ref({ background: '#3b82f6' });
const copied = ref(false);

onMounted(convert);

function convert() {
  const v = input.value.trim();
  if (v.startsWith('#')) {
    hexToAll(v);
  } else if (v.startsWith('rgb')) {
    rgbToAll(v);
  } else {
    output.value = '请输入 HEX(#RRGGBB) 或 RGB(r,g,b)';
  }
}

function hexToAll(hex: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    output.value = '格式: #RRGGBB';
    return;
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  swatchStyle.value = { background: hex };
  const { h, s, l } = rgbToHsl(r, g, b);
  output.value = `HEX: ${hex}   RGB: rgb(${r},${g},${b})   HSL: hsl(${h},${s}%,${l}%)`;
}

function rgbToAll(val: string) {
  const m = val.match(/\d+/g);
  if (!m || m.length < 3) {
    output.value = '格式: rgb(r,g,b)';
    return;
  }
  const r = parseInt(m[0]),
    g = parseInt(m[1]),
    b = parseInt(m[2]);
  const hex = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
  swatchStyle.value = { background: `rgb(${r},${g},${b})` };
  const { h, s, l } = rgbToHsl(r, g, b);
  output.value = `HEX: ${hex}   RGB: rgb(${r},${g},${b})   HSL: hsl(${h},${s}%,${l}%)`;
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

async function copy() {
  await navigator.clipboard.writeText(output.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div class="color-tool">
    <div class="color-input-row">
      <div class="color-swatch" :style="swatchStyle" />
      <input
        class="tool-input"
        v-model="input"
        @input="convert"
        placeholder="#3B82F6 / rgb(59,130,246)"
      />
    </div>
    <pre class="tool-output">{{ output }}</pre>
    <div class="tool-actions">
      <button class="btn" @click="copy">复制</button>
      <span v-if="copied" class="copied-hint">已复制</span>
    </div>
  </div>
</template>

<style scoped>
.color-tool {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.color-input-row {
  display: flex;
  gap: var(--space-md);
  align-items: flex-start;
}
.color-swatch {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  flex-shrink: 0;
}
.tool-input {
  flex: 1;
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-family: monospace;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--bg-primary);
  outline: none;
}
.tool-input:focus {
  border-color: var(--accent);
}
.tool-actions {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}
.btn {
  padding: 5px 14px;
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
.copied-hint {
  font-size: var(--text-xs);
  color: var(--success);
}
.tool-output {
  padding: var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  font-family: monospace;
  font-size: var(--text-sm);
  white-space: pre-wrap;
  min-height: 50px;
  color: var(--text-primary);
}
</style>
