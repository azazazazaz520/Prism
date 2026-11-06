import { beforeEach, describe, expect, it } from 'vitest';
import { DisposableStore } from '../plugin-api/disposable';
import {
  clearMenuRegistrations,
  createMenusAPI,
  getMenuRegistrations,
} from '../plugin-api/menus-impl';
import {
  clearViewRegistrations,
  createViewsAPI,
  getViewRegistrations,
  registerSandboxView,
} from '../plugin-api/views-impl';
import { type Disposable } from '../types';

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

  it('沙箱重复注册同一视图 ID 时只保留一条记录', () => {
    const session = { attach() {}, detach() {} };
    registerSandboxView(pluginId, session, {
      id: prefix + 'rail',
      location: 'rail',
    });
    registerSandboxView(pluginId, session, {
      id: prefix + 'rail',
      location: 'rail',
    });

    expect(getViewRegistrations('rail').filter((v) => v.id === prefix + 'rail')).toHaveLength(1);
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

beforeEach(() => {
  clearMenuRegistrations();
});

describe('Menus API', () => {
  const pluginId = 'com.example.test';
  const prefix = 'com.example.test.';
  // 每个测试创建独立 DisposableStore，模拟插件生命周期
  let store: DisposableStore;
  let track: <T extends Disposable>(d: T) => T;

  beforeEach(() => {
    store = new DisposableStore();
    track = makeTrack(store);
  });

  it('ctx.dispose() 自动清理所有已注册菜单（auto-track）', () => {
    const api = createMenusAPI(pluginId, track);
    api.register('task-context', [
      { id: prefix + 'auto1', label: '自动清理 1', action: () => {} },
      { id: prefix + 'auto2', label: '自动清理 2', action: () => {} },
    ]);
    expect(getMenuRegistrations('task-context').length).toBeGreaterThanOrEqual(2);

    // 模拟插件停用：dispose DisposableStore
    store.dispose();

    // 所有菜单项应被移除
    const remaining = getMenuRegistrations('task-context').filter((m) => m.pluginId === pluginId);
    expect(remaining.length).toBe(0);
  });

  it('editor-context action 接收 EditorSelection 参数', async () => {
    const api = createMenusAPI(pluginId, track);
    let capturedSelection: any = null;

    api.register('editor-context', [
      {
        id: prefix + 'withSelection',
        label: '带选区操作',
        action: (sel) => {
          capturedSelection = sel;
        },
      },
    ]);

    const items = getMenuRegistrations('editor-context');
    const selection = { text: 'hello', from: 0, to: 5, replace: () => {} };
    await items[0].item.action(selection);

    expect(capturedSelection).toBe(selection);
  });
});
