<script setup lang="ts">
import { ref } from 'vue';
import { useDashboard } from '../composables/useDashboard';
import TodayOverview from './widgets/TodayOverview.vue';
import CompletionRing from './widgets/CompletionRing.vue';
import Heatmap from './widgets/Heatmap.vue';
import AiSummary from './widgets/AiSummary.vue';
import OverdueReminder from './widgets/OverdueReminder.vue';
import TagDistribution from './widgets/TagDistribution.vue';
import QuickActions from './widgets/QuickActions.vue';
import AiCommandPanel from './AiCommandPanel.vue';

const {
  layout,
  removeWidget,
  addWidget,
  moveWidget,
  saveLayout,
  getWidgetDef,
  enabledWidgets,
  availableWidgets,
} = useDashboard();

// ── 拖拽状态 ──────────────────────────────────────
const dragging = ref<string | null>(null);
const dragStartPos = ref({ x: 0, y: 0 });
const gridRef = ref<HTMLElement | null>(null);

function onDragStart(e: PointerEvent, widgetId: string) {
  dragging.value = widgetId;
  dragStartPos.value = { x: e.clientX, y: e.clientY };
  (e.target as HTMLElement)?.setPointerCapture(e.pointerId);
}

function onDragMove(_e: PointerEvent) {
  if (!dragging.value) return;
  // 预留：后续可加视觉反馈（placeholder、ghost 等）
}

function onDragEnd(e: PointerEvent, widgetId: string) {
  if (!dragging.value) return;
  const dx = e.clientX - dragStartPos.value.x;
  const dy = e.clientY - dragStartPos.value.y;
  // 简化：偏移超过阈值视为拖拽完成，切换到相邻列/行
  if (Math.abs(dx) > 30 || Math.abs(dy) > 30) {
    const widget = layout.value.widgets.find((w) => w.id === widgetId);
    if (widget) {
      const newX =
        dx > 30
          ? Math.min(1, widget.position.x + 1)
          : dx < -30
            ? Math.max(0, widget.position.x - 1)
            : widget.position.x;
      const newY =
        dy > 30
          ? widget.position.y + 1
          : dy < -30
            ? Math.max(0, widget.position.y - 1)
            : widget.position.y;
      moveWidget(widgetId, newX, newY);
      saveLayout();
    }
  }
  dragging.value = null;
}

// ── Widget 组件映射 ──────────────────────────────

const widgetComponentMap: Record<string, any> = {
  'today-overview': TodayOverview,
  'completion-ring': CompletionRing,
  heatmap: Heatmap,
  'ai-summary': AiSummary,
  'overdue-reminder': OverdueReminder,
  'tag-distribution': TagDistribution,
  'quick-actions': QuickActions,
  'ai-command': AiCommandPanel,
};

// ── AiCommandPanel 的 addTask 事件转发 ──────────

// AiCommandPanel emit addTask，但 Dashboard 用动态组件渲染，
// 事件不会自动冒泡到父组件。这里通过 provide/inject 桥接。
// ponytail: 后续改用全局事件总线或 store action
function onAddTask(parsed: any) {
  // 通过 window 事件转发给 App.vue 的 useTaskStore
  window.dispatchEvent(new CustomEvent('prism:add-task', { detail: parsed }));
}
</script>

<template>
  <div class="dashboard">
    <div ref="gridRef" class="widget-grid">
      <div
        v-for="widget in enabledWidgets()"
        :key="widget.id"
        class="widget"
        :class="{ 'span-2': widget.size.w >= 2 }"
      >
        <div
          class="widget-header"
          @pointerdown="(e: PointerEvent) => onDragStart(e, widget.id)"
          @pointermove="onDragMove"
          @pointerup="(e: PointerEvent) => onDragEnd(e, widget.id)"
        >
          <span class="w-drag">
            <svg viewBox="0 0 24 24">
              <circle cx="9" cy="5" r="1" />
              <circle cx="15" cy="5" r="1" />
              <circle cx="9" cy="12" r="1" />
              <circle cx="15" cy="12" r="1" />
              <circle cx="9" cy="19" r="1" />
              <circle cx="15" cy="19" r="1" />
            </svg>
          </span>
          <span class="w-title">{{ getWidgetDef(widget.id)?.title }}</span>
          <button class="w-close" @click="removeWidget(widget.id)">&times;</button>
        </div>
        <div class="widget-body">
          <component :is="widgetComponentMap[widget.id]" @add-task="onAddTask" />
        </div>
      </div>
    </div>
    <div v-if="availableWidgets().length > 0" class="add-widget-area">
      <details class="add-widget-details">
        <summary class="add-widget-btn">+ 添加 Widget</summary>
        <div class="add-widget-menu">
          <button
            v-for="w in availableWidgets()"
            :key="w.id"
            class="add-widget-option"
            @click="addWidget(w.id)"
          >
            {{ w.title }}
          </button>
        </div>
      </details>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.widget-grid {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px 6px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  align-content: start;
}

.widget {
  background: var(--bg-panel, var(--bg-secondary));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
[data-theme='hud'] .widget {
  border-radius: 0;
  clip-path: polygon(
    8px 0%,
    100% 0%,
    100% calc(100% - 8px),
    calc(100% - 8px) 100%,
    0% 100%,
    0% 8px
  );
}

.widget.span-2 {
  grid-column: 1 / -1;
}

.widget-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-subtle);
  cursor: grab;
  user-select: none;
}
.widget-header:active {
  cursor: grabbing;
}

.w-drag {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-disabled);
  opacity: 0.4;
}
.w-drag svg {
  width: 10px;
  height: 10px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
}

.w-title {
  flex: 1;
  font-family: var(--font-heading);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--accent-dim);
}

.w-close {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-disabled);
  cursor: pointer;
  font-size: 13px;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}
.w-close:hover {
  color: var(--danger);
  background: var(--danger-light);
}

.widget-body {
  padding: 12px;
}

.add-widget-area {
  padding: 4px 14px 10px;
  flex-shrink: 0;
}
.add-widget-details {
  position: relative;
}

.add-widget-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 16px;
  border: 1px dashed var(--border-default);
  background: transparent;
  color: var(--text-disabled);
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: 10px;
  letter-spacing: 1px;
  text-transform: uppercase;
  width: 100%;
  justify-content: center;
  list-style: none;
}
.add-widget-btn::-webkit-details-marker {
  display: none;
}

.add-widget-menu {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: 4px;
  background: var(--bg-elevated, var(--bg-primary));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
  z-index: 10;
}
.add-widget-option {
  display: block;
  width: 100%;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 12px;
  text-align: left;
  transition: all var(--transition-fast);
}
.add-widget-option:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
</style>
