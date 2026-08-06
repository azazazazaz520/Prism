import type { ContextMenuItem } from '../../composables/useContextMenu';

// ═══ 编辑器操作接口 ═══

/** 编辑器操作接口（由 NoteWorkspaceBoard 代理到当前活动叶子） */
export interface EditorActions {
  getSelection: () => string;
  replaceSelection: (value: string) => void;
  selectAll: () => void;
  wrapSelection: (before: string, after: string) => void;
  prependToLine: (prefix: string) => void;
  insertText: (value: string) => void;
}

// ═══ 菜单图标 ═══

const menuIcon = (body: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><g>${body}</g></svg>`;

const editorMenuIcons = {
  link: menuIcon(
    '<path d="M8.5 13.5 6.8 15.2a3.4 3.4 0 0 0 4.8 4.8l2.3-2.3"/><path d="m15.5 10.5 1.7-1.7a3.4 3.4 0 0 0-4.8-4.8l-2.3 2.3"/><path d="m9.5 14.5 5-5"/>',
  ),
  externalLink: menuIcon(
    '<path d="M14 5h5v5"/><path d="m19 5-8 8"/><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  ),
  format: menuIcon('<path d="m5 16 10-10 3 3L8 19H5z"/><path d="m14 7 3 3"/><path d="M4 21h8"/>'),
  paragraph: menuIcon('<path d="M6 5h8a4 4 0 0 1 0 8h-3"/><path d="M11 13v6"/><path d="M8 19h6"/>'),
  insert: menuIcon('<path d="M4 6h10M4 12h10M4 18h6"/><path d="M18 11v8M14 15h8"/>'),
  scissors: menuIcon(
    '<circle cx="6" cy="7" r="2"/><circle cx="6" cy="17" r="2"/><path d="m8 8 10 8M8 16 18 8"/>',
  ),
  copy: menuIcon(
    '<rect x="8" y="8" width="11" height="12" rx="1"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h3"/>',
  ),
  paste: menuIcon(
    '<path d="M8 5h8a2 2 0 0 1 2 2v13H6V7a2 2 0 0 1 2-2Z"/><path d="M9 3h6v4H9z"/><path d="M9 12h6M9 16h4"/>',
  ),
  plainPaste: menuIcon(
    '<path d="M8 5h8a2 2 0 0 1 2 2v13H6V7a2 2 0 0 1 2-2Z"/><path d="M9 3h6v4H9z"/><path d="M9 12h6"/><path d="M9 16h6"/>',
  ),
  selectAll: menuIcon(
    '<rect x="6" y="6" width="12" height="12" stroke-dasharray="2 2"/><path d="M9 3h6M9 21h6M3 9v6M21 9v6"/>',
  ),
};

// ═══ 菜单项构造 ═══

/** 文本格式子菜单 */
export function createFormatMenuItems(editor: EditorActions, text: string): ContextMenuItem[] {
  return [
    {
      id: 'editor-format.bold',
      label: '加粗',
      icon: menuIcon(
        '<path d="M8 5h4.5a3 3 0 0 1 0 6H8zM8 11h5a3 3 0 0 1 0 6H8z"/><path d="M8 5v12"/>',
      ),
      action: () => editor.wrapSelection('**', '**'),
    },
    {
      id: 'editor-format.italic',
      label: '倾斜',
      icon: menuIcon('<path d="M10 5h8M6 19h8M14 5 10 19"/>'),
      action: () => editor.wrapSelection('_', '_'),
    },
    {
      id: 'editor-format.strikethrough',
      label: '删除线',
      icon: menuIcon('<path d="M5 12h14M8 8a3 3 0 0 1 5.5-1.5M16 16a3 3 0 0 1-5.5 1.5"/>'),
      action: () => editor.wrapSelection('~~', '~~'),
    },
    {
      id: 'editor-format.highlight',
      label: '高亮',
      icon: menuIcon('<path d="m5 16 9-9 4 4-9 9H5zM13 8l3 3M4 20h12"/>'),
      action: () => editor.wrapSelection('==', '=='),
    },
    {
      id: 'editor-format.inline-code',
      label: '代码',
      separatorBefore: true,
      icon: menuIcon('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>'),
      action: () => editor.wrapSelection('`', '`'),
    },
    {
      id: 'editor-format.math',
      label: '数学',
      icon: menuIcon('<path d="M6 5h12M6 19h12M8 5l8 14M16 5l-8 14"/>'),
      action: () => editor.wrapSelection('$', '$'),
    },
    {
      id: 'editor-format.comment',
      label: '注释',
      icon: menuIcon('<path d="M5 6h14v10H9l-4 3z"/><path d="M8 10h8M8 13h5"/>'),
      action: () => editor.wrapSelection('<!-- ', ' -->'),
    },
    {
      id: 'editor-format.clear',
      label: '清除格式',
      separatorBefore: true,
      icon: menuIcon('<path d="m5 16 7-7 7 7-3 3H8zM4 20h16"/>'),
      disabled: !text,
      action: () =>
        editor.replaceSelection(
          text.replace(/(^|\s)([#>*-]+\s|\d+\.\s)|([*_~`=$]|<!--|-->)/g, '$1'),
        ),
    },
  ];
}

