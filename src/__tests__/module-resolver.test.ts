import { describe, it, expect } from 'vitest';
import { parseModule } from '../plugin-api/module-resolver';

describe('parseModule', () => {
  it('将 vue import 重写为 __vue__ 解构', () => {
    const src = `import { ref, computed } from 'vue';`;
    const { body, deps } = parseModule(src);
    expect(body).toContain('const { ref, computed } = __vue__');
    expect(deps).toContain('__vue__');
  });

  it('将 prism:api import 重写为 __prism_api__ 解构', () => {
    const src = `import { api } from 'prism:api';`;
    const { body, deps } = parseModule(src);
    expect(body).toContain('const { api } = __prism_api__');
    expect(deps).toContain('__prism_api__');
  });

  it('将 prism:commands import 重写为 __prism_commands__ 解构', () => {
    const src = `import { commands } from 'prism:commands';`;
    const { body, deps } = parseModule(src);
    expect(body).toContain('const { commands } = __prism_commands__');
    expect(deps).toContain('__prism_commands__');
  });

  it('将 prism:tasks import 重写为 __prism_tasks__ 解构', () => {
    const src = `import { tasks } from 'prism:tasks';`;
    const { body, deps } = parseModule(src);
    expect(body).toContain('const { tasks } = __prism_tasks__');
    expect(deps).toContain('__prism_tasks__');
  });

  it('将 prism:network import 重写为 __prism_network__ 解构', () => {
    const src = `import { network } from 'prism:network';`;
    const { body, deps } = parseModule(src);
    expect(body).toContain('const { network } = __prism_network__');
    expect(deps).toContain('__prism_network__');
  });

  it('同时替换多个 import', () => {
    const src = `import { ref } from 'vue';\nimport { tasks } from 'prism:tasks';`;
    const { body, deps } = parseModule(src);
    expect(deps).toContain('__vue__');
    expect(deps).toContain('__prism_tasks__');
    expect(body).not.toContain('import {');
  });

  it('将 export async function activate 重写为 var activate = async function', () => {
    const src = `export async function activate(ctx) {\n  console.log('hi');\n}`;
    const { body } = parseModule(src);
    expect(body).toContain('var activate = async function');
    expect(body).not.toContain('export async function activate');
  });

  it('将 export function deactivate 重写为 var deactivate = function', () => {
    const src = `export function deactivate() {}`;
    const { body } = parseModule(src);
    expect(body).toContain('var deactivate = function');
    expect(body).not.toContain('export function deactivate');
  });

  it('不处理未知来源的 import', () => {
    const src = `import { z } from 'zod';`;
    const { body, deps } = parseModule(src);
    expect(body).toBe(src); // 保留原样
    expect(deps).toEqual([]);
  });

  it('不处理动态 import()', () => {
    const src = `const m = await import('vue');`;
    const { body, deps } = parseModule(src);
    expect(body).toBe(src);
    expect(deps).toEqual([]);
  });

  it('空字符串通过', () => {
    const { body, deps } = parseModule('');
    expect(body).toBe('');
    expect(deps).toEqual([]);
  });

  it('无 import 的代码保持不变', () => {
    const src = `console.log('hello');`;
    const { body } = parseModule(src);
    expect(body).toBe(src);
  });

  it('将 prism:* 别名导入转换为 JS 解构', () => {
    const src = `import { api as myApi, highlight as myHighlight } from 'prism:api';`;
    const { body, deps } = parseModule(src);
    expect(body).toContain('const { api: myApi, highlight: myHighlight } = __prism_api__');
    expect(deps).toContain('__prism_api__');
  });

  it('将 import { foo as bar } 别名转换为 const { foo: bar } 解构', () => {
    const src = `import { ref as myRef, computed as myComputed } from 'vue';`;
    const { body, deps } = parseModule(src);
    expect(body).toContain('const { ref: myRef, computed: myComputed } = __vue__');
    expect(deps).toContain('__vue__');
  });

  it('正确处理 as 周围的任意空白', () => {
    const src = `import { ref   as   myRef, computed as  myComputed } from 'vue';`;
    const { body } = parseModule(src);
    expect(body).toContain('const { ref: myRef, computed: myComputed } = __vue__');
  });

  it('混合普通导入和别名导入', () => {
    const src = `import { ref, computed as c } from 'vue';`;
    const { body } = parseModule(src);
    expect(body).toContain('const { ref, computed: c } = __vue__');
  });
});
