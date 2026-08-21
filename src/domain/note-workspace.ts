export type WorkspaceDirection = 'horizontal' | 'vertical';

export interface WorkspaceTab {
  id: string;
  path: string;
}

export interface WorkspaceLeaf {
  type: 'leaf';
  id: string;
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  /** 当前编辑区中打开过的文件路径，类似浏览器历史 */
  history?: string[];
  historyIndex?: number;
}

export interface WorkspaceSplit {
  type: 'split';
  id: string;
  direction: WorkspaceDirection;
  children: WorkspaceNode[];
  sizes: number[];
}

export type WorkspaceNode = WorkspaceLeaf | WorkspaceSplit;

export interface NoteWorkspaceState {
  root: WorkspaceNode;
  activeLeafId: string;
}

export function createWorkspaceState(leafId = 'leaf-1'): NoteWorkspaceState {
  return {
    root: createLeaf(leafId),
    activeLeafId: leafId,
  };
}

export function createLeaf(id: string, tabs: WorkspaceTab[] = []): WorkspaceLeaf {
  return {
    type: 'leaf',
    id,
    tabs: [...tabs],
    activeTabId: tabs[0]?.id ?? null,
    history: tabs.map((tab) => tab.path),
    historyIndex: tabs.length > 0 ? tabs.length - 1 : -1,
  };
}

/** 将旧版/外部工作区状态归一化为单标签 + 浏览器式历史。 */
export function normalizeWorkspaceState(state: NoteWorkspaceState): NoteWorkspaceState {
  return {
    ...state,
    root: mapNode(state.root, (leaf) => {
      const history =
        leaf.history && leaf.history.length > 0 ? leaf.history : leaf.tabs.map((tab) => tab.path);
      const currentTab =
        leaf.tabs.find((tab) => tab.id === leaf.activeTabId) ??
        leaf.tabs[leaf.tabs.length - 1] ??
        null;
      const currentPath = currentTab?.path ?? null;
      const normalizedHistory =
        currentPath && !history.includes(currentPath) ? [...history, currentPath] : history;
      const historyIndex = currentPath ? normalizedHistory.indexOf(currentPath) : -1;
      return {
        ...leaf,
        tabs: currentTab ? [currentTab] : [],
        activeTabId: currentTab?.id ?? null,
        history: normalizedHistory,
        historyIndex,
      };
    }),
  };
}

export function createTab(path: string, id = path): WorkspaceTab {
  return { id, path };
}

export function findLeaf(node: WorkspaceNode, leafId: string): WorkspaceLeaf | null {
  if (node.type === 'leaf') return node.id === leafId ? node : null;
  for (const child of node.children) {
    const leaf = findLeaf(child, leafId);
    if (leaf) return leaf;
  }
  return null;
}

export function listLeaves(node: WorkspaceNode): WorkspaceLeaf[] {
  if (node.type === 'leaf') return [node];
  return node.children.flatMap(listLeaves);
}

export function splitLeaf(
  state: NoteWorkspaceState,
  leafId: string,
  direction: WorkspaceDirection,
  newLeafId = nextLeafId(state.root),
): NoteWorkspaceState {
  const existingLeaf = findLeaf(state.root, leafId);
  if (!existingLeaf) return state;

  const newLeaf = createLeaf(newLeafId);
  const root = replaceNode(state.root, leafId, {
    type: 'split',
    id: `split-${newLeafId}`,
    direction,
    children: [existingLeaf, newLeaf],
    sizes: [0.5, 0.5],
  });

  return { root, activeLeafId: newLeafId };
}

export type WorkspaceDropZone = 'left' | 'right' | 'top' | 'bottom';

/** 将标签拖到目标编辑区边缘，创建新分栏并把标签放入新编辑区。 */
export function splitLeafWithTab(
  state: NoteWorkspaceState,
  targetLeafId: string,
  sourceLeafId: string,
  tabId: string,
  zone: WorkspaceDropZone,
  newLeafId = nextLeafId(state.root),
): NoteWorkspaceState {
  const source = findLeaf(state.root, sourceLeafId);
  const target = findLeaf(state.root, targetLeafId);
  const tab = source?.tabs.find((item) => item.id === tabId);
  if (!source || !target || !tab) return state;

  const direction: WorkspaceDirection =
    zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical';
  const sourceHistory =
    source.history && source.history.length > 0
      ? source.history
      : source.tabs.map((item) => item.path);
  const newLeaf: WorkspaceLeaf = {
    ...createLeaf(newLeafId, [tab]),
    history: sourceHistory,
    historyIndex: sourceHistory.length - 1,
  };
  const sourceTabs = source.tabs.filter((item) => item.id !== tabId);
  const sourceWithoutTab: WorkspaceLeaf = {
    ...source,
    tabs: sourceTabs,
    activeTabId:
      source.activeTabId === tabId
        ? (source.tabs.find((item) => item.id !== tabId)?.id ?? null)
        : source.activeTabId,
    history: sourceTabs.length === 0 ? [] : sourceHistory.filter((path) => path !== tab.path),
    historyIndex: sourceTabs.length === 0 ? -1 : Math.max(0, source.historyIndex ?? 0),
  };
  const rootWithoutTab = replaceNode(state.root, sourceLeafId, sourceWithoutTab);
  const currentTarget = findLeaf(rootWithoutTab, targetLeafId);
  if (!currentTarget) return state;

  const children =
    zone === 'left' || zone === 'top' ? [newLeaf, currentTarget] : [currentTarget, newLeaf];
  const root = replaceNode(rootWithoutTab, targetLeafId, {
    type: 'split',
    id: `split-${newLeafId}`,
    direction,
    children,
    sizes: [0.5, 0.5],
  });
  return { root, activeLeafId: newLeafId };
}

