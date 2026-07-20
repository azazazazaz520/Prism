/**
 * 安全的 Markdown → HTML 渲染工具。
 *
 * 对 marked 输出做 DOMPurify 深度净化，防御 XSS 攻击（javascript: 链接、
 * 事件处理器、嵌入脚本等）。调用方可通过 v-html 安全渲染结果。
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/** 剥离原始 HTML 标签，防止 HTML 注入混入 Markdown */
export function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

/** 安全渲染 Markdown 文本为净化后的 HTML */
export function renderMarkdown(text: string, options?: { breaks?: boolean }): string {
  const withoutTags = stripHtml(text);
  const raw = marked.parse(withoutTags, options) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'hr',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'em',
      'strong',
      'del',
      'a',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'img',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
  });
}
