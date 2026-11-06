import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import NoteEditor from '../components/notes/NoteEditor.vue';
import { type useNoteDocumentStore } from '../composables/useNoteDocumentStore';
import {
  mergeNoteSearchResults,
  searchNoteContent,
  type NoteSearchResponse,
} from '../notes/note-search';

const sharedContent =
  '计划 Project PROJECT 计划 <!-- prism-task:task_1 -->\n- [ ] 任务标题 <!-- prism-task:task_2 -->\n😀命中';

describe('笔记全文搜索匹配规则', () => {
  it('英文匹配不区分大小写并保留 UTF-16 列位置', () => {
    const english = searchNoteContent('计划.md', sharedContent, 'project', null);
    const emoji = searchNoteContent('计划.md', sharedContent, '命中', null);

    expect(english?.matchCount).toBe(2);
    expect(english?.matches.map((match) => match.columnUtf16)).toEqual([3, 11]);
    expect(emoji?.matches[0]).toMatchObject({ line: 3, columnUtf16: 2 });
  });
});

describe('笔记全文搜索结果合并', () => {
  it('以未保存正文覆盖相同路径的磁盘结果，并按文件名命中优先排序', () => {
    const disk: NoteSearchResponse = {
      requestId: 4,
      files: [
        {
          path: 'zeta.md',
          fileNameMatched: false,
          matchCount: 1,
          matches: [],
          mtime: 'mtime-z',
        },
        {
          path: 'alpha.md',
          fileNameMatched: false,
          matchCount: 1,
          matches: [],
          mtime: 'mtime-old',
        },
      ],
      matchedFileCount: 2,
      scannedFileCount: 5,
      failedPathCount: 0,
      truncated: false,
    };
    const unsaved = {
      path: 'alpha.md',
      fileNameMatched: true,
      matchCount: 0,
      matches: [],
      mtime: 'mtime-new',
      isUnsaved: true,
    };

    const result = mergeNoteSearchResults(disk, [unsaved], 5, 1);

    expect(result.files.map((file) => file.path)).toEqual(['alpha.md', 'zeta.md']);
    expect(result.files[0]).toMatchObject({ isUnsaved: true, mtime: 'mtime-new' });
    expect(result.matchedFileCount).toBe(2);
    expect(result.scannedFileCount).toBe(6);
  });
});

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn().mockResolvedValue(vi.fn()),
  revealSearchMatch: vi.fn(() => true),
  store: null as ReturnType<typeof useNoteDocumentStore> | null,
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'workspace-search' }),
}));

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
    mocks.listen.mockClear();
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

  it('从搜索结果重开文档时保留未保存内容', async () => {
    await search('关键词');
    click('.note-search-match');
    await flushUpdates();
    expect(mocks.store!.ensure(path).content).toBe(diskContent);

    click('.workspace-tab-close');
    await flushUpdates();
    mocks.store!.updateContent(path, '本地关键词');

    click('.note-search-match');
    await flushUpdates();

    expect(mocks.store!.ensure(path).content).toBe('本地关键词');
    expect(mocks.store!.ensure(path).dirty).toBe(true);
    expect(host.querySelector('.test-note-content')?.textContent).toBe('本地关键词');
  });
});
