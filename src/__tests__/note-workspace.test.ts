import { describe, expect, it } from 'vitest';
import {
  activateTab,
  closeLeaf,
  closeTab,
  createTab,
  createWorkspaceState,
  findLeaf,
  listLeaves,
  moveTab,
  openTab,
  renameTabPath,
  removeTabsByPath,
  resizeSplit,
  splitLeafWithTab,
  splitLeaf,
} from '../domain/note-workspace';
import type { WorkspaceNode, WorkspaceTab } from '../domain/note-workspace';

describe('笔记工作区树', () => {
  it('可以递归创建多个平等的编辑区', () => {
    let state = createWorkspaceState();
    state = splitLeaf(state, 'leaf-1', 'horizontal', 'leaf-2');
    state = splitLeaf(state, 'leaf-2', 'vertical', 'leaf-3');

    expect(listLeaves(state.root).map((leaf) => leaf.id)).toEqual(['leaf-1', 'leaf-2', 'leaf-3']);
    expect(state.activeLeafId).toBe('leaf-3');
  });

  it('关闭右侧 leaf 后只保留左侧内容', () => {
    let state = createWorkspaceState();
    const leftTab = createTab('left.md');
    state = splitLeaf(state, 'leaf-1', 'horizontal', 'leaf-2');
    state = activateTab(
      { ...state, root: replaceLeafTabs(state.root, 'leaf-1', [leftTab]) },
      'leaf-1',
      leftTab.id,
    );

    const rightTab = createTab('right.md');
    state = {
      ...state,
      root: replaceLeafTabs(state.root, 'leaf-2', [rightTab]),
      activeLeafId: 'leaf-2',
    };
    state = closeLeaf(state, 'leaf-2');

    expect(listLeaves(state.root)).toHaveLength(1);
    expect(findLeaf(state.root, 'leaf-1')?.tabs.map((tab) => tab.path)).toEqual(['left.md']);
  });

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

  it('关闭 leaf 的最后一个标签时自动收拢分栏', () => {
    let state = createWorkspaceState();
    state = splitLeaf(state, 'leaf-1', 'horizontal', 'leaf-2');
    const tab = createTab('right.md');
    state = { ...state, root: replaceLeafTabs(state.root, 'leaf-2', [tab]) };
    state = closeTab(state, 'leaf-2', tab.id);

    expect(state.root.type).toBe('leaf');
    expect(listLeaves(state.root)).toHaveLength(1);
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

  it('同一编辑区重复打开文档只激活已有标签', () => {
    let state = createWorkspaceState();
    state = openTab(state, 'leaf-1', 'same.md');
    state = openTab(state, 'leaf-1', 'other.md');
    state = openTab(state, 'leaf-1', 'same.md');

    expect(findLeaf(state.root, 'leaf-1')?.tabs.map((tab) => tab.path)).toEqual([
      'same.md',
      'other.md',
    ]);
    expect(findLeaf(state.root, 'leaf-1')?.activeTabId).toBe('same.md');
  });

  it('从其他编辑区打开已存在的文档时不会创建第二份标签', () => {
    let state = createWorkspaceState();
    state = openTab(state, 'leaf-1', 'same.md');
    state = splitLeaf(state, 'leaf-1', 'horizontal', 'leaf-2');
    state = openTab(state, 'leaf-2', 'same.md');

    expect(listLeaves(state.root).flatMap((leaf) => leaf.tabs)).toHaveLength(1);
    expect(state.activeLeafId).toBe('leaf-1');
  });

  it('重命名文档时只迁移标签路径并保留活动标签', () => {
    let state = createWorkspaceState();
    state = openTab(state, 'leaf-1', 'old.md');
    state = renameTabPath(state, 'old.md', 'new.md');

    expect(findLeaf(state.root, 'leaf-1')?.tabs).toEqual([{ id: 'new.md', path: 'new.md' }]);
    expect(findLeaf(state.root, 'leaf-1')?.activeTabId).toBe('new.md');
  });

  it('拖动分隔条只调整相邻编辑区并保留其他分栏比例', () => {
    let state = createWorkspaceState();
    state = splitLeaf(state, 'leaf-1', 'horizontal', 'leaf-2');
    state = resizeSplit(state, 'split-leaf-2', 0, 0.7);

    expect(state.root.type).toBe('split');
    if (state.root.type === 'split') {
      expect(state.root.sizes).toEqual([0.7, 0.3]);
    }
  });

  it('同一编辑区内拖动标签可以重新排序', () => {
    let state = createWorkspaceState();
    state = openTab(state, 'leaf-1', 'first.md');
    state = openTab(state, 'leaf-1', 'second.md');
    state = openTab(state, 'leaf-1', 'third.md');
    state = moveTab(state, 'leaf-1', 'leaf-1', 'third.md', 0);

    expect(findLeaf(state.root, 'leaf-1')?.tabs.map((tab) => tab.path)).toEqual([
      'third.md',
      'first.md',
      'second.md',
    ]);
  });

  it('删除目录时清理所有编辑区中的子路径标签', () => {
    let state = createWorkspaceState();
    state = openTab(state, 'leaf-1', 'docs/first.md');
    state = splitLeaf(state, 'leaf-1', 'horizontal', 'leaf-2');
    state = openTab(state, 'leaf-2', 'docs/second.md');
    state = openTab(state, 'leaf-2', 'keep.md');
    state = removeTabsByPath(state, 'docs', true);

    expect(listLeaves(state.root).flatMap((leaf) => leaf.tabs.map((tab) => tab.path))).toEqual([
      'keep.md',
    ]);
  });

  it('将标签拖到编辑区右侧会创建新分栏并移动标签', () => {
    let state = openTab(createWorkspaceState(), 'leaf-1', 'note.md');
    state = splitLeafWithTab(state, 'leaf-1', 'leaf-1', 'note.md', 'right', 'leaf-2');

    expect(listLeaves(state.root).map((leaf) => leaf.id)).toEqual(['leaf-1', 'leaf-2']);
    expect(findLeaf(state.root, 'leaf-1')?.tabs).toEqual([]);
    expect(findLeaf(state.root, 'leaf-2')?.tabs.map((tab) => tab.path)).toEqual(['note.md']);
    expect(state.activeLeafId).toBe('leaf-2');
  });
});

function replaceLeafTabs(node: WorkspaceNode, leafId: string, tabs: WorkspaceTab[]): WorkspaceNode {
  if (node.type === 'leaf') {
    return node.id === leafId ? { ...node, tabs, activeTabId: tabs[0]?.id ?? null } : node;
  }
  return { ...node, children: node.children.map((child) => replaceLeafTabs(child, leafId, tabs)) };
}
