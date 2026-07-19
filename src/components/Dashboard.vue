<script setup lang="ts">
/**
 * Dashboard 仪表盘组件。
 *
 * 提供可拖拽重排的 Widget 网格布局。用户可通过拖拽 Widget 标题栏
 * 调整各模块在网格中的位置，放置后自动持久化布局。支持添加/移除
 * Widget、双列自适应网格、拖拽时实时重排（SpringBoard 算法）以及
 * 惯性滑动落点。
 */
import { ref, computed, provide, onUnmounted } from 'vue';
import { useDashboard } from '../composables/useDashboard';
import { useTaskStore } from '../composables/useTaskStore';
import { useAiStatus } from '../composables/useAiStatus';
import ConfirmDialog from './ConfirmDialog.vue';
import TodayOverview from './widgets/TodayOverview.vue';
import CompletionRing from './widgets/CompletionRing.vue';
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

// ══════════════════════════════════════════════════════
//  常量
// ══════════════════════════════════════════════════════

const cols = computed(() => layout.value.columns);
const ROW_HEIGHT = 110;

// ══════════════════════════════════════════════════════
//  拖拽状态
// ══════════════════════════════════════════════════════

const gridRef = ref<HTMLElement | null>(null);
const dragWidgetId = ref<string | null>(null);
const dragOffset = ref({ x: 0, y: 0 });
const dragTarget = ref({ x: 0, y: 0 });
const dragGhostPos = ref({ x: 0, y: 0 });
const dragWidgetRect = ref({ width: 0, height: 0 });

const dragWidget = computed(() =>
  dragWidgetId.value ? layout.value.widgets.find((w) => w.id === dragWidgetId.value) : null,
);

const dragWidgetSize = computed(() => dragWidget.value?.size ?? { w: 1, h: 1 });

// ══════════════════════════════════════════════════════
//  速度追踪（惯性滑动用）
// ══════════════════════════════════════════════════════

const VELOCITY_SAMPLES = 8;
const velocitySamples: { x: number; y: number; t: number }[] = [];
const DAMPING = 0.3; // 边界阻尼系数
let inertiaRaf = 0;

function trackVelocity(e: PointerEvent) {
  velocitySamples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
  if (velocitySamples.length > VELOCITY_SAMPLES) velocitySamples.shift();
}

