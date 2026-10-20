import { describe, expect, it, vi } from 'vitest';
import {
  createAppExitController,
  type AppExitState,
  type ExitPreparationReport,
} from '../composables/useAppExit';

vi.mock('../diagnostics/invoke-logged', () => ({
  invokeWithDiagnostics: vi.fn(),
  diagnosticsLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const idle = (): AppExitState => ({ phase: 'idle', requestId: null, completed: false });
const preparing = (requestId: number, completed = false): AppExitState => ({
  phase: 'preparing',
  requestId,
  completed,
});
const quitting = (): AppExitState => ({ phase: 'quitting', requestId: 1, completed: true });
const successReport = (): ExitPreparationReport => ({
  success: true,
  failedPaths: [],
  conflictPaths: [],
  message: null,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function createHarness() {
  let prepareHandler: ((payload: { requestId: number }) => void) | null = null;
  let cancelHandler: ((payload: { requestId: number; reason?: string }) => void) | null = null;
  const invoke = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(
    async () => undefined,
  );
  const listenPrepare = vi.fn(async (handler: (payload: { requestId: number }) => void) => {
    prepareHandler = handler;
    return () => {
      prepareHandler = null;
    };
  });
  const listenCancelled = vi.fn(
    async (handler: (payload: { requestId: number; reason?: string }) => void) => {
      cancelHandler = handler;
      return () => {
        cancelHandler = null;
      };
    },
  );
  return {
    invoke,
    listenPrepare,
    listenCancelled,
    emitPrepare: (payload: { requestId: number }) => prepareHandler?.(payload),
    emitCancelled: (payload: { requestId: number; reason?: string }) => cancelHandler?.(payload),
  };
}

function createController(
  harness: ReturnType<typeof createHarness>,
  options: {
    saveNotes: () => Promise<ExitPreparationReport>;
    onFrozenChange?: (frozen: boolean) => void;
    onNotice?: (message: string) => void;
  },
) {
  return createAppExitController(
    {
      invoke: harness.invoke as never,
      listenPrepare: harness.listenPrepare,
      listenCancelled: harness.listenCancelled,
    },
    options,
  );
}

describe('退出准备', () => {
  it('准备事件冻结修改，保存完成后提交回执并保持冻结', async () => {
    const harness = createHarness();
    let state = idle();
    harness.invoke.mockImplementation(async (command) => {
      if (command === 'get_app_exit_state') return state;
      return undefined;
    });
    const saveNotes = vi.fn(async () => successReport());
    const frozenChanges: boolean[] = [];
    const controller = createController(harness, {
      saveNotes,
      onFrozenChange: (frozen) => frozenChanges.push(frozen),
    });

    await controller.initialize();
    expect(controller.frozen.value).toBe(false);

    state = preparing(7);
    harness.emitPrepare({ requestId: 7 });

    await vi.waitFor(() => expect(saveNotes).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(harness.invoke).toHaveBeenCalledWith(
        'complete_exit_preparation',
        expect.objectContaining({ requestId: 7, report: successReport() }),
      ),
    );
    expect(controller.frozen.value).toBe(true);
    expect(frozenChanges).toEqual([true]);

    harness.emitPrepare({ requestId: 7 });
    await settle();
    expect(saveNotes).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('取消通知在保存完成前解除冻结且不再提交回执', async () => {
    const harness = createHarness();
    let state = idle();
    let releaseSave!: () => void;
    const saveNotes = vi.fn(
      () =>
        new Promise<ExitPreparationReport>((resolve) => {
          releaseSave = () => resolve(successReport());
        }),
    );
    const notices: string[] = [];
    harness.invoke.mockImplementation(async (command) => {
      if (command === 'get_app_exit_state') return state;
      return undefined;
    });
    const controller = createController(harness, {
      saveNotes,
      onNotice: (message) => notices.push(message),
    });

    await controller.initialize();
    state = preparing(8);
    harness.emitPrepare({ requestId: 8 });
    await vi.waitFor(() => expect(saveNotes).toHaveBeenCalledOnce());

    harness.emitCancelled({ requestId: 8, reason: '存在未处理的笔记冲突' });
    expect(controller.frozen.value).toBe(false);
    expect(notices[notices.length - 1]).toContain('存在未处理的笔记冲突');

    state = idle();
    releaseSave();
    await settle();
    expect(controller.frozen.value).toBe(false);
    expect(harness.invoke).not.toHaveBeenCalledWith('complete_exit_preparation', expect.anything());
    controller.dispose();
  });

  it('页面重新获得响应时按后端准备状态冻结并提交回执', async () => {
    const harness = createHarness();
    const state = preparing(9);
    harness.invoke.mockImplementation(async (command) => {
      if (command === 'get_app_exit_state') return state;
      return undefined;
    });
    const saveNotes = vi.fn(async () => successReport());
    const controller = createController(harness, { saveNotes });

    await controller.initialize();

    expect(controller.frozen.value).toBe(true);
    await vi.waitFor(() =>
      expect(harness.invoke).toHaveBeenCalledWith(
        'complete_exit_preparation',
        expect.objectContaining({ requestId: 9 }),
      ),
    );
    expect(saveNotes).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('已提交回执的窗口保持冻结且不重复保存', async () => {
    const harness = createHarness();
    const state = preparing(10, true);
    harness.invoke.mockImplementation(async (command) => {
      if (command === 'get_app_exit_state') return state;
      return undefined;
    });
    const saveNotes = vi.fn(async () => successReport());
    const controller = createController(harness, { saveNotes });

    await controller.initialize();

    expect(controller.frozen.value).toBe(true);
    expect(saveNotes).not.toHaveBeenCalled();
    expect(harness.invoke).not.toHaveBeenCalledWith('complete_exit_preparation', expect.anything());
    controller.dispose();
  });

  it('最终退出阶段保持冻结', async () => {
    const harness = createHarness();
    const state = quitting();
    harness.invoke.mockImplementation(async (command) => {
      if (command === 'get_app_exit_state') return state;
      return undefined;
    });
    const saveNotes = vi.fn(async () => successReport());
    const controller = createController(harness, { saveNotes });

    await controller.initialize();

    expect(controller.frozen.value).toBe(true);
    expect(saveNotes).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('回执失败且请求已失效时解除冻结', async () => {
    const harness = createHarness();
    let state = preparing(11);
    harness.invoke.mockImplementation(async (command) => {
      if (command === 'get_app_exit_state') return state;
      if (command === 'complete_exit_preparation') {
        state = idle();
        throw new Error('退出请求编号已失效');
      }
      return undefined;
    });
    const saveNotes = vi.fn(async () => successReport());
    const controller = createController(harness, { saveNotes });

    await controller.initialize();

    await vi.waitFor(() => expect(controller.frozen.value).toBe(false));
    expect(saveNotes).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('无效请求不会触发保存', async () => {
    const harness = createHarness();
    harness.invoke.mockImplementation(async (command) => {
      if (command === 'get_app_exit_state') return idle();
      return undefined;
    });
    const saveNotes = vi.fn(async () => successReport());
    const controller = createController(harness, { saveNotes });

    await controller.initialize();
    harness.emitPrepare({ requestId: 12 });
    await settle();

    expect(saveNotes).not.toHaveBeenCalled();
    expect(controller.frozen.value).toBe(false);
    controller.dispose();
  });
});
