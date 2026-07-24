import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { normalizeError, sanitizeContext } from './error-normalizer';
import { createTraceId } from './trace-context';
import type { LogContext, LogEvent, LogLevel } from './types';

const BATCH_SIZE = 8;
const FLUSH_DELAY_MS = 250;
const MAX_PENDING_EVENTS = 32;

export type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface LoggerOptions {
  invokeFn?: InvokeFn;
  windowName?: string;
  appVersion?: string;
  clock?: () => Date;
}

export interface Logger {
  info(module: string, event: string, message: string, context?: unknown, traceId?: string): void;
  warn(module: string, event: string, message: string, context?: unknown, traceId?: string): void;
  error(
    module: string,
    event: string,
    message: string,
    error?: unknown,
    context?: unknown,
    traceId?: string,
  ): void;
  flush(): Promise<void>;
  dispose(): Promise<void>;
}

function resolveWindowName(): string {
  if (typeof window === 'undefined') return 'main';
  return new URLSearchParams(window.location.search).get('window') || 'main';
}

function resolveAppVersion(): string {
  return import.meta.env.VITE_APP_VERSION || 'unknown';
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const invokeFn = options.invokeFn || (tauriInvoke as InvokeFn);
  const windowName = options.windowName || resolveWindowName();
  const appVersion = options.appVersion || resolveAppVersion();
  const clock = options.clock || (() => new Date());
  let pending: LogEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushPromise: Promise<void> | null = null;

  const scheduleFlush = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, FLUSH_DELAY_MS);
  };

  const enqueue = (event: LogEvent) => {
    pending.push(event);
    if (pending.length >= BATCH_SIZE) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      void flush();
    } else {
      scheduleFlush();
    }
  };

  const createEvent = (
    level: LogLevel,
    module: string,
    event: string,
    message: string,
    context: unknown,
    error: unknown,
    traceId?: string,
  ): LogEvent => ({
    timestamp: clock().toISOString(),
    level,
    module,
    event,
    message: String(sanitizeContext({ message }).message),
    trace_id: traceId || createTraceId(),
    window: windowName,
    app_version: appVersion,
    context: sanitizeContext(context || {}),
    ...(error === undefined ? {} : { error: normalizeError(error) }),
  });

  const flush = async (): Promise<void> => {
    if (flushPromise) return flushPromise;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    flushPromise = invokeFn<void>('append_log_batch', { events: batch })
      .catch((error: unknown) => {
        pending = [...batch, ...pending].slice(-MAX_PENDING_EVENTS);
        console.error('[diagnostics] 日志写入失败:', error);
      })
      .finally(() => {
        flushPromise = null;
      });
    return flushPromise;
  };

  return {
    info(module, event, message, context = {}, traceId) {
      enqueue(createEvent('info', module, event, message, context, undefined, traceId));
    },
    warn(module, event, message, context = {}, traceId) {
      enqueue(createEvent('warn', module, event, message, context, undefined, traceId));
    },
    error(module, event, message, error, context = {}, traceId) {
      enqueue(createEvent('error', module, event, message, context, error, traceId));
    },
    flush,
    async dispose() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
    },
  };
}

export function installGlobalDiagnostics(logger: Logger): () => void {
  if (typeof window === 'undefined') return () => {};

  const onError = (event: ErrorEvent) => {
    logger.error(
      'frontend',
      'frontend.unhandled_error',
      '捕获到未处理的前端异常',
      event.error || event.message,
      {
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      },
      createTraceId(),
    );
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    logger.error(
      'frontend',
      'frontend.unhandled_rejection',
      '捕获到未处理的 Promise 异常',
      event.reason,
      {},
      createTraceId(),
    );
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

export function summarizeInvokeArgs(args: unknown): LogContext {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  const source = args as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (/content|apiKey|token|secret|authorization|headers|prompt|response/i.test(key)) continue;
    if (Array.isArray(value)) summary[`${key}_count`] = value.length;
    else if (typeof value === 'string') summary[`${key}_length`] = value.length;
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null)
      summary[key] = value;
  }
  return summary;
}
