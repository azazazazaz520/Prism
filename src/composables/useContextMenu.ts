import { ref } from 'vue';

/** 应用统一右键菜单项 */
export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  separatorBefore?: boolean;
  disabled?: boolean;
  submenu?: ContextMenuItem[];
  action?: () => void | Promise<void>;
}

export interface ContextMenuEditorTarget {
  getSelection: () => string;
  replaceSelection: (text: string) => void;
  selectAll: () => void;
  focus: () => void;
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
async function writeClipboardText(text: string) {
  if (!navigator.clipboard?.writeText) return false;
  await navigator.clipboard.writeText(text);
  return true;
}

async function readClipboardText() {
  if (!navigator.clipboard?.readText) return null;
  return navigator.clipboard.readText();
}

function getTargetSelection(target: HTMLElement) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const value = target.value;
    const start = target.selectionStart ?? value.length;
    const end = target.selectionEnd ?? start;
    return { text: value.slice(start, end), start, end };
  }

  const selection = window.getSelection();
  return { text: selection?.toString() ?? '', start: 0, end: 0 };
}

function replaceTargetSelection(target: HTMLElement, text: string) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const value = target.value;
    const start = target.selectionStart ?? value.length;
    const end = target.selectionEnd ?? start;
    target.setRangeText(text, start, end, 'end');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.focus();
    return;
  }

  document.execCommand('insertText', false, text);
  target.focus();
}

/** 为可编辑目标生成通用剪贴板菜单 */
function createClipboardMenuItems(target: HTMLElement, hasSelection = false): ContextMenuItem[] {
  const isEditable =
    target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
  if (!isEditable) return [];

  const selection = getTargetSelection(target);
  const selected = hasSelection || Boolean(selection.text);
  const result: ContextMenuItem[] = [];
  if (selected) {
    result.push(
      {
        id: 'clipboard.copy',
        label: '复制',
        action: async () => {
          await writeClipboardText(selection.text);
        },
      },
      {
        id: 'clipboard.cut',
        label: '剪切',
        action: async () => {
          if (await writeClipboardText(selection.text)) {
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
              target.setRangeText('', selection.start, selection.end, 'start');
              target.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
              document.execCommand('delete');
            }
            target.focus();
          }
        },
      },
    );
  }
  result.push(
    {
      id: 'clipboard.paste',
      label: '粘贴',
      action: async () => {
        const text = await readClipboardText();
        if (text !== null) replaceTargetSelection(target, text);
      },
    },
    {
      id: 'clipboard.paste-plain',
      label: '以纯文本形式粘贴',
      action: async () => {
        const text = await readClipboardText();
        if (text !== null) replaceTargetSelection(target, text);
      },
    },
    {
      id: 'clipboard.select-all',
      label: '全选',
      action: () => {
        target.focus();
        document.execCommand('selectAll');
      },
    },
  );
  return result;
}

/** 为 Markdown 编辑器生成不依赖 execCommand 剪贴板菜单。 */
function createEditorClipboardMenuItems(
  editor: ContextMenuEditorTarget,
  hasSelection = Boolean(editor.getSelection()),
): ContextMenuItem[] {
  const selectedText = editor.getSelection();
  const result: ContextMenuItem[] = [];

  if (hasSelection || selectedText) {
    result.push(
      {
        id: 'clipboard.cut',
        label: '剪切',
        disabled: !selectedText,
        action: async () => {
          if (await writeClipboardText(selectedText)) editor.replaceSelection('');
          editor.focus();
        },
      },
      {
        id: 'clipboard.copy',
        label: '复制',
        disabled: !selectedText,
        action: async () => {
          await writeClipboardText(selectedText);
          editor.focus();
        },
      },
    );
  } else {
    result.push(
      { id: 'clipboard.cut', label: '剪切', disabled: true },
      { id: 'clipboard.copy', label: '复制', disabled: true },
    );
  }

  result.push(
    {
      id: 'clipboard.paste',
      label: '粘贴',
      disabled: !navigator.clipboard?.readText,
      action: async () => {
        const text = await readClipboardText();
        if (text !== null) editor.replaceSelection(text);
        editor.focus();
      },
    },
    {
      id: 'clipboard.paste-plain',
      label: '以纯文本形式粘贴',
      disabled: !navigator.clipboard?.readText,
      action: async () => {
        const text = await readClipboardText();
        if (text !== null) editor.replaceSelection(text);
        editor.focus();
      },
    },
    {
      id: 'clipboard.select-all',
      label: '全选',
      action: () => editor.selectAll(),
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
    createEditorClipboardMenuItems,
  };
}
