/**
 * 插件图标消毒工具测试（插件系统审查报告 S-1）。
 */
import { describe, it, expect } from 'vitest';
import { sanitizeIconNodes, sanitizeIconMarkup } from '../utils/plugin-icon';

describe('sanitizeIconNodes', () => {
  it('保留白名单内的基础图形节点与合法属性', () => {
    const nodes = [
      { tag: 'path', attrs: { d: 'M6 3.5h8l4 4V20z', fill: 'none', 'stroke-width': 1.5 } },
      { tag: 'circle', attrs: { cx: 12, cy: 12, r: 4 } },
      { tag: 'rect', attrs: { x: '2', y: '2', width: '20', height: '20', rx: 2 } },
    ];
    const result = sanitizeIconNodes(nodes);
    expect(result).toHaveLength(3);
    expect(result[0].tag).toBe('path');
    expect(result[0].attrs).toEqual({ d: 'M6 3.5h8l4 4V20z', fill: 'none', 'stroke-width': 1.5 });
  });

  it('丢弃危险标签（div、img、script、a）', () => {
    const nodes = [
      { tag: 'div', attrs: { innerHTML: '<img src=x onerror="alert(1)">' } },
      { tag: 'img', attrs: { src: 'x', onerror: 'alert(1)' } },
      { tag: 'script', attrs: {} },
      { tag: 'a', attrs: { href: 'javascript:alert(1)' } },
      { tag: 'path', attrs: { d: 'M0 0' } },
    ];
    const result = sanitizeIconNodes(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].tag).toBe('path');
  });

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

  it('丢弃非法颜色、透明度与几何值', () => {
    const nodes = [
      {
        tag: 'path',
        attrs: {
          d: 'M0 0',
          fill: 'url(javascript:alert(1))',
          stroke: 'expression(alert(1))',
          opacity: '2',
          transform: 'url(#x)',
        },
      },
    ];
    const result = sanitizeIconNodes(nodes);
    expect(result[0].attrs).toEqual({ d: 'M0 0' });
  });

  it('允许本 SVG 内的渐变引用与合法透明度', () => {
    const nodes = [{ tag: 'path', attrs: { d: 'M0 0', fill: 'url(#grad)', opacity: 0.5 } }];
    const result = sanitizeIconNodes(nodes);
    expect(result[0].attrs).toEqual({ d: 'M0 0', fill: 'url(#grad)', opacity: 0.5 });
  });

  it('非数组输入返回空数组', () => {
    expect(sanitizeIconNodes(undefined)).toEqual([]);
    expect(sanitizeIconNodes(null)).toEqual([]);
    expect(sanitizeIconNodes('path')).toEqual([]);
  });
});

describe('sanitizeIconMarkup', () => {
  it('保留合法 SVG 图形', () => {
    const markup = '<svg viewBox="0 0 24 24"><path d="M6 3.5h8l4 4V20z"/></svg>';
    const result = sanitizeIconMarkup(markup);
    expect(result).toContain('<path');
    expect(result).toContain('d="M6 3.5h8l4 4V20z"');
  });

  it('移除 script 标签', () => {
    const markup = '<svg><script>alert(1)</script><path d="M0 0"/></svg>';
    const result = sanitizeIconMarkup(markup);
    expect(result).not.toContain('script');
    expect(result).toContain('<path');
  });

  it('移除事件属性与 javascript: 链接', () => {
    const markup =
      '<svg><path d="M0 0" onload="alert(1)"/><a href="javascript:alert(1)"><path d="M1 1"/></a></svg>';
    const result = sanitizeIconMarkup(markup);
    expect(result).not.toContain('onload');
    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('<a');
  });

  it('移除 style 属性与 data 属性', () => {
    const markup = '<svg><path d="M0 0" style="position:fixed" data-x="1"/></svg>';
    const result = sanitizeIconMarkup(markup);
    expect(result).not.toContain('style=');
    expect(result).not.toContain('data-x');
  });

  it('空值与非字符串返回空字符串', () => {
    expect(sanitizeIconMarkup('')).toBe('');
    expect(sanitizeIconMarkup(undefined)).toBe('');
    expect(sanitizeIconMarkup(null)).toBe('');
    expect(sanitizeIconMarkup(42)).toBe('');
  });
});
