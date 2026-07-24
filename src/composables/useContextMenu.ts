import { ref } from 'vue';

/** 应用统一右键菜单项 */
export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  separatorBefore?: boolean;
  disabled?: boolean;
  action: () => void | Promise<void>;
}

const visible = ref(false);
const x = ref(0);
const y = ref(0);
const items = ref<ContextMenuItem[]>([]);

function getMenuPosition(event: MouseEvent, itemCount: number): { x: number; y: number } {
  const estimatedHeight = Math.min(itemCount * 36 + 8, 360);
  const estimatedWidth = 240;
  const nextX = Math.min(event.clientX, Math.max(8, window.innerWidth - estimatedWidth - 8));
  const nextY =
    event.clientY + estimatedHeight > window.innerHeight
      ? Math.max(8, event.clientY - estimatedHeight)
      : event.clientY;
  return { x: nextX, y: nextY };
}

/** 打开应用统一右键菜单 */
function openContextMenu(event: MouseEvent, nextItems: ContextMenuItem[]) {
  if (nextItems.length === 0) {
    closeContextMenu();
    return;
  }

  const position = getMenuPosition(event, nextItems.length);
  x.value = position.x;
  y.value = position.y;
  items.value = nextItems;
  visible.value = true;
}

/** 关闭应用统一右键菜单 */
function closeContextMenu() {
  visible.value = false;
  items.value = [];
}

/** 为可编辑目标生成通用剪贴板菜单 */
function createClipboardMenuItems(target: HTMLElement, hasSelection = false): ContextMenuItem[] {
  const isEditable =
    target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
  if (!isEditable) return [];

  const result: ContextMenuItem[] = [];
  if (hasSelection || !!window.getSelection()?.toString()) {
    result.push(
      {
        id: 'clipboard.copy',
        label: '复制',
        action: () => {
          document.execCommand('copy');
        },
      },
      {
        id: 'clipboard.cut',
        label: '剪切',
        action: () => {
          document.execCommand('cut');
        },
      },
    );
  }
  result.push(
    {
      id: 'clipboard.paste',
      label: '粘贴',
      action: () => {
        document.execCommand('paste');
      },
    },
    {
      id: 'clipboard.select-all',
      label: '全选',
      action: () => {
        document.execCommand('selectAll');
      },
    },
  );
  return result;
}

export function useContextMenu() {
  return {
    visible,
    x,
    y,
    items,
    openContextMenu,
    closeContextMenu,
    createClipboardMenuItems,
  };
}
