import { describe, expect, it } from 'vitest';
import { computed, createApp, defineComponent, h, onUnmounted, ref } from 'vue';
import { validateManifest } from '../composables/usePluginManifest';
import { buildCapability } from '../plugin-api/capability-builder';
import { parseModule } from '../plugin-api/module-resolver';
import { createNetworkAPI } from '../plugin-api/network-impl';
import { createPluginContext } from '../plugin-api/plugin-context';
import { SANDBOX_PLUGIN_FACTORY_PARAMETERS } from '../plugin-api/sandbox-session';
import { createTasksAPI } from '../plugin-api/tasks-impl';
import { type Disposable, type PluginManifest, type PluginPermission } from '../types';
import { sanitizeIconMarkup, sanitizeIconNodes } from '../utils/plugin-icon';

describe('Capability Builder', () => {
  it('invalidate 后 tasks.list() 抛 SessionExpiredError', async () => {
    const cap = buildCapability('test.plugin', ['tasks:read', 'tasks:write']);
    cap.invalidate();
    await expect(cap.tasks!.list!()).rejects.toThrow();
  });
});

function fakeDisposable(): { disposed: boolean } & Disposable {
  const result = {
    disposed: false,
    dispose() {
      this.disposed = true;
    },
  };
  return result;
}

function makeCtx(pluginId: string, permissions: PluginPermission[]) {
  return createPluginContext(pluginId, permissions, {
    ref,
    computed,
    h,
    defineComponent,
    createApp,
    onUnmounted,
  });
}

describe('createPluginContext', () => {
  it('storage 按插件隔离并可跨上下文恢复', async () => {
    localStorage.clear();
    const first = makeCtx('com.example.storage', []);
    await first.storage.set('token', 'secret');

    const second = makeCtx('com.example.storage', []);
    expect(await second.storage.get('token')).toBe('secret');
    expect(await second.storage.keys()).toEqual(['token']);

    const other = makeCtx('com.other.storage', []);
    expect(await other.storage.get('token')).toBeNull();
    localStorage.clear();
  });

  it('track 注册 Disposable 并在 dispose 时释放', () => {
    const ctx = makeCtx('com.example.test', []);
    const d = fakeDisposable();
    ctx.track(d);
    ctx.dispose();
    expect(d.disposed).toBe(true);
  });
});

describe('parseModule', () => {
  it('转换插件的启动和停用导出', () => {
    const src = `export async function activate(ctx) {}\nexport function deactivate() {}`;
    const { body } = parseModule(src);
    expect(body).toContain('var activate = async function');
    expect(body).not.toContain('export async function activate');
    expect(body).toContain('var deactivate = function');
  });

  it('混合普通导入和别名导入', () => {
    const src = `import { ref, computed as c } from 'vue';`;
    const { body } = parseModule(src);
    expect(body).toContain('const { ref, computed: c } = __vue__');
  });

  it('导入模块的变量与沙箱工厂参数保持一致', () => {
    const cases: Array<[string, string]> = [
      ['vue', '__vue__'],
      ['prism:api', '__prism_api__'],
      ['prism:commands', '__prism_commands__'],
      ['prism:menus', '__prism_menus__'],
      ['prism:tasks', '__prism_tasks__'],
      ['prism:network', '__prism_network__'],
    ];
    for (const [from, varName] of cases) {
      const { body, deps } = parseModule(`import { x } from '${from}';`);
      expect(body).toContain(`const { x } = ${varName}`);
      expect(deps).toEqual([varName]);
      expect(SANDBOX_PLUGIN_FACTORY_PARAMETERS).toContain(varName);
    }
  });
});

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

  it('permissions 包含未知权限标识时失败', () => {
    const m = { ...validManifest, permissions: ['tasks:read', 'fs:write' as any] };
    expect(validateManifest(m)).toBe(false);
  });
});

describe('sanitizeIconNodes', () => {
  it('丢弃危险属性（innerHTML、事件、href、style）', () => {
    const nodes = [
      {
        tag: 'path',
        attrs: {
          d: 'M0 0',
          innerHTML: '<script>alert(1)</script>',
          onerror: 'alert(1)',
          href: 'javascript:alert(1)',
          style: 'position:fixed',
        },
      },
    ];
    const result = sanitizeIconNodes(nodes);
    expect(result[0].attrs).toEqual({ d: 'M0 0' });
  });
});

describe('sanitizeIconMarkup', () => {
  it('过滤脚本、事件属性与危险链接', () => {
    const markup =
      '<svg><script>alert(1)</script><path d="M0 0" onload="alert(1)"/><a href="javascript:alert(1)"><path d="M1 1"/></a></svg>';
    const result = sanitizeIconMarkup(markup);
    expect(result).not.toContain('onload');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('<a');
  });
});

describe('Tasks API', () => {
  const pluginId = 'com.example.test';

  describe('权限裁剪', () => {
    it('tasks:read 仅提供只读方法', () => {
      const api = createTasksAPI(pluginId, ['tasks:read']);
      expect(api.list).toBeDefined();
      expect(api.listByDate).toBeDefined();
      expect(api.create).toBeUndefined();
      expect(api.update).toBeUndefined();
      expect(api.toggle).toBeUndefined();
      expect(api.delete).toBeUndefined();
    });

    it('tasks:write 同时提供读写方法', () => {
      const api = createTasksAPI(pluginId, ['tasks:read', 'tasks:write']);
      expect(api.list).toBeDefined();
      expect(api.listByDate).toBeDefined();
      expect(api.create).toBeDefined();
      expect(api.update).toBeDefined();
      expect(api.toggle).toBeDefined();
      expect(api.delete).toBeDefined();
    });
  });
});

describe('Network API', () => {
  const pluginId = 'com.example.test';

  describe('权限裁剪', () => {
    it('按网络权限提供请求方法', () => {
      const api = createNetworkAPI(pluginId, []);
      expect(api.fetch).toBeUndefined();
      expect(createNetworkAPI(pluginId, ['network']).fetch).toBeTypeOf('function');
    });
  });
});
