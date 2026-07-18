import { ref, shallowRef, type Component } from 'vue';
import type { Disposable } from '../types';

// ═══════════════════════════════════════════════════════════════
//  类型
// ═══════════════════════════════════════════════════════════════

export type ViewLocation = 'sidebar' | 'panel' | 'settings' | 'rail' | 'page';

export interface ViewRegistration {
  id: string;
  pluginId: string;
  location: ViewLocation;
  /** Vue 组件（非 dom 位置使用） */
  component?: Component | null;
  /** 点击 rail 按钮时的回调，用于切换到对应 page */
  onActivate?: () => void;
  /** Raw DOM 生命周期（registerDomView 使用） */
  domMount?: (container: HTMLElement) => void;
  domUnmount?: () => void;
}

// ═══════════════════════════════════════════════════════════════
//  全局注册表
// ═══════════════════════════════════════════════════════════════

const registry = shallowRef<ViewRegistration[]>([]);

/** 获取指定位置的已注册视图（响应式） */
export function getViewRegistrations(location: ViewLocation): ViewRegistration[] {
  return registry.value.filter((v) => v.location === location);
}

/** 获取所有注册视图 */
export function getAllViewRegistrations(): ViewRegistration[] {
  return registry.value;
}

/** 清空注册表（仅测试使用） */
export function clearViewRegistrations(): void {
  registry.value = [];
}

// ═══════════════════════════════════════════════════════════════
//  活跃插件页面
// ═══════════════════════════════════════════════════════════════

/** 当前激活的插件页面 pluginId，null 表示未激活任一插件页面 */
const activePagePluginId = ref<string | null>(null);

/** 激活指定插件的页面（供 rail 按钮 onClick 调用） */
export function activatePluginPage(pluginId: string) {
  activePagePluginId.value = pluginId;
}

/** 获取当前激活的插件页面注册信息 */
export function getActivePageRegistrations(): ViewRegistration[] {
  return !activePagePluginId.value
    ? []
    : registry.value.filter(
        (v) => v.location === 'page' && v.pluginId === activePagePluginId.value,
      );
}

// ═══════════════════════════════════════════════════════════════
//  Views API 工厂
// ═══════════════════════════════════════════════════════════════

/**
 * 为指定插件创建 Views API。
 * 所有注册方法返回 Disposable，停用插件时自动卸载。
 */
export function createViewsAPI(pluginId: string, track: (d: Disposable) => Disposable) {
  const prefix = `${pluginId}.`;

  function checkId(id: string): void {
    if (!id || !id.startsWith(prefix)) {
      throw new TypeError(`视图 ID "${id}" 必须以 "${prefix}" 为前缀`);
    }
  }

  function register(
    id: string,
    location: ViewLocation,
    component?: Component | null,
    dom?: { mount: (container: HTMLElement) => void; unmount?: () => void },
    onActivate?: () => void,
  ): Disposable {
    checkId(id);

    const reg: ViewRegistration = {
      id,
      pluginId,
      location,
      component: component || null,
      domMount: dom?.mount,
      domUnmount: dom?.unmount,
      onActivate,
    };

    registry.value = [...registry.value, reg];

    let disposed = false;
    return track({
      dispose() {
        if (disposed) return;
        disposed = true;
        reg.domUnmount?.();
        // 如果当前激活的页面来自本插件，清空激活状态
        if (activePagePluginId.value === pluginId) {
          activePagePluginId.value = null;
        }
        registry.value = registry.value.filter((v) => v !== reg);
      },
    });
  }

  return {
    /** 注册侧边栏视图 */
    registerSidebar(id: string, component: Component): Disposable {
      return register(id, 'sidebar', component);
    },

    /** 注册内容面板视图 */
    registerPanel(id: string, component: Component): Disposable {
      return register(id, 'panel', component);
    },

    /** 注册设置页标签 */
    registerSettings(id: string, component: Component): Disposable {
      return register(id, 'settings', component);
    },

    /** 注册图标轨按钮，点击时激活本插件的 page 视图 */
    registerRail(id: string, component: Component): Disposable {
      return register(id, 'rail', component, undefined, () => {
        activatePluginPage(pluginId);
      });
    },

    /** 注册全屏页面视图，由对应插件的 rail 按钮激活时显示 */
    registerPage(id: string, component: Component): Disposable {
      return register(id, 'page', component);
    },

    /** 注册 Raw DOM 视图 */
    registerDomView(
      id: string,
      opts: { mount(container: HTMLElement): void; unmount(): void },
    ): Disposable {
      return register(id, 'panel', null, opts);
    },
  };
}
