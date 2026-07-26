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

const noteContents = ref<Record<string, string>>({});
const isIndexing = ref(false);
const indexError = ref<string | null>(null);
const writingPaths = new Set<string>();

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
      const results = await Promise.all(
        paths.map(async (path) => [path, await invoke<string>('read_note', { path })] as const),
      );
      noteContents.value = Object.fromEntries(results);
    } catch (error) {
      indexError.value = error instanceof Error ? error.message : String(error);
    } finally {
      isIndexing.value = false;
    }
  }

  function setNoteContent(path: string, content: string) {
    noteContents.value = { ...noteContents.value, [path]: content };
  }

  function resetNotes() {
    noteContents.value = {};
  }

  function removeNote(path: string) {
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
          await invoke('write_note', { path, content: next });
          setNoteContent(path, next);
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
          await invoke('write_note', { path, content: next });
          setNoteContent(path, next);
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
