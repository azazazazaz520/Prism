import { ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { PluginManifest, PluginDiagnostics, PluginContext } from '../types';
import { validateManifest, checkEngines, PRISM_VERSION } from './usePluginManifest';
import { rewriteImports, createBlobUrl } from '../plugin-api/module-resolver';
import { buildCapability } from '../plugin-api/capability-builder';
import { createPluginContext } from '../plugin-api/plugin-context';

// ═══════════════════════════════════════════════════════════════
//  内部类型
// ═══════════════════════════════════════════════════════════════

type PluginState = 'disabled' | 'activating' | 'active' | 'deactivating';

interface PluginEntry {
  manifest: PluginManifest;
  enabled: boolean;
  state: PluginState;
  diagnostics: PluginDiagnostics;
  lastError?: string;
  /** 活跃插件的 PluginContext，停用时调用 ctx.dispose() 清理资源 */
  ctx?: PluginContext;
}

interface PluginConfig {
  enabled: boolean;
  permissions: string[];
}

// ═══════════════════════════════════════════════════════════════
//  全局单例
// ═══════════════════════════════════════════════════════════════

const pluginEntries = ref<Map<string, PluginEntry>>(new Map());
let loaded = false;

/**
 * 浅克隆所有 entry 并替换 Map，确保 Vue v-for 检测到对象变更。
 * 只改属性不换引用 → Vue diff 认为无变化 → 不重渲染。
 */
function bumpReactivity() {
  const newMap = new Map<string, PluginEntry>();
  for (const [id, entry] of pluginEntries.value) {
    newMap.set(id, { ...entry });
  }
  pluginEntries.value = newMap;
}

export function usePluginLoader() {
  // ── 初始化：扫描 + 合并配置 + 自动激活 ─────────

  async function loadPlugins() {
    if (loaded) return;
    loaded = true;

    try {
      const manifests = await invoke<PluginManifest[]>('scan_plugins');
      const configs = await invoke<Record<string, PluginConfig>>('get_plugin_configs');

      const map = new Map<string, PluginEntry>();

      for (const raw of manifests) {
        if (!validateManifest(raw)) {
          const fallbackId = (raw as any).id || 'unknown';
          console.warn(`[PluginLoader] ${fallbackId} manifest 校验失败，跳过`);
          continue;
        }
        const m: PluginManifest = raw;

        // 扩展点 ID 前缀校验
        const prefix = `${m.id}.`;
        let idError = '';
        if (m.contributes?.commands) {
          for (const cmd of m.contributes.commands) {
            if (!cmd.id.startsWith(prefix)) {
              idError = `命令 ID "${cmd.id}" 前缀不正确`;
              break;
            }
          }
        }

        const cfg = configs[m.id];
        map.set(m.id, {
          manifest: m,
          enabled: cfg?.enabled ?? false,
          state: 'disabled',
          diagnostics: {
            status: idError ? 'error' : 'ok',
            errorCount: idError ? 1 : 0,
            lastError: idError || undefined,
          },
          lastError: idError,
        });
      }

      pluginEntries.value = map;

      // 自动激活已启用的插件
      for (const [id, entry] of map) {
        if (entry.enabled && entry.state === 'disabled') {
          // 同步 manifest 权限到持久化配置，确保 Rust 端第三层校验一致
          const cfg = configs[id];
          const manifestPerms = entry.manifest.permissions ?? [];
          const configPerms = cfg?.permissions ?? [];
          if (JSON.stringify(manifestPerms) !== JSON.stringify(configPerms)) {
            invoke('set_plugin_config', {
              pluginId: id,
              config: { enabled: true, permissions: manifestPerms },
            }).catch(() => {});
          }
          activatePlugin(id).catch((e) => {
            console.warn(`[PluginLoader] 自动激活 ${id} 失败:`, e);
          });
        }
      }
    } catch (e) {
      console.error('[PluginLoader] 扫描失败:', e);
    }
  }

  // ── 激活 ────────────────────────────────────────

  async function activatePlugin(pluginId: string): Promise<void> {
    // ⚠️ 每次 bumpReactivity() 都会创建新 Map + 新对象，
    //    因此必须重新获取 entry，否则后续写入会落到旧对象上（stale reference）。
    const initial = pluginEntries.value.get(pluginId);
    if (!initial) throw new Error(`插件 "${pluginId}" 未找到`);
    if (initial.state === 'active' || initial.state === 'activating') return;

    if (!checkEngines(initial.manifest.engines.prism, PRISM_VERSION)) {
      initial.lastError = `需要 Prism ${initial.manifest.engines.prism}，当前 ${PRISM_VERSION}`;
      initial.diagnostics = {
        status: 'error',
        errorCount: initial.diagnostics.errorCount + 1,
        lastError: initial.lastError,
        lastErrorAt: new Date().toISOString(),
      };
      bumpReactivity();
      return;
    }

    initial.state = 'activating';
    bumpReactivity();
    // ▲ 重新获取，避免 stale reference
    let entry = pluginEntries.value.get(pluginId)!;

    try {
      const token = crypto.randomUUID();

      const mainPath = entry.manifest.main;
      const source = await invoke<string>('read_plugin_file', {
        pluginId,
        filePath: mainPath,
      });

      const rewritten = rewriteImports(source, pluginId, token);
      const blobUrl = createBlobUrl(rewritten, pluginId);
      let module: any;
      try {
        module = await import(/* @vite-ignore */ blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }

      const permissions = entry.manifest.permissions ?? [];
      const ctx = createPluginContext(pluginId, permissions);

      if (typeof module.activate === 'function') {
        await module.activate(ctx);
      } else if (typeof module.default?.activate === 'function') {
        await module.default.activate(ctx);
      }

      // ▲ bumpReactivity 后 entry 可能已变 stale，重新获取
      entry = pluginEntries.value.get(pluginId)!;
      entry.ctx = ctx;
      entry.state = 'active';
      entry.diagnostics.status = 'ok';
      entry.lastError = undefined;
      bumpReactivity();
    } catch (e: any) {
      // ▲ 重新获取后再写入错误状态
      entry = pluginEntries.value.get(pluginId)!;
      entry.state = 'disabled';
      entry.lastError = e?.message || String(e);
      entry.diagnostics = {
        status: 'error',
        errorCount: entry.diagnostics.errorCount + 1,
        lastError: entry.lastError,
        lastErrorAt: new Date().toISOString(),
      };
      bumpReactivity();
    }
  }

  // ── 停用 ────────────────────────────────────────

  async function deactivatePlugin(pluginId: string): Promise<void> {
    const initial = pluginEntries.value.get(pluginId);
    if (!initial || initial.state === 'disabled' || initial.state === 'deactivating') return;

    initial.state = 'deactivating';
    bumpReactivity();
    // ▲ 重新获取，避免 stale reference
    let entry = pluginEntries.value.get(pluginId)!;

    try {
      // 调用 ctx.dispose() 清理所有插件资源（命令、视图、DOM 元素等）
      if (entry.ctx) {
        entry.ctx.dispose();
        entry.ctx = undefined;
      }
      entry.state = 'disabled';
      bumpReactivity();
    } catch (e: any) {
      // ▲ 重新获取后再写入错误状态
      entry = pluginEntries.value.get(pluginId)!;
      entry.state = 'disabled';
      entry.lastError = e?.message || String(e);
      entry.ctx = undefined;
      bumpReactivity();
    }
  }

  // ── 重载 ────────────────────────────────────────

  async function reloadPlugin(pluginId: string): Promise<void> {
    await deactivatePlugin(pluginId);
    await activatePlugin(pluginId);
  }

  // ── 启用/禁用切换 ──────────────────────────────

  async function togglePlugin(pluginId: string): Promise<void> {
    const entry = pluginEntries.value.get(pluginId);
    if (!entry) return;

    const newEnabled = !entry.enabled;
    entry.enabled = newEnabled;
    bumpReactivity();

    // 持久化
    try {
      await invoke('set_plugin_config', {
        pluginId,
        config: {
          enabled: newEnabled,
          permissions: entry.manifest.permissions ?? [],
        },
      });
    } catch (e) {
      console.warn('[PluginLoader] 保存配置失败:', e);
    }

    if (newEnabled) {
      await activatePlugin(pluginId);
    } else {
      await deactivatePlugin(pluginId);
    }
  }

  // ── 查询 ────────────────────────────────────────

  const entries = computed(() => Array.from(pluginEntries.value.values()));

  const enabledPlugins = computed(() => entries.value.filter((e) => e.enabled));

  const activePlugins = computed(() => entries.value.filter((e) => e.state === 'active'));

  function getEntry(pluginId: string): PluginEntry | undefined {
    return pluginEntries.value.get(pluginId);
  }

  return {
    loadPlugins,
    activatePlugin,
    deactivatePlugin,
    reloadPlugin,
    togglePlugin,
    entries,
    enabledPlugins,
    activePlugins,
    getEntry,
  };
}
