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
  output.value = `HEX: ${hex}\nRGB: rgb(${r}, ${g}, ${b})\nHSL: hsl(${h}, ${s}%, ${l}%)`;
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
  output.value = `HEX: ${hex}\nRGB: rgb(${r}, ${g}, ${b})\nHSL: hsl(${h}, ${s}%, ${l}%)`;
}

// RGB → HSL 转换（标准算法，参考 CSS Color Level 4）
// 归一化 RGB → 计算 max/min 差值 → 根据主色通道推导色相
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

function clearAll() {
  input.value = '';
  output.value = '';
  swatchStyle.value = { background: '#ffffff' };
}
</script>

<template>
  <div class="color-tool">
    <!-- 工具栏 -->
    <div class="tool-toolbar">
      <div class="toolbar-group toolbar-primary">
        <span class="tool-title">颜色转换器</span>
      </div>
      <div class="toolbar-group toolbar-secondary">
        <button class="btn btn-icon" @click="copy" :disabled="!output" title="复制结果">
          <svg
            v-if="!copied"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
          <svg
            v-else
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
        <button class="btn btn-icon" @click="clearAll" :disabled="!input && !output" title="清空">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path
              d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
            />
          </svg>
        </button>
      </div>
    </div>

    <!-- 分栏区域 -->
    <div class="tool-panes">
      <!-- 输入区 -->
      <div class="pane pane-input">
        <div class="pane-header">
          <span class="pane-label">输入颜色值</span>
        </div>
        <div class="input-section">
          <div class="color-swatch-wrapper">
            <div class="color-swatch" :style="swatchStyle"></div>
          </div>
          <input
            class="pane-content input-field"
            v-model="input"
            @input="convert"
            placeholder="#3B82F6 或 rgb(59,130,246)"
          />
        </div>
      </div>

      <!-- 输出区 -->
      <div class="pane pane-output">
        <div class="pane-header">
          <span class="pane-label">转换结果</span>
          <span v-if="copied" class="pane-status status-copied">已复制</span>
        </div>
        <pre class="pane-content"><code>{{ output || '等待输入...' }}</code></pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.color-tool {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  height: 100%;
}

/* ── 工具栏 ─────────────────────────────── */
.tool-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding-bottom: var(--space-xs);
  border-bottom: 1px solid var(--border-subtle);
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.tool-title {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

/* ── 按钮样式 ─────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  cursor: pointer;
  border: 1px solid var(--border-default);
  background: var(--bg-primary);
  color: var(--text-secondary);
  transition:
    background var(--transition-fast) var(--easing-standard),
    border-color var(--transition-fast) var(--easing-standard),
    color var(--transition-fast) var(--easing-standard);
}

.btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-icon {
  padding: 6px 8px;
}

/* ── 分栏布局 ─────────────────────────────── */
.tool-panes {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
  min-height: 0;
}

.pane {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-primary);
}

.pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px var(--space-md);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.pane-label {
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.pane-status {
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.status-success {
  background: rgba(39, 174, 96, 0.1);
  color: var(--success);
}

.status-error {
  background: var(--danger-light);
  color: var(--danger);
}

.status-copied {
  background: var(--accent-light);
  color: var(--accent);
}

.input-section {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md);
  flex: 1;
}

.color-swatch-wrapper {
  flex-shrink: 0;
}

.color-swatch {
  width: 60px;
  height: 60px;
  border-radius: var(--radius-md);
  border: 2px solid var(--border-default);
  box-shadow: var(--shadow-sm);
  transition: all var(--transition-fast);
}

.pane-content {
  flex: 1;
  padding: var(--space-md);
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--text-primary);
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.input-field {
  min-height: 44px;
  padding: 10px var(--space-md);
  font-family: inherit;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}

.input-field:focus {
  border-color: var(--accent);
}

.pane-input .pane-content {
  background: var(--bg-primary);
}

.pane-output .pane-content {
  background: var(--bg-secondary);
}

.pane-output code {
  color: var(--text-primary);
}

/* ── 响应式：小屏幕单列 ───────────────────── */
@media (max-width: 768px) {
  .tool-panes {
    grid-template-columns: 1fr;
  }

  .input-section {
    flex-direction: column;
    align-items: stretch;
  }

  .color-swatch {
    width: 100%;
    height: 80px;
  }
}
</style>
