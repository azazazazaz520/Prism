import { ref } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { invokeWithDiagnostics as invoke, diagnosticsLogger } from '../diagnostics/invoke-logged';

export interface QueueOperation {
  type: 'upsert' | 'delete';
  table: 'tasks' | 'daily_completions';
  data: Record<string, unknown>;
}

interface Delivery {
  token: string;
  item: QueueOperation & { id: string; sequence: number };
}

export const outboxCount = ref(0);
let migration: Promise<void> | null = null;

/** 将旧存储一次性转换为 Rust 发件箱，保存成功后清理旧键。 */
export function ensureOutboxReady(): Promise<void> {
  if (migration) return migration;
  migration = (async () => {
    const snapshot = await invoke<{ legacyQueueImported: boolean }>('get_task_snapshot');
    const key = 'prism_offline_queue';
    if (!snapshot.legacyQueueImported) {
      const raw = localStorage.getItem(key);
      const operations: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(operations)) throw new Error('旧队列格式无效');
      await invoke('import_legacy_queue', { operations });
    }
    try {
      localStorage.removeItem(key);
    } catch (error) {
      diagnosticsLogger.warn('sync', 'sync.legacy_queue_cleanup_failed', '清理旧队列存储失败', {
        error: String(error),
      });
    }
  })().catch((error) => {
    migration = null;
    throw error;
  });
  return migration;
}

export function normalizeOperation(item: QueueOperation, profile: string | null, uid: string) {
  const data: Record<string, unknown> = { ...item.data, user_id: uid };
  if (profile && data.profile_id == null) data.profile_id = profile;
  return { ...item, data };
}

/** 领取一项、发送、确认；失败时保留当前项及后续操作。 */
export async function deliverNext(
  execute: (item: QueueOperation, signal: AbortSignal) => Promise<{ error?: unknown }>,
): Promise<boolean> {
  const delivery = await invoke<Delivery | null>('claim_outbox');
  if (!delivery) return false;
  let success = false;
  try {
    const result = await execute(delivery.item, AbortSignal.timeout(30_000));
    if (result.error) throw result.error;
    success = true;
  } finally {
    await invoke('finish_outbox', { token: delivery.token, id: delivery.item.id, success });
  }
  return true;
}

export function createOutboxConsumer(
  ready: () => boolean,
  execute: (item: QueueOperation, signal: AbortSignal) => Promise<{ error?: unknown }>,
) {
  let running: Promise<void> | null = null;
  let start: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let unlisten: (() => void) | null = null;
  let stopped = false;

  function flush(): Promise<void> {
    if (running) return running;
    running = (async () => {
      await ensureOutboxReady();
      while (!stopped && ready()) {
        if (!(await deliverNext(execute))) break;
      }
    })().finally(() => {
      running = null;
    });
    return running;
  }

  function wake() {
    if (!ready() || stopped) return;
    void flush().catch((error) =>
      diagnosticsLogger.warn('sync', 'sync.outbox_send_failed', '发送待同步操作失败', {
        error: String(error),
      }),
    );
  }

  function initialize(): Promise<void> {
    if (start) return start;
    start = (async () => {
      await ensureOutboxReady();
      const stopListening = await listen('tasks://data-changed', wake);
      if (stopped) {
        stopListening();
        return;
      }
      unlisten = stopListening;
      timer = setInterval(wake, 5_000);
      window.addEventListener('online', wake);
      window.addEventListener('beforeunload', dispose, { once: true });
    })().catch((error) => {
      start = null;
      throw error;
    });
    return start;
  }

  function dispose() {
    stopped = true;
    unlisten?.();
    if (timer) clearInterval(timer);
    window.removeEventListener('online', wake);
  }
  return { initialize, flush, dispose };
}
