export type OcrErrorCode =
  | 'INVALID_IMAGE'
  | 'MODEL_ASSET_MISSING'
  | 'MODEL_INIT_FAILED'
  | 'UNSUPPORTED_RUNTIME'
  | 'RECOGNITION_TIMEOUT'
  | 'RECOGNITION_FAILED'
  | 'CANCELLED';

/** OCR 模块对调用方公开的结构化错误。 */
export class OcrModuleError extends Error {
  public readonly cause?: unknown;

  constructor(
    public readonly code: OcrErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'OcrModuleError';
    this.cause = cause;
  }
}
