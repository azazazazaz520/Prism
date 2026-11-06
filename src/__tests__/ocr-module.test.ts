import type { OcrResult as PaddleResult } from '@paddleocr/paddleocr-js';
import { describe, expect, it, vi } from 'vitest';
import { createOcrModule } from '../ocr';
import type { PaddleOcrEngine } from '../ocr/paddle-ocr-adapter';

const PNG_BASE64 = 'iVBORw0KGgo=';

class FakeEngine {
  disposed = false;
  predict = vi.fn(async () => [samplePaddleResult()]);

  getInitializationSummary() {
    return {
      elapsedMs: 120,
      detProvider: 'wasm',
      recProvider: 'wasm',
    };
  }

  async dispose() {
    this.disposed = true;
  }

  asEngine(): PaddleOcrEngine {
    return this as unknown as PaddleOcrEngine;
  }
}

function manifestFetch(): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      model_version: 'PP-OCRv6-small',
      languages: ['zh-Hans', 'en'],
    }),
  }) as unknown as typeof fetch;
}

function samplePaddleResult(): PaddleResult {
  return {
    image: { width: 100, height: 50 },
    items: [
      {
        text: '识别文本',
        score: 0.96,
        poly: [
          [1, 2],
          [81, 2],
          [81, 22],
          [1, 22],
        ],
      },
    ],
    metrics: { detMs: 10, recMs: 20, totalMs: 30, detectedBoxes: 1, recognizedCount: 1 },
    runtime: {
      requestedBackend: 'wasm',
      detProvider: 'wasm',
      recProvider: 'wasm',
      webgpuAvailable: false,
    },
  };
}

describe('OCR 模块', () => {
  it('能力检查不会提前创建引擎，识别时才延迟创建', async () => {
    const engine = new FakeEngine();
    const factory = vi.fn(async () => engine.asEngine());
    const module = createOcrModule({
      runtimeSupported: () => true,
      engineFactory: factory,
      fetchFn: manifestFetch(),
    });

    await expect(module.capabilities()).resolves.toMatchObject({
      available: true,
      modelVersion: 'PP-OCRv6-small',
    });
    expect(factory).not.toHaveBeenCalled();

    await expect(
      module.recognize({
        imageBase64: PNG_BASE64,
        width: 100,
        height: 50,
        requestId: 'request-2',
      }),
    ).resolves.toMatchObject({ text: '识别文本' });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(engine.predict).toHaveBeenCalledTimes(1);
  });

  it('引擎无响应时返回结构化超时错误', async () => {
    const engine = new FakeEngine();
    engine.predict = vi.fn(() => new Promise<PaddleResult[]>(() => undefined));
    const module = createOcrModule({
      runtimeSupported: () => true,
      engineFactory: async () => engine.asEngine(),
      fetchFn: manifestFetch(),
      timeoutMs: 5,
    });

    await expect(
      module.recognize({
        imageBase64: PNG_BASE64,
        width: 100,
        height: 50,
        requestId: 'request-4',
      }),
    ).rejects.toMatchObject({ code: 'RECOGNITION_TIMEOUT' });
  });
});
