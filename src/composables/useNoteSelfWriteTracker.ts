export type NoteSelfWriteToken = number;

const selfWritingPaths = new Map<string, NoteSelfWriteToken>();
let nextToken = 0;

/** 标记当前由 Prism 发起的笔记写入，避免文件监听器将其识别为外部修改。 */
export function beginNoteSelfWrite(path: string): NoteSelfWriteToken {
  const token = ++nextToken;
  selfWritingPaths.set(path, token);
  return token;
}

/** 仅结束对应请求的标记，避免旧请求清除新请求的标记。 */
export function endNoteSelfWrite(path: string, token: NoteSelfWriteToken): void {
  if (selfWritingPaths.get(path) === token) selfWritingPaths.delete(path);
}

export function isNoteSelfWriting(path: string): boolean {
  return selfWritingPaths.has(path);
}
