import { describe, it, expect } from 'vitest';
import { parseModule } from '../plugin-api/module-resolver';

describe('parseModule', () => {
  it('替换 vue import', () => {
    const src = `import { ref, h } from 'vue';\nexport async function activate(ctx) {}`;
    const { body, deps } = parseModule(src);
    expect(body).toContain('const { ref, h } = __vue__');
    expect(deps).toContain('__vue__');
  });

  it('替换 prism:api import', () => {
    const src = `import { api } from 'prism:api';\nvar activate = async function() {}`;
    const { body, deps } = parseModule(src);
    expect(body).toContain('const { api } = __prism_api__');
    expect(deps).toContain('__prism_api__');
  });

  it('替换 prism:tasks import', () => {
    const src = `import { tasks } from 'prism:tasks';`;
    const { deps } = parseModule(src);
    expect(deps).toContain('__prism_tasks__');
  });

  it('替换 prism:network import', () => {
    const src = `import { network } from 'prism:network';`;
    const { deps } = parseModule(src);
    expect(deps).toContain('__prism_network__');
  });

  it('替换 export async function activate', () => {
    const src = `export async function activate(ctx) { console.log(ctx); }`;
    const { body } = parseModule(src);
    expect(body).toContain('var activate = async function(ctx)');
    expect(body).not.toContain('export');
  });

  it('替换 export function deactivate', () => {
    const src = 'export function deactivate() {}';
    const { body } = parseModule(src);
    expect(body).toContain('var deactivate = function()');
  });

  it('不替换未知导入', () => {
    const src = `import { z } from 'zod';`;
    const { body, deps } = parseModule(src);
    expect(body).toBe(src); // 保持原样
    expect(deps.length).toBe(0);
  });

  it('同时替换多个导入', () => {
    const src = `import { ref } from 'vue';\nimport { api } from 'prism:api';\nimport { tasks } from 'prism:tasks';\nexport async function activate(ctx) {}`;
    const { body, deps } = parseModule(src);
    expect(deps).toContain('__vue__');
    expect(deps).toContain('__prism_api__');
    expect(deps).toContain('__prism_tasks__');
    expect(body).not.toContain('export');
    expect(body).not.toContain("from 'vue'");
    expect(body).not.toContain("from 'prism:api'");
  });

  it('空字符串通过', () => {
    const { body, deps } = parseModule('');
    expect(body).toBe('');
    expect(deps.length).toBe(0);
  });

  it('无导入的源码保持不变', () => {
    const src = `console.log('hello');\nexport async function activate(ctx) { ctx.log('info', 'ok'); }`;
    const { body } = parseModule(src);
    expect(body).toContain("console.log('hello')");
    expect(body).toContain('var activate = async function');
  });
});
