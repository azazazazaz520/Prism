export type LogLevel = 'info' | 'warn' | 'error';

export interface NormalizedError {
  name: string;
  message: string;
  stack?: string;
}

export type LogContext = Record<string, unknown>;

export interface LogEvent {
  timestamp: string;
  level: LogLevel;
  module: string;
  event: string;
  message: string;
  trace_id: string;
  window: string;
  app_version: string;
  context: LogContext;
  error?: NormalizedError;
}
