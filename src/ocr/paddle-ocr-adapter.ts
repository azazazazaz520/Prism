import type { OcrResult as PaddleResult, PaddleOCR } from '@paddleocr/paddleocr-js';
import type { OcrResult } from '../types';
import { OcrModuleError } from './errors';
import type { OcrCapabilities, OcrInput, OcrLogger, OcrModule } from './ocr-module';
import { normalizePaddleResult } from './result-normalizer';

const RECOGNITION_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

export type PaddleOcrEngine = Awaited<ReturnType<typeof PaddleOCR.create>>;
export type PaddleOcrEngineFactory = () => Promise<PaddleOcrEngine>;

export interface PaddleOcrAdapterOptions {
  engineFactory?: PaddleOcrEngineFactory;
  fetchFn?: typeof fetch;
  logger?: OcrLogger;
  timeoutMs?: number;
}

interface OcrManifest {
  model_version?: unknown;
  languages?: unknown;
}

interface DecodedImage {
  blob: Blob;
  byteLength: number;
}

function applicationUrl(path: string): string {
  return new URL(path, window.location.href).toString();
}

async function createDefaultEngine(): Promise<PaddleOcrEngine> {
  const { PaddleOCR } = await import('@paddleocr/paddleocr-js');
  return PaddleOCR.create({
    initialize: true,
    worker: true,
    unsupportedBehavior: 'error',
    textDetectionModelName: 'PP-OCRv6_small_det',
    textDetectionModelAsset: {
      url: applicationUrl('/ocr/models/PP-OCRv6_small_det_onnx_infer.tar'),
    },
    textRecognitionModelName: 'PP-OCRv6_small_rec',
    textRecognitionModelAsset: {
      url: applicationUrl('/ocr/models/PP-OCRv6_small_rec_onnx_infer.tar'),
    },
    ortOptions: {
      backend: 'wasm',
      wasmPaths: applicationUrl('/ocr/runtime/'),
      numThreads: 1,
      simd: true,
      proxy: false,
    },
  });
}