/** 调整一个分栏节点中相邻两个子区域的比例。position 为节点内的归一化位置。 */
export function resizeSplit(
  state: NoteWorkspaceState,
  splitId: string,
  dividerIndex: number,
  position: number,
): NoteWorkspaceState {
  const root = resizeNode(state.root, splitId, dividerIndex, position);
  return root === state.root ? state : { ...state, root };
}

export function closeTab(
  state: NoteWorkspaceState,
  leafId: string,
  tabId: string,
): NoteWorkspaceState {
  const leaf = findLeaf(state.root, leafId);
  if (!leaf || !leaf.tabs.some((tab) => tab.id === tabId)) return state;

  const remainingTabs = leaf.tabs.filter((tab) => tab.id !== tabId);
  if (remainingTabs.length === 0) return closeLeaf(state, leafId);

  const activeTabId =
    leaf.activeTabId === tabId
      ? (remainingTabs[Math.max(0, leaf.tabs.findIndex((tab) => tab.id === tabId) - 1)]?.id ??
        remainingTabs[0].id)
      : leaf.activeTabId;

  return {
    ...state,
    root: replaceNode(state.root, leafId, { ...leaf, tabs: remainingTabs, activeTabId }),
  };
}

export function closeLeaf(state: NoteWorkspaceState, leafId: string): NoteWorkspaceState {
  const leaves = listLeaves(state.root);
  if (!leaves.some((leaf) => leaf.id === leafId)) return state;

  if (state.root.type === 'leaf') {
    return {
      root: { ...state.root, tabs: [], activeTabId: null, history: [], historyIndex: -1 },
      activeLeafId: state.root.id,
    };
  }

  const rootWithoutLeaf = removeNode(state.root, leafId);
  const root = rootWithoutLeaf ? collapseSplits(rootWithoutLeaf) : createLeaf('leaf-1');
  const nextActiveLeaf = listLeaves(root).find((leaf) => leaf.id !== leafId) ?? listLeaves(root)[0];

  return {
    root,
    activeLeafId: nextActiveLeaf?.id ?? state.activeLeafId,
  };
}

export function activateLeaf(state: NoteWorkspaceState, leafId: string): NoteWorkspaceState {
  return findLeaf(state.root, leafId) ? { ...state, activeLeafId: leafId } : state;
}

export function activateTab(
  state: NoteWorkspaceState,
  leafId: string,
  tabId: string,
): NoteWorkspaceState {
  const leaf = findLeaf(state.root, leafId);
  if (!leaf || !leaf.tabs.some((tab) => tab.id === tabId)) return state;
  return {
    ...state,
    activeLeafId: leafId,
    root: replaceNode(state.root, leafId, { ...leaf, activeTabId: tabId }),
  };
}

export function openTab(
  state: NoteWorkspaceState,
  leafId: string,
  path: string,
  tabId = path,
): NoteWorkspaceState {
  const leaf = findLeaf(state.root, leafId);
  if (!leaf) return state;

  const history =
    leaf.history && leaf.history.length > 0 ? leaf.history : leaf.tabs.map((tab) => tab.path);
  const historyIndex = leaf.historyIndex ?? Math.max(0, history.length - 1);
  const currentPath = leaf.tabs.find((tab) => tab.id === leaf.activeTabId)?.path;
  const nextHistory =
    currentPath === path ? history : [...history.slice(0, historyIndex + 1), path];
  const tab = createTab(path, tabId);
  return {
    root: replaceNode(state.root, leafId, {
      ...leaf,
      tabs: [tab],
      activeTabId: tab.id,
      history: nextHistory,
      historyIndex: nextHistory.length - 1,
    }),
    activeLeafId: leafId,
  };
}

export function goBack(state: NoteWorkspaceState, leafId: string): NoteWorkspaceState {
  return navigateHistory(state, leafId, -1);
}

