import { resolve } from 'path';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const schema = require('../manifest-schema.json');

/**
 * 手动 JSON Schema 校验（不引入 ajv，保持零依赖）。
 * 仅校验 required + type，不做完整 draft-07 实现。
 */
function validateSchema(instance, sch, errors, path) {
  if (sch.type === 'object') {
    if (typeof instance !== 'object' || instance === null || Array.isArray(instance)) {
      errors.push(`${path} 应为对象`);
      return;
    }
    if (sch.required) {
      for (const key of sch.required) {
        if (!(key in instance)) errors.push(`${path} 缺少必填字段: ${key}`);
      }
    }
    if (sch.properties) {
      for (const [key, propSch] of Object.entries(sch.properties)) {
        if (key in instance) {
          validateSchema(instance[key], propSch, errors, `${path}.${key}`);
        }
      }
    }
  } else if (sch.type === 'string') {
    if (typeof instance !== 'string') {
      errors.push(`${path} 应为字符串`);
    } else {
      if (sch.minLength !== undefined && instance.length < sch.minLength) {
        errors.push(`${path} 为空`);
      }
      if (sch.pattern && !new RegExp(sch.pattern).test(instance)) {
        errors.push(`${path} "${instance}" 不匹配格式要求`);
      }
      if (sch.enum && !sch.enum.includes(instance)) {
        errors.push(`${path} "${instance}" 不在合法值中`);
      }
    }
  } else if (sch.type === 'array') {
    if (!Array.isArray(instance)) {
      errors.push(`${path} 应为数组`);
    } else if (sch.items) {
      for (let i = 0; i < instance.length; i++) {
        validateSchema(instance[i], sch.items, errors, `${path}[${i}]`);
      }
    }
  }
}

/**
 * 检测源码中 prism:* 导入是否全部为单行标准格式。
 * 跨行 import 将在 blob URL 加载时被正则忽略 → 激活失败。
 */
function checkPrismImports(filePath, errors) {
  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return;
  }

  // 匹配所有包含 prism: 的 import 声明
  const importRe = /from\s+['"](prism:[a-z:]+)['"]/g;
  let match;
  while ((match = importRe.exec(content)) !== null) {
    // 检查 from 和字符串是否跨行 —— 如果中间有换行则报错
    const start = match.index;
    const end = importRe.lastIndex;
    const segment = content.slice(start, end);
    if (segment.includes('\n')) {
      errors.push(`${filePath}: prism:* 导入跨行（${match[1]}），正则改写将无法匹配，请合并为单行`);
    }
  }
}

/**
 * 检测 h() 调用中空字符串作为第二参数的错误写法。
 * h('span', '', text) 会创建 props: '' 的 VNode，
 * 在 Vue 3.5 生产模式下，若父元素为 display:flex 且兄弟节点有正常 props 对象，
 * 会触发 patch 阶段的崩溃。
 *
 * 使用全文正则匹配以兼容多行写法，例如 h(\n  'span',\n  '',\n  text\n)。
 */
function checkHEmptyProps(filePath, errors) {
  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return;
  }

  const violations = [];
  const hEmptyRe = /h\s*\(\s*['"][^'"]*['"]\s*,\s*['"]["']\s*,/gm;
  let match;
  while ((match = hEmptyRe.exec(content)) !== null) {
    const line = content.slice(0, match.index).split('\n').length;
    violations.push(line);
  }

  if (violations.length > 0) {
    const locs = violations.map((l) => `  ${filePath}:${l}`).join('\n');
    errors.push(
      `h() 第二参数为空字符串（共 ${violations.length} 处）：\n${locs}\n` +
        `  修复: h(type, children) 或 h(type, { style: '...' }, children)\n` +
        `  原因: 空字符串第二参数会创建 props: '' 的 VNode，Vue 3.5 生产模式下父元素为 display:flex 且兄弟节点有正常 props 时触发崩溃。`,
    );
  }
}

/**
 * 校验扩展点 ID 前缀（commands/views/menus 的 id 必须以 "{plugin.id}." 开头）
 */
function checkExtensionPointIds(manifest, errors) {
  const pluginId = manifest.id;
  if (!pluginId || !pluginId.includes('.')) return; // id 校验在其他地方处理
  const prefix = pluginId + '.';

  const contributes = manifest.contributes;
  if (!contributes) return;

  for (const section of ['commands', 'views', 'menus']) {
    const items = contributes[section];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (item.id && !item.id.startsWith(prefix)) {
        errors.push(
          `manifest.json: contributes.${section}[].id "${item.id}" 不以 "${prefix}" 开头`,
        );
      }
    }
  }
}

export function check({ cwd }) {
  const errors = [];

  // 1. 读取 manifest.json
  const manifestPath = resolve(cwd, 'manifest.json');
  if (!existsSync(manifestPath)) {
    errors.push('manifest.json 不存在');
    return errors;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    errors.push('manifest.json 不是合法 JSON: ' + e.message);
    return errors;
  }

  // 2. Schema 校验
  validateSchema(manifest, schema, errors, 'manifest');

  // 3. 扩展点 ID 前缀校验
  checkExtensionPointIds(manifest, errors);

  // 4. main 文件存在
  const mainPath = resolve(cwd, manifest.main || '');
  if (!existsSync(mainPath)) {
    errors.push(`入口文件不存在: ${manifest.main}`);
  }

  // 5. 扫描所有 JS 文件的 prism:* 导入格式
  function scanDir(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = resolve(dir, entry);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          if (entry === 'node_modules' || entry === '.git') continue;
          scanDir(full);
        } else if (entry.endsWith('.js')) {
          checkPrismImports(full, errors);
          checkHEmptyProps(full, errors);
        }
      } catch {
        // skip inaccessible
      }
    }
  }

  scanDir(cwd);

  return errors;
}
