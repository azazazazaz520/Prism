import { ref } from 'vue';
import { diagnosticsLogger, invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';
import type { FileEntry, Task } from '../types';
import {
  buildTaskReferenceIndex,
  parseTaskReferences,
  removeTaskReference,
  referencesForTask,
  updateTaskReferences,
  type TaskReferenceIndex,
} from '../notes/task-references';
import {
  beginNoteSelfWrite,
  completeNoteSelfWrite,
  endNoteSelfWrite,
} from './useNoteSelfWriteTracker';
import { useNoteSaveController, type NoteSaveResult } from './useNoteSaveController';
import { useNoteDocumentStore } from './useNoteDocumentStore';
import { saveNoteRecovery } from './useNoteRecovery';

const noteContents = ref<Record<string, string>>({});
const writingPaths = new Set<string>();
const noteRevisions = new Map<string, number>();

/** 本地 Markdown 笔记的任务引用索引与投影服务。 */
export function useNoteTaskSync(
  documentStore: ReturnType<typeof useNoteDocumentStore> = useNoteDocumentStore(),
) {
  const noteSaveController = useNoteSaveController();
  const isIndexing = ref(false);
  const indexError = ref<string | null>(null);
  const isIndexComplete = ref(false);
  let indexGeneration = 0;
  let indexPromise: Promise<void> | null = null;
  const pendingTaskProjections = new Map<string, Pick<Task, 'id' | 'title' | 'completed'>>();
  const referenceIndex = ref<TaskReferenceIndex>({
    byTaskId: new Map(),
    byNotePath: new Map(),
  });

  function replaceIndexNote(path: string, content: string | null) {
    const byTaskId = new Map(referenceIndex.value.byTaskId);
    const byNotePath = new Map(referenceIndex.value.byNotePath);
    for (const reference of byNotePath.get(path) ?? []) {
      const next = (byTaskId.get(reference.taskId) ?? []).filter(
        (item) => item.notePath !== path || item.line !== reference.line,
      );
      if (next.length > 0) byTaskId.set(reference.taskId, next);
      else byTaskId.delete(reference.taskId);
    }

    if (content === null) byNotePath.delete(path);
    else {
      const references = parseTaskReferences(content, path);
      byNotePath.set(path, references);
      for (const reference of references) {
        byTaskId.set(reference.taskId, [...(byTaskId.get(reference.taskId) ?? []), reference]);
      }
    }
    referenceIndex.value = { byTaskId, byNotePath };
  }

  function cancelIndex() {
    indexGeneration += 1;
    for (const [path, revision] of noteRevisions) noteRevisions.set(path, revision + 1);
    indexPromise = null;
    isIndexing.value = false;
    isIndexComplete.value = false;
  }

  async function runIndex(generation: number) {
    let directories = [''];
    const paths: string[] = [];
    let failures = 0;
    while (directories.length > 0 && generation === indexGeneration) {
      const directory = directories.shift()!;
      try {
        const entries = await invoke<FileEntry[]>('list_note_dir', { path: directory });
        if (generation !== indexGeneration) return;
        for (const entry of entries) {
          if (entry.isDir) directories.push(entry.path);
          else if (entry.path.toLowerCase().endsWith('.md')) paths.push(entry.path);
        }
      } catch (error) {
        failures += 1;
        diagnosticsLogger.error(
          'notes',
          'notes.task_index_directory_failed',
          '扫描任务索引时读取目录失败',
          error,
          {
            path: directory,
          },
        );
      }
    }

    for (let offset = 0; offset < paths.length && generation === indexGeneration; offset += 20) {
      const batch = paths.slice(offset, offset + 20);
      const revisions = new Map(batch.map((path) => [path, noteRevisions.get(path) ?? 0]));
      const results: Array<readonly [string, string] | null> = new Array(batch.length);
      let nextIndex = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, batch.length) }, async () => {
          while (nextIndex < batch.length) {
            const index = nextIndex++;
            const path = batch[index];
            try {
              results[index] = [path, await invoke<string>('read_note', { path })];
            } catch (error) {
              failures += 1;
              diagnosticsLogger.error(
                'notes',
                'notes.task_index_note_failed',
                '扫描任务索引时读取笔记失败',
                error,
                {
                  path,
                },
              );
              results[index] = null;
            }
          }
        }),
      );
      if (generation !== indexGeneration) return;
      const nextContents = { ...noteContents.value };
      const byTaskId = new Map(referenceIndex.value.byTaskId);
      const byNotePath = new Map(referenceIndex.value.byNotePath);
      for (const result of results) {
        if (!result) continue;
        const [path, content] = result;
        if ((noteRevisions.get(path) ?? 0) !== revisions.get(path)) continue;
        nextContents[path] = content;
        for (const reference of byNotePath.get(path) ?? []) {
          const remaining = (byTaskId.get(reference.taskId) ?? []).filter(
            (item) => item.notePath !== path,
          );
          if (remaining.length > 0) byTaskId.set(reference.taskId, remaining);
          else byTaskId.delete(reference.taskId);
        }
        const references = parseTaskReferences(content, path);
        byNotePath.set(path, references);
        for (const reference of references) {
          byTaskId.set(reference.taskId, [...(byTaskId.get(reference.taskId) ?? []), reference]);
        }
      }
      noteContents.value = nextContents;
      referenceIndex.value = { byTaskId, byNotePath };
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    if (generation === indexGeneration && failures === 0) {
      await Promise.all([...pendingTaskProjections.values()].map((task) => projectTask(task)));
    }
    if (generation === indexGeneration && failures > 0) {
      indexError.value = `索引未完整建立，${failures} 项读取失败`;
    } else if (generation === indexGeneration) {
      isIndexComplete.value = true;
    }
  }

  function refreshIndex() {
    if (isIndexComplete.value) return Promise.resolve();
    if (isIndexing.value) return indexPromise ?? Promise.resolve();
    const generation = ++indexGeneration;
    isIndexing.value = true;
    indexError.value = null;
    indexPromise = runIndex(generation)
      .catch((error) => {
        if (generation === indexGeneration) {
          indexError.value = error instanceof Error ? error.message : String(error);
        }
      })
      .finally(() => {
        if (generation === indexGeneration) {
          isIndexing.value = false;
          indexPromise = null;
        }
      });
    return indexPromise;
  }

  async function ensureIndexReady() {
    if (isIndexComplete.value) return;
    let expectedGeneration = indexGeneration;
    let pending = indexPromise;
    if (!isIndexing.value) {
      pending = refreshIndex();
      expectedGeneration = indexGeneration;
    }
    await pending;
    if (indexError.value !== null) throw new Error(indexError.value);
    if (expectedGeneration !== indexGeneration || !isIndexComplete.value) {
      throw new Error('任务引用索引已取消，无法确认全部笔记引用');
    }
  }

  function setNoteContent(path: string, content: string) {
    noteRevisions.set(path, (noteRevisions.get(path) ?? 0) + 1);
    noteContents.value = { ...noteContents.value, [path]: content };
    replaceIndexNote(path, content);
  }

  /** 增量刷新单篇笔记，供文件监听器维护任务引用索引。 */
  async function refreshNoteIndex(path: string) {
    if (!path.toLowerCase().endsWith('.md')) return;
    const document = documentStore.ensure(path);
    if (document.conflict || document.dirty) {
      if (document.content !== noteContents.value[path]) setNoteContent(path, document.content);
      return;
    }
    const revision = (noteRevisions.get(path) ?? 0) + 1;
    noteRevisions.set(path, revision);
    try {
      const content = await invoke<string>('read_note', { path });
      if ((noteRevisions.get(path) ?? 0) === revision) setNoteContent(path, content);
    } catch {
      if ((noteRevisions.get(path) ?? 0) === revision) removeNote(path);
    }
  }

  function resetNotes() {
    cancelIndex();
    isIndexComplete.value = false;
    pendingTaskProjections.clear();
    noteContents.value = {};
    referenceIndex.value = { byTaskId: new Map(), byNotePath: new Map() };
  }

  /** 将任务投影加入与编辑器共用的按路径写入队列。 */
  async function writeProjectedNote(path: string, content: string): Promise<NoteSaveResult | null> {
    const document = documentStore.ensure(path);
    const latestSnapshot = noteSaveController.getLatestSnapshot(path);
    const expectedMtime =
      latestSnapshot?.expectedMtime ??
      document.mtime ??
      (await invoke<string>('get_note_mtime', { path }));
    const currentContent = latestSnapshot?.content ?? noteContents.value[path] ?? document.content;

    if (document.hydratedRevision < 0 || document.content !== currentContent) {
      documentStore.finishLoading(path, currentContent, expectedMtime);
    }
    documentStore.updateContent(path, content);
    setNoteContent(path, content);

    let selfWriteToken: ReturnType<typeof beginNoteSelfWrite> | null = null;
    const generation = noteSaveController.scheduleResult({
      path,
      snapshot: { content, expectedMtime },
      source: 'task-projection',
      write: async (request) => {
        documentStore.markSaving(path, request.generation);
        const token = beginNoteSelfWrite(path, {
          content: request.content,
          expectedMtime: request.expectedMtime,
        });
        selfWriteToken = token;
        const mtime = await invoke<string>('write_note', {
          path,
          content: request.content,
          expectedMtime: request.expectedMtime,
        });
        completeNoteSelfWrite(path, token, { mtime, content: request.content });
        return mtime;
      },
      readConflict: async () => {
        const meta = await invoke<{ content: string; mtime: string }>('read_note_meta', { path });
        return { diskContent: meta.content, diskMtime: meta.mtime };
      },
      onResult: (result) => {
        if (result.status === 'saved') {
          documentStore.markSaved(path, result.mtime, result.generation);
        } else if (result.status === 'conflict') {
          void saveNoteRecovery({
            notePath: path,
            content: result.localContent,
            generation: result.generation,
            documentMtime: expectedMtime,
            reason: 'conflict',
            errorMessage: '任务投影保存时检测到外部修改',
          }).catch(() => undefined);
          documentStore.setConflict(path, result.diskContent, result.diskMtime, result.generation);
        } else {
          void saveNoteRecovery({
            notePath: path,
            content,
            generation: result.generation,
            documentMtime: expectedMtime,
            reason: 'save-failed',
            errorMessage: result.error.message,
          }).catch(() => undefined);
          documentStore.markSaveFailed(path, result.generation, result.error.cause);
        }
      },
      onSettled: () => {
        if (selfWriteToken !== null) endNoteSelfWrite(path, selfWriteToken);
      },
    });
    documentStore.markScheduled(path, generation);

    return noteSaveController.flush(path);
  }

  function removeNote(path: string) {
    noteRevisions.set(path, (noteRevisions.get(path) ?? 0) + 1);
    const next = { ...noteContents.value };
    delete next[path];
    noteContents.value = next;
    replaceIndexNote(path, null);
  }

  function removeNotesUnderPath(path: string) {
    const next = { ...noteContents.value };
    for (const notePath of Object.keys(next)) {
      if (notePath === path || notePath.startsWith(`${path}/`)) {
        noteRevisions.set(notePath, (noteRevisions.get(notePath) ?? 0) + 1);
        delete next[notePath];
      }
    }
    noteContents.value = next;
    referenceIndex.value = buildTaskReferenceIndex(next);
  }

  function renameNote(oldPath: string, newPath: string) {
    const content = noteContents.value[oldPath];
    if (content === undefined) return;
    noteRevisions.set(oldPath, (noteRevisions.get(oldPath) ?? 0) + 1);
    noteRevisions.set(newPath, (noteRevisions.get(newPath) ?? 0) + 1);
    const next = { ...noteContents.value, [newPath]: content };
    delete next[oldPath];
    noteContents.value = next;
    replaceIndexNote(oldPath, null);
    replaceIndexNote(newPath, content);
  }

  function renameNotesUnderPath(oldPrefix: string, newPrefix: string) {
    const next = { ...noteContents.value };
    let changed = false;
    for (const [oldPath, content] of Object.entries(noteContents.value)) {
      if (oldPath !== oldPrefix && !oldPath.startsWith(`${oldPrefix}/`)) continue;
      const newPath = `${newPrefix}${oldPath.slice(oldPrefix.length)}`;
      delete next[oldPath];
      next[newPath] = content;
      noteRevisions.set(oldPath, (noteRevisions.get(oldPath) ?? 0) + 1);
      noteRevisions.set(newPath, (noteRevisions.get(newPath) ?? 0) + 1);
      changed = true;
    }
    if (changed) {
      noteContents.value = next;
      referenceIndex.value = buildTaskReferenceIndex(next);
    }
  }

  async function projectTask(task: Pick<Task, 'id' | 'title' | 'completed'>) {
    pendingTaskProjections.set(task.id, task);
    const references = referencesForTask(referenceIndex.value, task.id);
    const paths = [...new Set(references.map((reference) => reference.notePath))];
    await Promise.all(
      paths.map(async (path) => {
        const current =
          noteSaveController.getLatestSnapshot(path)?.content ?? noteContents.value[path];
        if (current === undefined) return;
        const next = updateTaskReferences(current, task);
        if (next === current) return;
        writingPaths.add(path);
        try {
          await writeProjectedNote(path, next);
        } finally {
          writingPaths.delete(path);
        }
      }),
    );
  }

  async function removeTaskFromAllNotes(taskId: string) {
    await ensureIndexReady();
    const references = referencesForTask(referenceIndex.value, taskId);
    const paths = [...new Set(references.map((reference) => reference.notePath))];
    await Promise.all(
      paths.map(async (path) => {
        const current =
          noteSaveController.getLatestSnapshot(path)?.content ?? noteContents.value[path];
        if (current === undefined) return;
        let next = current;
        for (const reference of references
          .filter((item) => item.notePath === path)
          .slice()
          .reverse()) {
          next = removeTaskReference(next, taskId, reference.line);
        }
        if (next === current) return;
        writingPaths.add(path);
        try {
          const result = await writeProjectedNote(path, next);
          if (!result || result.status !== 'saved') {
            throw new Error(`移除笔记中的任务引用失败：${path}`);
          }
        } finally {
          writingPaths.delete(path);
        }
      }),
    );
  }

  function isProjecting(path: string) {
    return writingPaths.has(path);
  }

  return {
    noteContents,
    referenceIndex,
    isIndexing,
    indexError,
    refreshIndex,
    cancelIndex,
    ensureIndexReady,
    refreshNoteIndex,
    setNoteContent,
    resetNotes,
    removeNote,
    removeNotesUnderPath,
    renameNote,
    renameNotesUnderPath,
    projectTask,
    removeTaskFromAllNotes,
    isProjecting,
  };
}
