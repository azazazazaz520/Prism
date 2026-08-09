export interface TabDropRect {
  left: number;
  right: number;
}

export interface TabDropPosition {
  left: number;
  targetIndex: number;
}

/** 根据指针位置计算标签插入指示条位置。 */
export function getTabDropPosition(
  clientX: number,
  tabs: TabDropRect[],
  stripLeft: number,
): TabDropPosition {
  if (tabs.length === 0) return { left: stripLeft, targetIndex: 0 };

  let targetIndex = tabs.length;
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index];
    const midpoint = tab.left + (tab.right - tab.left) / 2;
    if (clientX < midpoint) {
      targetIndex = index;
      break;
    }
  }

  const lastTab = tabs[tabs.length - 1];
  const left =
    targetIndex === 0
      ? tabs[0].left
      : targetIndex === tabs.length
        ? lastTab.right
        : (tabs[targetIndex - 1].right + tabs[targetIndex].left) / 2;
  return {
    left,
    targetIndex,
  };
}
