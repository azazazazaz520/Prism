import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { createLogger, summarizeInvokeArgs } from './logger';
import type { Logger, InvokeFn } from './logger';
import { createTraceId } from './trace-context';

export interface InvokeLoggedOptions {
  traceId?: string;
  context?: unknown;
}

export const diagnosticsLogger = createLogger();

export async function invokeLogged<T>(
  logger: Logger,
  invokeFn: InvokeFn,
  command: string,
  args?: Record<string, unknown>,
  options: InvokeLoggedOptions = {},
): Promise<T> {
  const traceId = options.traceId || createTraceId();
  const startedAt = performance.now();
  const extraContext =
    options.context && typeof options.context === 'object' && !Array.isArray(options.context)
      ? options.context
      : {};
  const commandContext = {
    command,
    ...summarizeInvokeArgs(args),
    ...extraContext,
  };
  try {
    const result = await invokeFn<T>(command, args);
    logger.info(
      'tauri',
      'tauri.command_completed',
      `Tauri 命令完成：${command}`,
      {
        ...commandContext,
        duration_ms: Math.round(performance.now() - startedAt),
      },
      traceId,
    );
    return result;
  } catch (error) {
    logger.error(
      'tauri',
      'tauri.command_failed',
      `Tauri 命令失败：${command}`,
      error,
      {
        ...commandContext,
        duration_ms: Math.round(performance.now() - startedAt),
      },
      traceId,
    );
    throw error;
  }
}

export function invokeWithDiagnostics<T>(
  command: string,
  args?: Record<string, unknown>,
  options: InvokeLoggedOptions = {},
): Promise<T> {
  return invokeLogged<T>(diagnosticsLogger, tauriInvoke as InvokeFn, command, args, options);
}
