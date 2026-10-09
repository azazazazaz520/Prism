import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import NoteEditor from '../components/notes/NoteEditor.vue';
import type { useNoteDocumentStore } from '../composables/useNoteDocumentStore';
import { searchNoteContent } from '../notes/note-search';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  revealSearchMatch: vi.fn(() => true),
  store: null as ReturnType<typeof useNoteDocumentStore> | null,
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(vi.fn()) }));
vi.mock('../diagnostics/invoke-logged', () => ({
  invokeWithDiagnostics: mocks.invoke,
  diagnosticsLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../composables/useTaskStore', async () => {
  const { ref } = await import('vue');
  return { useTaskStore: () => ({ tasks: ref([]) }) };
});
vi.mock('../composables/useNoteDocumentStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../composables/useNoteDocumentStore')>();
  return {
    ...actual,
    useNoteDocumentStore: () => {
      mocks.store = actual.useNoteDocumentStore();
      return mocks.store;
    },
  };
});
vi.mock('../components/notes/MarkdownEditor.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    __esModule: true,
    default: defineComponent({
      props: ['modelValue'],
      setup(props, { expose }) {
        expose({
          revealSearchMatch: mocks.revealSearchMatch,
          scrollToLine: () => true,
          focus: vi.fn(),
        });
        return () => h('div', { class: 'test-note-content' }, props.modelValue);
      },
    }),
  };
});

describe('搜索结果打开与保留文档', () => {
  const path = 'retained.md';
  const diskContent = '磁盘关键词';
  let app: App;
  let host: HTMLDivElement;

  async function flushUpdates() {
    for (let i = 0; i < 15; i += 1) {
      vi.runAllTicks();
      await nextTick();
    }
  }

  function click(selector: string) {
    const button = host.querySelector<HTMLButtonElement>(selector);
    expect(button).not.toBeNull();
    button!.click();
  }

  async function search(query: string) {
    const input = host.querySelector<HTMLInputElement>('[aria-label="搜索笔记内容"]')!;
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushUpdates();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    localStorage.clear();
    mocks.invoke.mockReset();
    mocks.revealSearchMatch.mockClear();
    mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'get_notes_directory') return 'D:/notes';
      if (command === 'list_note_dir' || command === 'list_note_recoveries') return [];
      if (command === 'read_note_meta') return { content: diskContent, mtime: 'disk-mtime' };
      if (command === 'get_note_mtime') return 'disk-mtime';
      if (command === 'search_notes') {
        const skippedPaths = args!.skippedPaths as string[];
        const result = skippedPaths.includes(path)
          ? null
          : searchNoteContent(path, diskContent, args!.query as string, 'disk-mtime');
        return {
          requestId: args!.requestId,
          files: result ? [result] : [],
          matchedFileCount: result ? 1 : 0,
          scannedFileCount: skippedPaths.includes(path) ? 0 : 1,
          failedPathCount: 0,
          truncated: false,
        };
      }
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(NoteEditor);
    app.mount(host);
    await flushUpdates();
    click('[role="tab"]:last-child');
    await flushUpdates();
  });

  afterEach(() => {
    app.unmount();
    host.remove();
    localStorage.clear();
    vi.useRealTimers();
  });

  it.each(['未保存', '冲突'] as const)(
    '从搜索结果重开已关闭的%s文档时保留本地内容',
    async (state) => {
      await search('关键词');
      click('.note-search-match');
      await flushUpdates();
      expect(mocks.store!.ensure(path).content).toBe(diskContent);

      click('.workspace-tab-close');
      await flushUpdates();
      expect(host.querySelector('[data-workspace-path]')).toBeNull();

      mocks.store!.updateContent(path, '本地独有关键词');
      if (state === '冲突') mocks.store!.setConflict(path, '外部关键词', 'external-mtime');
      await flushUpdates();
      const conflict = mocks.store!.ensure(path).conflict;
      mocks.invoke.mockClear();
      mocks.revealSearchMatch.mockClear();
      click('.note-search-match');
      await flushUpdates();

      const document = mocks.store!.ensure(path);
      expect(document.content).toBe('本地独有关键词');
      expect(document.dirty).toBe(true);
      expect(document.conflict).toEqual(conflict);
      expect(document.mtime).toBe('disk-mtime');
      expect(
        mocks.invoke.mock.calls.some(
          ([command]) => command === 'read_note_meta' || command === 'get_note_mtime',
        ),
      ).toBe(false);
      expect(mocks.revealSearchMatch).toHaveBeenCalledWith(1, 4, 3);
      expect(host.querySelector('.test-note-content')?.textContent).toBe('本地独有关键词');

      click('.workspace-tab-close');
      await flushUpdates();
      const store = mocks.store!;
      const query = '本地独有';

      await search(query);
      expect(mocks.invoke).toHaveBeenCalledWith(
        'search_notes',
        expect.objectContaining({ skippedPaths: [path] }),
      );
      expect(host.querySelector('.note-search-match')?.textContent).toContain(query);
      expect(host.querySelector('.note-search-unsaved')).not.toBeNull();
      expect(host.querySelector('.note-search-stale')).toBeNull();

      store.updateContent(path, '其他内容');
      await flushUpdates();
      expect(host.querySelector('.note-search-stale')).not.toBeNull();
      await search(query);
      expect(host.querySelector('.note-search-match')).toBeNull();
    },
  );
});
