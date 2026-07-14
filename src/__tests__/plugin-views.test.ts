import { describe, it, expect, beforeEach } from 'vitest';
import {
  createViewsAPI,
  getViewRegistrations,
  clearViewRegistrations,
} from '../plugin-api/views-impl';

beforeEach(() => {
  clearViewRegistrations();
});

describe('Views API', () => {
  const pluginId = 'com.example.test';
  const prefix = 'com.example.test.';

  it('registerPanel 返回 Disposable', () => {
    const api = createViewsAPI(pluginId);
    const d = api.registerPanel(prefix + 'myPanel', {} as any);
    expect(typeof d.dispose).toBe('function');
  });

  it('registerPanel 拒绝无前缀的 ID', () => {
    const api = createViewsAPI(pluginId);
    expect(() => api.registerPanel('badId', {} as any)).toThrow(TypeError);
  });

  it('注册后出现在全局注册表中', () => {
    const api = createViewsAPI(pluginId);
    api.registerPanel(prefix + 'myPanel', {} as any);
    const panels = getViewRegistrations('panel');
    expect(panels.length).toBeGreaterThanOrEqual(1);
    expect(panels.some((v) => v.id === prefix + 'myPanel')).toBe(true);
  });

  it('dispose 后从注册表移除', () => {
    const api = createViewsAPI(pluginId);
    const d = api.registerPanel(prefix + 'myPanel', {} as any);
    d.dispose();
    const panels = getViewRegistrations('panel');
    expect(panels.some((v) => v.id === prefix + 'myPanel')).toBe(false);
  });

  it('registerSidebar 正确记录位置', () => {
    const api = createViewsAPI(pluginId);
    api.registerSidebar(prefix + 'side', {} as any);
    expect(getViewRegistrations('sidebar').some((v) => v.id === prefix + 'side')).toBe(true);
    expect(getViewRegistrations('panel').some((v) => v.id === prefix + 'side')).toBe(false);
  });

  it('registerSettings 正确记录位置', () => {
    const api = createViewsAPI(pluginId);
    api.registerSettings(prefix + 'settings', {} as any);
    expect(getViewRegistrations('settings').some((v) => v.id === prefix + 'settings')).toBe(true);
  });

  it('registerDomView 存储 mount/unmount 回调', () => {
    const api = createViewsAPI(pluginId);
    let mounted = false;
    let unmounted = false;
    const d = api.registerDomView(prefix + 'dom', {
      mount(_container: HTMLElement) {
        mounted = true;
      },
      unmount() {
        unmounted = true;
      },
    });
    expect(typeof d.dispose).toBe('function');
    // dispose 应触发 unmount
    d.dispose();
    expect(unmounted).toBe(true);
  });

  it('多个插件注册不冲突', () => {
    const a1 = createViewsAPI('com.a');
    const a2 = createViewsAPI('com.b');
    a1.registerPanel('com.a.p1', {} as any);
    a2.registerPanel('com.b.p2', {} as any);
    const panels = getViewRegistrations('panel');
    expect(panels.some((v) => v.pluginId === 'com.a')).toBe(true);
    expect(panels.some((v) => v.pluginId === 'com.b')).toBe(true);
  });
});
