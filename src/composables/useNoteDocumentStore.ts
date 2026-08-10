import { reactive } from 'vue';

export interface NoteConflict {
  localContent: string;
  diskContent: string;
  diskMtime: string | null;
}

export interface NoteDocumentState {
  content: string;
  mtime: string | null;
  dirty: boolean;
  loading: boolean;
  revision: number;
  hydratedRevision: number;
  conflict: NoteConflict | null;
}

/** 只有完成加载且发生过用户修改的文档才允许进入自动保存流程。 */
export function shouldScheduleNoteSave(document: NoteDocumentState): boolean {
  return (
    !document.loading &&
    document.hydratedRevision >= 0 &&
    document.revision !== document.hydratedRevision
  );
}

/**
 * 维护笔记文件的唯一运行时状态。
 * 主编辑器、分栏编辑器以及任务投影都通过路径访问同一份文档对象。
 */
export function useNoteDocumentStore() {
  const documents = reactive(new Map<string, NoteDocumentState>());

  function ensure(path: string): NoteDocumentState {
    const existing = documents.get(path);
    if (existing) return existing;

    const document: NoteDocumentState = {
      content: '',
      mtime: null,
      dirty: false,
      loading: false,
      revision: 0,
      hydratedRevision: -1,
      conflict: null,
    };
    documents.set(path, document);
    return document;
  }

  function beginLoading(path: string) {
    ensure(path).loading = true;
  }

  function finishLoading(path: string, content: string, mtime: string | null) {
    const document = ensure(path);
    document.content = content;
    document.mtime = mtime;
    document.dirty = false;
    document.conflict = null;
    queueMicrotask(() => {
      document.loading = false;
    });
    document.revision += 1;
    document.hydratedRevision = document.revision;
  }

  function failLoading(path: string) {
    ensure(path).loading = false;
  }

  function updateContent(path: string, content: string) {
    const document = ensure(path);
    if (document.content === content) return;
    document.content = content;
    document.dirty = true;
    document.revision += 1;
  }

  /** 文件重命名后迁移运行时状态，避免新路径被初始化为空文档。 */
  function rename(oldPath: string, newPath: string) {
    if (oldPath === newPath) return;
    const document = documents.get(oldPath);
    if (!document) return;
    documents.set(newPath, document);
    documents.delete(oldPath);
  }

  /** 目录重命名后迁移目录及其子路径下的全部运行时状态。 */
  function renamePrefix(oldPrefix: string, newPrefix: string) {
    if (oldPrefix === newPrefix) return;
    const affected = [...documents.keys()].filter(
      (path) => path === oldPrefix || path.startsWith(`${oldPrefix}/`),
    );
    for (const oldPath of affected) {
      rename(oldPath, `${newPrefix}${oldPath.slice(oldPrefix.length)}`);
    }
  }

  function markSaved(path: string, mtime: string | null) {
    const document = ensure(path);
    document.mtime = mtime;
    document.dirty = false;
    document.conflict = null;
  }

  function setConflict(path: string, diskContent: string, diskMtime: string | null) {
    const document = ensure(path);
    document.conflict = {
      localContent: document.content,
      diskContent,
      diskMtime,
    };
  }

  function clearConflict(path: string) {
    ensure(path).conflict = null;
  }

  function acceptConflictForOverwrite(path: string) {
    const document = ensure(path);
    if (document.conflict) document.mtime = document.conflict.diskMtime;
    document.conflict = null;
  }

  function markDirty(path: string) {
    ensure(path).dirty = true;
  }

  function clear(path: string) {
    documents.delete(path);
  }

  function clearAll() {
    documents.clear();
  }

  return {
    documents,
    ensure,
    beginLoading,
    finishLoading,
    failLoading,
    updateContent,
    rename,
    renamePrefix,
    markSaved,
    setConflict,
    clearConflict,
    acceptConflictForOverwrite,
    markDirty,
    clear,
    clearAll,
  };
}
