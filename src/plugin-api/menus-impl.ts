import type { Disposable } from '../types';
import { shallowRef } from 'vue';

// ═══════════════════════════════════════════════════════════════
//  类型
// ═══════════════════════════════════════════════════════════════

/** 菜单挂载位置 */
export type MenuLocation = 'task-context' | 'editor-context';

/** 单个菜单项（由插件提供） */
export interface MenuItem {
  /** 唯一标识，必须以 `{pluginId}.` 为前缀 */
  id: string;
  /** 显示文本 */
  label: string;
  /** 点击回调 */
  action: () => void | Promise<void>;
  /** 可选的 SVG 图标字符串 */
  icon?: string;
}

/** 内部注册条目 */
export interface MenuRegistration {
  id: string;
  pluginId: string;
  location: MenuLocation;
  item: MenuItem;
}

// ═══════════════════════════════════════════════════════════════
//  全局注册表
// ═══════════════════════════════════════════════════════════════

const registry = shallowRef<MenuRegistration[]>([]);

/** 获取指定位置的已注册菜单项（响应式） */
export function getMenuRegistrations(location: MenuLocation): MenuRegistration[] {
  return registry.value.filter((m) => m.location === location);
}

/** 清空注册表（仅测试使用） */
export function clearMenuRegistrations(): void {
  registry.value = [];
}

// ═══════════════════════════════════════════════════════════════
//  Menus API 工厂
// ═══════════════════════════════════════════════════════════════

/**
 * 为指定插件创建 Menus API。
 * `register(location, items)` 返回 Disposable，停用插件时自动移除。
 */
export function createMenusAPI(pluginId: string, track: (d: Disposable) => Disposable) {
  const prefix = `${pluginId}.`;

  function checkId(id: string): void {
    if (!id || !id.startsWith(prefix)) {
      throw new TypeError(`菜单 ID "${id}" 必须以 "${prefix}" 为前缀`);
    }
  }

  function register(location: MenuLocation, items: MenuItem[]): Disposable {
    // 逐个校验 ID 前缀
    for (const item of items) {
      checkId(item.id);
    }

    const regs: MenuRegistration[] = items.map((item) => ({
      id: item.id,
      pluginId,
      location,
      item,
    }));

    // 添加到注册表（触发响应式更新）
    registry.value = [...registry.value, ...regs];

    let disposed = false;
    // 自动追踪：插件停用时 ctx.dispose() 必然清理，不会因插件作者忘记 track 而残留
    return track({
      dispose() {
        if (disposed) return;
        disposed = true;
        registry.value = registry.value.filter((v) => !regs.includes(v));
      },
    });
  }

  return { register };
}
