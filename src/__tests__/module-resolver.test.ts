import { describe, it, expect } from 'vitest';
import { rewriteImports, createBlobUrl } from '../plugin-api/module-resolver';

describe('rewriteImports', () => {
  const pluginId = 'com.example.test';
  const token = 'abc123';

  it('替换单行单引号 prism:* import', () => {
    const src = `import { commands } from 'prism:api';`;
    const result = rewriteImports(src, pluginId, token);
    expect(result).toContain('/__prism/api/api.js?pluginId=com.example.test&token=abc123');
    expect(result).not.toContain("'prism:api'");
  });

  it('替换单行双引号 prism:* import', () => {
    const src = `import { ref } from "prism:commands";`;
    const result = rewriteImports(src, pluginId, token);
    expect(result).toContain('/__prism/api/commands.js?');
    expect(result).not.toContain('"prism:commands"');
  });

  it('同时替换多个 prism:* import', () => {
    const src = `import { ui } from 'prism:api';\nimport { commands } from 'prism:commands';`;
    const result = rewriteImports(src, pluginId, token);
    expect(result).toContain('/__prism/api/api.js?');
    expect(result).toContain('/__prism/api/commands.js?');
    expect(result).not.toContain('prism:');
  });

  it('不替换非 prism 开头的 import', () => {
    const src = `import { ref } from 'vue';`;
    const result = rewriteImports(src, pluginId, token);
    expect(result).toBe(src);
  });

  it('不处理模板字符串', () => {
    const src = 'import { x } from `prism:api`;';
    const result = rewriteImports(src, pluginId, token);
    expect(result).toBe(src);
  });

  it('不处理多行 import（from 与字符串跨行）', () => {
    const src = `import {\n  commands\n} from\n'prism:api';`;
    const result = rewriteImports(src, pluginId, token);
    // 多行 import 不被正则匹配 → 不替换 → 浏览器自然报错
    expect(result).toBe(src);
  });

  it('不处理动态 import()', () => {
    const src = `const m = await import('prism:api');`;
    const result = rewriteImports(src, pluginId, token);
    expect(result).toBe(src);
  });

  it('无匹配时返回原字符串（引用不变时）', () => {
    const src = `console.log('hello');`;
    const result = rewriteImports(src, pluginId, token);
    expect(result).toBe(src);
  });

  it('空字符串通过', () => {
    const result = rewriteImports('', pluginId, token);
    expect(result).toBe('');
  });
});

describe('createBlobUrl', () => {
  it('返回 blob: 开头的 URL', () => {
    const url = createBlobUrl('export default {};', 'com.example.test');
    expect(url).toMatch(/^blob:/);
  });

  it('返回的 URL 可用于创建 import 语句', () => {
    // 仅验证 URL 格式合法性
    const url = createBlobUrl('export const x = 1;', 'test');
    expect(() => new URL(url)).not.toThrow();
  });
});
