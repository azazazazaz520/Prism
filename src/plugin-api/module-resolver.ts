/**
 * prism:* 词法改写和 Module Resolver。
 *
 * 安全约束：正则仅匹配标准单行字面量 `from 'prism:xxx'` / `from "prism:xxx"`。
 * 多行 import、模板字符串、动态 import() 均不匹配 → 浏览器自然报错 → 激活中止。
 * CLI check 阶段静态扫描拒绝非标准换行的 prism:* 导入，从工具链层面确保 100% 可匹配。
 */

// ── 正则：严格匹配单行字面量 ──────────────────────
// 匹配: from 'prism:api' 或 from "prism:commands"
// 不匹配: 跨行（from 与字符串之间有换行）、模板字符串、动态 import()
// [ \t] 严格限定空格/Tab，禁用 \s 防止跨行匹配
const PRISM_IMPORT_RE = /from[ \t]+['"](prism:[a-z:]+)['"]/g;

/** API 端点：Tauri custom protocol scheme */
const API_PREFIX = 'prism-api://localhost';

/**
 * 将源码中的 `prism:*` 裸模块替换为携带插件身份和 token 的绝对 URL。
 * 仅匹配标准单行字面量，多行/模板字符串/动态 import 不处理。
 */
export function rewriteImports(source: string, pluginId: string, sessionToken: string): string {
  return source.replace(PRISM_IMPORT_RE, (_match, specifier: string) => {
    // specifier 格式: "prism:api" → 取冒号后的部分作为模块名
    const moduleName = specifier.slice(6); // "prism:" 之后的部分
    const url = `${API_PREFIX}/${moduleName}.js?pluginId=${encodeURIComponent(pluginId)}&token=${encodeURIComponent(sessionToken)}`;
    return `from '${url}'`;
  });
}

export function createModuleUrl(source: string): string {
  return 'data:application/javascript;charset=utf-8,' + encodeURIComponent(source);
}
