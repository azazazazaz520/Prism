import { reactive } from 'vue';

export interface NoteDocumentState {
  content: string;
  mtime: string | null;
  dirty: boolean;
  loading: boolean;
  revision: number;
  hydratedRevision: number;
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

  function markSaved(path: string, mtime: string | null) {
    const document = ensure(path);
    document.mtime = mtime;
    document.dirty = false;
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
    markSaved,
    markDirty,
    clear,
    clearAll,
  };
}
