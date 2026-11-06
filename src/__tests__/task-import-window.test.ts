import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import ImportFloating from '../components/overlays/ImportFloating.vue';

const mocks = vi.hoisted(() => ({
  emit: vi.fn().mockResolvedValue(undefined),
  invoke: vi.fn(),
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
    warn: vi.fn(),
    info: vi.fn(),
  },
  invokeWithDiagnostics: mocks.invoke,
}));

vi.mock('../ocr', () => ({
  OcrModuleError: Error,
  createOcrModule: () => ({
    capabilities: async () => ({
      available: false,
      mode: 'offline',
      languages: [],
      modelVersion: null,
      reason: 'UNSUPPORTED_RUNTIME',
    }),
    recognize: vi.fn(),
    dispose: async () => undefined,
  }),
}));

describe('导入任务窗口', () => {
  let host: HTMLDivElement;
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    mocks.emit.mockClear();
    mocks.invoke.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(async () => {
    unmount?.();
    await nextTick();
    host.remove();
    unmount = undefined;
  });

  it('提交选中候选并通知主窗口', async () => {
    const parsedTask = {
      title: '任务 A',
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
    await setTextareaValue(textarea, '原文');
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

  it('持久化失败后保留候选并允许重试', async () => {
    const parsedTask = {
      title: '任务 A',
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
    await setTextareaValue(textarea, '原文');
    (host.querySelector('.parse-btn') as HTMLButtonElement).click();
    await flushAsyncUpdates();
    (host.querySelector('.add-btn') as HTMLButtonElement).click();
    await flushAsyncUpdates();

    expect(host.textContent).toContain('保存任务数据失败');
    expect(host.textContent).toContain('任务 A');
    expect((host.querySelector('.add-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  async function mountImportWindow() {
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
});
