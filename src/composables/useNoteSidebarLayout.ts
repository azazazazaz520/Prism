import { computed, ref, type Ref } from 'vue';
import type { NotesLayoutState } from '../types';

// ═══ 侧边栏布局常量 ═══

/** 侧边栏初始宽度 */
export const DEFAULT_SIDEBAR_WIDTH = 260;
/** 侧边栏最小宽度 */
export const MIN_SIDEBAR_WIDTH = 220;
/** 侧边栏最大宽度 */
export const MAX_SIDEBAR_WIDTH = 420;
/** 编辑区最小宽度 */
export const EDITOR_MIN_WIDTH = 360;
/** 分隔条宽度 */
export const RESIZER_WIDTH = 4;
/** localStorage 键名 */
export const LAYOUT_STORAGE_KEY = 'prism-notes-layout';

// ═══ 侧边栏布局状态与拖动逻辑 ═══

/**
 * 管理笔记工作区侧边栏的宽度、收起与拖动。
 *
 * `expanded` 为文件树展开集合，与侧边栏宽度一同持久化到 localStorage；
 * 该集合由调用方持有，后续文件树面板拆分时将随树逻辑一起迁移。
 */
export function useNoteSidebarLayout(expanded: Ref<Set<string>>) {
  const treeWidth = ref(DEFAULT_SIDEBAR_WIDTH);
  const isResizing = ref(false);
  const sidebarCollapsed = ref(false);
  const previousWidth = ref(DEFAULT_SIDEBAR_WIDTH);

  /** 侧边栏实际显示宽度（收起时为 0） */
  const effectiveTreeWidth = computed(() => (sidebarCollapsed.value ? 0 : treeWidth.value));

  /** 约束宽度到有效范围内 */
  function clampWidth(w: number): number {
    return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(w)));
  }

  /** 返回当前窗口下允许的最大侧边栏宽度。 */
  function getMaxSidebarWidth(): number {
    return Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - EDITOR_MIN_WIDTH - RESIZER_WIDTH);
  }

  /** 将宽度限制在侧边栏和编辑区都可用的范围内。 */
  function getSafeSidebarWidth(width: number): number {
    return Math.min(clampWidth(width), getMaxSidebarWidth());
  }

  /** 保存布局状态到 localStorage */
  function saveLayoutState() {
    try {
      const state: NotesLayoutState = {
        sidebarWidth: treeWidth.value,
        expandedPaths: Array.from(expanded.value),
      };
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // localStorage 不可用时静默忽略
    }
  }

  /** 从 localStorage 加载布局状态 */
  function loadLayoutState() {
    try {
      const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw) as NotesLayoutState;
      if (typeof state.sidebarWidth === 'number' && Number.isFinite(state.sidebarWidth)) {
        treeWidth.value = clampWidth(state.sidebarWidth);
      }
      if (state.expandedPaths && Array.isArray(state.expandedPaths)) {
        expanded.value = new Set(state.expandedPaths);
      }
    } catch {
      // 解析失败时使用默认值
    }
  }

  /** 窗口缩放时重新约束宽度 */
  function constrainOnResize() {
    const safeWidth = getSafeSidebarWidth(treeWidth.value);
    if (treeWidth.value !== safeWidth) {
      treeWidth.value = safeWidth;
      saveLayoutState();
    }
  }

  /** 开始拖拽分隔条 */
  function startResize(event: PointerEvent) {
    event.preventDefault();
    isResizing.value = true;

    const startX = event.clientX;
    const startWidth = treeWidth.value;

    // 拖动期间禁止文本选择
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    function onMove(e: PointerEvent) {
      if (!isResizing.value) return;
      const delta = e.clientX - startX;
      const newWidth = getSafeSidebarWidth(startWidth + delta);
      // 确保不挤压编辑区
      treeWidth.value = newWidth;
    }

    function onUp() {
      isResizing.value = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      saveLayoutState();
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  /** 分隔条键盘调整 */
  function handleResizerKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      treeWidth.value = clampWidth(treeWidth.value - 20);
      saveLayoutState();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      treeWidth.value = getSafeSidebarWidth(treeWidth.value + 20);
      saveLayoutState();
    } else if (event.key === 'Home') {
      event.preventDefault();
      treeWidth.value = MIN_SIDEBAR_WIDTH;
      saveLayoutState();
    } else if (event.key === 'End') {
      event.preventDefault();
      treeWidth.value = getSafeSidebarWidth(MAX_SIDEBAR_WIDTH);
      saveLayoutState();
    }
  }

  /** 切换侧边栏收起/展开 */
  function toggleSidebar() {
    if (sidebarCollapsed.value) {
      sidebarCollapsed.value = false;
      treeWidth.value = getSafeSidebarWidth(previousWidth.value);
    } else {
      sidebarCollapsed.value = true;
      previousWidth.value = treeWidth.value;
    }
  }

  return {
    treeWidth,
    isResizing,
    sidebarCollapsed,
    previousWidth,
    effectiveTreeWidth,
    clampWidth,
    getMaxSidebarWidth,
    getSafeSidebarWidth,
    constrainOnResize,
    saveLayoutState,
    loadLayoutState,
    startResize,
    handleResizerKeydown,
    toggleSidebar,
    MIN_SIDEBAR_WIDTH,
    MAX_SIDEBAR_WIDTH,
  };
}