export function goForward(state: NoteWorkspaceState, leafId: string): NoteWorkspaceState {
  return navigateHistory(state, leafId, 1);
}

function navigateHistory(
  state: NoteWorkspaceState,
  leafId: string,
  delta: -1 | 1,
): NoteWorkspaceState {
  const leaf = findLeaf(state.root, leafId);
  if (!leaf) return state;

  const history =
    leaf.history && leaf.history.length > 0 ? leaf.history : leaf.tabs.map((tab) => tab.path);
  const currentIndex = leaf.historyIndex ?? (history.length > 0 ? history.length - 1 : -1);
  const nextIndex = currentIndex + delta;
  if (nextIndex < 0 || nextIndex >= history.length) return state;

  const path = history[nextIndex];
  if (!path) return state;
  const tab = createTab(path, path);

  return {
    ...state,
    activeLeafId: leafId,
    root: replaceNode(state.root, leafId, {
      ...leaf,
      tabs: [tab],
      activeTabId: tab.id,
      history,
      historyIndex: nextIndex,
    }),
  };
}

export function moveTab(
  state: NoteWorkspaceState,
  fromLeafId: string,
  toLeafId: string,
  tabId: string,
  targetIndex = Number.MAX_SAFE_INTEGER,
): NoteWorkspaceState {
  const source = findLeaf(state.root, fromLeafId);
  const target = findLeaf(state.root, toLeafId);
  const tab = source?.tabs.find((item) => item.id === tabId);
  if (!source || !target || !tab) return state;

  if (fromLeafId === toLeafId) {
    const sourceIndex = source.tabs.findIndex((item) => item.id === tabId);
    const insertionIndex = Math.min(Math.max(targetIndex, 0), source.tabs.length - 1);
    if (sourceIndex === insertionIndex) return state;

    const tabs = source.tabs.filter((item) => item.id !== tabId);
    tabs.splice(Math.min(insertionIndex, tabs.length), 0, tab);
    return {
      ...state,
      root: replaceNode(state.root, fromLeafId, {
        ...source,
        tabs,
        activeTabId: tab.id,
      }),
      activeLeafId: fromLeafId,
    };
  }

  const sourceHistory =
    source.history && source.history.length > 0
      ? source.history
      : source.tabs.map((item) => item.path);
  const sourceTabs = source.tabs.filter((item) => item.id !== tabId);
  const targetLeaf: WorkspaceLeaf = {
    ...target,
    tabs: [tab],
    activeTabId: tab.id,
    history: sourceHistory,
    historyIndex: sourceHistory.length - 1,
  };
  const sourceLeaf: WorkspaceLeaf = {
    ...source,
    tabs: sourceTabs,
    activeTabId: source.activeTabId === tabId ? (sourceTabs[0]?.id ?? null) : source.activeTabId,
    history: sourceTabs.length === 0 ? [] : sourceHistory.filter((path) => path !== tab.path),
    historyIndex: sourceTabs.length === 0 ? -1 : Math.max(0, source.historyIndex ?? 0),
  };
  const nextRoot = replaceNode(
    replaceNode(state.root, fromLeafId, sourceLeaf),
    toLeafId,
    targetLeaf,
  );

  return {
    root: sourceTabs.length === 0 ? collapseSplits(removeNode(nextRoot, fromLeafId)!) : nextRoot,
    activeLeafId: toLeafId,
  };
}

/** 删除指定路径对应的标签；includeDescendants 用于删除目录时清理其子路径。 */
export function removeTabsByPath(
  state: NoteWorkspaceState,
  path: string,
  includeDescendants = false,
): NoteWorkspaceState {
  const matches = (candidate: string) =>
    candidate === path || (includeDescendants && candidate.startsWith(`${path}/`));
  let changed = false;
  const root = mapNode(state.root, (leaf) => {
    const tabs = leaf.tabs.filter((tab) => {
      const keep = !matches(tab.path);
      if (!keep) changed = true;
      return keep;
    });
    if (tabs.length === leaf.tabs.length) return leaf;
    const history = (
      leaf.history && leaf.history.length > 0 ? leaf.history : leaf.tabs.map((tab) => tab.path)
    ).filter((path) => !matches(path));
    const currentPath = leaf.tabs.find((tab) => tab.id === leaf.activeTabId)?.path;
    const currentRemoved = Boolean(currentPath && matches(currentPath));
    const currentIndex = currentPath ? history.indexOf(currentPath) : -1;
    const originalIndex = leaf.historyIndex ?? Math.max(0, history.length - 1);
    const nextIndex = currentRemoved
      ? Math.max(0, history.length - 1)
      : currentIndex >= 0
        ? currentIndex
        : Math.min(originalIndex, Math.max(0, history.length - 1));
    const activePath = currentRemoved ? history[nextIndex] : currentPath;
    const activeTab = activePath ? createTab(activePath, activePath) : null;
    return {
      ...leaf,
      tabs: activeTab ? [activeTab] : [],
      activeTabId: activeTab?.id ?? null,
      history,
      historyIndex: history.length > 0 ? nextIndex : -1,
    };
  });
  if (!changed) return state;

  const collapsed = collapseEmptyLeaves(root);
  const activeLeaf = findLeaf(collapsed, state.activeLeafId) ?? listLeaves(collapsed)[0];
  return {
    root: collapsed,
    activeLeafId: activeLeaf?.id ?? state.activeLeafId,
  };
}

