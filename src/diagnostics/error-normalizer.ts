import type { NormalizedError } from './types';

const REDACTED = '[REDACTED]';
const TRUNCATED = '[TRUNCATED]';
const UNSERIALIZABLE = '[UNSERIALIZABLE]';
const MAX_DEPTH = 5;
const MAX_STRING_LENGTH = 2048;
const SENSITIVE_KEY =
  /key|token|secret|authorization|password|content|prompt|response|headers|cookie|credential/i;

function truncateString(value: string): string {
  return value.length <= MAX_STRING_LENGTH ? value : value.slice(0, MAX_STRING_LENGTH);
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!url.protocol || !url.host) return truncateString(value);
    url.search = '';
    url.hash = '';
    return truncateString(url.toString());
  } catch {
    return truncateString(value);
  }
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return TRUNCATED;
  if (typeof value === 'string') {
    return value.includes('://') ? sanitizeUrl(value) : truncateString(value);
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const items = value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1));
    return value.length > 100 ? [...items, TRUNCATED] : items;
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitizeValue(item, depth + 1);
    }
    return result;
  }
  return UNSERIALIZABLE;
}

export function sanitizeContext(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeValue(value, 0);
  if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>;
  }
  return { value: sanitized };
}

export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: truncateString(error.message || String(error)),
      ...(error.stack ? { stack: truncateString(error.stack) } : {}),
    };
  }
  if (typeof error === 'string') {
    return { name: 'Error', message: truncateString(error) };
  }
  if (error && typeof error === 'object') {
    const candidate = error as { name?: unknown; message?: unknown; stack?: unknown };
    return {
      name: typeof candidate.name === 'string' ? truncateString(candidate.name) : 'Error',
      message:
        typeof candidate.message === 'string' ? truncateString(candidate.message) : '未知异常对象',
      ...(typeof candidate.stack === 'string' ? { stack: truncateString(candidate.stack) } : {}),
    };
  }
  return { name: 'Error', message: error == null ? '未知异常' : truncateString(String(error)) };
}
