export interface NoteSaveSnapshot {
  content: string;
  expectedMtime: string | null;
}

type WriteNote = (snapshot: NoteSaveSnapshot) => Promise<string>;
type SaveSuccess = (mtime: string) => void;
type SaveFailure = (error: unknown) => void;

/** 按文件管理防抖保存和过期写入保护，避免多个编辑器各自维护保存状态。 */
export function useNoteSaveController(delay = 500) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const versions = new Map<string, number>();

  function cancel(path: string) {
    const timer = timers.get(path);
    if (timer) clearTimeout(timer);
    timers.delete(path);
    versions.set(path, (versions.get(path) ?? 0) + 1);
  }

  function schedule(
    path: string,
    snapshot: NoteSaveSnapshot,
    write: WriteNote,
    onSuccess: SaveSuccess,
    onFailure: SaveFailure,
  ) {
    cancel(path);
    const version = versions.get(path) ?? 0;
    const timer = setTimeout(async () => {
      if (versions.get(path) !== version) return;
      timers.delete(path);
      try {
        const mtime = await write(snapshot);
        if (versions.get(path) !== version) return;
        onSuccess(mtime);
      } catch (error) {
        if (versions.get(path) === version) onFailure(error);
      }
    }, delay);
    timers.set(path, timer);
  }

  function dispose() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    versions.clear();
  }

  return { cancel, schedule, dispose };
}
