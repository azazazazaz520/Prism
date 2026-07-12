<script setup lang="ts">
import { ref, computed } from 'vue';
import ToolShell from './ToolShell.vue';
import JsonTool from './JsonTool.vue';
import RegexTool from './RegexTool.vue';
import Base64Tool from './Base64Tool.vue';
import TimestampTool from './TimestampTool.vue';
import UuidTool from './UuidTool.vue';
import ColorTool from './ColorTool.vue';

const props = defineProps<{ aiEnabled?: boolean }>();

interface ToolDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  /** 每个工具的独立色调（HSL 色相），用于图标背景渐变 */
  hue: number;
}

const tools: ToolDef[] = [
  {
    id: 'json',
    name: 'JSON 格式化',
    desc: '格式化、压缩、校验 JSON',
    hue: 180,
    icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M12 18v-6M9 15h6',
  },
  {
    id: 'regex',
    name: '正则测试',
    desc: '测试正则，高亮匹配结果',
    hue: 220,
    icon: 'M12 2a10 10 0 1010 10A10 10 0 0012 2zm4.2 13.8l-1.4 1.4L12 14.4l-2.8 2.8-1.4-1.4 2.8-2.8-2.8-2.8 1.4-1.4 2.8 2.8 2.8-2.8 1.4 1.4-2.8 2.8z',
  },
  {
    id: 'base64',
    name: 'Base64',
    desc: '双向编解码',
    hue: 280,
    icon: 'M8 3l-5 5v13a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM8 3v5H3M10 12l4 4 4-4',
  },
  {
    id: 'timestamp',
    name: '时间戳',
    desc: 'Unix 时间戳 ↔ 日期',
    hue: 30,
    icon: 'M12 2a10 10 0 1010 10A10 10 0 0012 2zm0 4v6l4 2',
  },
  {
    id: 'uuid',
    name: 'UUID 生成',
    desc: '生成 v4 UUID，一键复制',
    hue: 340,
    icon: 'M10 2h4v4h-4zM3 10h4v4H3zM17 10h4v4h-4zM10 18h4v4h-4z',
  },
  {
    id: 'color',
    name: '颜色转换',
    desc: 'HEX ↔ RGB ↔ HSL',
    hue: 140,
    icon: 'M12 2a10 10 0 1010 10A10 10 0 0012 2zm0 2a8 8 0 11-8 8 8 8 0 018-8z',
  },
];

const searchQuery = ref('');
const activeTool = ref<string | null>(null);

const filteredTools = computed(() =>
  tools.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      t.desc.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      searchQuery.value === '',
  ),
);

const activeToolDef = computed(() => tools.find((t) => t.id === activeTool.value));

const isEmpty = computed(() => filteredTools.value.length === 0 && searchQuery.value.length > 0);

function openTool(id: string) {
  activeTool.value = id;
}

function back() {
  activeTool.value = null;
  searchQuery.value = '';
}
</script>

<template>
  <div class="toolbox">
    <!-- 工具网格视图 -->
    <template v-if="!activeTool">
      <div class="tb-header">
        <h2 class="tb-title">开发者工具箱</h2>
        <span class="tb-count">{{ tools.length }} 个工具</span>
      </div>
      <div class="tb-search-wrap">
        <div class="tb-search">
          <svg
            class="tb-search-icon"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            class="tb-search-input"
            v-model="searchQuery"
            placeholder="搜索工具..."
            autofocus
          />
          <button
            v-if="searchQuery"
            class="tb-search-clear"
            aria-label="清空搜索"
            @click="searchQuery = ''"
          >
            ×
          </button>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="isEmpty" class="tb-empty">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-disabled)"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35M8 11h6" />
        </svg>
        <p class="tb-empty-text">没有匹配「{{ searchQuery }}」的工具</p>
      </div>

      <!-- 工具网格 -->
      <div v-else class="tb-grid">
        <div
          v-for="(tool, idx) in filteredTools"
          :key="tool.id"
          class="tb-card"
          :style="{ '--card-hue': tool.hue, '--card-idx': idx }"
          @click="openTool(tool.id)"
        >
          <div class="tb-card-icon-wrap">
            <svg
              class="tb-card-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path :d="tool.icon" />
            </svg>
          </div>
          <div class="tb-card-body">
            <div class="tb-card-name">{{ tool.name }}</div>
            <div class="tb-card-desc">{{ tool.desc }}</div>
          </div>
          <svg
            class="tb-card-arrow"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
      </div>
    </template>

    <!-- 工具详情视图 -->
    <template v-else>
      <ToolShell :title="activeToolDef?.name ?? ''" @back="back">
        <JsonTool v-if="activeTool === 'json'" :ai-enabled="props.aiEnabled" />
        <RegexTool v-else-if="activeTool === 'regex'" :ai-enabled="props.aiEnabled" />
        <Base64Tool v-else-if="activeTool === 'base64'" />
        <TimestampTool v-else-if="activeTool === 'timestamp'" />
        <UuidTool v-else-if="activeTool === 'uuid'" />
        <ColorTool v-else-if="activeTool === 'color'" />
      </ToolShell>
    </template>
  </div>
</template>

<style scoped>
.toolbox {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
}

/* ── 头部 ──────────────────────────────── */
.tb-header {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  padding: var(--space-2xl) var(--space-2xl) var(--space-md);
}

