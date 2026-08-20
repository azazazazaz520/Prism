export type NoteSelfWriteToken = number;

export interface NoteSelfWriteOptions {
  content?: string;
  expectedMtime?: string | null;
  ttlMs?: number;
}

export interface NoteSelfWriteCompletion {
  mtime: string;
  content: string;
  ttlMs?: number;
}

export interface NoteSelfWriteEventVersion {
  mtime?: string | null;
  contentDigest?: string | null;
}

export type NoteSelfWriteEventKind = 'create' | 'modify' | 'remove' | 'rename' | string;

interface SelfWriteEntry {
  token: NoteSelfWriteToken;
  contentDigest: string | null;
  expectedMtime: string | null;
  settled: boolean;
  matched: boolean;
  expiresAt: number;
}

const selfWritingPaths = new Map<string, SelfWriteEntry>();
const DEFAULT_TTL_MS = 10000;
let nextToken = 0;

/** 使用与 Rust 文件监听器一致的 FNV-1a 算法生成轻量内容指纹。 */
export function noteContentDigest(content: string): string {
  let hash = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(content);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function pruneExpired(path?: string) {
  const now = Date.now();
  if (path) {
    const entry = selfWritingPaths.get(path);
    if (entry && entry.settled && entry.expiresAt <= now) selfWritingPaths.delete(path);
    return;
  }
  for (const [entryPath, entry] of selfWritingPaths) {
    if (entry.settled && entry.expiresAt <= now) selfWritingPaths.delete(entryPath);
  }
}

/** 标记当前由 Prism 发起的笔记写入，等待命令返回后登记最终文件版本。 */
export function beginNoteSelfWrite(
  path: string,
  options: NoteSelfWriteOptions = {},
): NoteSelfWriteToken {
  pruneExpired(path);
  const token = ++nextToken;
  selfWritingPaths.set(path, {
    token,
    contentDigest: options.content === undefined ? null : noteContentDigest(options.content),
    expectedMtime: options.expectedMtime ?? null,
    settled: false,
    matched: false,
    expiresAt: Number.POSITIVE_INFINITY,
  });
  return token;
}

/** 写入命令成功返回新版本后补充修改时间，并保留短暂窗口关联延迟监听事件。 */
export function completeNoteSelfWrite(
  path: string,
  token: NoteSelfWriteToken,
  completion: NoteSelfWriteCompletion,
): void {
  const entry = selfWritingPaths.get(path);
  if (!entry || entry.token !== token) return;
  entry.contentDigest = noteContentDigest(completion.content);
  entry.expectedMtime = completion.mtime;
  entry.settled = true;
  entry.matched = false;
  entry.expiresAt = Date.now() + (completion.ttlMs ?? DEFAULT_TTL_MS);
}

/** 仅结束对应请求的标记，避免旧请求清除新请求或清除延迟到达的事件关联。 */
export function endNoteSelfWrite(path: string, token: NoteSelfWriteToken): void {
  const entry = selfWritingPaths.get(path);
  if (!entry || entry.token !== token) return;
  if (entry.settled) pruneExpired(path);
  else selfWritingPaths.delete(path);
}

/** 根据监听器携带的版本信息判断事件是否由本地写入产生。 */
export function matchesNoteSelfWrite(path: string, version: NoteSelfWriteEventVersion): boolean {
  pruneExpired(path);
  const entry = selfWritingPaths.get(path);
  if (!entry) return false;

  const versionMatches =
    entry.settled &&
    Boolean(version.contentDigest) &&
    Boolean(entry.contentDigest) &&
    version.contentDigest === entry.contentDigest &&
    Boolean(version.mtime) &&
    Boolean(entry.expectedMtime) &&
    version.mtime === entry.expectedMtime;
  if (!versionMatches) return false;

  entry.matched = true;
  return true;
}

/**
 * 判断文件监听事件是否属于当前自身写入。
 *
 * 写入命令尚未返回时无法取得最终 mtime，必须沿用路径级保护；
 * 命令返回后仅放行可核对版本的事件，但原子替换产生的 remove 事件没有版本信息，
 * 仍需在短暂关联窗口内视为自身事件。
 */
export function shouldIgnoreNoteSelfWriteEvent(
  path: string,
  kind: NoteSelfWriteEventKind,
  version: NoteSelfWriteEventVersion,
): boolean {
  pruneExpired(path);
  const entry = selfWritingPaths.get(path);
  if (!entry) return false;
  if (!entry.settled) return true;
  if (kind === 'remove') return !entry.matched;
  return matchesNoteSelfWrite(path, version);
}

export function isNoteSelfWriting(path: string): boolean {
  pruneExpired(path);
  return selfWritingPaths.get(path)?.matched === false;
}
