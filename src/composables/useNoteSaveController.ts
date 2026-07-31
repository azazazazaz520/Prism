export interface NoteSaveSnapshot {
  content: string;
  expectedMtime: string | null;
}

type WriteNote = (snapshot: NoteSaveSnapshot) => Promise<string>;
type SaveSuccess = (mtime: string, snapshot: NoteSaveSnapshot) => void;
type SaveFailure = (error: unknown) => void;

interface PendingSave {
  snapshot: NoteSaveSnapshot;
  write: WriteNote;
  onSuccess: SaveSuccess;
  onFailure: SaveFailure;
  generation: number;
}

/** 按文件管理防抖保存和过期写入保护，避免多个编辑器各自维护保存状态。 */
export function useNoteSaveController(delay = 500) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, PendingSave>();
  const running = new Map<string, Promise<void>>();
  const generations = new Map<string, number>();

  function cancel(path: string) {
    const timer = timers.get(path);
    if (timer) clearTimeout(timer);
    timers.delete(path);
    pending.delete(path);
    generations.set(path, (generations.get(path) ?? 0) + 1);
  }

  async function drain(path: string): Promise<void> {
    if (running.has(path)) {
      await running.get(path);
      return;
    }

    const job = pending.get(path);
    if (!job) return;

    pending.delete(path);
    const task = (async () => {
      try {
        const mtime = await job.write(job.snapshot);
        if (generations.get(path) === job.generation) {
          job.onSuccess(mtime, job.snapshot);
        }
      } catch (error) {
        if (generations.get(path) === job.generation) {
          job.onFailure(error);
        }
      } finally {
        running.delete(path);
        if (pending.has(path) && !timers.has(path)) {
          void drain(path);
        }
      }
    })();

    running.set(path, task);
    await task;
  }

  function scheduleDrain(path: string) {
    const timer = setTimeout(() => {
      timers.delete(path);
      void drain(path);
    }, delay);
    timers.set(path, timer);
  }

  function schedule(
    path: string,
    snapshot: NoteSaveSnapshot,
    write: WriteNote,
    onSuccess: SaveSuccess,
    onFailure: SaveFailure,
  ) {
    const generation = (generations.get(path) ?? 0) + 1;
    generations.set(path, generation);
    const timer = timers.get(path);
    if (timer) clearTimeout(timer);
    timers.delete(path);
    pending.set(path, { snapshot, write, onSuccess, onFailure, generation });
    scheduleDrain(path);
  }

  async function flush(path: string): Promise<void> {
    const timer = timers.get(path);
    if (timer) clearTimeout(timer);
    timers.delete(path);

    while (pending.has(path) || running.has(path)) {
      await drain(path);
    }
  }

  function dispose() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    pending.clear();
    generations.clear();
  }

  return { cancel, schedule, flush, dispose };
}
