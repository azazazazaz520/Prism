import type { PluginManifest, PluginPermission } from '../types';

// ═══════════════════════════════════════════════════════════════
//  常量
// ═══════════════════════════════════════════════════════════════

/** 当前 Prism 版本，用于 engines.prism 兼容性检查 */
export const PRISM_VERSION = '0.1.0';

/** 合法权限标识集合 */
const VALID_PERMISSIONS: ReadonlySet<string> = new Set<PluginPermission>([
  'tasks:read',
  'tasks:write',
  'network',
  'network:local',
]);

// ═══════════════════════════════════════════════════════════════
//  校验：字段存在性
// ═══════════════════════════════════════════════════════════════

/**
 * 校验 manifest 对象的结构合法性。
 * 返回 true 表示所有必填字段存在且类型正确。
 */
export function validateManifest(m: unknown): m is PluginManifest {
  if (!m || typeof m !== 'object') return false;

  const obj = m as Record<string, unknown>;

  // 必填字符串字段
  if (typeof obj.id !== 'string' || !obj.id) return false;
  if (typeof obj.name !== 'string' || !obj.name) return false;
  if (typeof obj.version !== 'string' || !obj.version) return false;
  if (typeof obj.author !== 'string' || !obj.author) return false;
  if (typeof obj.main !== 'string' || !obj.main) return false;

  // id 必须含命名空间（至少一个点号）
  if (!obj.id.includes('.')) return false;

  // engines 对象
  if (!obj.engines || typeof obj.engines !== 'object') return false;
  const engines = obj.engines as Record<string, unknown>;
  if (typeof engines.prism !== 'string') return false;

  // permissions 可选，但如果有则必须是 string[]
  if (obj.permissions !== undefined) {
    if (!Array.isArray(obj.permissions)) return false;
    if (
      !(obj.permissions as unknown[]).every(
        (p) => typeof p === 'string' && VALID_PERMISSIONS.has(p),
      )
    )
      return false;
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════
//  校验：版本兼容性
// ═══════════════════════════════════════════════════════════════

/**
 * 检查插件要求的 Prism 版本是否与当前运行版本兼容。
 * MVP 仅支持 `>=x.y.z` 和无前缀（视为 >=）格式。
 */
export function checkEngines(required: string, current: string): boolean {
  if (!required) return true;

  let range = required;
  // 去除 '>=' 前缀
  if (range.startsWith('>=')) {
    range = range.slice(2);
  }

  return compareSemver(current, range) >= 0;
}

/** 简易 semver 比较：返回 <0 / 0 / >0 */
function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa[0] !== pb[0]) return pa[0] - pb[0];
  if (pa[1] !== pb[1]) return pa[1] - pb[1];
  return pa[2] - pb[2];
}

function parseSemver(v: string): [number, number, number] {
  const parts = v.split('.');
  return [
    parseInt(parts[0] || '0', 10) || 0,
    parseInt(parts[1] || '0', 10) || 0,
    parseInt(parts[2] || '0', 10) || 0,
  ];
}

// ═══════════════════════════════════════════════════════════════
//  校验：扩展点 ID 前缀
// ═══════════════════════════════════════════════════════════════

export interface IdValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 校验 manifest 中所有扩展点 ID 是否以 `{pluginId}.` 为前缀。
 * 适用于 commands、views、menus 三种扩展点。
 */
export function validateExtensionPointIds(
  manifest: PluginManifest,
  pluginId: string,
): IdValidationResult {
  const errors: string[] = [];
  const prefix = pluginId + '.';

  const contributes = manifest.contributes;
  if (!contributes) return { valid: true, errors: [] };

  // 校验 commands
  if (contributes.commands) {
    for (const cmd of contributes.commands) {
      if (!cmd.id.startsWith(prefix)) {
        errors.push(`命令 ID "${cmd.id}" 必须以 "${prefix}" 为前缀`);
      }
    }
  }

  // 校验 views
  if (contributes.views) {
    for (const view of contributes.views) {
      if (!view.id.startsWith(prefix)) {
        errors.push(`视图 ID "${view.id}" 必须以 "${prefix}" 为前缀`);
      }
    }
  }

  // 校验 menus
  if (contributes.menus) {
    for (const menu of contributes.menus) {
      if (!menu.id.startsWith(prefix)) {
        errors.push(`菜单 ID "${menu.id}" 必须以 "${prefix}" 为前缀`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
