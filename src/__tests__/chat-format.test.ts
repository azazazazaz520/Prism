import { describe, expect, it } from 'vitest';
import { formatChatLine, renderAssistantMessage } from '../utils/chat-format';

describe('聊天消息格式化', () => {
  it('渲染加粗与行内代码', () => {
    expect(formatChatLine('先做 **重要** 的 `task`')).toBe(
      '先做 <strong>重要</strong> 的 <code>task</code>',
    );
  });

  it('转义 HTML 标签与事件属性，不生成可执行元素', () => {
    const html = formatChatLine('<img src=x onerror="alert(1)"> **<b>x</b>**');

    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror="');
    expect(html).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; <strong>&lt;b&gt;x&lt;/b&gt;</strong>',
    );
  });

  it('转义单引号与 & 符号', () => {
    expect(formatChatLine("a & 'b'")).toBe('a &amp; &#39;b&#39;');
  });
});

describe('助手回复 Markdown 渲染', () => {
  it('渲染标题、列表与加粗', () => {
    const html = renderAssistantMessage('## 排序\n- **先做**');

    expect(html).toContain('<h2');
    expect(html).toContain('<li>');
    expect(html).toContain('<strong>先做</strong>');
  });

  it('补齐标题符号后缺失的空格', () => {
    expect(renderAssistantMessage('##先说明')).toContain('<h2');
  });

  it('净化回复中的脚本与事件属性', () => {
    const html = renderAssistantMessage('<img src=x onerror="alert(1)">');

    expect(html).not.toContain('onerror');
  });
});
