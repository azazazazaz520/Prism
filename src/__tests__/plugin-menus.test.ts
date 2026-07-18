import { describe, it, expect, beforeEach } from 'vitest';
import type { Disposable } from '../types';
import { DisposableStore } from '../plugin-api/disposable';
import {
  createMenusAPI,
  getMenuRegistrations,
  clearMenuRegistrations,
} from '../plugin-api/menus-impl';

beforeEach(() => {
  clearMenuRegistrations();
});

function makeTrack(store: DisposableStore) {
  return <T extends Disposable>(d: T): T => store.track(d);
}

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

  it('register 返回 Disposable', () => {
    const api = createMenusAPI(pluginId, track);
    const d = api.register('task-context', [
      { id: prefix + 'myAction', label: '测试', action: () => {} },
    ]);
    expect(typeof d.dispose).toBe('function');
  });

  it('register 拒绝无前缀的 ID', () => {
    const api = createMenusAPI(pluginId, track);
    expect(() =>
      api.register('task-context', [{ id: 'badId', label: '坏菜单', action: () => {} }]),
    ).toThrow(TypeError);
  });

  it('register 拒绝空 ID', () => {
    const api = createMenusAPI(pluginId, track);
    expect(() =>
      api.register('task-context', [{ id: '', label: '空 ID', action: () => {} }]),
    ).toThrow(TypeError);
  });

  it('register 校验数组中所有菜单项的 ID', () => {
    const api = createMenusAPI(pluginId, track);
    expect(() =>
      api.register('task-context', [
        { id: prefix + 'ok', label: '合法', action: () => {} },
        { id: 'bad', label: '非法', action: () => {} },
      ]),
    ).toThrow(TypeError);
  });

  it('注册后出现在 task-context 注册表中', () => {
    const api = createMenusAPI(pluginId, track);
    api.register('task-context', [{ id: prefix + 'action1', label: '操作一', action: () => {} }]);
    const items = getMenuRegistrations('task-context');
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.some((m) => m.id === prefix + 'action1')).toBe(true);
  });

  it('注册后出现在 editor-context 注册表中', () => {
    const api = createMenusAPI(pluginId, track);
    api.register('editor-context', [
      { id: prefix + 'editorAction', label: '编辑器操作', action: () => {} },
    ]);
    const items = getMenuRegistrations('editor-context');
    expect(items.some((m) => m.id === prefix + 'editorAction')).toBe(true);
  });

  it('task-context 和 editor-context 互不干扰', () => {
    const api = createMenusAPI(pluginId, track);
    api.register('task-context', [{ id: prefix + 'taskOnly', label: '仅任务', action: () => {} }]);
    api.register('editor-context', [
      { id: prefix + 'editorOnly', label: '仅编辑器', action: () => {} },
    ]);
    expect(getMenuRegistrations('task-context').some((m) => m.id === prefix + 'editorOnly')).toBe(
      false,
    );
    expect(getMenuRegistrations('editor-context').some((m) => m.id === prefix + 'taskOnly')).toBe(
      false,
    );
  });

  it('dispose 后从注册表移除', () => {
    const api = createMenusAPI(pluginId, track);
    const d = api.register('task-context', [
      { id: prefix + 'temp', label: '临时', action: () => {} },
    ]);
    d.dispose();
    const items = getMenuRegistrations('task-context');
    expect(items.some((m) => m.id === prefix + 'temp')).toBe(false);
  });

  it('重复 dispose 不抛异常（幂等）', () => {
    const api = createMenusAPI(pluginId, track);
    const d = api.register('task-context', [
      { id: prefix + 'idempotent', label: '幂等', action: () => {} },
    ]);
    d.dispose();
    expect(() => d.dispose()).not.toThrow();
  });

  it('多个插件注册不冲突', () => {
    const a1 = createMenusAPI('com.a', track);
    const a2 = createMenusAPI('com.b', track);
    a1.register('task-context', [{ id: 'com.a.item1', label: 'A 菜单', action: () => {} }]);
    a2.register('task-context', [{ id: 'com.b.item2', label: 'B 菜单', action: () => {} }]);
    const items = getMenuRegistrations('task-context');
    expect(items.some((m) => m.pluginId === 'com.a')).toBe(true);
    expect(items.some((m) => m.pluginId === 'com.b')).toBe(true);
  });

  it('同一插件注册多组菜单项均显示', () => {
    const api = createMenusAPI(pluginId, track);
    api.register('task-context', [{ id: prefix + 'group1', label: '第一组', action: () => {} }]);
    api.register('task-context', [{ id: prefix + 'group2', label: '第二组', action: () => {} }]);
    const items = getMenuRegistrations('task-context');
    const pluginItems = items.filter((m) => m.pluginId === pluginId);
    expect(pluginItems.length).toBe(2);
  });

  it('空数组注册不抛异常但不产生条目', () => {
    const api = createMenusAPI(pluginId, track);
    const before = getMenuRegistrations('task-context').length;
    api.register('task-context', []);
    expect(getMenuRegistrations('task-context').length).toBe(before);
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

  it('editor-context action 不传参数向后兼容', async () => {
    const api = createMenusAPI(pluginId, track);
    let called = false;

    api.register('editor-context', [
      {
        id: prefix + 'noParam',
        label: '无参操作',
        action: () => {
          called = true;
        },
      },
    ]);

    const items = getMenuRegistrations('editor-context');
    await items[0].item.action();
    expect(called).toBe(true);
  });
});
