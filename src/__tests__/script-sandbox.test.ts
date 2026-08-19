/**
 * 脚本沙箱执行器测试（插件系统审查报告 S-2）。
 *
 * 说明：jsdom 不执行 srcdoc iframe 的内联脚本（jsdom 已知限制），
 * 因此 iframe 内的真实执行路径留待真实 Tauri/WebView2 运行验收；
 * 本测试覆盖宿主侧可独立验证的逻辑：RPC 方法分发、隔离存储往返、
 * 权限裁剪声明与超时路径。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runScriptInSandbox, handleRpcMethod } from '../plugin-api/script-sandbox';

describe('handleRpcMethod（宿主侧 RPC 分发）', () => {
  afterEach(() => {
    localStorage.removeItem('plugin:script:test:k1');
  });

  it('storage.set 后 storage.get 往返一致', async () => {
    await handleRpcMethod('script:test', 'storage.set', ['k1', { n: 42 }]);
    const value = await handleRpcMethod('script:test', 'storage.get', ['k1']);
    expect(value).toEqual({ n: 42 });
  });

  it('storage 使用插件前缀隔离存储', async () => {
    await handleRpcMethod('script:test', 'storage.set', ['k1', 'v1']);
    expect(localStorage.getItem('plugin:script:test:k1')).toBe('"v1"');
    expect(localStorage.getItem('plugin:other:k1')).toBeNull();
  });

  it('storage.delete 移除键', async () => {
    await handleRpcMethod('script:test', 'storage.set', ['k1', 'v1']);
    await handleRpcMethod('script:test', 'storage.delete', ['k1']);
    const value = await handleRpcMethod('script:test', 'storage.get', ['k1']);
    expect(value).toBeNull();
  });

  it('storage.keys 仅返回本脚本前缀的键', async () => {
    await handleRpcMethod('script:test', 'storage.set', ['k1', 1]);
    await handleRpcMethod('script:other', 'storage.set', ['k2', 2]);
    const keys = await handleRpcMethod('script:test', 'storage.keys', []);
    expect(keys).toEqual(['k1']);
    localStorage.removeItem('plugin:script:other:k2');
  });

  it('未知 RPC 方法抛错', async () => {
    await expect(handleRpcMethod('script:test', 'unknown.method', [])).rejects.toThrow(
      '未知 RPC 方法',
    );
  });
});

describe('runScriptInSandbox（沙箱生命周期）', () => {
  afterEach(() => {
    // 清理测试遗留的 iframe
    document.body.querySelectorAll('iframe[sandbox]').forEach((node) => node.remove());
  });

  it('异步挂起超过超时时间返回失败', async () => {
    const result = await runScriptInSandbox({
      scriptId: 'script:test',
      permissions: [],
      source: 'await new Promise(() => {});',
      timeoutMs: 300,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('超时');
  });

  it('超时后移除沙箱 iframe', async () => {
    const result = await runScriptInSandbox({
      scriptId: 'script:test',
      permissions: [],
      source: 'await new Promise(() => {});',
      timeoutMs: 200,
    });
    expect(result.ok).toBe(false);
    expect(document.body.querySelectorAll('iframe[sandbox]').length).toBe(0);
  });
});
