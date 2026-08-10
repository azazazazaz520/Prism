import { describe, expect, it } from 'vitest';
import {
  beginNoteSelfWrite,
  endNoteSelfWrite,
  isNoteSelfWriting,
} from '../composables/useNoteSelfWriteTracker';

describe('笔记自身写入标识', () => {
  it('保存期间识别同路径监听事件，结束后解除标识', () => {
    const path = `notes/self-write-${Date.now()}.md`;
    const token = beginNoteSelfWrite(path);

    expect(isNoteSelfWriting(path)).toBe(true);

    endNoteSelfWrite(path, token);

    expect(isNoteSelfWriting(path)).toBe(false);
  });

  it('旧请求不能清除后续请求的标识', () => {
    const path = `notes/self-write-${Date.now()}.md`;
    const oldToken = beginNoteSelfWrite(path);
    const newToken = beginNoteSelfWrite(path);

    endNoteSelfWrite(path, oldToken);

    expect(isNoteSelfWriting(path)).toBe(true);
    endNoteSelfWrite(path, newToken);
    expect(isNoteSelfWriting(path)).toBe(false);
  });
});
