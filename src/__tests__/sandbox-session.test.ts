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
