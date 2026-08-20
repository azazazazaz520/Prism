import { describe, expect, it } from 'vitest';
import {
  beginNoteSelfWrite,
  completeNoteSelfWrite,
  endNoteSelfWrite,
  isNoteSelfWriting,
  matchesNoteSelfWrite,
  noteContentDigest,
  shouldIgnoreNoteSelfWriteEvent,
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

  it('写入完成后可关联延迟到达的同正文事件', () => {
    const path = `notes/self-write-delayed-${Date.now()}.md`;
    const token = beginNoteSelfWrite(path, { content: '正文' });

    completeNoteSelfWrite(path, token, { mtime: 'mtime-2', content: '正文' });
    endNoteSelfWrite(path, token);

    expect(
      matchesNoteSelfWrite(path, {
        mtime: 'mtime-2',
        contentDigest: noteContentDigest('正文'),
      }),
    ).toBe(true);
    expect(
      matchesNoteSelfWrite(path, {
        mtime: 'mtime-2',
        contentDigest: noteContentDigest('正文'),
      }),
    ).toBe(true);
    expect(isNoteSelfWriting(path)).toBe(false);
  });

  it('版本不匹配时不吞掉可能来自外部的事件', () => {
    const path = `notes/self-write-external-${Date.now()}.md`;
    const token = beginNoteSelfWrite(path, { content: '本地正文' });
    completeNoteSelfWrite(path, token, { mtime: 'mtime-local', content: '本地正文' });
    endNoteSelfWrite(path, token);

    expect(matchesNoteSelfWrite(path, { mtime: 'mtime-external' })).toBe(false);
  });

  it('原子替换产生的 remove 事件仍属于自身写入事件', () => {
    const path = `notes/self-write-remove-${Date.now()}.md`;
    const token = beginNoteSelfWrite(path, { content: '正文' });

    expect(shouldIgnoreNoteSelfWriteEvent(path, 'remove', {})).toBe(true);

    completeNoteSelfWrite(path, token, { mtime: 'mtime-2', content: '正文' });
    endNoteSelfWrite(path, token);

    expect(shouldIgnoreNoteSelfWriteEvent(path, 'remove', {})).toBe(true);
    expect(
      shouldIgnoreNoteSelfWriteEvent(path, 'modify', {
        mtime: 'mtime-external',
        contentDigest: noteContentDigest('外部正文'),
      }),
    ).toBe(false);
  });
});
