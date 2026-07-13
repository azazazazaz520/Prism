import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { WidgetDefinition, DashboardLayout } from '../types';

// ── 内建 Widget 注册表 ──────────────────────────

export const BUILTIN_WIDGETS: WidgetDefinition[] = [
  { id: 'today-overview', title: '今日概览', icon: 'overview', defaultSize: { w: 2, h: 1 } },
  {
    id: 'completion-ring',
    title: '完成率',
    icon: 'ring',
    defaultSize: { w: 1, h: 1 },
    minSize: { w: 1, h: 1 },
  },
  { id: 'ai-summary', title: 'AI 今日摘要', icon: 'ai', defaultSize: { w: 2, h: 1 } },
  { id: 'overdue-reminder', title: '过期提醒', icon: 'overdue', defaultSize: { w: 2, h: 1 } },
  {
    id: 'tag-distribution',
    title: '标签分布',
    icon: 'tag',
    defaultSize: { w: 1, h: 1 },
    minSize: { w: 1, h: 1 },
  },
  {
    id: 'quick-actions',
    title: '快捷操作',
    icon: 'actions',
    defaultSize: { w: 1, h: 1 },
    minSize: { w: 1, h: 1 },
  },
  { id: 'ai-command', title: 'AI 指令面板', icon: 'command', defaultSize: { w: 2, h: 1 } },
];

function defaultLayout(): DashboardLayout {
  const result: DashboardLayout['widgets'] = [];
  let row = 0;
  let col = 0;

  for (const w of BUILTIN_WIDGETS) {
    result.push({
      id: w.id,
      enabled: true,
      position: { x: col, y: row },
      size: { ...w.defaultSize },
    });

    if (w.defaultSize.w >= 2) {
      // 全宽 widget 占整行
      row++;
      col = 0;
    } else {
      col++;
      if (col >= 2) {
        col = 0;
        row++;
      }
    }
  }

  return { columns: 2, widgets: result };
}

// ── 全局单例 ────────────────────────────────────

const layout = ref<DashboardLayout>(defaultLayout());
let layoutLoaded = false;

export function useDashboard() {
  // ── 加载持久化布局 ────────────────────────────

  async function loadLayout() {
    if (layoutLoaded) return;
    layoutLoaded = true;
    try {
      const stored = await invoke<string | null>('get_dashboard_layout');
      if (stored) {
        const parsed = JSON.parse(stored) as DashboardLayout;
        // 合并：保留内建 Widget 定义，用存储的布局覆盖位置/启用状态
        const storedMap = new Map(parsed.widgets.map((w) => [w.id, w]));
        const merged = defaultLayout().widgets.map((w) => {
          const stored = storedMap.get(w.id);
          return stored ? { ...w, ...stored } : w;
        });
        layout.value = { ...parsed, widgets: merged };
      }
    } catch {
      // 首次运行，使用默认布局
    }
  }

  // ── 持久化 ────────────────────────────────────

  async function saveLayout() {
    try {
      await invoke('set_dashboard_layout', { layout: JSON.stringify(layout.value) });
    } catch (e) {
      console.warn('保存仪表盘布局失败:', e);
    }
  }

  // ── 操作 ──────────────────────────────────────

  function addWidget(widgetId: string) {
    const def = BUILTIN_WIDGETS.find((w) => w.id === widgetId);
    if (!def || layout.value.widgets.some((w) => w.id === widgetId)) return;
    const maxY = layout.value.widgets.reduce((max, w) => Math.max(max, w.position.y), -1);
    layout.value = {
      ...layout.value,
      widgets: [
        ...layout.value.widgets,
        {
          id: widgetId,
          enabled: true,
          position: { x: 0, y: maxY + 1 },
          size: { ...def.defaultSize },
        },
      ],
    };
    saveLayout();
  }

  function removeWidget(widgetId: string) {
    layout.value = {
      ...layout.value,
      widgets: layout.value.widgets.filter((w) => w.id !== widgetId),
    };
    saveLayout();
  }

  function moveWidget(widgetId: string, newX: number, newY: number) {
    layout.value = {
      ...layout.value,
      widgets: layout.value.widgets.map((w) =>
        w.id === widgetId ? { ...w, position: { x: newX, y: newY } } : w,
      ),
    };
    // 拖拽结束时调用 saveLayout（防抖在组件层处理）
  }

  function toggleWidget(widgetId: string) {
    layout.value = {
      ...layout.value,
      widgets: layout.value.widgets.map((w) =>
        w.id === widgetId ? { ...w, enabled: !w.enabled } : w,
      ),
    };
    saveLayout();
  }

  function resetLayout() {
    layout.value = defaultLayout();
    saveLayout();
  }

  // ── 计算属性 ──────────────────────────────────

  function getWidgetDef(id: string): WidgetDefinition | undefined {
    return BUILTIN_WIDGETS.find((w) => w.id === id);
  }

  const enabledWidgets = () => layout.value.widgets.filter((w) => w.enabled);

  const availableWidgets = () =>
    BUILTIN_WIDGETS.filter((w) => !layout.value.widgets.some((lw) => lw.id === w.id));

  return {
    layout,
    loadLayout,
    saveLayout,
    addWidget,
    removeWidget,
    moveWidget,
    toggleWidget,
    resetLayout,
    getWidgetDef,
    enabledWidgets,
    availableWidgets,
  };
}
