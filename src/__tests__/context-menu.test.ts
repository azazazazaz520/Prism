import { describe, expect, it } from 'vitest';
import { useContextMenu } from '../composables/useContextMenu';

describe('useContextMenu', () => {
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
      'clipboard.select-all',
    ]);
  });

  it('空菜单不会打开统一菜单', () => {
    const { visible, openContextMenu } = useContextMenu();

    openContextMenu(new MouseEvent('contextmenu', { clientX: 20, clientY: 20 }), []);

    expect(visible.value).toBe(false);
  });
});
