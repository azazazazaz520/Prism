import type { Logger } from '../diagnostics/logger';
import type { OcrResult } from '../types';
import type { OcrErrorCode } from './errors';

export interface OcrCapabilities {
  available: boolean;
  mode: 'offline';
  languages: string[];
  modelVersion: string | null;
  reason: OcrErrorCode | null;
}

export interface OcrInput {
  imageBase64: string;
  width: number;
  height: number;
  requestId: string;
}

/** 导入窗口使用的 OCR 模块接口。 */
export interface OcrModule {
  capabilities(): Promise<OcrCapabilities>;
  recognize(input: OcrInput): Promise<OcrResult>;
  dispose(): Promise<void>;
}

export type OcrLogger = Pick<Logger, 'info' | 'warn' | 'error'>;