/** 段落设置子菜单 */
export function createParagraphMenuItems(editor: EditorActions): ContextMenuItem[] {
  return [
    {
      id: 'editor-paragraph.heading-1',
      label: '一级标题',
      action: () => editor.prependToLine('# '),
    },
    {
      id: 'editor-paragraph.heading-2',
      label: '二级标题',
      action: () => editor.prependToLine('## '),
    },
    {
      id: 'editor-paragraph.heading-3',
      label: '三级标题',
      action: () => editor.prependToLine('### '),
    },
    {
      id: 'editor-paragraph.bullet-list',
      label: '无序列表',
      separatorBefore: true,
      action: () => editor.prependToLine('- '),
    },
    {
      id: 'editor-paragraph.ordered-list',
      label: '有序列表',
      action: () => editor.prependToLine('1. '),
    },
    {
      id: 'editor-paragraph.blockquote',
      label: '引用块',
      action: () => editor.prependToLine('> '),
    },
  ];
}

/** 插入子菜单 */
export function createInsertMenuItems(editor: EditorActions, text: string): ContextMenuItem[] {
  return [
    {
      id: 'editor-insert.link',
      label: '链接',
      action: () => (text ? editor.wrapSelection('[', '](url)') : editor.insertText('[文字](url)')),
    },
    {
      id: 'editor-insert.image',
      label: '图片',
      action: () => editor.insertText('![替代文字](图片地址)'),
    },
    {
      id: 'editor-insert.rule',
      label: '分隔线',
      action: () => editor.insertText('\n---\n'),
    },
    {
      id: 'editor-insert.code-block',
      label: '代码块',
      separatorBefore: true,
      action: () => editor.insertText('```\n\n```'),
    },
  ];
}

/** 剪贴板菜单项图标映射 */
export function withClipboardIcons(clipboardItems: ContextMenuItem[]): ContextMenuItem[] {
  return clipboardItems.map((item, index) => ({
    ...item,
    separatorBefore: index === 0,
    icon:
      item.id === 'clipboard.cut'
        ? editorMenuIcons.scissors
        : item.id === 'clipboard.copy'
          ? editorMenuIcons.copy
          : item.id === 'clipboard.paste'
            ? editorMenuIcons.paste
            : item.id === 'clipboard.paste-plain'
              ? editorMenuIcons.plainPaste
              : editorMenuIcons.selectAll,
  }));
}

/** 组装编辑器主菜单（格式/段落/插入/剪贴板分组） */
export function createEditorMenuItems(
  editor: EditorActions,
  text: string,
  clipboardItems: ContextMenuItem[],
): ContextMenuItem[] {
  const formatItems = createFormatMenuItems(editor, text);
  const paragraphItems = createParagraphMenuItems(editor);
  const insertItems = createInsertMenuItems(editor, text);

  return [
    {
      id: 'editor-insert.link-new',
      label: '新增链接',
      icon: editorMenuIcons.link,
      action: () =>
        text ? editor.wrapSelection('[', '](链接地址)') : editor.insertText('[文字](链接地址)'),
    },
    {
      id: 'editor-insert.external-link',
      label: '新增外部链接',
      icon: editorMenuIcons.externalLink,
      action: () =>
        text ? editor.wrapSelection('[', '](https://)') : editor.insertText('[文字](https://)'),
    },
    {
      id: 'editor-format.menu',
      label: '文本格式',
      icon: editorMenuIcons.format,
      separatorBefore: true,
      submenu: formatItems,
    },
    {
      id: 'editor-paragraph.menu',
      label: '段落设置',
      icon: editorMenuIcons.paragraph,
      submenu: paragraphItems,
    },
    {
      id: 'editor-insert.menu',
      label: '插入',
      icon: editorMenuIcons.insert,
      submenu: insertItems,
    },
    ...withClipboardIcons(clipboardItems),
  ];
}