.tb-title {
  font-weight: var(--font-weight-bold);
  font-size: var(--text-h1);
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.02em;
}

.tb-count {
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-weight: var(--font-weight-medium);
}

/* ── 搜索栏 ─────────────────────────────── */
.tb-search-wrap {
  padding: 0 var(--space-2xl) var(--space-xl);
  max-width: 420px;
}

.tb-search {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 9px var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--bg-secondary);
  color: var(--text-muted);
  transition:
    border-color var(--transition-fast) var(--easing-standard),
    box-shadow var(--transition-fast) var(--easing-standard),
    background var(--transition-fast) var(--easing-standard);
}

.tb-search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
  background: var(--bg-primary);
}

.tb-search-icon {
  flex-shrink: 0;
  opacity: 0.6;
}

.tb-search:focus-within .tb-search-icon {
  opacity: 1;
  color: var(--accent);
}

.tb-search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: transparent;
  min-width: 0;
}

.tb-search-input::placeholder {
  color: var(--text-muted);
}

.tb-search-clear {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: var(--border-default);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.tb-search-clear:hover {
  background: var(--text-muted);
  color: var(--bg-primary);
}

/* ── 空状态 ─────────────────────────────── */
.tb-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  opacity: 0.7;
}

.tb-empty-text {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

/* ── 工具网格（Bento Grid 风格） ─────────── */
.tb-grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-lg);
  padding: 0 var(--space-2xl) var(--space-2xl);
  max-width: 720px;
  align-content: start;
  /* 防止卡片悬浮上移时被裁剪 */
  padding-top: var(--space-sm);
}

/* ── 工具卡片 ──────────────────────────── */
.tb-card {
  position: relative;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: var(--space-xl);
  cursor: pointer;
  transition:
    border-color 0.2s var(--easing-standard),
    box-shadow 0.2s var(--easing-standard),
    transform 0.2s var(--easing-standard);
  min-height: 100px;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  animation: card-enter 0.35s var(--easing-standard) backwards;
  animation-delay: calc(var(--card-idx, 0) * 50ms);
}

@keyframes card-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.tb-card:hover {
  border-color: hsl(var(--card-hue, 180) 40% 70%);
  box-shadow:
    0 6px 16px -4px hsl(var(--card-hue, 180) 40% 70% / 0.18),
    0 2px 6px -1px rgba(0, 0, 0, 0.04);
  transform: translateY(-2px);
  z-index: 1;
}

.tb-card:active {
  transform: translateY(0) scale(0.98);
  transition-duration: 0.08s;
}

/* ── 图标徽章 ────────────────────────────── */
.tb-card-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: hsl(var(--card-hue, 180) 30% 92%);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s var(--easing-standard);
}

[data-theme='hud'] .tb-card-icon-wrap {
  background: hsl(var(--card-hue, 180) 25% 22%);
}

.tb-card:hover .tb-card-icon-wrap {
  background: hsl(var(--card-hue, 180) 50% 88%);
}

[data-theme='hud'] .tb-card:hover .tb-card-icon-wrap {
  background: hsl(var(--card-hue, 180) 35% 28%);
}

.tb-card-icon {
  width: 22px;
  height: 22px;
  color: hsl(var(--card-hue, 180) 50% 36%);
}

[data-theme='hud'] .tb-card-icon {
  color: hsl(var(--card-hue, 180) 55% 72%);
}

.tb-card:hover .tb-card-icon {
  color: hsl(var(--card-hue, 180) 60% 30%);
}

[data-theme='hud'] .tb-card:hover .tb-card-icon {
  color: hsl(var(--card-hue, 180) 60% 78%);
}

/* ── 卡片文字 ──────────────────────────── */
.tb-card-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.tb-card-name {
  font-weight: var(--font-weight-semibold);
  font-size: var(--text-base);
  color: var(--text-primary);
  transition: color var(--transition-fast);
}

.tb-card:hover .tb-card-name {
  color: var(--accent);
}

.tb-card-desc {
  font-size: var(--text-xs);
  color: var(--text-muted);
  transition: color var(--transition-fast);
}

.tb-card:hover .tb-card-desc {
  color: var(--text-secondary);
}

/* ── 箭头指示 ──────────────────────────── */
.tb-card-arrow {
  position: absolute;
  top: var(--space-lg);
  right: var(--space-lg);
  color: var(--text-disabled);
  opacity: 0;
  transform: translateX(-4px);
  transition:
    opacity 0.2s var(--easing-standard),
    transform 0.2s var(--easing-standard);
}

.tb-card:hover .tb-card-arrow {
  opacity: 1;
  transform: translateX(0);
}

/* ── auto 暗色模式 ───────────────────────── */
@media (prefers-color-scheme: dark) {
  [data-theme='hud'] .tb-card-icon-wrap {
    background: hsl(var(--card-hue, 180) 25% 22%);
  }
  [data-theme='hud'] .tb-card:hover .tb-card-icon-wrap {
    background: hsl(var(--card-hue, 180) 35% 28%);
  }
  [data-theme='hud'] .tb-card-icon {
    color: hsl(var(--card-hue, 180) 55% 72%);
  }
  [data-theme='hud'] .tb-card:hover .tb-card-icon {
    color: hsl(var(--card-hue, 180) 60% 78%);
  }
}
</style>
