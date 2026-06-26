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
}

const tools: ToolDef[] = [
  {
    id: 'json',
    name: 'JSON 格式化',
    desc: '格式化、压缩、校验 JSON',
    icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M12 18v-6M9 15h6',
  },
  {
    id: 'regex',
    name: '正则测试',
    desc: '测试正则，高亮匹配结果',
    icon: 'M12 2a10 10 0 1010 10A10 10 0 0012 2zm4.2 13.8l-1.4 1.4L12 14.4l-2.8 2.8-1.4-1.4 2.8-2.8-2.8-2.8 1.4-1.4 2.8 2.8 2.8-2.8 1.4 1.4-2.8 2.8z',
  },
  {
    id: 'base64',
    name: 'Base64',
    desc: '双向编解码',
    icon: 'M8 3l-5 5v13a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM8 3v5H3M10 12l4 4 4-4',
  },
  {
    id: 'timestamp',
    name: '时间戳',
    desc: 'Unix 时间戳 ↔ 日期',
    icon: 'M12 2a10 10 0 1010 10A10 10 0 0012 2zm0 4v6l4 2',
  },
  {
    id: 'uuid',
    name: 'UUID 生成',
    desc: '生成 v4 UUID，一键复制',
    icon: 'M10 2h4v4h-4zM3 10h4v4H3zM17 10h4v4h-4zM10 18h4v4h-4z',
  },
  {
    id: 'color',
    name: '颜色转换',
    desc: 'HEX ↔ RGB ↔ HSL',
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

function openTool(id: string) {
  activeTool.value = id;
}

function back() {
  activeTool.value = null;
}
</script>

<template>
  <div class="toolbox">
    <!-- Grid view -->
    <template v-if="!activeTool">
      <div class="tb-header">
        <h2 class="tb-title">开发者工具箱</h2>
      </div>
      <div class="tb-search">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input class="tb-search-input" v-model="searchQuery" placeholder="搜索工具..." />
      </div>
      <div class="tb-grid">
        <div
          v-for="tool in filteredTools"
          :key="tool.id"
          class="tb-card"
          @click="openTool(tool.id)"
        >
          <svg
            class="tb-card-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent)"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path :d="tool.icon" />
          </svg>
          <div class="tb-card-name">{{ tool.name }}</div>
          <div class="tb-card-desc">{{ tool.desc }}</div>
        </div>
      </div>
    </template>

    <!-- Tool view -->
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

.tb-header {
  padding: var(--space-2xl) var(--space-xl) var(--space-md);
}

.tb-title {
  font-weight: 700;
  font-size: var(--text-h1);
  color: var(--text-primary);
  margin: 0;
}

.tb-search {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin: 0 var(--space-2xl) var(--space-xl);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  max-width: 480px;
  color: var(--text-muted);
  transition: all var(--transition-fast);
  background: var(--bg-primary);
}

.tb-search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}

.tb-search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: transparent;
}

.tb-grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-lg);
  padding: 0 var(--space-xl) var(--space-xl);
  max-width: 720px;
}

.tb-card {
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: var(--space-xl) var(--space-lg);
  cursor: pointer;
  transition: all var(--transition-fast);
  min-height: 110px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.tb-card:hover {
  border-color: var(--accent-muted);
  box-shadow: var(--shadow-lg);
  z-index: 1;
}

.tb-card-icon {
  width: 28px;
  height: 28px;
  margin-bottom: var(--space-sm);
  transition: stroke var(--transition-fast);
}

.tb-card-name {
  font-weight: var(--font-weight-semibold);
  font-size: var(--text-base);
  color: var(--text-primary);
  margin-bottom: 4px;
  transition: color var(--transition-fast);
}

.tb-card-desc {
  font-size: var(--text-xs);
  color: var(--text-muted);
  transition: color var(--transition-fast);
}

.tb-card:hover .tb-card-name {
  color: var(--accent);
}

.tb-card:hover .tb-card-desc {
  color: var(--text-secondary);
}
</style>
