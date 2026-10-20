import { ref } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { diagnosticsLogger, invokeWithDiagnostics } from '../diagnostics/invoke-logged';

export const PREPARE_EXIT_EVENT = 'prism:prepare-exit';
export const EXIT_CANCELLED_EVENT = 'prism:exit-cancelled';

/** 当前窗口提交的退出保存结果。 */
export interface ExitPreparationReport {
  success: boolean;
  failedPaths: string[];
  conflictPaths: string[];
  message: string | null;
}

/** 当前窗口看到的退出请求状态。 */
export interface AppExitState {
  phase: 'idle' | 'preparing' | 'quitting';
  requestId: number | null;
  completed: boolean;
}

export interface AppExitDeps {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  listenPrepare: (handler: (payload: { requestId: number }) => void) => Promise<() => void>;
  listenCancelled: (
    handler: (payload: { requestId: number; reason?: string }) => void,
  ) => Promise<() => void>;
}

export interface AppExitOptions {
  /** 冻结修改并完成当前窗口全部已接受的笔记写入。 */
  saveNotes: () => Promise<ExitPreparationReport>;
  onFrozenChange?: (frozen: boolean) => void;
  onNotice?: (message: string) => void;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * 协调当前完整窗口的退出准备、冻结与取消恢复。
 *
 * 冻结在保存前生效；回执成功后保持冻结，直到进程退出或收到取消通知。
 */
export function createAppExitController(deps: Partial<AppExitDeps>, options: AppExitOptions) {
  const invoke = deps.invoke ?? ((command, args) => invokeWithDiagnostics(command, args));
  const listenPrepare =
    deps.listenPrepare ??
    ((handler) =>
      listen<{ requestId: number }>(PREPARE_EXIT_EVENT, (event) => handler(event.payload)));
  const listenCancelled =
    deps.listenCancelled ??
    ((handler) =>
      listen<{ requestId: number; reason?: string }>(EXIT_CANCELLED_EVENT, (event) =>
        handler(event.payload),
      ));

  const frozen = ref(false);
  let currentRequestId: number | null = null;
  let completedRequestId: number | null = null;
  let handlingRequestId: number | null = null;
  let queue: Promise<void> = Promise.resolve();
  let unlistenPrepare: (() => void) | null = null;
  let unlistenCancelled: (() => void) | null = null;
  let focusHandler: (() => void) | null = null;
  let started = false;

  function freeze(value: boolean) {
    if (frozen.value === value) return;
    frozen.value = value;
    options.onFrozenChange?.(value);
  }

  async function readState(): Promise<AppExitState | null> {
    try {
      return await invoke<AppExitState>('get_app_exit_state');
    } catch (cause) {
      diagnosticsLogger.error('app', 'app.exit_state_query_failed', '查询退出状态失败', cause);
      return null;
    }
  }

  function isActive(state: AppExitState | null, requestId: number): boolean {
    return (
      state?.phase === 'preparing' && state.requestId === requestId && state.completed === false
    );
  }

  async function runSave(): Promise<ExitPreparationReport> {
    try {
      return await options.saveNotes();
    } catch (cause) {
      return {
        success: false,
        failedPaths: [],
        conflictPaths: [],
        message: errorMessage(cause),
      };
    }
  }

  async function handlePreparation(requestId: number) {
    if (completedRequestId === requestId || handlingRequestId === requestId) return;
    const state = await readState();
    if (!isActive(state, requestId)) return;

    handlingRequestId = requestId;
    currentRequestId = requestId;
    freeze(true);

    const report = await runSave();
    const after = await readState();
    if (!after || after.phase !== 'preparing' || after.requestId !== requestId) {
      if (currentRequestId === requestId) {
        currentRequestId = null;
        freeze(false);
      }
      handlingRequestId = null;
      return;
    }
    if (after.completed) {
      completedRequestId = requestId;
      handlingRequestId = null;
      return;
    }

    try {
      await invoke('complete_exit_preparation', { requestId, report });
      completedRequestId = requestId;
    } catch (cause) {
      diagnosticsLogger.error('app', 'app.exit_prepare_failed', '提交退出保存结果失败', cause, {
        requestId,
      });
      const finalState = await readState();
      if (!finalState || finalState.phase !== 'preparing' || finalState.requestId !== requestId) {
        if (currentRequestId === requestId) {
          currentRequestId = null;
          freeze(false);
        }
      }
    } finally {
      handlingRequestId = null;
    }
  }

  function enqueuePreparation(requestId: number) {
    if (typeof requestId !== 'number') return;
    queue = queue.then(() => handlePreparation(requestId)).catch(() => undefined);
  }

  function handleCancelled(payload: { requestId: number; reason?: string }) {
    if (currentRequestId !== null && payload.requestId !== currentRequestId) return;
    currentRequestId = null;
    completedRequestId = null;
    handlingRequestId = null;
    freeze(false);
    options.onNotice?.(
      payload.reason ? `已取消退出：${payload.reason}` : '已取消退出，可以继续编辑',
    );
  }

  /** 页面初始化或重新获得焦点时，用后端状态校正冻结状态。 */
  async function correctState() {
    const state = await readState();
    if (!state) return;
    if (state.phase === 'quitting') {
      freeze(true);
      return;
    }
    if (state.phase === 'preparing' && state.requestId !== null) {
      if (state.completed) {
        currentRequestId = state.requestId;
        completedRequestId = state.requestId;
        freeze(true);
        return;
      }
      if (completedRequestId !== state.requestId) {
        freeze(true);
        enqueuePreparation(state.requestId);
      }
      return;
    }
    currentRequestId = null;
    freeze(false);
  }

  async function initialize() {
    if (started) return;
    started = true;
    try {
      unlistenPrepare = await listenPrepare((payload) => {
        enqueuePreparation(payload?.requestId);
      });
      unlistenCancelled = await listenCancelled(handleCancelled);
    } catch (cause) {
      diagnosticsLogger.error('app', 'app.exit_listen_failed', '订阅退出准备事件失败', cause);
    }
    focusHandler = () => {
      void correctState();
    };
    window.addEventListener('focus', focusHandler);
    await correctState();
  }

  function dispose() {
    started = false;
    unlistenPrepare?.();
    unlistenCancelled?.();
    unlistenPrepare = null;
    unlistenCancelled = null;
    if (focusHandler) window.removeEventListener('focus', focusHandler);
    focusHandler = null;
  }

  return { frozen, initialize, correctState, dispose };
}
