import { OcrModuleError } from './errors';
import type { OcrCapabilities, OcrInput, OcrModule } from './ocr-module';

const CAPABILITIES: OcrCapabilities = {
  available: false,
  mode: 'offline',
  languages: [],
  modelVersion: null,
  reason: 'UNSUPPORTED_RUNTIME',
};

/** 当前运行环境不支持 Worker 或 WebAssembly 时使用。 */
export class UnavailableOcrAdapter implements OcrModule {
  async capabilities(): Promise<OcrCapabilities> {
    return CAPABILITIES;
  }

  async recognize(_input: OcrInput): Promise<never> {
    throw new OcrModuleError('UNSUPPORTED_RUNTIME', '当前环境不支持离线文字识别。');
  }

  async dispose(): Promise<void> {}
}
