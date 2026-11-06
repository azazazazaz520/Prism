import { computed, ref } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { diagnosticsLogger, invokeWithDiagnostics } from '../diagnostics/invoke-logged';

export const CLOSE_TO_TRAY_CHANGED = 'prism:close-to-tray-changed';

/** 托盘设置与本次运行状态的完整快照。 */
export interface CloseToTrayStatus {
  enabled: boolean;
  available: boolean;
  updating: boolean;
  revision: number;
  error: string | null;
}

export interface CloseToTrayDeps {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  listenStatus: (handler: (status: CloseToTrayStatus) => void) => Promise<() => void>;
}

function errorMessage(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  return text.replace(/^[A-Z_]+:\s*/, '');
}

/**
 * 维护当前窗口看到的托盘设置快照。
 *
 * 事件版本低于已应用版本时丢弃，命令响应与广播共用同一版本序列。
 */
export function createCloseToTrayController(deps: Partial<CloseToTrayDeps> = {}) {
  const invoke = deps.invoke ?? ((command, args) => invokeWithDiagnostics(command, args));
  const listenStatus =
    deps.listenStatus ??
    ((handler) =>
      listen<CloseToTrayStatus>(CLOSE_TO_TRAY_CHANGED, (event) => handler(event.payload)));

  const status = ref<CloseToTrayStatus | null>(null);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);
  /** 初始读取、提交或后端更新进行中时禁止再次提交。 */
  const busy = computed(
    () => loading.value || saving.value || status.value === null || status.value.updating,
  );

  let revision = -1;
  let unlisten: (() => void) | null = null;
  let started = false;
  let focusHandler: (() => void) | null = null;

  function apply(next: CloseToTrayStatus | null) {
    if (!next || typeof next.revision !== 'number' || next.revision < revision) return;
    revision = next.revision;
    status.value = next;
    error.value = next.error ?? null;
  }

  async function refresh(): Promise<CloseToTrayStatus | null> {
    loading.value = true;
    try {
      const next = await invoke<CloseToTrayStatus>('get_close_to_tray');
      apply(next);
      return next;
    } catch (cause) {
      error.value = errorMessage(cause);
      diagnosticsLogger.error(
        'settings',
        'settings.close_to_tray_query_failed',
        '查询关闭到托盘状态失败',
        cause,
      );
      return null;
    } finally {
      loading.value = false;
    }
  }

  /** 提交明确目标值；失败后重新读取实际状态。 */
  async function setEnabled(enabled: boolean): Promise<boolean> {
    if (saving.value || loading.value || status.value?.updating) return false;
    saving.value = true;
    error.value = null;
    try {
      const next = await invoke<CloseToTrayStatus>('set_close_to_tray', { enabled });
      apply(next);
      return enabled ? next.enabled && next.available : !next.enabled;
    } catch (cause) {
      const message = errorMessage(cause);
      error.value = message;
      diagnosticsLogger.error(
        'settings',
        'settings.close_to_tray_update_failed',
        '更新关闭到托盘设置失败',
        cause,
        { enabled },
      );
      const actual = await refresh();
      error.value = actual?.error ?? message;
      return false;
    } finally {
      saving.value = false;
    }
  }

  /** 先订阅变更事件，再读取初始快照；再次进入设置页时重新查询。 */
  async function initialize() {
    if (started) {
      await refresh();
      return;
    }
    started = true;
    try {
      unlisten = await listenStatus(apply);
    } catch (cause) {
      error.value = errorMessage(cause);
    }
    focusHandler = () => {
      void refresh();
    };
    window.addEventListener('focus', focusHandler);
    await refresh();
  }

  function dispose() {
    started = false;
    unlisten?.();
    unlisten = null;
    if (focusHandler) window.removeEventListener('focus', focusHandler);
    focusHandler = null;
  }

  return { status, loading, saving, error, busy, initialize, refresh, setEnabled, dispose };
}

let sharedController: ReturnType<typeof createCloseToTrayController> | null = null;

/** 当前窗口共享的托盘设置控制器。 */
export function useCloseToTray() {
  sharedController ??= createCloseToTrayController();
  return sharedController;
}
