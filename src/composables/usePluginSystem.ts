import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { PluginManifest, PluginEntry, PluginContext } from '../types';

// ── 插件注册表（全局单例） ──────────────────────

const pluginRegistry = ref<PluginEntry[]>([]);
const cleanupFns = new Map<string, (() => void)[]>();

export function usePluginSystem() {
  // ── 内建插件注册（应用启动时调用一次） ──────────

  function registerBuiltin(manifest: PluginManifest, overrides?: string[]) {
    const existing = pluginRegistry.value.find((p) => p.manifest.id === manifest.id);
    if (existing) return;
    pluginRegistry.value = [
      ...pluginRegistry.value,
      {
        manifest,
        enabled: true,
        builtin: true,
        overrides,
        dirName: `builtin:${manifest.id}`,
      },
    ];
  }

  // ── 外部插件注册 ──────────────────────────────

  function registerPlugin(manifest: PluginManifest, dirName: string) {
    const existing = pluginRegistry.value.find((p) => p.manifest.id === manifest.id);
    if (existing) return;
    pluginRegistry.value = [
      ...pluginRegistry.value,
      {
        manifest,
        enabled: false, // 默认禁用，需用户手动启用
        builtin: false,
        dirName,
      },
    ];
  }

  // ── 插件激活/停用 ────────────────────────────

  async function activatePlugin(pluginId: string) {
    const entry = pluginRegistry.value.find((p) => p.manifest.id === pluginId);
    if (!entry) return;
    entry.enabled = true;
    // 触发: 初始化插件
    // 实际激活逻辑在 PluginHost 中处理
  }

  async function deactivatePlugin(pluginId: string) {
    const entry = pluginRegistry.value.find((p) => p.manifest.id === pluginId);
    if (!entry) return;
    entry.enabled = false;
    // 运行清理函数
    const fns = cleanupFns.get(pluginId) || [];
    for (const fn of fns) fn();
    cleanupFns.delete(pluginId);
  }

  // ── 清理注册 ──────────────────────────────────

  /** 注册清理回调（类似 Obsidian registerEvent/registerInterval） */
  function registerCleanup(pluginId: string, fn: () => void) {
    if (!cleanupFns.has(pluginId)) cleanupFns.set(pluginId, []);
    cleanupFns.get(pluginId)!.push(fn);
  }

  // ── 模块覆盖 ──────────────────────────────────

  /** 检查指定模块是否有激活的插件覆盖 */
  function getOverride(moduleId: string): PluginEntry | undefined {
    return pluginRegistry.value.find((p) => p.enabled && p.overrides?.includes(moduleId));
  }

  // ── 查询 ──────────────────────────────────────

  function getPlugin(id: string) {
    return pluginRegistry.value.find((p) => p.manifest.id === id);
  }

  function getAllPlugins() {
    return pluginRegistry.value;
  }

  const enabledPlugins = () => pluginRegistry.value.filter((p) => p.enabled);

  return {
    registerBuiltin,
    registerPlugin,
    activatePlugin,
    deactivatePlugin,
    registerCleanup,
    getOverride,
    getPlugin,
    getAllPlugins,
    enabledPlugins,
    pluginRegistry,
  };
}
