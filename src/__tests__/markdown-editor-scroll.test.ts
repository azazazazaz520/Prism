import { createApp, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import MarkdownEditor from '../components/notes/MarkdownEditor.vue';

const markdown = [
  '# 前文',
  '',
  '```powershell',
  'npm run test',
  'npm run compile',
  'npm run build',
  '```',
].join('\n');

const markdownWithTable = [
  '# 前文',
  '',
  '| 服务 | 作用 |',
  '| --- | --- |',
  '| API | 接口 |',
  '| Worker | 后台任务 |',
  '',
  '表格后的正文',
].join('\n');

const markdownWithInline = 'prefix **bold *italic* end** `**code**` tail';
const markdownWithLinks = '[label](https://example.com "tip") ![alt](image.png) tail';

function previewText(parent: HTMLElement): string {
  const content = parent.querySelector('.cm-line')!.cloneNode(true) as HTMLElement;
  content.querySelectorAll('.cm-md-syntax, .cm-task-meta').forEach((node) => node.remove());
  return (content.textContent ?? '').replace(/\s+/g, ' ').trim();
}

async function waitForEditor(parent: HTMLElement): Promise<EditorView> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const editor = parent.querySelector<HTMLElement>('.cm-editor');
    const view = editor ? EditorView.findFromDOM(editor) : null;
    if (view) return view;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('CodeMirror 编辑器未完成挂载');
}

describe('Markdown 编辑器滚动稳定性', () => {
  let app: App<Element> | null = null;
  let parent: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    app?.unmount();
    parent?.remove();
    app = null;
    parent = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('代码块进入编辑态时应保持相同的块级布局装饰', async () => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
    app = createApp(MarkdownEditor, { modelValue: markdown });
    app.mount(parent);

    const view = await waitForEditor(parent);
    const codeRowTexts = [
      '```powershell',
      'npm run test',
      'npm run compile',
      'npm run build',
      '```',
    ];
    const layoutClasses = () =>
      [...parent!.querySelectorAll<HTMLElement>('.cm-line')]
        .filter((line) => codeRowTexts.includes(line.textContent ?? ''))
        .map((line) => line.className);

    const previewClasses = layoutClasses();
    expect(previewClasses).toHaveLength(5);
    expect(parent.querySelectorAll('.cm-live-code-fence-syntax')).toHaveLength(3);

    const compilePosition = view.state.doc.toString().indexOf('npm run compile');
    view.dispatch({ selection: { anchor: compilePosition } });

    expect(layoutClasses()).toEqual(previewClasses);
    expect(parent.querySelectorAll('.cm-live-code-fence-syntax')).toHaveLength(0);
  });

  it('表格垂直间距应包含在 CodeMirror 可测量的部件容器内', async () => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
    app = createApp(MarkdownEditor, { modelValue: markdownWithTable });
    app.mount(parent);

    await waitForEditor(parent);
    const shell = parent.querySelector<HTMLElement>('.cm-md-table-shell');
    const table = shell?.querySelector<HTMLElement>(':scope > .cm-md-table');

    expect(shell).toBeTruthy();
    expect(table).toBeTruthy();
  });

  it('同一行移动光标时按语法节点更新嵌套强调预览', async () => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
    app = createApp(MarkdownEditor, { modelValue: markdownWithInline });
    app.mount(parent);

    const view = await waitForEditor(parent);
    expect(parent.querySelectorAll('.cm-md-bold')).not.toHaveLength(0);
    expect(parent.querySelectorAll('.cm-md-italic')).not.toHaveLength(0);
    expect(parent.querySelectorAll('.cm-md-code')).not.toHaveLength(0);
    expect(previewText(parent)).toBe('prefix bold italic end **code** tail');

    const boldPosition = markdownWithInline.indexOf('bold');
    view.dispatch({ selection: { anchor: boldPosition } });
    expect(previewText(parent)).toBe('prefix **bold italic end** **code** tail');
    expect(parent.querySelector('.cm-md-bold')).toBeNull();

    view.dispatch({ selection: { anchor: markdownWithInline.indexOf('italic') } });
    expect(previewText(parent)).toBe(markdownWithInline.replace('`**code**`', '**code**'));

    view.dispatch({ selection: { anchor: markdownWithInline.length - 2 } });
    expect(previewText(parent)).toBe('prefix bold italic end **code** tail');
    expect(parent.querySelectorAll('.cm-md-bold')).not.toHaveLength(0);
  });

  it('链接标题与图片地址在预览态隐藏，进入语法范围时恢复源码', async () => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
    app = createApp(MarkdownEditor, { modelValue: markdownWithLinks });
    app.mount(parent);

    const view = await waitForEditor(parent);
    view.dispatch({ selection: { anchor: markdownWithLinks.length } });
    expect(previewText(parent)).toBe('label alt tail');

    view.dispatch({ selection: { anchor: markdownWithLinks.indexOf('https://') + 2 } });
    expect(previewText(parent)).toBe('[label](https://example.com "tip") alt tail');

    view.dispatch({ selection: { anchor: markdownWithLinks.indexOf('image.png') + 2 } });
    expect(previewText(parent)).toBe('label ![alt](image.png) tail');
    view.dispatch({ selection: { anchor: markdownWithLinks.length } });
    expect(previewText(parent)).toBe('label alt tail');
  });
});