function getVelocity(): { vx: number; vy: number } {
  if (velocitySamples.length < 2) return { vx: 0, vy: 0 };
  const first = velocitySamples[0];
  const last = velocitySamples[velocitySamples.length - 1];
  const dt = last.t - first.t;
  if (dt < 1) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

function clearVelocity() {
  velocitySamples.length = 0;
}

// ══════════════════════════════════════════════════════
//  SpringBoard 重排 — 拖拽中其他 widget 实时让位
//  renderSlots 只含真实 widget，不含 ghost。
//  ghost 位置留空，用独立 drop-indicator 渲染。
// ══════════════════════════════════════════════════════

interface RenderSlot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function linearIdx(x: number, y: number): number {
  return y * cols.value + x;
}

/** SpringBoard 重排算法：计算当前帧所有 Widget 在网格中的渲染位置。
 *  拖拽进行中时，被拖拽 Widget 不参与排列，其目标位置留空；
 *  其余 Widget 按线性索引顺序（从上到下、从左到右）逐格填充。
 *  全宽 Widget（w=2）仅当第 0 列未被占用时放入。 */
const renderSlots = computed<RenderSlot[]>(() => {
  const widgets = enabledWidgets();
  if (widgets.length === 0) return [];

  if (!dragWidgetId.value || !dragWidget.value) {
    return widgets.map((w) => ({
      id: w.id,
      x: w.position.x,
      y: w.position.y,
      w: w.size.w,
      h: w.size.h,
    }));
  }

  const target = dragTarget.value;
  const draggedW = dragWidget.value.size.w;
  const draggedH = dragWidget.value.size.h;

  const others = widgets
    .filter((w) => w.id !== dragWidgetId.value)
    .map((w) => ({ ...w }))
    .sort((a, b) => linearIdx(a.position.x, a.position.y) - linearIdx(b.position.x, b.position.y));

  const result: RenderSlot[] = [];
  let oi = 0;

  for (let y = 0; y < 200 && oi < others.length; y++) {
    for (let x = 0; x < cols.value; x++) {
      // ghost 占用的格子 → 跳过
      const blocked =
        x >= target.x && x < target.x + draggedW && y >= target.y && y < target.y + draggedH;
      if (blocked) {
        if (draggedW > 1) break;
        continue;
      }

      if (oi >= others.length) break;

      const next = others[oi];
      if (next.size.w > 1) {
        // 全宽 widget 只能放 x=0
        if (x !== 0) continue;
        // 且 x=1 不能被 ghost 占用
        const col1Blocked =
          target.x <= 1 && 1 < target.x + draggedW && y >= target.y && y < target.y + draggedH;
        if (col1Blocked) continue;
        result.push({ id: next.id, x: 0, y, w: 2, h: next.size.h });
        oi++;
        break;
      } else {
        result.push({ id: next.id, x, y, w: 1, h: next.size.h });
        oi++;
      }
    }
  }

  return result;
});

// ══════════════════════════════════════════════════════
//  拖拽事件
// ══════════════════════════════════════════════════════

/** 开始拖拽 Widget。
 *  记录拖拽起始偏移、Widget 尺寸与当前位置，清除惯性动画状态，
 *  并播放拾起放大弹跳动画。通过 pointer capture 捕获后续指针事件。 */
function onDragStart(e: PointerEvent, widgetId: string) {
  if ((e.target as HTMLElement).closest('.w-close')) return;

  const widgetEl = (e.currentTarget as HTMLElement).closest('.widget') as HTMLElement;
  if (!widgetEl) return;

  const rect = widgetEl.getBoundingClientRect();
  dragOffset.value = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  dragWidgetRect.value = { width: rect.width, height: rect.height };
  dragWidgetId.value = widgetId;
  dragGhostPos.value = { x: e.clientX, y: e.clientY };

  const widget = layout.value.widgets.find((w) => w.id === widgetId);
  if (widget) dragTarget.value = { ...widget.position };

  clearVelocity();
  cancelAnimationFrame(inertiaRaf);

  // 拾起动画 — 轻微放大 + 弹跳
  const ghostEl = document.querySelector('.drag-ghost') as HTMLElement;
  if (ghostEl) {
    ghostEl.animate(
      [
        { transform: 'scale(0.9)', opacity: '0.7' },
        { transform: 'scale(1.06)', opacity: '0.95', offset: 0.4 },
        { transform: 'scale(1.03)', opacity: '0.94', offset: 1 },
      ],
      { duration: 200, easing: 'ease-out', fill: 'forwards' },
    );
  }

  gridRef.value?.setPointerCapture(e.pointerId);
  e.preventDefault();
}

/** 拖拽移动处理。
 *  追踪指针速度（供惯性计算用），将指针相对网格的位置映射为网格坐标，
 *  超出边界时施加阻尼系数实现弹性阻力效果，实时更新落点指示器。 */
function onDragMove(e: PointerEvent) {
  if (!dragWidgetId.value || !gridRef.value) return;

  trackVelocity(e);
  dragGhostPos.value = { x: e.clientX, y: e.clientY };

  const gridRect = gridRef.value.getBoundingClientRect();
  const gap = 10;
  const colWidth = (gridRect.width - gap) / cols.value;

  // 指针相对于 grid 的位置（带滚动偏移）
  const relX = e.clientX - gridRect.left;
  const relY = e.clientY - gridRect.top + gridRef.value.scrollTop;

  const maxX = dragWidget.value ? cols.value - dragWidget.value.size.w : 1;

  // 边界阻尼 — 允许略微超界但有弹性阻力
  let rawX = relX / colWidth;
  let rawY = relY / ROW_HEIGHT;
  if (rawX < 0) rawX = rawX * DAMPING;
  else if (rawX > maxX) rawX = maxX + (rawX - maxX) * DAMPING;
  if (rawY < 0) rawY = rawY * DAMPING;

  const targetX = Math.max(0, Math.min(maxX, Math.round(rawX)));
  const targetY = Math.max(0, Math.floor(rawY));

  dragTarget.value = { x: targetX, y: targetY };
}

/** 提交拖拽布局。
 *  将被拖拽 Widget 放入目标位置，其余 Widget 从 renderSlots
 *  当前计算的位置取得，逐一比对后更新，最终持久化到本地布局存储。 */
function finalizeDrag() {
  if (!dragWidgetId.value || !dragWidget.value) return;

  const posMap = new Map(renderSlots.value.map((s) => [s.id, { x: s.x, y: s.y }]));
  for (const w of layout.value.widgets) {
    const newPos = posMap.get(w.id);
    if (newPos && (w.position.x !== newPos.x || w.position.y !== newPos.y)) {
      moveWidget(w.id, newPos.x, newPos.y);
    }
  }
  moveWidget(dragWidgetId.value, dragTarget.value.x, dragTarget.value.y);
  saveLayout();

  dragWidgetId.value = null;
}

/** 结束拖拽。
 *  根据拖拽结束时的指针速度决定行为：速度超过阈值时触发惯性滑动
 *  （逐步减速直至停止后提交布局），否则直接提交当前落点。 */
function onDragEnd() {
  if (!dragWidgetId.value || !dragWidget.value) {
    dragWidgetId.value = null;
    return;
  }

  const { vx, vy } = getVelocity();
  const speed = Math.sqrt(vx * vx + vy * vy);

  // 惯性滑动
  const INERTIA_THRESHOLD = 0.15;
  if (speed > INERTIA_THRESHOLD) {
    const gridRect = gridRef.value!.getBoundingClientRect();
    const colWidth = (gridRect.width - 10) / cols.value;
    const maxX = dragWidget.value ? cols.value - dragWidget.value.size.w : 1;

    let virtualPx = dragTarget.value.x * colWidth;
    let virtualPy = dragTarget.value.y * ROW_HEIGHT;
    let curVx = vx;
    let curVy = vy;
    const DECEL = 0.88;

    /** 惯性滑动单步：按衰减系数逐步降低速度，更新虚拟像素坐标并映射
     *  为网格位置。当速度降至阈值以下时四舍五入到最近网格并提交布局。 */
    function inertiaStep() {
      curVx *= DECEL;
      curVy *= DECEL;
      virtualPx += curVx * 16;
      virtualPy += curVy * 16;

      let tx = virtualPx / colWidth;
      let ty = virtualPy / ROW_HEIGHT;

      const newSpeed = Math.sqrt(curVx * curVx + curVy * curVy);
      if (newSpeed < 0.05) {
        tx = Math.max(0, Math.min(maxX, Math.round(tx)));
        ty = Math.max(0, Math.floor(ty));
        dragTarget.value = { x: tx, y: ty };
        finalizeDrag();
        return;
      }

      tx = Math.max(0, Math.min(maxX, Math.round(tx)));
      ty = Math.max(0, Math.floor(ty));
      dragTarget.value = { x: tx, y: ty };
      inertiaRaf = requestAnimationFrame(inertiaStep);
    }

    inertiaRaf = requestAnimationFrame(inertiaStep);
  } else {
    finalizeDrag();
  }
}

// ══════════════════════════════════════════════════════
//  Widget 组件映射
// ══════════════════════════════════════════════════════

const widgetComponentMap: Record<string, any> = {
  'today-overview': TodayOverview,
  'completion-ring': CompletionRing,
  'ai-summary': AiSummary,
  'overdue-reminder': OverdueReminder,
  'tag-distribution': TagDistribution,
  'quick-actions': QuickActions,
  'ai-command': AiCommandPanel,
};

const { addTask: addTaskToStore } = useTaskStore();
const { aiEnabled } = useAiStatus();

// ══════════════════════════════════════════════════════
//  AI 未配置引导弹窗（所有 AI Widget 共享）
// ══════════════════════════════════════════════════════

const showAiGuide = ref(false);

function showAiConfigGuide() {
  showAiGuide.value = true;
}

function handleGoToVendors() {
  showAiGuide.value = false;
  window.dispatchEvent(new CustomEvent('prism:nav-settings', { detail: 'vendors' }));
}

provide('showAiConfigGuide', showAiConfigGuide);

function onAddTask(parsed: {
  title: string;
  due_date: string | null;
  tags: string[];
  important: boolean;
  pinned: boolean;
  is_daily: boolean;
}) {
  addTaskToStore(
    parsed.title,
    parsed.due_date,
    parsed.tags,
    parsed.important,
    parsed.pinned,
    parsed.is_daily,
  );
}
onUnmounted(() => cancelAnimationFrame(inertiaRaf));
</script>

<template>
  <div class="dashboard">
    <div
      ref="gridRef"
      class="widget-grid"
      @pointermove="onDragMove"
      @pointerup="onDragEnd"
      @pointercancel="onDragEnd"
    >
      <div
        v-for="slot in renderSlots"
        :key="slot.id"
        class="widget"
        :style="{
          gridColumn: slot.x + 1 + ' / span ' + slot.w,
          gridRow: slot.y + 1 + ' / span ' + slot.h,
        }"
      >
        <div class="widget-header" @pointerdown="(e: PointerEvent) => onDragStart(e, slot.id)">
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
          <span class="w-title">{{ getWidgetDef(slot.id)?.title }}</span>
          <button class="w-close" @pointerdown.stop @click="removeWidget(slot.id)">&times;</button>
        </div>
        <div class="widget-body">
          <component :is="widgetComponentMap[slot.id]" @add-task="onAddTask" />
        </div>
      </div>

      <!-- 落点指示器：独立元素，不和 widget 重叠 -->
      <div
        v-if="dragWidgetId"
        class="drop-indicator"
        :style="{
          gridColumn: dragTarget.x + 1 + ' / span ' + dragWidgetSize.w,
          gridRow: dragTarget.y + 1 + ' / span ' + dragWidgetSize.h,
        }"
      />
    </div>

    <!-- 抬起 ghost -->
    <Teleport to="body">
      <div
        v-if="dragWidgetId"
        class="drag-ghost"
        :style="{
          left: dragGhostPos.x - dragOffset.x + 'px',
          top: dragGhostPos.y - dragOffset.y + 'px',
          width: dragWidgetRect.width + 'px',
          height: dragWidgetRect.height + 'px',
        }"
      >
        <div class="drag-ghost-header">
          <span class="dg-drag-icon">
            <svg viewBox="0 0 24 24">
              <circle cx="9" cy="5" r="1" />
              <circle cx="15" cy="5" r="1" />
              <circle cx="9" cy="12" r="1" />
              <circle cx="15" cy="12" r="1" />
              <circle cx="9" cy="19" r="1" />
              <circle cx="15" cy="19" r="1" />
            </svg>
          </span>
          <span class="dg-title">{{ getWidgetDef(dragWidgetId)?.title }}</span>
        </div>
        <div class="drag-ghost-body">拖拽到目标位置</div>
      </div>
    </Teleport>

    <!-- AI 未配置引导弹窗 -->
    <ConfirmDialog
      :visible="showAiGuide"
      title="AI 未配置"
      message="请先在设置中添加并启用 AI 供应商，然后即可使用 AI 分析、摘要等功能。"
      confirm-text="前往配置"
      cancel-text="稍后"
      @confirm="handleGoToVendors"
      @cancel="showAiGuide = false"
    />

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
  min-height: 0;
  overflow: hidden;
  container-type: inline-size;
}

