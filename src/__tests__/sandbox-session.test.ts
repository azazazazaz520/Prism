import { afterEach, describe, expect, it, vi } from 'vitest';
import { SandboxPluginSession } from '../plugin-api/sandbox-session';

describe('SandboxPluginSession 启动生命周期', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('未收到 ready 时在超时后拒绝启动 Promise', async () => {
    vi.useFakeTimers();
    const session = new SandboxPluginSession('com.example.timeout', [], '');
    const ready = session.waitUntilReady();
    const assertion = expect(ready).rejects.toThrow('插件沙箱启动超时');

    await vi.advanceTimersByTimeAsync(10_000);

    await assertion;
    session.dispose();
  });

  it('dispose 会拒绝尚未完成的启动 Promise', async () => {
    const session = new SandboxPluginSession('com.example.dispose', [], '');
    const ready = session.waitUntilReady();
    const assertion = expect(ready).rejects.toThrow('插件沙箱已关闭');

    session.dispose();

    await assertion;
  });

  it('来源对象不一致时可通过会话通道令牌完成握手', async () => {
    const session = new SandboxPluginSession('com.example.channel', [], '');
    const channelId = session.iframe.srcdoc.match(/"channelId":"([^"]+)"/)?.[1];
    expect(channelId).toBeTruthy();

    const ready = session.waitUntilReady();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { kind: 'ready', channelId },
        source: null,
      }),
    );

    await expect(ready).resolves.toBeUndefined();
    session.dispose();
  });
});

// jsdom 不执行 srcdoc iframe 内联脚本，沙箱内 mountView / dispose 的
// 真实行为只能通过 srcdoc 生成的引导代码契约断言覆盖（M-4），
// 完整执行路径留待真实 Tauri / WebView2 验收。
describe('SandboxPluginSession 沙箱引导代码（M-4 视图卸载契约）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 创建会话并消费 ready Promise，避免 dispose 时产生未处理的拒绝 */
  function createSession(pluginId: string): SandboxPluginSession {
    const session = new SandboxPluginSession(pluginId, [], '');
    session.waitUntilReady().catch(() => {});
    return session;
  }

  it('mountView 在清空挂载点之前卸载旧 Vue 应用实例', () => {
    const session = createSession('com.example.m4');
    const srcdoc = session.iframe.srcdoc;
    // 卸载旧实例的调用必须出现在 replaceChildren 之前（顺序即契约）
    const unmountIndex = srcdoc.indexOf('currentApp.unmount()');
    const replaceIndex = srcdoc.indexOf('root.replaceChildren()');
    expect(unmountIndex).toBeGreaterThan(-1);
    expect(replaceIndex).toBeGreaterThan(unmountIndex);
    session.dispose();
  });

  it('mountView 对新 Vue 实例保存引用', () => {
    const session = createSession('com.example.m4b');
    expect(session.iframe.srcdoc).toContain('currentApp = app;');
    session.dispose();
  });

  it('dispose 时先卸载当前 Vue 应用实例', () => {
    const session = createSession('com.example.m4c');
    const srcdoc = session.iframe.srcdoc;
    const disposeSection = srcdoc.slice(srcdoc.indexOf('async function dispose()'));
    const unmountIndex = disposeSection.indexOf('currentApp.unmount()');
    const replaceIndex = disposeSection.indexOf('replaceChildren()');
    expect(unmountIndex).toBeGreaterThan(-1);
    expect(replaceIndex).toBeGreaterThan(unmountIndex);
    session.dispose();
  });

  it('registerDomView 对象（含 mount 方法）不进入 Vue createApp 分支', () => {
    const session = createSession('com.example.m4d');
    const srcdoc = session.iframe.srcdoc;
    // Vue 分支与 DomView 分支以 mount 方法存在与否判别，保证 DomView 分支可达
    expect(srcdoc).toContain("typeof registration.component.mount !== 'function'");
    session.dispose();
  });

  it('切换视图时先卸载旧 Raw DOM 视图', () => {
    const session = createSession('com.example.m4e');
    const srcdoc = session.iframe.srcdoc;
    const domUnmountIndex = srcdoc.indexOf('currentDomView.unmount()');
    const replaceIndex = srcdoc.indexOf('root.replaceChildren()');
    expect(domUnmountIndex).toBeGreaterThan(-1);
    expect(replaceIndex).toBeGreaterThan(domUnmountIndex);
    session.dispose();
  });
});
