import { describe, expect, it } from 'vitest';
import { getTabDropPosition } from '../components/notes/tab-drop-indicator';

describe('标签拖拽插入位置', () => {
  it('指针位于两个标签的间隙时，指示条稳定落在两个标签之间', () => {
    const result = getTabDropPosition(
      132,
      [
        { left: 20, right: 128 },
        { left: 136, right: 244 },
      ],
      12,
    );

    expect(result).toEqual({ left: 132, targetIndex: 1 });
  });
});
