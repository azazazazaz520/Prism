export interface NoteSaveSnapshot {
  content: string;
  expectedMtime: string | null;
  generation?: number;
}

export type NoteSaveSource = 'editor' | 'task-projection' | 'recovery' | 'conflict';

export interface NoteWriteRequest extends NoteSaveSnapshot {
  path: string;
  generation: number;
  source: NoteSaveSource;
}

export interface NoteConflictData {
  localContent: string;
  diskContent: string;
  diskMtime: string | null;
}

export interface NoteSaveError {
  kind: 'write-failed' | 'conflict';
  cause: unknown;
  message: string;
  conflict?: NoteConflictData;
}

export type NoteSaveResult =
  | {
      status: 'saved';
      path: string;
      generation: number;
      mtime: string;
    }
  | {
      status: 'failed';
      path: string;
      generation: number;
      error: NoteSaveError;
    }
  | {
      status: 'conflict';
      path: string;
      generation: number;
      localContent: string;
      diskContent: string;
      diskMtime: string | null;
    };

type WriteNote = (request: NoteWriteRequest) => Promise<string>;
type ReadConflict = () => Promise<Pick<NoteConflictData, 'diskContent' | 'diskMtime'>>;
type SaveSuccess = (mtime: string, snapshot: NoteSaveSnapshot) => void;
type SaveFailure = (error: unknown) => void;
type SaveSettled = () => void;

export interface ScheduleResultOptions {
  path: string;
  snapshot: NoteSaveSnapshot;
  source: NoteSaveSource;
  write: WriteNote;
  readConflict?: ReadConflict;
  onResult?: (result: NoteSaveResult) => void;
  onSettled?: () => void;
}

interface PendingSave {
  request: NoteWriteRequest;
  write: WriteNote;
  readConflict?: ReadConflict;
  onResult?: (result: NoteSaveResult) => void;
  onSettled?: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExternalConflict(error: unknown): boolean {
  return errorMessage(error).startsWith('FILE_CHANGED_EXTERNALLY');
}

function createWriteError(error: unknown): NoteSaveError {
  return {
    kind: 'write-failed',
    cause: error,
    message: errorMessage(error),
  };
}

/** 按路径统一协调编辑器、任务投影和其他笔记写入，保证同一路径串行。 */
export function createNoteSaveController(delay = 500) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, PendingSave>();
  const running = new Map<string, Promise<void>>();
  const generations = new Map<string, number>();
  const latestSnapshots = new Map<string, NoteSaveSnapshot>();
  const lastResults = new Map<string, NoteSaveResult>();

  function cancel(path: string) {
    const timer = timers.get(path);
    if (timer) clearTimeout(timer);
    timers.delete(path);
    pending.delete(path);
    generations.set(path, (generations.get(path) ?? 0) + 1);
  }

  async function resolveResult(job: PendingSave): Promise<NoteSaveResult> {
    try {
      const mtime = await job.write(job.request);
      return {
        status: 'saved',
        path: job.request.path,
        generation: job.request.generation,
        mtime,
      };
    } catch (error) {
      if (isExternalConflict(error) && job.readConflict) {
        try {
          const conflict = await job.readConflict();
          return {
            status: 'conflict',
            path: job.request.path,
            generation: job.request.generation,
            localContent: job.request.content,
            ...conflict,
          };
        } catch (conflictError) {
          return {
            status: 'failed',
            path: job.request.path,
            generation: job.request.generation,
            error: createWriteError(conflictError),
          };
        }
      }

      const saveError = createWriteError(error);
      if (isExternalConflict(error)) saveError.kind = 'conflict';
      return {
        status: 'failed',
        path: job.request.path,
        generation: job.request.generation,
        error: saveError,
      };
    }
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
      const result = await resolveResult(job);
      lastResults.set(path, result);
      if (result.status === 'saved') {
        latestSnapshots.set(path, {
          content: job.request.content,
          expectedMtime: result.mtime,
        });
        const nextJob = pending.get(path);
        if (nextJob?.request.expectedMtime === job.request.expectedMtime) {
          nextJob.request.expectedMtime = result.mtime;
        }
      }
      if (job.onResult && generations.get(path) === job.request.generation) {
        job.onResult(result);
      }
      job.onSettled?.();
      running.delete(path);
      if (pending.has(path) && !timers.has(path)) void drain(path);
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

  function scheduleResult(options: ScheduleResultOptions): number {
    const generation = (generations.get(options.path) ?? 0) + 1;
    generations.set(options.path, generation);
    latestSnapshots.set(options.path, options.snapshot);

    const timer = timers.get(options.path);
    if (timer) clearTimeout(timer);
    timers.delete(options.path);
    pending.set(options.path, {
      request: { ...options.snapshot, path: options.path, generation, source: options.source },
      write: options.write,
      readConflict: options.readConflict,
      onResult: options.onResult,
      onSettled: options.onSettled,
    });
    scheduleDrain(options.path);
    return generation;
  }

  function schedule(
    path: string,
    snapshot: NoteSaveSnapshot,
    write: (request: NoteWriteRequest) => Promise<string>,
    onSuccess: SaveSuccess,
    onFailure: SaveFailure,
    onSettled?: SaveSettled,
    options?: Pick<ScheduleResultOptions, 'source' | 'readConflict'>,
  ) {
    return scheduleResult({
      path,
      snapshot,
      source: options?.source ?? 'editor',
      write,
      readConflict: options?.readConflict,
      onResult: (result) => {
        const resultSnapshot = { ...snapshot, generation: result.generation };
        if (result.status === 'saved') onSuccess(result.mtime, resultSnapshot);
        else if (result.status === 'conflict') onFailure(new Error('FILE_CHANGED_EXTERNALLY'));
        else onFailure(result.error.cause);
      },
      onSettled,
    });
  }

  function getLatestSnapshot(path: string): NoteSaveSnapshot | null {
    const snapshot = latestSnapshots.get(path);
    return snapshot ? { ...snapshot } : null;
  }

  async function flush(path: string): Promise<NoteSaveResult | null> {
    const timer = timers.get(path);
    if (timer) clearTimeout(timer);
    timers.delete(path);

    while (pending.has(path) || running.has(path)) {
      await drain(path);
    }
    return lastResults.get(path) ?? null;
  }

  function dispose() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    pending.clear();
    generations.clear();
    latestSnapshots.clear();
    lastResults.clear();
  }

  return {
    cancel,
    schedule,
    scheduleResult,
    getLatestSnapshot,
    flush,
    dispose,
  };
}

const sharedNoteSaveController = createNoteSaveController();

/** 应用内所有笔记写入默认共用同一个按路径协调器。 */
export function useNoteSaveController(_delay = 500) {
  return sharedNoteSaveController;
}
