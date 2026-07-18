/**
 * 插件模块解析器。
 *
 * 将 ES module 源码转换为可通过 new Function() 执行的纯脚本：
 * - import { x } from 'vue'           → const { x } = __vue__
 * - import { x } from 'prism:api'     → const { x } = __prism_api__
 * - export async function activate    → var activate = async function
 *
 * 这避免了 import() — Tauri 生产环境 WebView2 不支持 blob:/data:/prism-api: 等
 * 非标准 scheme 的动态导入。
 */

interface ParsedModule {
  /** 去除所有 import/export 后的可执行代码 */
  body: string;
  /** 所需的外部依赖标识 */
  deps: string[];
}

const IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*/g;

export function parseModule(source: string): ParsedModule {
  const deps: string[] = [];
  let body = source;

  // 替换所有 import 声明
  // 同时处理 import { foo as bar } 别名语法：将 as 替换为 :
  body = body.replace(IMPORT_RE, (_match, names: string, from: string) => {
    const varName = importToVar(from);
    if (varName) deps.push(varName);
    // 将 ES import 别名语法转换为 JS 解构语法：foo as bar → foo: bar
    const normalized = names.replace(/\b as \b/g, ': ');
    return varName ? `const {${normalized}} = ${varName};` : _match;
  });

  // export async function activate → var activate = async function
  body = body.replace(/export\s+async\s+function\s+activate\b/g, 'var activate = async function');
  // export function deactivate → var deactivate = function
  body = body.replace(/export\s+function\s+deactivate\b/g, 'var deactivate = function');

  return { body, deps };
}

/** 将 import 来源映射到注入变量名 */
function importToVar(from: string): string | null {
  if (from === 'vue') return '__vue__';
  if (from === 'prism:api') return '__prism_api__';
  if (from === 'prism:commands' || from === 'prism:menus') return '__prism_commands__';
  if (from === 'prism:tasks') return '__prism_tasks__';
  if (from === 'prism:network') return '__prism_network__';
  return null; // 未知导入保留原样，让 Function 构造器报错
}