function decodeBase64Image(value: string): DecodedImage {
  const encoded = value.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
  if (!encoded) throw new OcrModuleError('INVALID_IMAGE', 'OCR 输入图片为空。');
  try {
    const binary = atob(encoded);
    if (binary.length > MAX_IMAGE_BYTES) {
      throw new OcrModuleError('INVALID_IMAGE', '截图过大，请缩小选区后重试。');
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (
      bytes.length < 8 ||
      bytes[0] !== 0x89 ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x4e ||
      bytes[3] !== 0x47
    ) {
      throw new OcrModuleError('INVALID_IMAGE', 'OCR 输入不是有效的 PNG 截图。');
    }
    return { blob: new Blob([bytes], { type: 'image/png' }), byteLength: bytes.byteLength };
  } catch (error) {
    if (error instanceof OcrModuleError) throw error;
    throw new OcrModuleError('INVALID_IMAGE', 'OCR 输入图片编码无效。', error);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new OcrModuleError('RECOGNITION_TIMEOUT', '离线文字识别超时。'));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** 使用 SDK 自带 Worker 执行本地 OCR，并集中管理模型与错误。 */
export class PaddleOcrAdapter implements OcrModule {
  private enginePromise: Promise<PaddleOcrEngine> | null = null;
  private capabilitiesPromise: Promise<OcrCapabilities> | null = null;
  private recognitionQueue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(private readonly options: PaddleOcrAdapterOptions) {}

  capabilities(): Promise<OcrCapabilities> {
    if (!this.capabilitiesPromise) this.capabilitiesPromise = this.checkCapabilities();
    return this.capabilitiesPromise;
  }

  async recognize(input: OcrInput): Promise<OcrResult> {
    const run = this.recognitionQueue.then(() => this.recognizeOnce(input));
    this.recognitionQueue = run.catch(() => undefined);
    return run;
  }

  private async recognizeOnce(input: OcrInput): Promise<OcrResult> {
    if (this.disposed) throw new OcrModuleError('CANCELLED', 'OCR 模块已经释放。');
    const capabilities = await this.capabilities();
    if (!capabilities.available) {
      throw new OcrModuleError(
        capabilities.reason || 'UNSUPPORTED_RUNTIME',
        '离线文字识别资源不可用。',
      );
    }

    const image = decodeBase64Image(input.imageBase64);
    const startedAt = performance.now();
    this.options.logger?.info('ocr', 'ocr.recognition_started', '开始离线文字识别', {
      request_id: input.requestId,
      image_width: input.width,
      image_height: input.height,
      image_bytes: image.byteLength,
      provider: 'paddleocr-web',
      model_version: capabilities.modelVersion,
    });

    try {
      const engine = await this.getEngine();
      const results = (await withTimeout(
        engine.predict(image.blob),
        this.options.timeoutMs || RECOGNITION_TIMEOUT_MS,
      )) as PaddleResult[];
      const result = results[0];
      if (!result) throw new OcrModuleError('RECOGNITION_FAILED', 'OCR 引擎返回空结果。');
      const normalized = normalizePaddleResult(
        result,
        engine.getInitializationSummary()?.elapsedMs,
      );
      this.options.logger?.info('ocr', 'ocr.recognition_completed', '离线文字识别完成', {
        request_id: input.requestId,
        duration_ms: Math.round(performance.now() - startedAt),
        line_count: normalized.lines.length,
        confidence: normalized.confidence,
        provider: normalized.provider,
        runtime: normalized.metrics?.runtime,
      });
      return normalized;
    } catch (error) {
      const normalized =
        error instanceof OcrModuleError
          ? error
          : new OcrModuleError(
              this.enginePromise ? 'RECOGNITION_FAILED' : 'MODEL_INIT_FAILED',
              '离线文字识别失败。',
              error,
            );
      this.options.logger?.error('ocr', 'ocr.recognition_failed', '离线文字识别失败', normalized, {
        request_id: input.requestId,
        duration_ms: Math.round(performance.now() - startedAt),
        image_width: input.width,
        image_height: input.height,
        error_code: normalized.code,
      });
      throw normalized;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.enginePromise) return;
    try {
      const engine = await this.enginePromise;
      await engine.dispose();
    } finally {
      this.enginePromise = null;
      this.options.logger?.info('ocr', 'ocr.worker_disposed', '离线识别 Worker 已释放');
    }
  }

  private getEngine(): Promise<PaddleOcrEngine> {
    if (!this.enginePromise) {
      const startedAt = performance.now();
      this.enginePromise = (this.options.engineFactory || createDefaultEngine)()
        .then((engine) => {
          const summary = engine.getInitializationSummary();
          this.options.logger?.info('ocr', 'ocr.model_initialized', '离线识别模型加载完成', {
            duration_ms: Math.round(performance.now() - startedAt),
            initialize_ms: summary?.elapsedMs,
            runtime: summary ? `${summary.detProvider}/${summary.recProvider}` : 'unknown',
          });
          return engine;
        })
        .catch((error) => {
          this.enginePromise = null;
          throw new OcrModuleError('MODEL_INIT_FAILED', '离线识别模型加载失败。', error);
        });
    }
    return this.enginePromise;
  }

  private async checkCapabilities(): Promise<OcrCapabilities> {
    try {
      const response = await (this.options.fetchFn || fetch)('/ocr/manifest.json', {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`OCR 资源清单读取失败：${response.status}`);
      const manifest = (await response.json()) as OcrManifest;
      if (typeof manifest.model_version !== 'string') throw new Error('OCR 资源清单缺少模型版本');
      const languages = Array.isArray(manifest.languages)
        ? manifest.languages.filter((value): value is string => typeof value === 'string')
        : [];
      const capabilities: OcrCapabilities = {
        available: true,
        mode: 'offline',
        languages,
        modelVersion: manifest.model_version,
        reason: null,
      };
      this.options.logger?.info('ocr', 'ocr.capability_checked', '离线识别能力可用', {
        available: true,
        model_version: manifest.model_version,
        language_count: languages.length,
      });
      return capabilities;
    } catch {
      this.options.logger?.warn('ocr', 'ocr.capability_checked', '离线识别资源不可用', {
        available: false,
        error_code: 'MODEL_ASSET_MISSING',
      });
      return {
        available: false,
        mode: 'offline',
        languages: [],
        modelVersion: null,
        reason: 'MODEL_ASSET_MISSING',
      };
    }
  }
}
