import { describe, it, expect } from 'vitest';
import { buildCapability, PermissionError } from '../plugin-api/capability-builder';

describe('Capability Builder', () => {
  const basePerms = ['tasks:read', 'tasks:write', 'network'] as const;

  it('始终注入 core 模块 (prism:api)', () => {
    const cap = buildCapability('test.plugin', []);
    expect(cap.api).toBeDefined();
    expect(cap.api.ui).toBeDefined();
    expect(cap.api.storage).toBeDefined();
    expect(cap.api.diagnostics).toBeDefined();
  });

  it('始终注入 commands 模块', () => {
    const cap = buildCapability('test.plugin', []);
    expect(cap.commands).toBeDefined();
  });

  it('tasks:read 权限注入只读 tasks 模块', () => {
    const cap = buildCapability('test.plugin', ['tasks:read']);
    expect(cap.tasks).toBeDefined();
    expect(cap.tasks!.list).toBeDefined();
    // 仅有 read 权限时 write 方法为 undefined
    expect(cap.tasks!.create).toBeUndefined();
    expect(cap.tasks!.delete).toBeUndefined();
  });

  it('tasks:write 不提供只读方法（仅有 list 为 undefined）', () => {
    // 仅 write 没有 read → tasks 模块存在，但 list 为 undefined
    const cap = buildCapability('test.plugin', ['tasks:write']);
    expect(cap.tasks).toBeDefined();
    expect(cap.tasks!.list).toBeUndefined();
    expect(cap.tasks!.create).toBeDefined();
  });

  it('tasks:read + tasks:write 提供完整读写', () => {
    const cap = buildCapability('test.plugin', ['tasks:read', 'tasks:write']);
    expect(cap.tasks).toBeDefined();
    expect(cap.tasks!.list).toBeDefined();
    expect(cap.tasks!.create).toBeDefined();
    expect(cap.tasks!.update).toBeDefined();
    expect(cap.tasks!.delete).toBeDefined();
  });

  it('未声明的权限对应模块为 undefined', () => {
    const cap = buildCapability('test.plugin', []);
    expect(cap.network).toBeUndefined();
  });

  it('network 权限注入 network 模块', () => {
    const cap = buildCapability('test.plugin', ['network']);
    expect(cap.network).toBeDefined();
  });

  it('写操作在仅有 read 权限时 create 为 undefined', () => {
    const cap = buildCapability('test.plugin', ['tasks:read']);
    expect(cap.tasks!.create).toBeUndefined();
    expect(cap.tasks!.list).toBeDefined();
  });

  it('PermissionError 包含完整上下文', () => {
    const err = new PermissionError('my.plugin', 'tasks:write', 'create');
    expect(err.pluginId).toBe('my.plugin');
    expect(err.permission).toBe('tasks:write');
    expect(err.operation).toBe('create');
    expect(err.message).toContain('my.plugin');
    expect(err.message).toContain('tasks:write');
    expect(err.message).toContain('create');
  });

  it('invalidate 后 tasks.list() 抛 SessionExpiredError', async () => {
    const cap = buildCapability('test.plugin', ['tasks:read', 'tasks:write']);
    cap.invalidate();
    await expect(cap.tasks!.list!()).rejects.toThrow();
  });
});
