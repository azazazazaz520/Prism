import { renderMarkdown } from '../composables/useMarkdown';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** 将用户消息的单行文本转换为可安全插入的 HTML：先转义全部特殊字符，再渲染加粗与行内代码。 */
export function formatChatLine(line: string): string {
  return line
    .replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

/** 将助手回复渲染为净化后的 Markdown HTML；标题符号后缺少空格时自动补齐。 */
export function renderAssistantMessage(content: string): string {
  return renderMarkdown(content.replace(/^(#{1,6})(?=[^\s#])/gm, '$1 '), { breaks: true });
}