export function renameTabPath(
  state: NoteWorkspaceState,
  oldPath: string,
  newPath: string,
): NoteWorkspaceState {
  if (oldPath === newPath) return state;
  return {
    ...state,
    root: mapNode(state.root, (leaf) => {
      const renamePath = (path: string) => (path === oldPath ? newPath : path);
      const history = (
        leaf.history && leaf.history.length > 0 ? leaf.history : leaf.tabs.map((tab) => tab.path)
      ).map(renamePath);
      const tabs = leaf.tabs.map((tab) =>
        tab.path === oldPath ? { ...tab, id: newPath, path: newPath } : tab,
      );
      const activeTabId = leaf.tabs.some(
        (tab) => tab.path === oldPath && tab.id === leaf.activeTabId,
      )
        ? newPath
        : leaf.activeTabId;
      return { ...leaf, tabs, activeTabId, history };
    }),
  };
}

function replaceNode(
  node: WorkspaceNode,
  targetId: string,
  replacement: WorkspaceNode,
): WorkspaceNode {
  if (node.id === targetId) return replacement;
  if (node.type === 'leaf') return node;
  return {
    ...node,
    children: node.children.map((child) => replaceNode(child, targetId, replacement)),
  };
}

function resizeNode(
  node: WorkspaceNode,
  splitId: string,
  dividerIndex: number,
  position: number,
): WorkspaceNode {
  if (node.type === 'leaf') return node;
  if (node.id === splitId) {
    const leftIndex = Math.floor(dividerIndex);
    if (leftIndex < 0 || leftIndex >= node.children.length - 1) return node;
    const before = node.sizes.slice(0, leftIndex).reduce((sum, size) => sum + size, 0);
    const pairSize = node.sizes[leftIndex] + node.sizes[leftIndex + 1];
    const minimum = Math.min(0.12, pairSize / 2);
    const nextLeft = Math.min(
      Math.max(position - before, minimum),
      Math.max(minimum, pairSize - minimum),
    );
    const sizes = [...node.sizes];
    sizes[leftIndex] = roundSize(nextLeft);
    sizes[leftIndex + 1] = roundSize(pairSize - nextLeft);
    return { ...node, sizes };
  }
  const children = node.children.map((child) => resizeNode(child, splitId, dividerIndex, position));
  return children.some((child, index) => child !== node.children[index])
    ? { ...node, children }
    : node;
}

function mapNode(
  node: WorkspaceNode,
  mapLeaf: (leaf: WorkspaceLeaf) => WorkspaceLeaf,
): WorkspaceNode {
  if (node.type === 'leaf') return mapLeaf(node);
  return { ...node, children: node.children.map((child) => mapNode(child, mapLeaf)) };
}

function removeNode(node: WorkspaceNode, targetId: string): WorkspaceNode | null {
  if (node.type === 'leaf') return node.id === targetId ? null : node;
  const children = node.children
    .map((child) => removeNode(child, targetId))
    .filter((child): child is WorkspaceNode => child !== null);
  return children.length === 0 ? null : { ...node, children, sizes: equalSizes(children.length) };
}

function collapseSplits(node: WorkspaceNode): WorkspaceNode {
  if (node.type === 'leaf') return node;
  const children = node.children.map(collapseSplits);
  return children.length === 1
    ? children[0]
    : { ...node, children, sizes: equalSizes(children.length) };
}

function collapseEmptyLeaves(node: WorkspaceNode): WorkspaceNode {
  if (node.type === 'leaf') return node;
  const children = node.children.map(collapseEmptyLeaves);
  const nonEmpty = children.filter((child) => child.type === 'split' || child.tabs.length > 0);
  if (nonEmpty.length === 0) return children[0] ?? createLeaf('leaf-1');
  if (nonEmpty.length === 1) return nonEmpty[0];
  return { ...node, children: nonEmpty, sizes: equalSizes(nonEmpty.length) };
}

function equalSizes(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

function roundSize(size: number): number {
  return Number(size.toFixed(6));
}

function nextLeafId(root: WorkspaceNode): string {
  const used = new Set(listLeaves(root).map((leaf) => leaf.id));
  let index = used.size + 1;
  while (used.has(`leaf-${index}`)) index += 1;
  return `leaf-${index}`;
}
