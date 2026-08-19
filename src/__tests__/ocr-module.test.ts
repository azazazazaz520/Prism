import { describe, expect, it, vi } from 'vitest';
import type { OcrResult as PaddleResult } from '@paddleocr/paddleocr-js';
import { createOcrModule, normalizePaddleResult, OcrModuleError } from '../ocr';
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
        text: '明天提交报告',
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
  it('运行环境不支持时使用不可用 Adapter', async () => {
    const module = createOcrModule({ runtimeSupported: () => false });

    await expect(module.capabilities()).resolves.toMatchObject({
      available: false,
      reason: 'UNSUPPORTED_RUNTIME',
    });
    await expect(
      module.recognize({ imageBase64: PNG_BASE64, width: 1, height: 1, requestId: 'request-1' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_RUNTIME' });
  });

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
    ).resolves.toMatchObject({ text: '明天提交报告' });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(engine.predict).toHaveBeenCalledTimes(1);
  });

  it('拒绝无效图片且不会启动引擎', async () => {
    const factory = vi.fn(async () => new FakeEngine().asEngine());
    const module = createOcrModule({
      runtimeSupported: () => true,
      engineFactory: factory,
      fetchFn: manifestFetch(),
    });

    await expect(
      module.recognize({
        imageBase64: 'not-a-png',
        width: 100,
        height: 50,
        requestId: 'request-3',
      }),
    ).rejects.toBeInstanceOf(OcrModuleError);
    expect(factory).not.toHaveBeenCalled();
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

  it('释放时销毁识别引擎', async () => {
    const engine = new FakeEngine();
    const module = createOcrModule({
      runtimeSupported: () => true,
      engineFactory: async () => engine.asEngine(),
      fetchFn: manifestFetch(),
    });
    await module.recognize({
      imageBase64: PNG_BASE64,
      width: 100,
      height: 50,
      requestId: 'request-5',
    });

    await module.dispose();

    expect(engine.disposed).toBe(true);
  });
});

describe('OCR 结果标准化', () => {
  it('按阅读顺序排序并按字符数加权置信度', () => {
    const source: PaddleResult = {
      image: { width: 200, height: 100 },
      items: [
        {
          text: '低',
          score: 0.5,
          poly: [
            [100, 50],
            [120, 50],
            [120, 70],
            [100, 70],
          ],
        },
        {
          text: '第一行',
          score: 1,
          poly: [
            [10, 10],
            [70, 10],
            [70, 30],
            [10, 30],
          ],
        },
      ],
      metrics: { detMs: 10, recMs: 20, totalMs: 30, detectedBoxes: 2, recognizedCount: 2 },
      runtime: {
        requestedBackend: 'wasm',
        detProvider: 'wasm',
        recProvider: 'wasm',
        webgpuAvailable: false,
      },
    };

    const result = normalizePaddleResult(source, 120);

    expect(result.text).toBe('第一行\n低');
    expect(result.lines[0].bounds).toEqual({ x: 10, y: 10, width: 60, height: 20 });
    expect(result.confidence).toBeCloseTo(0.875);
    expect(result.warnings).toEqual(['1 行文字置信度较低，请重点检查。']);
    expect(result.metrics).toMatchObject({ initialize_ms: 120, runtime: 'wasm/wasm' });
  });

  it('空结果保持为空且不制造错误警告', () => {
    const source: PaddleResult = {
      image: { width: 10, height: 10 },
      items: [],
      metrics: { detMs: 1, recMs: 0, totalMs: 1, detectedBoxes: 0, recognizedCount: 0 },
      runtime: {
        requestedBackend: 'wasm',
        detProvider: 'wasm',
        recProvider: 'wasm',
        webgpuAvailable: false,
      },
    };

    expect(normalizePaddleResult(source)).toMatchObject({
      text: '',
      lines: [],
      warnings: [],
      confidence: undefined,
    });
  });
});
