import { diagnosticsLogger } from '../diagnostics/invoke-logged';
import type { OcrLogger, OcrModule } from './ocr-module';
import { PaddleOcrAdapter, type PaddleOcrEngineFactory } from './paddle-ocr-adapter';
import { UnavailableOcrAdapter } from './unavailable-ocr-adapter';

export type { OcrCapabilities, OcrInput, OcrModule } from './ocr-module';
export { OcrModuleError, type OcrErrorCode } from './errors';
export { normalizePaddleResult } from './result-normalizer';

export interface CreateOcrModuleOptions {
  engineFactory?: PaddleOcrEngineFactory;
  fetchFn?: typeof fetch;
  logger?: OcrLogger;
  timeoutMs?: number;
  runtimeSupported?: () => boolean;
}

/** 根据真实运行能力选择本地识别或不可用 Adapter。 */
export function createOcrModule(options: CreateOcrModuleOptions = {}): OcrModule {
  const supported = options.runtimeSupported
    ? options.runtimeSupported()
    : typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
  if (!supported) return new UnavailableOcrAdapter();
  return new PaddleOcrAdapter({
    engineFactory: options.engineFactory,
    fetchFn: options.fetchFn,
    logger: options.logger || diagnosticsLogger,
    timeoutMs: options.timeoutMs,
  });
}
