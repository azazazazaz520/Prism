import { describe, it, expect } from 'vitest';
import type { PluginManifest, PluginEntry } from '../types';

// 纯逻辑测试
const mockManifest: PluginManifest = {
  id: 'test-plugin',
  name: 'Test Plugin',
  version: '1.0.0',
  author: 'test',
  permissions: ['tasks:read'],
};

function createPluginEntry(m: PluginManifest, builtin = false): PluginEntry {
  return { manifest: m, enabled: true, builtin, dirName: m.id };
}

function validateManifest(m: any): m is PluginManifest {
  if (!m || typeof m !== 'object') return false;
  if (typeof m.id !== 'string' || !m.id) return false;
  if (typeof m.name !== 'string' || !m.name) return false;
  if (typeof m.version !== 'string') return false;
  if (!Array.isArray(m.permissions)) return false;
  const validPerms: Set<string> = new Set([
    'tasks:read',
    'tasks:write',
    'ai:invoke',
    'notifications',
    'http',
  ]);
  return m.permissions.every((p: any) => validPerms.has(p));
}

function checkPermission(plugin: PluginEntry, perm: string): boolean {
  return plugin.manifest.permissions.includes(perm as any);
}

describe('插件注册系统', () => {
  it('validateManifest 通过合法 manifest', () => {
    expect(validateManifest(mockManifest)).toBe(true);
  });

  it('validateManifest 拒绝空对象', () => {
    expect(validateManifest({})).toBe(false);
  });

  it('validateManifest 拒绝非法权限', () => {
    expect(validateManifest({ ...mockManifest, permissions: ['fs'] })).toBe(false);
  });

  it('createPluginEntry 标记内建插件', () => {
    const entry = createPluginEntry(mockManifest, true);
    expect(entry.builtin).toBe(true);
    expect(entry.enabled).toBe(true);
  });

  it('checkPermission 正确验证权限', () => {
    const entry = createPluginEntry(mockManifest);
    expect(checkPermission(entry, 'tasks:read')).toBe(true);
    expect(checkPermission(entry, 'tasks:write')).toBe(false);
  });
});
