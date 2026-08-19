/**
 * 插件图标安全渲染工具。
 *
 * 插件沙箱可能声明任意图标节点数据或 SVG 字符串，宿主渲染时必须做白名单
 * 校验与消毒，防止 innerHTML、事件属性、javascript: 链接等进入宿主 DOM
 * （见插件系统审查报告 S-1：插件图标数据直通宿主 DOM 构成主上下文 XSS）。
 */

import DOMPurify from 'dompurify';

// ═══ 结构化图标节点白名单（rail 图标） ═══

/** 允许的 SVG 标签 */
const ALLOWED_TAGS = new Set(['path', 'circle', 'rect']);

/** 允许的属性白名单 */
const ALLOWED_ATTRS = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'x',
  'y',
  'width',
  'height',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'transform',
  'points',
  'fill-rule',
  'clip-rule',
]);

/** 颜色相关属性的值校验（仅允许颜色字面量或本 SVG 内渐变引用） */
const COLOR_VALUE_RE =
  /^(currentColor|none|transparent|#[0-9a-fA-F]{3,8}|rgb\([^)]*\)|rgba\([^)]*\)|hsl\([^)]*\)|hsla\([^)]*\)|url\(#[A-Za-z0-9_-]+\)|[a-zA-Z]+)$/;

/** 数值型属性的值校验（数字或受限单位） */
const LENGTH_VALUE_RE = /^-?\d*\.?\d+(px|em|rem|%)?$/;

/** 几何数据属性的字符集校验（d / transform / points） */
const GEOMETRY_VALUE_RE = /^[0-9a-zA-Z .,\-/()]*$/;

export interface SanitizedIconNode {
  tag: string;
  attrs: Record<string, string | number>;
}

/**
 * 白名单校验插件声明的结构化图标节点。
 * 非白名单标签、危险属性（innerHTML、on* 等）与非法属性值一律丢弃。
 */
export function sanitizeIconNodes(nodes: unknown): SanitizedIconNode[] {
  if (!Array.isArray(nodes)) return [];
  const result: SanitizedIconNode[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const { tag, attrs } = node as { tag?: unknown; attrs?: unknown };
    if (typeof tag !== 'string' || !ALLOWED_TAGS.has(tag)) continue;
    const clean: Record<string, string | number> = {};
    if (attrs && typeof attrs === 'object') {
      for (const [key, value] of Object.entries(attrs as Record<string, unknown>)) {
        if (!ALLOWED_ATTRS.has(key)) continue;
        if (typeof value === 'number') {
          if (Number.isFinite(value)) clean[key] = value;
          continue;
        }
        const text = String(value);
        if (key === 'fill' || key === 'stroke') {
          if (!COLOR_VALUE_RE.test(text)) continue;
        } else if (key === 'opacity') {
          const num = Number(text);
          if (!Number.isFinite(num) || num < 0 || num > 1) continue;
          clean[key] = num;
          continue;
        } else if (key === 'd' || key === 'transform' || key === 'points') {
          if (!GEOMETRY_VALUE_RE.test(text)) continue;
        } else {
          // cx / cy / r / x / y / width / height / stroke-width 等长度属性
          if (!LENGTH_VALUE_RE.test(text)) continue;
        }
        clean[key] = text;
      }
    }
    result.push({ tag, attrs: clean });
  }
  return result;
}

// ═══ SVG 字符串消毒（菜单图标） ═══

/** 菜单图标允许的 SVG 属性 */
const ICON_ALLOWED_ATTRS = [
  'viewBox',
  'd',
  'cx',
  'cy',
  'r',
  'x',
  'y',
  'width',
  'height',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'transform',
  'points',
  'fill-rule',
  'clip-rule',
];

/** 额外禁止的标签（DOMPurify 默认已移除 script/style，此处双保险） */
const ICON_FORBID_TAGS = ['a', 'use', 'animate', 'set', 'foreignObject'];

/**
 * 消毒插件提供的 SVG 图标字符串。
 * 使用 DOMPurify 的 SVG 配置文件并收紧属性白名单；
 * 消毒后仅保留基础图形元素，事件属性与脚本引用会被移除。
 */
export function sanitizeIconMarkup(markup: unknown): string {
  if (typeof markup !== 'string' || markup.trim() === '') return '';
  return DOMPurify.sanitize(markup, {
    USE_PROFILES: { svg: true, svgFilters: false },
    ALLOWED_ATTR: ICON_ALLOWED_ATTRS,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ICON_FORBID_TAGS,
    // SVG 配置文件默认保留 style 属性，显式禁止以避免样式注入
    FORBID_ATTR: ['style'],
  });
}
