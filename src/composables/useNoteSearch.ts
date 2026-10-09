import { onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { NoteDocumentState } from './useNoteDocumentStore';
import {
  mergeNoteSearchResults,
  searchNoteContent,
  type NoteSearchFileResult,
  type NoteSearchResponse,
} from '../notes/note-search';

interface UnsavedDocumentSnapshot {
  path: string;
  content: string;
  mtime: string | null;
}

export function useNoteSearch(
  workspacePath: Ref<string>,
  documents: Map<string, NoteDocumentState>,
  openPaths: ComputedRef<string[]>,
) {
  const query = ref('');
  const response = ref<NoteSearchResponse | null>(null);
  const searching = ref(false);
  const stale = ref(false);
  const error = ref<string | null>(null);
  const displayedQuery = ref('');
  let timer: ReturnType<typeof setTimeout> | null = null;
  let requestSequence = 0;
  let changedPathsDuringSearch: Set<string> | null = null;
  let lastUnsavedDocuments = new Map<string, UnsavedDocumentSnapshot>();
  let disposed = false;

  function getUnsavedDocuments(): UnsavedDocumentSnapshot[] {
    return [...new Set(openPaths.value)].flatMap((path) => {
      const document = documents.get(path);
      if (!document || (!document.dirty && !document.conflict)) return [];
      return [{ path, content: document.content, mtime: document.mtime }];
    });
  }

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function invalidate() {
    requestSequence += 1;
    searching.value = false;
    changedPathsDuringSearch = null;
    void invoke('cancel_note_search').catch(() => undefined);
  }

  function clear() {
    clearTimer();
    invalidate();
    query.value = '';
    displayedQuery.value = '';
    response.value = null;
    stale.value = false;
    error.value = null;
    lastUnsavedDocuments.clear();
  }

  function scheduleSearch() {
    clearTimer();
    invalidate();
    error.value = null;
    if (!query.value.trim()) {
      response.value = null;
      displayedQuery.value = '';
      stale.value = false;
      return;
    }
    timer = setTimeout(() => void searchNow(), 300);
  }

  async function searchNow() {
    clearTimer();
    const normalizedQuery = query.value.trim();
    if (!normalizedQuery || !workspacePath.value) return;

    const sequence = ++requestSequence;
    const requestId = sequence;
    const workspace = normalizeWorkspacePath(workspacePath.value);
    const unsavedDocuments = getUnsavedDocuments();
    const skippedPaths = unsavedDocuments.map((document) => document.path);
    const changedPaths = new Set<string>();
    changedPathsDuringSearch = changedPaths;
    searching.value = true;
    error.value = null;

    try {
      const disk = await invoke<NoteSearchResponse>('search_notes', {
        requestId,
        query: normalizedQuery,
        skippedPaths,
      });
      if (
        disposed ||
        sequence !== requestSequence ||
        workspace !== normalizeWorkspacePath(workspacePath.value) ||
        disk.requestId !== requestId
      ) {
        return;
      }

      const unsavedResults: NoteSearchFileResult[] = unsavedDocuments.flatMap((document) => {
        const result = searchNoteContent(
          document.path,
          document.content,
          normalizedQuery,
          document.mtime,
        );
        return result ? [result] : [];
      });
      const nextResponse = mergeNoteSearchResults(
        disk,
        unsavedResults,
        requestId,
        unsavedDocuments.length,
      );
      const unsavedByPath = new Map(
        unsavedDocuments.map((document) => [normalizeSearchPath(document.path), document]),
      );
      stale.value =
        [...changedPaths].some((path) =>
          changedPathAffectsResults(
            path,
            nextResponse.files,
            unsavedByPath,
            documents,
            normalizedQuery,
          ),
        ) ||
        unsavedDocuments.some((snapshot) => {
          const current = documents.get(snapshot.path);
          return (
            current !== undefined &&
            hasSearchResultChanged(
              snapshot.path,
              snapshot.content,
              current.content,
              normalizedQuery,
            )
          );
        });
      response.value = nextResponse;
      displayedQuery.value = normalizedQuery;
      lastUnsavedDocuments = unsavedByPath;
    } catch (searchError) {
      if (
        !disposed &&
        sequence === requestSequence &&
        workspace === normalizeWorkspacePath(workspacePath.value)
      ) {
        error.value = String(searchError);
      }
    } finally {
      if (!disposed && sequence === requestSequence) {
        searching.value = false;
        changedPathsDuringSearch = null;
      }
    }
  }

  function markStale(paths: string[]) {
    const changedPaths = paths.map(normalizeSearchPath);
    for (const path of changedPaths) changedPathsDuringSearch?.add(path);
    if (!query.value.trim() || !response.value) return;

    const affected = changedPaths.some((path) => {
      const snapshot = lastUnsavedDocuments.get(path);
      if (snapshot) {
        const current = documents.get(snapshot.path);
        return (
          current !== undefined &&
          hasSearchResultChanged(
            snapshot.path,
            snapshot.content,
            current.content,
            displayedQuery.value,
          )
        );
      }
      if (responseContainsPath(response.value, path)) return true;
      const current = findDocument(path, documents);
      return Boolean(
        current &&
        (current.document.dirty || current.document.conflict) &&
        searchNoteContent(current.path, current.document.content, displayedQuery.value, null),
      );
    });
    if (affected) stale.value = true;
  }

  function resetForWorkspace() {
    clearTimer();
    invalidate();
    query.value = '';
    displayedQuery.value = '';
    response.value = null;
    stale.value = false;
    error.value = null;
    lastUnsavedDocuments.clear();
  }

  watch(query, scheduleSearch);
  watch(
    () => normalizeWorkspacePath(workspacePath.value),
    () => resetForWorkspace(),
  );
  watch(
    () =>
      [...new Set(openPaths.value)].flatMap((path) => {
        const document = documents.get(path);
        if (!document || (!document.dirty && !document.conflict)) return [];
        return [{ path, revision: document.revision, conflict: Boolean(document.conflict) }];
      }),
    (next, previous) => {
      const previousByPath = new Map(
        previous.map((document) => [normalizeSearchPath(document.path), document]),
      );
      const changed = next.filter((document) => {
        const previousDocument = previousByPath.get(normalizeSearchPath(document.path));
        return (
          !previousDocument ||
          previousDocument.revision !== document.revision ||
          previousDocument.conflict !== document.conflict
        );
      });
      markStale(changed.map((document) => document.path));
    },
  );

  onUnmounted(() => {
    disposed = true;
    clearTimer();
    invalidate();
  });

  return {
    query,
    response,
    searching,
    stale,
    error,
    displayedQuery,
    searchNow,
    clear,
    markStale,
    resetForWorkspace,
  };
}

function normalizeWorkspacePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
  return typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win')
    ? normalized.toLowerCase()
    : normalized;
}

function normalizeSearchPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win')
    ? normalized.toLowerCase()
    : normalized;
}

function responseContainsPath(
  response: Pick<NoteSearchResponse, 'files'> | null,
  normalizedPath: string,
): boolean {
  return Boolean(response?.files.some((file) => normalizeSearchPath(file.path) === normalizedPath));
}

function changedPathAffectsResults(
  normalizedPath: string,
  files: NoteSearchFileResult[],
  unsavedDocuments: Map<string, UnsavedDocumentSnapshot>,
  documents: Map<string, NoteDocumentState>,
  query: string,
): boolean {
  const snapshot = unsavedDocuments.get(normalizedPath);
  if (snapshot) {
    const current = documents.get(snapshot.path);
    if (current) {
      return hasSearchResultChanged(snapshot.path, snapshot.content, current.content, query);
    }
  }
  if (files.some((file) => normalizeSearchPath(file.path) === normalizedPath)) return true;
  const current = findDocument(normalizedPath, documents);
  return Boolean(
    current &&
    (current.document.dirty || current.document.conflict) &&
    searchNoteContent(current.path, current.document.content, query, null),
  );
}

function findDocument(
  normalizedPath: string,
  documents: Map<string, NoteDocumentState>,
): { path: string; document: NoteDocumentState } | undefined {
  for (const [path, document] of documents) {
    if (normalizeSearchPath(path) === normalizedPath) return { path, document };
  }
  return undefined;
}

function hasSearchResultChanged(
  path: string,
  previousContent: string,
  currentContent: string,
  query: string,
): boolean {
  const previousResult = searchNoteContent(path, previousContent, query, null);
  const currentResult = searchNoteContent(path, currentContent, query, null);
  return JSON.stringify(previousResult) !== JSON.stringify(currentResult);
}
