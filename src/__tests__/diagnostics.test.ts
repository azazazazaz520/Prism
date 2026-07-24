import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeError, sanitizeContext } from '../diagnostics/error-normalizer';
import { createLogger, installGlobalDiagnostics } from '../diagnostics/logger';
import { createTraceId, withTrace } from '../diagnostics/trace-context';
import { invokeLogged } from '../diagnostics/invoke-logged';

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

  it('移除 URL 查询参数并限制上下文字符串长度', () => {
    const context = sanitizeContext({
      url: 'https://example.com/api?token=secret',
      description: 'x'.repeat(5000),
    });

    expect(context.url).toBe('https://example.com/api');
    expect(String(context.description).length).toBeLessThanOrEqual(2048);
  });

  it('生成带 tr 前缀的 trace_id', () => {
    expect(createTraceId()).toMatch(/^tr_[0-9a-f-]{36}$/);
  });

  it('withTrace 在异步操作中保留调用方 trace_id', async () => {
    await expect(withTrace('tr_fixed', async () => 'tr_fixed')).resolves.toBe('tr_fixed');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('队列达到八条时批量写入日志', async () => {
    const invokeFn = vi.fn().mockResolvedValue(undefined);
    const logger = createLogger({ invokeFn, windowName: 'main', appVersion: '0.3.3' });

    for (let index = 0; index < 8; index += 1) {
      logger.info('sync', `sync.event_${index}`, '同步事件');
    }
    await logger.flush();

    expect(invokeFn).toHaveBeenCalledWith(
      'append_log_batch',
      expect.objectContaining({
        events: expect.arrayContaining([expect.objectContaining({ level: 'info' })]),
      }),
    );
  });

  it('Tauri 命令失败时记录错误并重新抛出原始异常', async () => {
    const invokeFn = vi.fn().mockRejectedValue(new Error('请求失败'));
    const logInvoke = vi.fn().mockResolvedValue(undefined);
    const logger = createLogger({ invokeFn: logInvoke, windowName: 'main', appVersion: '0.3.3' });

    await expect(
      invokeLogged(logger, invokeFn, 'sync_local_tasks', { remoteTasks: [] }),
    ).rejects.toThrow('请求失败');
    await logger.flush();

    expect(logInvoke).toHaveBeenCalledWith(
      'append_log_batch',
      expect.objectContaining({
        events: expect.arrayContaining([
          expect.objectContaining({ event: 'tauri.command_failed', level: 'error' }),
        ]),
      }),
    );
  });

  it('捕获浏览器级未处理异常并支持移除监听器', () => {
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const cleanup = installGlobalDiagnostics(logger);
    const event = new ErrorEvent('error', {
      message: 'render failed',
      filename: 'app.ts',
      lineno: 10,
      colno: 2,
    });

    window.dispatchEvent(event);
    expect(logger.error).toHaveBeenCalledWith(
      'frontend',
      'frontend.unhandled_error',
      '捕获到未处理的前端异常',
      'render failed',
      expect.objectContaining({ filename: 'app.ts', line: 10, column: 2 }),
      expect.any(String),
    );

    cleanup();
    logger.error.mockClear();
    window.dispatchEvent(event);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
