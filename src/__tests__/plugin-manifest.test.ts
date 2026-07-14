import { describe, it, expect } from 'vitest';
import {
  validateManifest,
  checkEngines,
  validateExtensionPointIds,
} from '../composables/usePluginManifest';
import type { PluginManifest } from '../types';

const validManifest: PluginManifest = {
  id: 'com.example.my-plugin',
  name: '我的插件',
  version: '1.0.0',
  description: '一个测试插件',
  author: 'test',
  license: 'MIT',
  main: 'main.js',
  engines: { prism: '>=0.1.0' },
  permissions: ['tasks:read'],
  contributes: {
    commands: [{ id: 'com.example.my-plugin.hello', title: '打个招呼' }],
  },
};

describe('validateManifest', () => {
  it('合法 manifest 通过校验', () => {
    expect(validateManifest(validManifest)).toBe(true);
  });

  it('缺少 id 字段时失败', () => {
    const m = { ...validManifest, id: undefined };
    expect(validateManifest(m)).toBe(false);
  });

  it('id 不是字符串时失败', () => {
    const m = { ...validManifest, id: 123 };
    expect(validateManifest(m)).toBe(false);
  });

  it('id 为空字符串时失败', () => {
    const m = { ...validManifest, id: '' };
    expect(validateManifest(m)).toBe(false);
  });

  it('id 不含点号时失败（kebab-case 不含命名空间）', () => {
    const m = { ...validManifest, id: 'myplugin' };
    expect(validateManifest(m)).toBe(false);
  });

  it('id 含点号时通过', () => {
    const m = { ...validManifest, id: 'com.example.my-plugin' };
    expect(validateManifest(m)).toBe(true);
  });

  it('缺少 name 字段时失败', () => {
    const m = { ...validManifest, name: undefined };
    expect(validateManifest(m)).toBe(false);
  });

  it('缺少 version 字段时失败', () => {
    const m = { ...validManifest, version: undefined };
    expect(validateManifest(m)).toBe(false);
  });

  it('缺少 engines 字段时失败', () => {
    const m = { ...validManifest, engines: undefined };
    expect(validateManifest(m)).toBe(false);
  });

  it('缺少 engines.prism 字段时失败', () => {
    const m = { ...validManifest, engines: {} as any };
    expect(validateManifest(m)).toBe(false);
  });

  it('缺少 author 字段时失败', () => {
    const m = { ...validManifest, author: undefined };
    expect(validateManifest(m)).toBe(false);
  });

  it('缺少 main 字段时失败', () => {
    const m = { ...validManifest, main: undefined };
    expect(validateManifest(m)).toBe(false);
  });

  it('permissions 不是 string[] 时失败', () => {
    const m = { ...validManifest, permissions: 'tasks:read' as any };
    expect(validateManifest(m)).toBe(false);
  });

  it('permissions 包含未知权限标识时失败', () => {
    const m = { ...validManifest, permissions: ['tasks:read', 'fs:write' as any] };
    expect(validateManifest(m)).toBe(false);
  });

  it('permissions 为 undefined 时通过（可选字段）', () => {
    const m = { ...validManifest, permissions: undefined };
    expect(validateManifest(m)).toBe(true);
  });

  it('contributes 为 undefined 时通过（可选字段）', () => {
    const m = { ...validManifest, contributes: undefined };
    expect(validateManifest(m)).toBe(true);
  });

  it('非对象输入失败', () => {
    expect(validateManifest(null)).toBe(false);
    expect(validateManifest(undefined)).toBe(false);
    expect(validateManifest('string')).toBe(false);
    expect(validateManifest(42)).toBe(false);
  });
});

describe('checkEngines', () => {
  const currentVersion = '0.1.0';

  it('>= 范围匹配：相同版本通过', () => {
    expect(checkEngines('>=0.1.0', currentVersion)).toBe(true);
  });

  it('>= 范围匹配：当前版本更高通过', () => {
    expect(checkEngines('>=0.0.5', currentVersion)).toBe(true);
  });

  it('>= 范围匹配：当前版本更低失败', () => {
    expect(checkEngines('>=0.2.0', currentVersion)).toBe(false);
  });

  it('>= 范围匹配：大版本跨越失败', () => {
    expect(checkEngines('>=1.0.0', currentVersion)).toBe(false);
  });

  it('空字符串要求时通过', () => {
    expect(checkEngines('', currentVersion)).toBe(true);
  });

  it('无前缀的精确版本号视为 >=', () => {
    expect(checkEngines('0.1.0', currentVersion)).toBe(true);
    expect(checkEngines('0.2.0', currentVersion)).toBe(false);
  });
});

describe('validateExtensionPointIds', () => {
  it('合法前缀的 command ID 通过', () => {
    const result = validateExtensionPointIds(validManifest, 'com.example.my-plugin');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('command ID 缺少插件前缀时报错', () => {
    const m = {
      ...validManifest,
      contributes: { commands: [{ id: 'hello', title: 'Hi' }] },
    };
    const result = validateExtensionPointIds(m, 'com.example.my-plugin');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('前缀');
  });

  it('command ID 使用错误前缀时报错', () => {
    const m = {
      ...validManifest,
      contributes: {
        commands: [{ id: 'com.other.hello', title: 'Hi' }],
      },
    };
    const result = validateExtensionPointIds(m, 'com.example.my-plugin');
    expect(result.valid).toBe(false);
  });

  it('无 contributes 时通过', () => {
    const m = { ...validManifest, contributes: undefined };
    const result = validateExtensionPointIds(m, 'com.example.my-plugin');
    expect(result.valid).toBe(true);
  });

  it('view ID 同样需要前缀校验', () => {
    const m = {
      ...validManifest,
      contributes: {
        views: [{ id: 'bad-view', title: 'Bad', location: 'sidebar' as const }],
      },
    };
    const result = validateExtensionPointIds(m, 'com.example.my-plugin');
    expect(result.valid).toBe(false);
  });

  it('menu ID 同样需要前缀校验', () => {
    const m = {
      ...validManifest,
      contributes: {
        menus: [
          {
            id: 'bad-menu',
            command: 'com.example.my-plugin.hello',
            location: 'task-context' as const,
          },
        ],
      },
    };
    const result = validateExtensionPointIds(m, 'com.example.my-plugin');
    expect(result.valid).toBe(false);
  });
});
