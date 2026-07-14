import { describe, it, expect, beforeEach } from 'vitest';
import type { Disposable } from '../types';
import { DisposableStore } from '../plugin-api/disposable';
import {
  createViewsAPI,
  getViewRegistrations,
  clearViewRegistrations,
} from '../plugin-api/views-impl';

beforeEach(() => {
  clearViewRegistrations();
});

function makeTrack(store: DisposableStore) {
  return <T extends Disposable>(d: T): T => store.track(d);
}

describe('Views API', () => {
  const pluginId = 'com.example.test';
  const prefix = 'com.example.test.';
  let store: DisposableStore;
  let track: <T extends Disposable>(d: T) => T;

  beforeEach(() => {
    store = new DisposableStore();
    track = makeTrack(store);
  });

  it('registerPanel 返回 Disposable', () => {
    const api = createViewsAPI(pluginId, track);
    const d = api.registerPanel(prefix + 'myPanel', {} as any);
    expect(typeof d.dispose).toBe('function');
  });

  it('registerPanel 拒绝无前缀的 ID', () => {
    const api = createViewsAPI(pluginId, track);
    expect(() => api.registerPanel('badId', {} as any)).toThrow(TypeError);
  });

  it('注册后出现在全局注册表中', () => {
    const api = createViewsAPI(pluginId, track);
    api.registerPanel(prefix + 'myPanel', {} as any);
    const panels = getViewRegistrations('panel');
    expect(panels.length).toBeGreaterThanOrEqual(1);
    expect(panels.some((v) => v.id === prefix + 'myPanel')).toBe(true);
  });

  it('dispose 后从注册表移除', () => {
    const api = createViewsAPI(pluginId, track);
    const d = api.registerPanel(prefix + 'myPanel', {} as any);
    d.dispose();
    const panels = getViewRegistrations('panel');
    expect(panels.some((v) => v.id === prefix + 'myPanel')).toBe(false);
  });

  it('registerSidebar 正确记录位置', () => {
    const api = createViewsAPI(pluginId, track);
    api.registerSidebar(prefix + 'side', {} as any);
    expect(getViewRegistrations('sidebar').some((v) => v.id === prefix + 'side')).toBe(true);
    expect(getViewRegistrations('panel').some((v) => v.id === prefix + 'side')).toBe(false);
  });

  it('registerSettings 正确记录位置', () => {
    const api = createViewsAPI(pluginId, track);
    api.registerSettings(prefix + 'settings', {} as any);
    expect(getViewRegistrations('settings').some((v) => v.id === prefix + 'settings')).toBe(true);
  });

  it('registerDomView 存储 mount/unmount 回调', () => {
    const api = createViewsAPI(pluginId, track);
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
    const a1 = createViewsAPI('com.a', track);
    const a2 = createViewsAPI('com.b', track);
    a1.registerPanel('com.a.p1', {} as any);
    a2.registerPanel('com.b.p2', {} as any);
    const panels = getViewRegistrations('panel');
    expect(panels.some((v) => v.pluginId === 'com.a')).toBe(true);
    expect(panels.some((v) => v.pluginId === 'com.b')).toBe(true);
  });

  it('registerRail 返回 Disposable', () => {
    const api = createViewsAPI(pluginId, track);
    const d = api.registerRail(prefix + 'railBtn', {} as any);
    expect(typeof d.dispose).toBe('function');
  });

  it('registerPage 返回 Disposable', () => {
    const api = createViewsAPI(pluginId, track);
    const d = api.registerPage(prefix + 'testPage', {} as any);
    expect(typeof d.dispose).toBe('function');
  });

  it('rail 和 page 注册到正确位置', () => {
    const api = createViewsAPI(pluginId, track);
    api.registerRail(prefix + 'railBtn', {} as any);
    api.registerPage(prefix + 'testPage', {} as any);
    expect(getViewRegistrations('rail').some((v) => v.id === prefix + 'railBtn')).toBe(true);
    expect(getViewRegistrations('page').some((v) => v.id === prefix + 'testPage')).toBe(true);
  });

  it('ctx.dispose() 自动清理所有已注册视图（auto-track）', () => {
    const api = createViewsAPI(pluginId, track);
    api.registerPanel(prefix + 'view1', {} as any);
    api.registerSidebar(prefix + 'view2', {} as any);
    expect(getViewRegistrations('panel').length).toBeGreaterThanOrEqual(1);
    expect(getViewRegistrations('sidebar').length).toBeGreaterThanOrEqual(1);

    // 模拟插件停用：dispose DisposableStore
    store.dispose();

    const remaining = getViewRegistrations('panel')
      .concat(getViewRegistrations('sidebar'))
      .filter((v) => v.pluginId === pluginId);
    expect(remaining.length).toBe(0);
  });
});
