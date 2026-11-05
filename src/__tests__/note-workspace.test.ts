import { defaultKeymap, history, historyKeymap, undo } from '@codemirror/commands';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { replaceEditorDocument } from '../components/notes/editor-document-sync';
import {
  type WorkspaceNode,
  type WorkspaceTab,
  closeLeaf,
  createTab,
  createWorkspaceState,
  findLeaf,
  goBack,
  goForward,
  listLeaves,
  moveTab,
  openInCurrentTab,
  openTab,
  renameTabPath,
  splitLeaf,
} from '../domain/note-workspace';
import { parseTaskReferences, updateTaskReferences } from '../notes/task-references';

describe('笔记工作区树', () => {
  it('关闭左侧 leaf 后只保留右侧内容', () => {
    let state = createWorkspaceState();
    state = splitLeaf(state, 'leaf-1', 'horizontal', 'leaf-2');
    const rightTab = createTab('right.md');
    state = {
      ...state,
      root: replaceLeafTabs(state.root, 'leaf-2', [rightTab]),
      activeLeafId: 'leaf-1',
    };
    state = closeLeaf(state, 'leaf-1');

    expect(listLeaves(state.root)).toHaveLength(1);
    expect(findLeaf(state.root, 'leaf-2')?.tabs.map((tab) => tab.path)).toEqual(['right.md']);
    expect(state.activeLeafId).toBe('leaf-2');
  });

  it('标签移动到新编辑区后不会在来源编辑区留下重复标签', () => {
    let state = createWorkspaceState();
    const first = createTab('first.md');
    const second = createTab('second.md');
    state = { ...state, root: replaceLeafTabs(state.root, 'leaf-1', [first, second]) };
    state = splitLeaf(state, 'leaf-1', 'horizontal', 'leaf-2');
    state = moveTab(state, 'leaf-1', 'leaf-2', second.id);

    expect(findLeaf(state.root, 'leaf-1')?.tabs.map((tab) => tab.path)).toEqual(['first.md']);
    expect(findLeaf(state.root, 'leaf-2')?.tabs.map((tab) => tab.path)).toEqual(['second.md']);
  });

  it('重命名文档时只迁移标签路径并保留活动标签', () => {
    let state = createWorkspaceState();
    state = openTab(state, 'leaf-1', 'old.md');
    state = renameTabPath(state, 'old.md', 'new.md');

    expect(findLeaf(state.root, 'leaf-1')?.tabs).toEqual([
      expect.objectContaining({ id: 'old.md', path: 'new.md' }),
    ]);
    expect(findLeaf(state.root, 'leaf-1')?.activeTabId).toBe('old.md');
  });

  it('后退和前进可以在当前标签的历史中切换', () => {
    let state = createWorkspaceState();
    state = openInCurrentTab(state, 'leaf-1', 'first.md');
    state = openInCurrentTab(state, 'leaf-1', 'second.md');
    state = openInCurrentTab(state, 'leaf-1', 'third.md');

    const active = () => findLeaf(state.root, 'leaf-1')?.tabs[0];
    expect(active()?.path).toBe('third.md');
    expect(active()?.history).toEqual(['first.md', 'second.md', 'third.md']);

    state = goBack(state, 'leaf-1');
    expect(active()?.path).toBe('second.md');
    state = goBack(state, 'leaf-1');
    expect(active()?.path).toBe('first.md');
    state = goForward(state, 'leaf-1');
    expect(active()?.path).toBe('second.md');

    state = openInCurrentTab(state, 'leaf-1', 'fourth.md');
    expect(active()?.history).toEqual(['first.md', 'second.md', 'fourth.md']);
    expect(active()?.historyIndex).toBe(2);
  });
});

function replaceLeafTabs(node: WorkspaceNode, leafId: string, tabs: WorkspaceTab[]): WorkspaceNode {
  if (node.type === 'leaf') {
    return node.id === leafId ? { ...node, tabs, activeTabId: tabs[0]?.id ?? null } : node;
  }
  return { ...node, children: node.children.map((child) => replaceLeafTabs(child, leafId, tabs)) };
}

describe('task references', () => {
  it('解析带稳定 ID 的 Markdown 任务引用', () => {
    const markdown = '# 项目\n\n  * [x] 确认方案 <!-- prism-task:task-123 -->';
    const [reference] = parseTaskReferences(markdown, '项目.md');

    expect(reference).toMatchObject({
      taskId: 'task-123',
      notePath: '项目.md',
      line: 3,
      title: '确认方案',
      completed: true,
      indent: '  ',
      marker: '*',
    });
    expect(reference.lineStart).toBe(6);
  });

  it('排除围栏代码、缩进代码和行内代码中的任务示例', () => {
    const markdown = [
      '- [ ] 正式任务 <!-- prism-task:task-1 -->',
      '',
      '```md',
      '- [ ] 围栏示例 <!-- prism-task:task-1 -->',
      '```',
      '',
      '    - [ ] 缩进示例 <!-- prism-task:task-1 -->',
      '',
      '`- [ ] 行内示例 <!-- prism-task:task-1 -->`',
    ].join('\n');
    expect(parseTaskReferences(markdown, '项目.md').map((item) => item.title)).toEqual([
      '正式任务',
    ]);
  });

  it('更新笔记中的全部同任务引用', () => {
    const markdown =
      '- [ ] 旧标题 <!-- prism-task:task-1 -->\n\n- [ ] 旧标题 <!-- prism-task:task-1 -->';
    expect(updateTaskReferences(markdown, { id: 'task-1', title: '新标题', completed: true })).toBe(
      '- [x] 新标题 <!-- prism-task:task-1 -->\n\n- [x] 新标题 <!-- prism-task:task-1 -->',
    );
  });
});

describe('笔记任务同步边界', () => {
  it('保留 CRLF 换行并更新同一任务的全部引用', () => {
    const markdown =
      '- [ ] 旧标题 <!-- prism-task:t1 -->\r\n\r\n  * [ ] 旧标题 <!-- prism-task:t1 -->';
    expect(updateTaskReferences(markdown, { id: 't1', title: '新标题', completed: true })).toBe(
      '- [x] 新标题 <!-- prism-task:t1 -->\r\n\r\n  * [x] 新标题 <!-- prism-task:t1 -->',
    );
  });
});

describe('编辑器文档加载', () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it('加载全文不进入撤销历史，但加载后的用户编辑仍然可以撤销', () => {
    const historyCompartment = new Compartment();
    view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          historyCompartment.of(history()),
          keymap.of([...defaultKeymap, ...historyKeymap]),
        ],
      }),
      parent: document.body,
    });

    replaceEditorDocument(view, historyCompartment, '# 已打开的文件\n正文');
    expect(view.state.doc.toString()).toBe('# 已打开的文件\n正文');
    expect(undo(view)).toBe(false);
    expect(view.state.doc.toString()).toBe('# 已打开的文件\n正文');

    view.dispatch({
      changes: { from: view.state.doc.length, insert: '\n新增内容' },
    });
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('# 已打开的文件\n正文');
  });
});
