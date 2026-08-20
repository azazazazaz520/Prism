import { ref } from 'vue';
import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';
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
const isIndexing = ref(false);
const indexError = ref<string | null>(null);
const writingPaths = new Set<string>();
const noteRevisions = new Map<string, number>();

function noteFiles(entries: FileEntry[]): string[] {
  return entries.flatMap((entry) =>
    entry.isDir
      ? noteFiles(entry.children ?? [])
      : entry.path.toLowerCase().endsWith('.md')
        ? [entry.path]
        : [],
  );
}

/** 本地 Markdown 笔记的任务引用索引与投影服务。 */
export function useNoteTaskSync(
  documentStore: ReturnType<typeof useNoteDocumentStore> = useNoteDocumentStore(),
) {
  const noteSaveController = useNoteSaveController();
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

  async function refreshIndex(tree?: FileEntry[]) {
    isIndexing.value = true;
    indexError.value = null;
    try {
      const entries = tree ?? (await invoke<FileEntry[]>('list_note_tree'));
      const paths = noteFiles(entries);
      const results: Array<readonly [string, string, number]> = [];
      const revisionsAtStart = new Map(paths.map((path) => [path, noteRevisions.get(path) ?? 0]));
      let nextIndex = 0;
      const worker = async () => {
        while (nextIndex < paths.length) {
          const index = nextIndex++;
          const path = paths[index];
          results[index] = [
            path,
            await invoke<string>('read_note', { path }),
            revisionsAtStart.get(path) ?? 0,
          ];
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, paths.length) }, () => worker()));
      const nextContents = { ...noteContents.value };
      for (const [path, content, revision] of results) {
        if ((noteRevisions.get(path) ?? 0) === revision) nextContents[path] = content;
      }
      noteContents.value = nextContents;
      referenceIndex.value = buildTaskReferenceIndex(nextContents);
    } catch (error) {
      indexError.value = error instanceof Error ? error.message : String(error);
    } finally {
      isIndexing.value = false;
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
    try {
      const content = await invoke<string>('read_note', { path });
      setNoteContent(path, content);
    } catch {
      removeNote(path);
    }
  }

  function resetNotes() {
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
      if (notePath === path || notePath.startsWith(`${path}/`)) delete next[notePath];
    }
    noteContents.value = next;
    referenceIndex.value = buildTaskReferenceIndex(next);
  }

  function renameNote(oldPath: string, newPath: string) {
    const content = noteContents.value[oldPath];
    if (content === undefined) return;
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
      noteRevisions.set(newPath, (noteRevisions.get(oldPath) ?? 0) + 1);
      noteRevisions.delete(oldPath);
      changed = true;
    }
    if (changed) {
      noteContents.value = next;
      referenceIndex.value = buildTaskReferenceIndex(next);
    }
  }

  async function projectTask(task: Pick<Task, 'id' | 'title' | 'completed'>) {
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
          await writeProjectedNote(path, next);
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
