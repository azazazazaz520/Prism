import { ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { AppModule, ModuleDescriptor } from '../types';

/** 完整模块注册表（所有可用模块的元数据定义） */
const ALL_MODULES: ModuleDescriptor[] = [
  {
    id: 'tasks',
    label: '任务看板',
    iconPath: 'M3 6h18M7 12h10M10 18h4',
  },
  {
    id: 'ai-assistant',
    label: 'AI 助手',
    iconPath:
      'M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z',
  },
  {
    id: 'notes',
    label: '笔记',
    iconPath: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8',
  },
  {
    id: 'devtools',
    label: '工具箱',
    iconPath:
      'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z',
  },
  {
    id: 'floating',
    label: '悬浮窗',
    iconPath: 'M4 4h16v16H4V4zm4 4h8v8H8V8z',
    isAction: true,
  },
  {
    id: 'settings',
    label: '设置',
    iconPath:
      'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
  },
];

/** 模块启用状态的全局单例 ref —— 确保跨组件共享 */
const enabledMap = ref<Record<string, boolean>>({});

/**
 * ModuleRegistry — 数据驱动侧边栏
 *
 * 定义所有可用模块元数据（ALL_MODULES），管理启用/禁用状态。
 * 计算属性将模块分为 topModules（导航视图）、bottomModules（设置）、
 * actionModules（悬浮窗动作），供 Sidebar 渲染。
 *
 * 全局单例：enabledMap 跨组件共享。
 */
export function useModuleRegistry() {
  /** 判断模块是否启用（不在 map 中或值为 true 视为启用） */
  function isEnabled(id: string): boolean {
    return enabledMap.value[id] !== false;
  }

  /** 可导航的视图模块（排除 isAction） */
  const viewModules = computed(() => ALL_MODULES.filter((m) => !m.isAction && isEnabled(m.id)));

  /** 动作模块（悬浮窗） */
  const actionModules = computed(() => ALL_MODULES.filter((m) => m.isAction && isEnabled(m.id)));

  /** 侧边栏顶部模块：view 中排除 settings */
  const topModules = computed(() => viewModules.value.filter((m) => m.id !== 'settings'));

  /** 侧边栏底部模块：仅 settings */
  const bottomModules = computed(() => viewModules.value.filter((m) => m.id === 'settings'));

  /** 所有模块（用于设置面板开关） */
  const allModules = computed(() => ALL_MODULES);

  /** 从后端加载模块启用状态 */
  async function load() {
    try {
      enabledMap.value = await invoke<Record<string, boolean>>('get_module_enabled');
    } catch {
      // 首次运行使用默认值（全部启用）
    }
  }

  /** 切换模块启用状态并持久化 */
  async function toggle(moduleId: AppModule, enabled: boolean) {
    enabledMap.value[moduleId] = enabled;
    try {
      await invoke('set_module_enabled', { moduleId, enabled });
    } catch (e) {
      console.error('保存模块开关失败:', e);
    }
  }

  return {
    allModules,
    viewModules,
    actionModules,
    topModules,
    bottomModules,
    isEnabled,
    load,
    toggle,
  };
}
