/**
 * 安全的 Markdown → HTML 渲染工具。
 *
 * 先由 marked 解析 Markdown 原始文本，再由 DOMPurify 按标签白名单深度净化
 * 输出，防御 XSS 攻击（script 标签、事件处理器、javascript: 链接等）。
 * 净化放在 marked 之后而非之前，避免破坏 Markdown 语法（如自动链接
 * `<url>`、代码块中的 HTML 示例等）。
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/** 安全渲染 Markdown 文本为净化后的 HTML */
export function renderMarkdown(text: string, options?: { breaks?: boolean }): string {
  const raw = marked.parse(text, options) as string;
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
