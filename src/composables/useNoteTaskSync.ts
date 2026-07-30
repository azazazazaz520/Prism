import { computed, ref } from 'vue';
import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';
import type { FileEntry, Task } from '../types';
import {
  buildTaskReferenceIndex,
  removeTaskReference,
  referencesForTask,
  updateTaskReferences,
  type TaskReferenceIndex,
} from '../notes/task-references';
import { FILE_CHANGED_EXTERNALLY } from '../utils/error-codes';

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
export function useNoteTaskSync() {
  const referenceIndex = computed<TaskReferenceIndex>(() =>
    buildTaskReferenceIndex(noteContents.value),
  );

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
    } catch (error) {
      indexError.value = error instanceof Error ? error.message : String(error);
    } finally {
      isIndexing.value = false;
    }
  }

  function setNoteContent(path: string, content: string) {
    noteRevisions.set(path, (noteRevisions.get(path) ?? 0) + 1);
    noteContents.value = { ...noteContents.value, [path]: content };
  }

  /** 增量刷新单篇笔记，供文件监听器维护任务引用索引。 */
  async function refreshNoteIndex(path: string) {
    if (!path.toLowerCase().endsWith('.md')) return;
    try {
      const content = await invoke<string>('read_note', { path });
      setNoteContent(path, content);
    } catch {
      removeNote(path);
    }
  }

  function resetNotes() {
    noteContents.value = {};
  }

  /** 使用文件版本校验写入任务引用，避免覆盖外部编辑。 */
  async function writeNoteSafely(path: string, content: string): Promise<string | null> {
    const expectedMtime = await invoke<string>('get_note_mtime', { path });
    try {
      return await invoke<string>('write_note', { path, content, expectedMtime });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith(FILE_CHANGED_EXTERNALLY)) {
        const meta = await invoke<{ content: string; mtime: string }>('read_note_meta', { path });
        setNoteContent(path, meta.content);
        return null;
      }
      throw error;
    }
  }

  function removeNote(path: string) {
    noteRevisions.set(path, (noteRevisions.get(path) ?? 0) + 1);
    const next = { ...noteContents.value };
    delete next[path];
    noteContents.value = next;
  }

  function removeNotesUnderPath(path: string) {
    const next = { ...noteContents.value };
    for (const notePath of Object.keys(next)) {
      if (notePath === path || notePath.startsWith(`${path}/`)) delete next[notePath];
    }
    noteContents.value = next;
  }

  function renameNote(oldPath: string, newPath: string) {
    const content = noteContents.value[oldPath];
    if (content === undefined) return;
    const next = { ...noteContents.value, [newPath]: content };
    delete next[oldPath];
    noteContents.value = next;
  }

  async function projectTask(task: Pick<Task, 'id' | 'title' | 'completed'>) {
    const references = referencesForTask(referenceIndex.value, task.id);
    const paths = [...new Set(references.map((reference) => reference.notePath))];
    await Promise.all(
      paths.map(async (path) => {
        const current = noteContents.value[path];
        if (current === undefined) return;
        const next = updateTaskReferences(current, task);
        if (next === current) return;
        writingPaths.add(path);
        try {
          const writtenMtime = await writeNoteSafely(path, next);
          if (writtenMtime) setNoteContent(path, next);
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
        const current = noteContents.value[path];
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
          const writtenMtime = await writeNoteSafely(path, next);
          if (writtenMtime) setNoteContent(path, next);
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
    projectTask,
    removeTaskFromAllNotes,
    isProjecting,
  };
}
