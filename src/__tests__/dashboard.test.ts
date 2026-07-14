import { describe, it, expect } from 'vitest';
import { BUILTIN_WIDGETS } from '../composables/useDashboard';

// 测试默认布局逻辑：直接引用 real BUILTIN_WIDGETS 和 defaultLayout 语义
// 避免维护测试专用副本，确保生产 registry 变更时测试自动感知

describe('Dashboard 布局纯逻辑', () => {
  it('BUILTIN_WIDGETS 包含 7 个内建 Widget', () => {
    expect(BUILTIN_WIDGETS).toHaveLength(7);
  });

  it('所有 Widget 都有唯一的 id', () => {
    const ids = BUILTIN_WIDGETS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('所有 Widget 的 defaultSize 合法', () => {
    for (const w of BUILTIN_WIDGETS) {
      expect(w.defaultSize.w).toBeGreaterThanOrEqual(1);
      expect(w.defaultSize.h).toBeGreaterThanOrEqual(1);
    }
  });

  it('全宽 Widget (w>=2) 和半宽 Widget (w=1) 都有定义', () => {
    const full = BUILTIN_WIDGETS.filter((w) => w.defaultSize.w >= 2);
    const half = BUILTIN_WIDGETS.filter((w) => w.defaultSize.w === 1);
    expect(full.length).toBeGreaterThan(0);
    expect(half.length).toBeGreaterThan(0);
  });

  it('BUILTIN_WIDGETS 中不再包含已下线的 heatmap', () => {
    expect(BUILTIN_WIDGETS.find((w) => w.id === 'heatmap')).toBeUndefined();
  });
});
