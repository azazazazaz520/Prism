import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

const mocks = vi.hoisted(() => ({
  emit: vi.fn().mockResolvedValue(undefined),
  invoke: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  ocrCapabilities: vi.fn(),
  ocrRecognize: vi.fn(),
  ocrDispose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    listen: vi.fn().mockResolvedValue(vi.fn()),
  })),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: mocks.emit,
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock('../composables/useTheme', () => ({
  initTheme: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../diagnostics/invoke-logged', () => ({
  diagnosticsLogger: {
    warn: mocks.warn,
    info: mocks.info,
  },
  invokeWithDiagnostics: mocks.invoke,
}));

vi.mock('../ocr', () => {
  class OcrModuleError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    OcrModuleError,
    createOcrModule: vi.fn(() => ({
      capabilities: mocks.ocrCapabilities,
      recognize: mocks.ocrRecognize,
      dispose: mocks.ocrDispose,
    })),
  };
});

describe('导入任务窗口', () => {
  let host: HTMLDivElement;
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    mocks.emit.mockClear();
    mocks.invoke.mockReset();
    mocks.warn.mockClear();
    mocks.info.mockClear();
    mocks.ocrCapabilities.mockReset();
    mocks.ocrCapabilities.mockResolvedValue({
      available: true,
      mode: 'offline',
      languages: ['zh-Hans', 'en'],
      modelVersion: 'PP-OCRv6-small',
      reason: null,
    });
    mocks.ocrRecognize.mockReset();
    mocks.ocrDispose.mockClear();
    delete (window as Window & { __screenshotResult?: unknown }).__screenshotResult;
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    unmount?.();
    host.remove();
    unmount = undefined;
  });

  it('默认状态下显示区域截图快捷键', async () => {
    const { default: ImportFloating } = await import('../components/overlays/ImportFloating.vue');
    const app = createApp(ImportFloating);
    app.mount(host);
    unmount = () => app.unmount();
    await nextTick();

    expect(host.textContent).toContain('Ctrl+Alt+I');
    expect(host.textContent).toContain('区域截图');
  });

  it('原始内容变化后要求重新解析', async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'ai_parse_wechat') {
        return Promise.resolve([
          {
            title: '整理会议纪要',
            due_date: '2026-08-20',
            tags: ['工作'],
            confidence: 0.9,
          },
        ]);
      }
      return Promise.resolve(undefined);
    });
    await mountImportWindow();

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    await setTextareaValue(textarea, '明天整理会议纪要');
    (host.querySelector('.parse-btn') as HTMLButtonElement).click();
    await flushAsyncUpdates();

    expect(host.textContent).toContain('整理会议纪要');
    await setTextareaValue(textarea, '后天整理会议纪要');

    expect(host.textContent).toContain('原始内容已变化，请重新解析后再导入。');
    expect((host.querySelector('.add-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('解析为空时显示明确提示', async () => {
    mocks.invoke.mockResolvedValueOnce([]);
    await mountImportWindow();

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    await setTextareaValue(textarea, '没有可执行事项');
    (host.querySelector('.parse-btn') as HTMLButtonElement).click();
    await flushAsyncUpdates();

    expect(host.textContent).toContain('未从这段文字中识别到任务，请修改内容后重新解析。');
  });

  it('长原文解析出较多候选时切换为结果优先布局并保留全部候选', async () => {
    const tasks = Array.from({ length: 12 }, (_, index) => ({
      title: `候选任务 ${index + 1}`,
      due_date: null,
      tags: [],
      confidence: 0.9,
    }));
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'ai_parse_wechat') return Promise.resolve(tasks);
      return Promise.resolve(undefined);
    });
    await mountImportWindow();

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    await setTextareaValue(textarea, '包含大量界面文字的 OCR 结果。'.repeat(80));
    (host.querySelector('.parse-btn') as HTMLButtonElement).click();
    await flushAsyncUpdates();

    expect(host.querySelector('.input-section')?.classList.contains('has-results')).toBe(true);
    expect(host.querySelectorAll('.card')).toHaveLength(12);
    expect(host.querySelector('.card-list')).not.toBeNull();
    expect(host.querySelector('.bottom-bar')).not.toBeNull();
    expect(host.textContent).toContain('候选任务 12');
  });

  it('一次提交全部选中候选并通知主窗口', async () => {
    const parsedTask = {
      title: '整理会议纪要',
      due_date: '2026-08-20',
      tags: ['工作'],
      confidence: 0.9,
    };
    const createdTask = {
      id: 'task-1',
      title: parsedTask.title,
      completed: false,
      created_at: '2026-08-19T09:00:00Z',
      due_date: parsedTask.due_date,
      tags: parsedTask.tags,
      profile_id: 'profile-1',
    };
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'ai_parse_wechat') return Promise.resolve([parsedTask]);
      if (command === 'add_tasks_batch') return Promise.resolve({ created: [createdTask] });
      return Promise.resolve(undefined);
    });
    await mountImportWindow();

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    await setTextareaValue(textarea, '明天整理会议纪要');
    (host.querySelector('.parse-btn') as HTMLButtonElement).click();
    await flushAsyncUpdates();
    (host.querySelector('.add-btn') as HTMLButtonElement).click();
    await flushAsyncUpdates();

    expect(mocks.invoke).toHaveBeenCalledWith('add_tasks_batch', {
      args: {
        tasks: [
          {
            title: parsedTask.title,
            dueDate: parsedTask.due_date,
            tags: parsedTask.tags,
          },
        ],
      },
    });
    expect(mocks.emit).toHaveBeenCalledWith('tasks-imported', [createdTask]);
    expect(host.textContent).toContain('已导入 1 项任务');
  });

  it('字段校验失败时展开并聚焦对应候选字段', async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'ai_parse_wechat') {
        return Promise.resolve([
          {
            title: '整理会议纪要',
            due_date: null,
            tags: [],
            confidence: 0.9,
          },
        ]);
      }
      if (command === 'add_tasks_batch') return Promise.reject('第 1 项任务标题为空');
      return Promise.resolve(undefined);
    });
    await mountImportWindow();

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    await setTextareaValue(textarea, '整理会议纪要');
    (host.querySelector('.parse-btn') as HTMLButtonElement).click();
    await flushAsyncUpdates();
    (host.querySelector('.card-summary') as HTMLDivElement).click();
    await nextTick();
    const titleInput = host.querySelector('[data-field="title"]') as HTMLInputElement;
    titleInput.value = '';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    (host.querySelector('.add-btn') as HTMLButtonElement).click();
    await flushAsyncUpdates();

    expect(host.querySelector('.card')?.classList.contains('has-error')).toBe(true);
    expect(host.textContent).toContain('第 1 项任务标题为空');
    expect(document.activeElement).toBe(titleInput);
  });

  it('持久化失败后保留候选并允许重试', async () => {
    const parsedTask = {
      title: '整理会议纪要',
      due_date: null,
      tags: [],
      confidence: 0.9,
    };
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'ai_parse_wechat') return Promise.resolve([parsedTask]);
      if (command === 'add_tasks_batch') return Promise.reject('保存任务数据失败');
      return Promise.resolve(undefined);
    });
    await mountImportWindow();

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    await setTextareaValue(textarea, '整理会议纪要');
    (host.querySelector('.parse-btn') as HTMLButtonElement).click();
    await flushAsyncUpdates();
    (host.querySelector('.add-btn') as HTMLButtonElement).click();
    await flushAsyncUpdates();

    expect(host.textContent).toContain('保存任务数据失败');
    expect(host.textContent).toContain('整理会议纪要');
    expect((host.querySelector('.add-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('截图识别成功后将文字写入可编辑输入区', async () => {
    setScreenshotResult();
    mocks.ocrRecognize.mockResolvedValue({
      text: '明天提交报告',
      lines: [],
      confidence: 0.96,
      provider: 'paddleocr-web',
      warnings: [],
    });
    await mountImportWindow();
    await flushAsyncUpdates();

    (host.querySelector('.ocr-actions .secondary-btn') as HTMLButtonElement).click();
    await flushAsyncUpdates();

    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('明天提交报告');
    expect(host.textContent).toContain('识别完成');
    expect(mocks.ocrRecognize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 320, height: 180 }),
    );
  });

  it('识别期间修改文字后丢弃迟到结果', async () => {
    setScreenshotResult();
    let resolveRecognition!: (value: unknown) => void;
    mocks.ocrRecognize.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRecognition = resolve;
        }),
    );
    await mountImportWindow();
    await flushAsyncUpdates();

    (host.querySelector('.ocr-actions .secondary-btn') as HTMLButtonElement).click();
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    await setTextareaValue(textarea, '我手动输入的文字');
    resolveRecognition({
      text: '迟到的识别结果',
      lines: [],
      provider: 'paddleocr-web',
      warnings: [],
    });
    await flushAsyncUpdates();

    expect(textarea.value).toBe('我手动输入的文字');
    expect(host.textContent).toContain('未应用本次识别结果');
    expect(mocks.info).toHaveBeenCalledWith(
      'ocr',
      'ocr.result_discarded_as_stale',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('离线识别不可用时保留手动输入路径', async () => {
    setScreenshotResult();
    mocks.ocrCapabilities.mockResolvedValue({
      available: false,
      mode: 'offline',
      languages: [],
      modelVersion: null,
      reason: 'MODEL_ASSET_MISSING',
    });
    await mountImportWindow();
    await flushAsyncUpdates();

    expect(host.textContent).toContain('离线识别暂不可用');
    expect((host.querySelector('.ocr-actions .secondary-btn') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((host.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(false);
  });

  async function mountImportWindow() {
    const { default: ImportFloating } = await import('../components/overlays/ImportFloating.vue');
    const app = createApp(ImportFloating);
    app.mount(host);
    unmount = () => app.unmount();
    await nextTick();
  }

  async function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
    textarea.value = value;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
  }

  async function flushAsyncUpdates() {
    await Promise.resolve();
    await Promise.resolve();
    await nextTick();
  }

  function setScreenshotResult() {
    (window as Window & { __screenshotResult?: unknown }).__screenshotResult = {
      source: 'region',
      text: '',
      image_base64: 'iVBORw0KGgo=',
      width: 320,
      height: 180,
    };
  }
});
