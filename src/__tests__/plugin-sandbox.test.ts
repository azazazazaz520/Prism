import { afterEach, describe, expect, it, vi } from 'vitest';
import { SandboxPluginSession } from '../plugin-api/sandbox-session';
import { handleRpcMethod, runScriptInSandbox } from '../plugin-api/script-sandbox';

describe('handleRpcMethod（宿主侧 RPC 分发）', () => {
  afterEach(() => {
    localStorage.removeItem('plugin:script:test:k1');
  });

  it('storage.keys 仅返回本脚本前缀的键', async () => {
    await handleRpcMethod('script:test', 'storage.set', ['k1', 1]);
    await handleRpcMethod('script:other', 'storage.set', ['k2', 2]);
    const keys = await handleRpcMethod('script:test', 'storage.keys', []);
    expect(keys).toEqual(['k1']);
    localStorage.removeItem('plugin:script:other:k2');
  });
});

describe('runScriptInSandbox（沙箱生命周期）', () => {
  afterEach(() => {
    // 清理测试遗留的 iframe
    document.body.querySelectorAll('iframe[sandbox]').forEach((node) => node.remove());
  });

  it('执行超时后返回失败并移除沙箱', async () => {
    const result = await runScriptInSandbox({
      scriptId: 'script:test',
      permissions: [],
      source: 'await new Promise(() => {});',
      timeoutMs: 300,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('超时');
    expect(document.body.querySelectorAll('iframe[sandbox]')).toHaveLength(0);
  });
});

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
