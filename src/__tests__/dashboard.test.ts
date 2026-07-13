import { describe, it, expect } from 'vitest';
import type { DashboardLayout, WidgetDefinition } from '../types';

// 模拟 Widget 注册表（测试纯逻辑）
const BUILTIN_WIDGETS: WidgetDefinition[] = [
  { id: 'today-overview', title: '今日概览', icon: '', defaultSize: { w: 2, h: 1 } },
  { id: 'completion-ring', title: '完成率', icon: '', defaultSize: { w: 1, h: 1 } },
  { id: 'heatmap', title: '活跃热力图', icon: '', defaultSize: { w: 2, h: 1 } },
  { id: 'ai-summary', title: 'AI 摘要', icon: '', defaultSize: { w: 2, h: 1 } },
  { id: 'overdue-reminder', title: '过期提醒', icon: '', defaultSize: { w: 2, h: 1 } },
  { id: 'tag-distribution', title: '标签分布', icon: '', defaultSize: { w: 1, h: 1 } },
  { id: 'quick-actions', title: '快捷操作', icon: '', defaultSize: { w: 1, h: 1 } },
  { id: 'ai-command', title: 'AI 指令', icon: '', defaultSize: { w: 2, h: 1 } },
];

function buildDefaultLayout(): DashboardLayout {
  return {
    columns: 2,
    widgets: BUILTIN_WIDGETS.map((w, i) => ({
      id: w.id,
      enabled: true,
      position: { x: i % 2, y: Math.floor(i / 2) },
      size: w.defaultSize,
    })),
  };
}

function addWidget(
  layout: DashboardLayout,
  widgetId: string,
  definition: WidgetDefinition,
): DashboardLayout {
  if (layout.widgets.some((w) => w.id === widgetId)) return layout;
  const maxY = layout.widgets.reduce((max, w) => Math.max(max, w.position.y), -1);
  return {
    ...layout,
    widgets: [
      ...layout.widgets,
      {
        id: widgetId,
        enabled: true,
        position: { x: 0, y: maxY + 1 },
        size: definition.defaultSize,
      },
    ],
  };
}

function removeWidget(layout: DashboardLayout, widgetId: string): DashboardLayout {
  return {
    ...layout,
    widgets: layout.widgets.filter((w) => w.id !== widgetId),
  };
}

function toggleWidget(layout: DashboardLayout, widgetId: string): DashboardLayout {
  return {
    ...layout,
    widgets: layout.widgets.map((w) => (w.id === widgetId ? { ...w, enabled: !w.enabled } : w)),
  };
}

describe('Dashboard 布局纯逻辑', () => {
  it('buildDefaultLayout 创建 8 个 Widget', () => {
    const layout = buildDefaultLayout();
    expect(layout.widgets).toHaveLength(8);
    expect(layout.columns).toBe(2);
  });

  it('addWidget 添加新 Widget 到末尾', () => {
    const layout = buildDefaultLayout();
    const newDef: WidgetDefinition = {
      id: 'custom',
      title: '自定义',
      icon: '',
      defaultSize: { w: 1, h: 1 },
    };
    const updated = addWidget(layout, 'custom', newDef);
    expect(updated.widgets).toHaveLength(9);
    expect(updated.widgets[8].id).toBe('custom');
  });

  it('addWidget 防重复', () => {
    const layout = buildDefaultLayout();
    const updated = addWidget(layout, 'today-overview', BUILTIN_WIDGETS[0]);
    expect(updated.widgets).toHaveLength(8); // 不增长
  });

  it('removeWidget 移除指定 Widget', () => {
    const layout = buildDefaultLayout();
    const updated = removeWidget(layout, 'today-overview');
    expect(updated.widgets).toHaveLength(7);
    expect(updated.widgets.find((w) => w.id === 'today-overview')).toBeUndefined();
  });

  it('toggleWidget 切换启用状态', () => {
    const layout = buildDefaultLayout();
    const updated = toggleWidget(layout, 'today-overview');
    expect(updated.widgets.find((w) => w.id === 'today-overview')!.enabled).toBe(false);
    const reverted = toggleWidget(updated, 'today-overview');
    expect(reverted.widgets.find((w) => w.id === 'today-overview')!.enabled).toBe(true);
  });
});
