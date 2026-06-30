<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

const selecting = ref(false);
const startX = ref(0);
const startY = ref(0);
const endX = ref(0);
const endY = ref(0);
const rectStyle = ref<Record<string, string>>({ display: 'none' });

function onMouseDown(e: MouseEvent) {
  selecting.value = true;
  startX.value = e.clientX;
  startY.value = e.clientY;
  endX.value = e.clientX;
  endY.value = e.clientY;
  updateRect();
}

function onMouseMove(e: MouseEvent) {
  if (!selecting.value) return;
  endX.value = e.clientX;
  endY.value = e.clientY;
  updateRect();
}

function updateRect() {
  const x = Math.min(startX.value, endX.value);
  const y = Math.min(startY.value, endY.value);
  const w = Math.abs(endX.value - startX.value);
  const h = Math.abs(endY.value - startY.value);
  rectStyle.value = {
    display: 'block',
    left: x + 'px',
    top: y + 'px',
    width: w + 'px',
    height: h + 'px',
  };
}

async function onMouseUp() {
  if (!selecting.value) return;
  selecting.value = false;
  const x = Math.min(startX.value, endX.value);
  const y = Math.min(startY.value, endY.value);
  const w = Math.abs(endX.value - startX.value);
  const h = Math.abs(endY.value - startY.value);

  if (w < 20 || h < 20) {
    await invoke('hide_selector_window');
    return;
  }

  // DPI 缩放补偿：e.clientX/Y 是逻辑像素，截图 API 是物理像素
  const scale = window.devicePixelRatio || 1;
  console.log('[DEBUG] crop coords:', {
    x: Math.round(x * scale),
    y: Math.round(y * scale),
    w: Math.round(w * scale),
    h: Math.round(h * scale),
  });
  try {
    await invoke('crop_screenshot', {
      x: Math.round(x * scale),
      y: Math.round(y * scale),
      width: Math.round(w * scale),
      height: Math.round(h * scale),
    });
  } finally {
    resetState();
    await invoke('hide_selector_window');
  }
}

function resetState() {
  selecting.value = false;
  rectStyle.value = { display: 'none' };
}

onMounted(async () => {
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
  document.body.style.cursor = 'crosshair';

  // 每次窗口显示时重置选框
  const win = getCurrentWindow();
  unlisten = await win.listen('tauri://focus', resetState);
});

let unlisten: (() => void) | null = null;
onUnmounted(() => {
  if (unlisten) unlisten();
});
</script>

<template>
  <div
    class="selector-overlay"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
  >
    <div class="selection-rect" :style="rectStyle"></div>
    <div class="hint">拖动选择截图区域</div>
  </div>
</template>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
.selector-overlay {
  width: 100vw;
  height: 100vh;
  position: fixed;
  top: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.25);
  user-select: none;
}
.selection-rect {
  position: fixed;
  border: 2px solid var(--accent);
  background: rgba(45, 212, 191, 0.1);
  pointer-events: none;
  z-index: 10;
}
.hint {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
  font-family: var(--font-sans);
  pointer-events: none;
}
</style>
