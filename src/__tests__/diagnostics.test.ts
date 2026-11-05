import { describe, expect, it } from 'vitest';
import { normalizeError, sanitizeContext } from '../diagnostics/error-normalizer';

describe('诊断日志基础能力', () => {
  it('标准化未知异常并递归脱敏敏感字段', () => {
    const error = normalizeError({ message: 'failed', apiKey: 'secret' });

    expect(error.message).toBe('failed');
    expect(sanitizeContext({ apiKey: 'secret', nested: { token: 'abc' } })).toEqual({
      apiKey: '[REDACTED]',
      nested: { token: '[REDACTED]' },
    });
    expect(
      sanitizeContext({ prompt: 'private prompt', headers: { Authorization: 'secret' } }),
    ).toEqual({
      prompt: '[REDACTED]',
      headers: '[REDACTED]',
    });
  });
});
