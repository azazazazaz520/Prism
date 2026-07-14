import { describe, it, expect } from 'vitest';
import { DisposableStore } from '../plugin-api/disposable';
import { createPluginContext } from '../plugin-api/plugin-context';
import type { Disposable } from '../types';

// 测试用 Disposable 桩
function fakeDisposable(): { disposed: boolean } & Disposable {
  const result = {
    disposed: false,
    dispose() {
      this.disposed = true;
    },
  };
  return result;
}

describe('DisposableStore', () => {
  it('添加 Disposable 并可追踪', () => {
    const store = new DisposableStore();
    const d = fakeDisposable();
    store.add(d);
    expect(d.disposed).toBe(false);
  });

  it('dispose 调用所有已注册的 Disposable', () => {
    const store = new DisposableStore();
    const d1 = fakeDisposable();
    const d2 = fakeDisposable();
    store.add(d1);
    store.add(d2);
    store.dispose();
    expect(d1.disposed).toBe(true);
    expect(d2.disposed).toBe(true);
  });

  it('dispose 按 LIFO 顺序调用（后注册先释放）', () => {
    const store = new DisposableStore();
    const order: string[] = [];
    store.add({ dispose: () => order.push('first') });
    store.add({ dispose: () => order.push('second') });
    store.dispose();
    expect(order).toEqual(['second', 'first']);
  });

  it('重复 dispose 不抛异常（幂等）', () => {
    const store = new DisposableStore();
    const d = fakeDisposable();
    store.add(d);
    store.dispose();
    expect(() => store.dispose()).not.toThrow();
  });

  it('dispose 后不能再添加', () => {
    const store = new DisposableStore();
    store.dispose();
    const d = fakeDisposable();
    store.add(d);
    // 已 dispose 的 store 添加时直接 dispose 该资源
    expect(d.disposed).toBe(true);
  });

  it('某个 dispose 抛异常不阻塞后续', () => {
    const store = new DisposableStore();
    const d2 = fakeDisposable();
    store.add({
      dispose() {
        throw new Error('boom');
      },
    });
    store.add(d2);
    expect(() => store.dispose()).not.toThrow();
    expect(d2.disposed).toBe(true);
  });

  it('track 方法同时支持 add 和 dispose 时自动移除', () => {
    const store = new DisposableStore();
    const d = fakeDisposable();
    store.track(d);
    expect(d.disposed).toBe(false);
    store.dispose();
    expect(d.disposed).toBe(true);
  });
});

describe('createPluginContext', () => {
  it('runtimeId 格式为 plugin:{id}', () => {
    const ctx = createPluginContext('com.example.test', []);
    expect(ctx.runtimeId).toBe('plugin:com.example.test');
  });

  it('pluginId 正确暴露', () => {
    const ctx = createPluginContext('com.example.test', []);
    expect(ctx.pluginId).toBe('com.example.test');
  });

  it('permissions 以 ReadonlySet 形式暴露', () => {
    const ctx = createPluginContext('com.example.test', ['tasks:read', 'network']);
    expect(ctx.permissions.has('tasks:read')).toBe(true);
    expect(ctx.permissions.has('tasks:write')).toBe(false);
  });

  it('track 注册 Disposable 并在 dispose 时释放', () => {
    const ctx = createPluginContext('com.example.test', []);
    const d = fakeDisposable();
    ctx.track(d);
    ctx.dispose();
    expect(d.disposed).toBe(true);
  });

  it('log 带前缀输出', () => {
    const ctx = createPluginContext('com.example.test', []);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    ctx.log('info', 'hello');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[plugin:com.example.test]'), 'hello');
    spy.mockRestore();
  });

  it('commands.register 校验 ID 前缀并返回 Disposable', () => {
    const ctx = createPluginContext('com.example.test', []);
    const d = ctx.commands.register('com.example.test.myCmd', () => {});
    expect(typeof d.dispose).toBe('function');
    d.dispose();
  });

  it('commands.register 拒绝无前缀的 ID', () => {
    const ctx = createPluginContext('com.example.test', []);
    expect(() => ctx.commands.register('myCmd', () => {})).toThrow(TypeError);
  });

  it('commands.register 拒绝空字符串 ID', () => {
    const ctx = createPluginContext('com.example.test', []);
    expect(() => ctx.commands.register('', () => {})).toThrow(TypeError);
  });

  it('dispose 后 commands.execute 抛出 SessionExpiredError', async () => {
    const ctx = createPluginContext('com.example.test', []);
    ctx.dispose();
    await expect(ctx.commands.execute('any.cmd')).rejects.toThrow();
  });
});
