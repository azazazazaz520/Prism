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
    expect(parent.querySelectorAll('.cm-live-code-fence-syntax')).toHaveLength(2);

    const compilePosition = view.state.doc.toString().indexOf('npm run compile');
    view.dispatch({ selection: { anchor: compilePosition } });

    expect(layoutClasses()).toEqual(previewClasses);
    expect(parent.querySelectorAll('.cm-live-code-fence-syntax')).toHaveLength(0);
  });
});
