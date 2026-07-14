import type { Disposable } from '../types';
import { shallowRef, type Component } from 'vue';

// ═══════════════════════════════════════════════════════════════
//  类型
// ═══════════════════════════════════════════════════════════════

export type ViewLocation = 'sidebar' | 'panel' | 'settings';

export interface ViewRegistration {
  id: string;
  pluginId: string;
  location: ViewLocation;
  /** Vue 组件（registerSidebar/registerPanel/registerSettings 使用） */
  component?: Component | null;
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
    dom?: { mount: (container: HTMLElement) => void; unmount: () => void },
  ): Disposable {
    checkId(id);

    const reg: ViewRegistration = {
      id,
      pluginId,
      location,
      component: component ?? null,
      domMount: dom?.mount,
      domUnmount: dom?.unmount,
    };

    // 添加到注册表（触发响应式更新）
    registry.value = [...registry.value, reg];

    let disposed = false;
    // 自动追踪：插件停用时 ctx.dispose() 必然清理
    return track({
      dispose() {
        if (disposed) return;
        disposed = true;
        // 先调 unmount（如有）
        reg.domUnmount?.();
        // 从注册表移除
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

    /** 注册 Raw DOM 视图（Monaco/Three.js 等非 Vue 库） */
    registerDomView(
      id: string,
      opts: { mount(container: HTMLElement): void; unmount(): void },
    ): Disposable {
      return register(id, 'panel', null, opts);
    },
  };
}
