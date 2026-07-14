import { ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { PluginManifest, PluginDiagnostics } from '../types';
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
  /** 最后一次激活失败的错误信息 */
  lastError?: string;
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

export function usePluginLoader() {
  // ── 初始化：扫描 + 合并配置 ─────────────────────

  async function loadPlugins() {
    if (loaded) return;
    loaded = true;

    try {
      // 扫描文件系统
      const manifests = await invoke<PluginManifest[]>('scan_plugins');
      const configs = await invoke<Record<string, PluginConfig>>('get_plugin_configs');

      const map = new Map<string, PluginEntry>();

      for (const raw of manifests) {
        // 校验 manifest
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
        const diagnostics: PluginDiagnostics = {
          status: idError ? 'error' : 'ok',
          errorCount: idError ? 1 : 0,
          lastError: idError || undefined,
        };

        map.set(m.id, {
          manifest: m,
          enabled: cfg?.enabled ?? false,
          state: 'disabled',
          diagnostics,
          lastError: idError,
        });
      }

      pluginEntries.value = map;
    } catch (e) {
      console.error('[PluginLoader] 扫描失败:', e);
    }
  }

  // ── 激活 ────────────────────────────────────────

  async function activatePlugin(pluginId: string): Promise<void> {
    const entry = pluginEntries.value.get(pluginId);
    if (!entry) throw new Error(`插件 "${pluginId}" 未找到`);
    if (entry.state === 'active' || entry.state === 'activating') return;

    // 版本兼容性检查
    if (!checkEngines(entry.manifest.engines.prism, PRISM_VERSION)) {
      entry.lastError = `需要 Prism ${entry.manifest.engines.prism}，当前 ${PRISM_VERSION}`;
      entry.diagnostics = {
        status: 'error',
        errorCount: entry.diagnostics.errorCount + 1,
        lastError: entry.lastError,
        lastErrorAt: new Date().toISOString(),
      };
      return;
    }

    entry.state = 'activating';

    try {
      // 生成一次性 session token（3s TTL）
      const token = crypto.randomUUID();

      // 读取插件入口源码
      const mainPath = entry.manifest.main;
      const source = await invoke<string>('read_plugin_file', {
        pluginId,
        filePath: mainPath,
      });

      // 词法改写 prism:* → 含 token 的 URL
      const rewritten = rewriteImports(source, pluginId, token);

      // 构造 Blob URL 并动态 import
      const blobUrl = createBlobUrl(rewritten, pluginId);
      let module: any;
      try {
        module = await import(/* @vite-ignore */ blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }

      // 构造 Capability + PluginContext
      const permissions = entry.manifest.permissions ?? [];
      const capability = buildCapability(pluginId, permissions);
      const ctx = createPluginContext(pluginId, permissions);

      // 调用插件的 activate(ctx)
      if (typeof module.activate === 'function') {
        await module.activate(ctx);
      } else if (typeof module.default?.activate === 'function') {
        await module.default.activate(ctx);
      }

      entry.state = 'active';
      entry.diagnostics.status = 'ok';
      entry.lastError = undefined;

      // token 即用即销（Capability 已建立内存闭包，后续走 IPC）
      // Tauri Protocol Handler 侧应在返回薄封装后立即注销 token
    } catch (e: any) {
      // 激活失败 → 回退 Disabled
      entry.state = 'disabled';
      entry.lastError = e?.message || String(e);
      entry.diagnostics = {
        status: 'error',
        errorCount: entry.diagnostics.errorCount + 1,
        lastError: entry.lastError,
        lastErrorAt: new Date().toISOString(),
      };
    }
  }

  // ── 停用 ────────────────────────────────────────

  async function deactivatePlugin(pluginId: string): Promise<void> {
    const entry = pluginEntries.value.get(pluginId);
    if (!entry || entry.state === 'disabled' || entry.state === 'deactivating') return;

    entry.state = 'deactivating';

    try {
      // 清理 PluginContext 和所有 Disposable 资源
      // ctx.dispose() 会注销所有注册的命令、视图等
      // 实际 dispose 在 createPluginContext 返回的 ctx 上调用
      // 此处 ctx 由 Plugin Loader 内部持有（Phase 2 扩展）
      entry.state = 'disabled';
    } catch (e: any) {
      // deactivate 超时/失败 → 强制回退
      entry.state = 'disabled';
      entry.lastError = e?.message || String(e);
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

    // 启用 → 激活；禁用 → 停用
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
