import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  diagnosticsLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../diagnostics/invoke-logged', () => ({
  invokeWithDiagnostics: mocks.invoke,
  diagnosticsLogger: mocks.diagnosticsLogger,
}));

vi.mock('../plugin-api/module-resolver', () => ({
  parseModule: vi.fn(),
}));

vi.mock('../plugin-api/menus-impl', () => ({
  registerSandboxMenus: vi.fn(),
}));

vi.mock('../plugin-api/views-impl', () => ({
  activatePluginPage: vi.fn(),
  registerSandboxView: vi.fn(),
}));

vi.mock('../plugin-api/sandbox-session', () => ({
  SandboxPluginSession: vi.fn(),
}));

import { resetPluginLoaderForTests, usePluginLoader } from '../composables/usePluginLoader';
import { resetScriptRunnerForTests, useScriptRunner } from '../composables/useScriptRunner';

const pluginA = {
  id: 'com.example.alpha',
  name: 'Alpha',
  version: '1.0.0',
  author: 'test',
  main: 'main.js',
  engines: { prism: '>=0.1.0' },
};

const pluginB = {
  id: 'com.example.beta',
  name: 'Beta',
  version: '1.0.0',
  author: 'test',
  main: 'main.js',
  engines: { prism: '>=0.1.0' },
};

describe('插件与脚本重新扫描', () => {
  beforeEach(() => {
    resetPluginLoaderForTests();
    resetScriptRunnerForTests();
    mocks.invoke.mockReset();
    mocks.diagnosticsLogger.error.mockReset();
    mocks.diagnosticsLogger.info.mockReset();
    mocks.diagnosticsLogger.warn.mockReset();
  });

  it('插件首次加载只扫描一次，显式重新扫描后更新列表', async () => {
    let scanCount = 0;
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'scan_plugins') {
        scanCount += 1;
        return scanCount === 1 ? [pluginA] : [pluginB];
      }
      if (command === 'get_plugin_configs') return {};
      throw new Error(`unexpected command: ${command}`);
    });

    const loader = usePluginLoader();
    await loader.loadPlugins();
    await loader.loadPlugins();

    expect(scanCount).toBe(1);
    expect(loader.entries.value.map((entry) => entry.manifest.id)).toEqual(['com.example.alpha']);

    await loader.rescanPlugins();

    expect(scanCount).toBe(2);
    expect(loader.entries.value.map((entry) => entry.manifest.id)).toEqual(['com.example.beta']);
    expect(loader.scanState.value).toBe('success');
  });

  it('脚本重新扫描后更新文件列表并保留同名脚本结果', async () => {
    let scanCount = 0;
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command !== 'scan_scripts') throw new Error(`unexpected command: ${command}`);
      scanCount += 1;
      return scanCount === 1
        ? [{ name: 'daily.js', description: '每日任务', permissions: [] }]
        : [
            { name: 'daily.js', description: '每日任务（更新）', permissions: ['tasks:read'] },
            { name: 'weekly.js', description: '每周任务', permissions: [] },
          ];
    });

    const runner = useScriptRunner();
    await runner.loadScripts();
    runner.scripts.value[0].status = 'done';
    runner.scripts.value[0].lastOutput = '执行完成';

    await runner.rescanScripts();

    expect(scanCount).toBe(2);
    expect(runner.scripts.value).toEqual([
      {
        name: 'daily.js',
        description: '每日任务（更新）',
        permissions: ['tasks:read'],
        status: 'done',
        lastOutput: '执行完成',
      },
      {
        name: 'weekly.js',
        description: '每周任务',
        permissions: [],
        status: 'idle',
        lastOutput: undefined,
      },
    ]);
    expect(runner.scanState.value).toBe('success');
  });
});