.widget-grid {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px 6px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  align-content: start;
  position: relative;
}

@container (max-width: 420px) {
  .widget-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* ── Widget ──────────────────────────────── */

.widget {
  background: var(--bg-panel, var(--bg-secondary));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  min-width: 0;
  min-height: 80px;
  transition:
    grid-column 0.2s cubic-bezier(0.25, 0.1, 0.25, 1),
    grid-row 0.2s cubic-bezier(0.25, 0.1, 0.25, 1);
  will-change: grid-column, grid-row;
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

.widget-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-subtle);
  cursor: grab;
  user-select: none;
  touch-action: none;
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
  flex-shrink: 0;
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
  pointer-events: none;
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
  flex-shrink: 0;
}
.w-close:hover {
  color: var(--danger);
  background: var(--danger-light);
}

.widget-body {
  padding: 12px;
}

/* ── 落点指示器（独立元素，不参与 repack） ── */

.drop-indicator {
  border: 2px dashed var(--accent);
  border-radius: var(--radius-lg);
  background: var(--accent-glow-s);
  pointer-events: none;
  z-index: 1;
  min-height: 80px;
  animation: drop-pulse 1s ease-in-out infinite;
}

[data-theme='hud'] .drop-indicator {
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

@keyframes drop-pulse {
  0%,
  100% {
    border-color: var(--accent);
    opacity: 0.8;
  }
  50% {
    border-color: var(--accent-dim);
    opacity: 0.4;
  }
}

/* ── 添加 Widget ──────────────────────────── */

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

<!-- unscoped: ghost -->
<style>
.drag-ghost {
  position: fixed;
  z-index: 1000;
  pointer-events: none;
  background: var(--bg-elevated, var(--bg-primary));
  border: 1px solid var(--accent);
  border-radius: var(--radius-lg);
  box-shadow:
    0 20px 60px rgba(0, 0, 0, 0.35),
    0 0 0 1px rgba(0, 0, 0, 0.06);
  transform: scale(1.03);
  opacity: 0.94;
  overflow: hidden;
  will-change: left, top;
}
.drag-ghost-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--accent-glow-s);
}
.dg-drag-icon {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-disabled);
  opacity: 0.5;
  flex-shrink: 0;
}
.dg-drag-icon svg {
  width: 10px;
  height: 10px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
}
.dg-title {
  flex: 1;
  font-family: var(--font-heading);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--accent-dim);
}
.drag-ghost-body {
  padding: 14px 12px;
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  font-family: var(--font-heading);
  letter-spacing: 1px;
}
</style>
