import { afterEach, describe, expect, it, vi } from 'vitest';
import { useContextMenu } from '../composables/useContextMenu';

describe('useContextMenu', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('非可编辑目标不生成菜单', () => {
    const { createClipboardMenuItems } = useContextMenu();
    const target = document.createElement('div');

    expect(createClipboardMenuItems(target)).toEqual([]);
  });

  it('可编辑目标生成剪贴板菜单，并在有选区时包含复制和剪切', () => {
    const { createClipboardMenuItems } = useContextMenu();
    const target = document.createElement('textarea');

    expect(createClipboardMenuItems(target, true).map((item) => item.id)).toEqual([
      'clipboard.copy',
      'clipboard.cut',
      'clipboard.paste',
      'clipboard.paste-plain',
      'clipboard.select-all',
    ]);
  });

  it('编辑器菜单使用系统剪贴板，并把粘贴内容写回编辑器选区', async () => {
    const clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue('粘贴内容'),
    };
    vi.stubGlobal('navigator', { clipboard });

    let replaced = '';
    const selectAll = vi.fn();
    const editor = {
      getSelection: () => '选中内容',
      replaceSelection: (text: string) => {
        replaced = text;
      },
      selectAll,
      focus: vi.fn(),
    };
    const { createEditorClipboardMenuItems } = useContextMenu();
    const items = createEditorClipboardMenuItems(editor, true);

    await items.find((item) => item.id === 'clipboard.copy')?.action?.();
    await items.find((item) => item.id === 'clipboard.paste')?.action?.();
    items.find((item) => item.id === 'clipboard.select-all')?.action?.();

    expect(clipboard.writeText).toHaveBeenCalledWith('选中内容');
    expect(replaced).toBe('粘贴内容');
    expect(selectAll).toHaveBeenCalledOnce();
  });

  it('空菜单不会打开统一菜单', () => {
    const { visible, openContextMenu } = useContextMenu();

    openContextMenu(new MouseEvent('contextmenu', { clientX: 20, clientY: 20 }), []);

    expect(visible.value).toBe(false);
  });
});
