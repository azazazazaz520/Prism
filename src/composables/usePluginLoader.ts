import { computed, ref, shallowRef } from 'vue';
import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';
import { diagnosticsLogger } from '../diagnostics/invoke-logged';
import type { Disposable, PluginDiagnostics, PluginManifest } from '../types';
import { checkEngines, PRISM_VERSION, validateManifest } from './usePluginManifest';
import { parseModule } from '../plugin-api/module-resolver';
import { registerSandboxMenus } from '../plugin-api/menus-impl';
import { activatePluginPage, registerSandboxView } from '../plugin-api/views-impl';
import { SandboxPluginSession } from '../plugin-api/sandbox-session';

type PluginState = 'disabled' | 'activating' | 'active' | 'deactivating';
export type PluginScanState = 'idle' | 'scanning' | 'success' | 'error';

interface PluginEntry {
  manifest: PluginManifest;
  enabled: boolean;
  state: PluginState;
  diagnostics: PluginDiagnostics;
  lastError?: string;
  session?: SandboxPluginSession;
  registrations?: Disposable[];
}

interface PluginConfig {
  enabled: boolean;
  permissions: string[];
}

const pluginEntries = shallowRef<Map<string, PluginEntry>>(new Map());
let loaded = false;
const scanState = ref<PluginScanState>('idle');
const scanError = ref('');
let scanPromise: Promise<void> | null = null;

/** 各插件的激活世代号：停用/重载时递增，使在途激活失效（审查报告 H-3） */
const pluginGenerations = new Map<string, number>();

function invalidatePluginActivations(pluginId: string): void {
  pluginGenerations.set(pluginId, (pluginGenerations.get(pluginId) ?? 0) + 1);
}

function bumpReactivity(): void {
  pluginEntries.value = new Map(pluginEntries.value);
}

function markFailure(entry: PluginEntry, error: unknown): void {
  entry.state = 'disabled';
  entry.lastError = error instanceof Error ? error.message : String(error);
  entry.diagnostics = {
    status: 'error',
    errorCount: entry.diagnostics.errorCount + 1,
    lastError: entry.lastError,
    lastErrorAt: new Date().toISOString(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameManifest(left: PluginManifest, right: PluginManifest): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createPluginEntry(
  manifest: PluginManifest,
  config: PluginConfig | undefined,
): PluginEntry {
  const lastError = manifest.contributes?.commands?.some(
    (item) => !item.id.startsWith(`${manifest.id}.`),
  )
    ? '插件命令 ID 必须以插件 ID 为前缀'
    : undefined;

  return {
    manifest,
    enabled: config?.enabled ?? false,
    state: 'disabled',
    diagnostics: {
      status: lastError ? 'error' : 'ok',
      errorCount: lastError ? 1 : 0,
      lastError,
    },
    lastError,
  };
}

export function usePluginLoader() {
  async function performScan(): Promise<void> {
    try {
      const rawManifests = await invoke<PluginManifest[]>('scan_plugins');
      const configs = await invoke<Record<string, PluginConfig>>('get_plugin_configs');
      const manifests = new Map<string, PluginManifest>();

      for (const raw of rawManifests) {
        if (!validateManifest(raw)) continue;
        manifests.set(raw.id, raw);
      }

      const currentEntries = pluginEntries.value;
      const nextEntries = new Map<string, PluginEntry>();

      // 先清理已删除或 manifest 已变化的插件，避免旧沙箱和注册项残留。
      for (const [id, entry] of currentEntries) {
        const manifest = manifests.get(id);
        if (!manifest || !sameManifest(entry.manifest, manifest)) {
          await deactivatePlugin(id);
        }
      }

      for (const [id, manifest] of manifests) {
        const current = currentEntries.get(id);
        const config = configs[id];
        if (current && sameManifest(current.manifest, manifest)) {
          current.enabled = config?.enabled ?? false;
          nextEntries.set(id, current);
        } else {
          nextEntries.set(id, createPluginEntry(manifest, config));
        }
      }

      pluginEntries.value = nextEntries;

      await Promise.all(
        [...nextEntries].map(async ([id, entry]) => {
          const permissions = entry.manifest.permissions ?? [];
          if (
            entry.enabled &&
            JSON.stringify(configs[id]?.permissions ?? []) !== JSON.stringify(permissions)
          ) {
            await invoke('set_plugin_config', {
              pluginId: id,
              config: { enabled: entry.enabled, permissions },
            }).catch((error) =>
              diagnosticsLogger.warn('plugin', 'plugin.config_save_failed', '插件配置保存失败', {
                error: errorMessage(error),
                plugin_id: id,
              }),
            );
          }
          if (!entry.enabled) {
            if (entry.state !== 'disabled') await deactivatePlugin(id);
            return;
          }
          await activatePlugin(id);
        }),
      );
      loaded = true;
    } catch (error) {
      loaded = false;
      scanError.value = errorMessage(error);
      diagnosticsLogger.error('plugin', 'plugin.scan_failed', '插件扫描失败', error);
    }
  }

  async function scanPlugins(force: boolean): Promise<void> {
    if (scanPromise) {
      await scanPromise;
      if (!force) return;
    }
    if (!force && loaded) return;

    scanState.value = 'scanning';
    scanError.value = '';
    const currentScan = performScan();
    scanPromise = currentScan;
    try {
      await currentScan;
      scanState.value = scanError.value ? 'error' : 'success';
    } finally {
      if (scanPromise === currentScan) scanPromise = null;
    }
  }

  async function loadPlugins(): Promise<void> {
    await scanPlugins(false);
  }

  async function rescanPlugins(): Promise<void> {
    await scanPlugins(true);
  }

  async function activatePlugin(pluginId: string): Promise<void> {
    const initial = pluginEntries.value.get(pluginId);
    if (!initial || initial.state === 'active' || initial.state === 'activating') return;
    if (!checkEngines(initial.manifest.engines.prism, PRISM_VERSION)) {
      initial.lastError = `需要 Prism ${initial.manifest.engines.prism}`;
      initial.diagnostics = {
        status: 'error',
        errorCount: initial.diagnostics.errorCount + 1,
        lastError: initial.lastError,
      };
      bumpReactivity();
      return;
    }

    initial.state = 'activating';
    bumpReactivity();
    const startedAt = performance.now();
    diagnosticsLogger.info('plugin', 'plugin.activation_started', '插件开始激活', {
      plugin_id: pluginId,
    });
    // 捕获本次激活世代：若激活期间被停用（世代递增），结果作废（H-3）
    const generation = pluginGenerations.get(pluginId) ?? 0;
    const entry = pluginEntries.value.get(pluginId)!;
    const registrations: Disposable[] = [];
    try {
      const source = await invoke<string>('read_plugin_file', {
        pluginId,
        filePath: entry.manifest.main,
      });
      const { body } = parseModule(source);
      const session = new SandboxPluginSession(pluginId, entry.manifest.permissions ?? [], body);
      entry.session = session;
      session.onViewRegistered((registration) => {
        try {
          const disposable = registerSandboxView(
            pluginId,
            session,
            registration,
            registration.location === 'rail' ? () => activatePluginPage(pluginId) : undefined,
          );
          registrations.push(disposable);
          // 登记到会话，使沙箱内 Disposable.dispose() 能释放宿主注册（S-4）
          session.registerExternalDisposable(`view:${registration.id}`, disposable);
        } catch (error) {
          // 视图 ID 前缀校验失败（H-6）：拒绝该注册但保持插件激活
          diagnosticsLogger.warn('plugin', 'plugin.sandbox_view_rejected', '沙箱视图注册被拒绝', {
            plugin_id: pluginId,
            view_id: registration.id,
            error: String(error),
          });
        }
      });
      session.onMenuRegistered((location, items) => {
        try {
          const disposable = registerSandboxMenus(
            pluginId,
            location as any,
            items,
            async (commandId) => {
              await session.executeCommand(commandId);
            },
          );
          registrations.push(disposable);
          session.registerExternalDisposable(`menu:${location}`, disposable);
        } catch (error) {
          // 菜单 ID 前缀校验失败（H-6）：拒绝该注册但保持插件激活
          diagnosticsLogger.warn('plugin', 'plugin.sandbox_menu_rejected', '沙箱菜单注册被拒绝', {
            plugin_id: pluginId,
            location,
            error: String(error),
          });
        }
      });
      await session.waitUntilReady();
      // 激活期间被停用：清理会话与注册，保持 disabled 且不写错误诊断（H-3）
      if (generation !== (pluginGenerations.get(pluginId) ?? 0) || entry.state !== 'activating') {
        session.dispose();
        entry.session = undefined;
        for (const registration of registrations) registration.dispose();
        entry.registrations = undefined;
        entry.state = 'disabled';
        entry.lastError = undefined;
        bumpReactivity();
        return;
      }
      entry.session = session;
      entry.registrations = registrations;
      entry.state = 'active';
      entry.diagnostics = { status: 'ok', errorCount: entry.diagnostics.errorCount };
      entry.lastError = undefined;
      bumpReactivity();
      diagnosticsLogger.info('plugin', 'plugin.activation_completed', '插件激活完成', {
        plugin_id: pluginId,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      const stale = generation !== (pluginGenerations.get(pluginId) ?? 0);
      entry.session?.dispose();
      entry.session = undefined;
      for (const registration of registrations) registration.dispose();
      for (const registration of entry.registrations ?? []) registration.dispose();
      entry.registrations = undefined;
      if (stale) {
        // 主动停用导致的沙箱关闭：不记录为错误诊断（H-3/M-5）
        entry.state = 'disabled';
        entry.lastError = undefined;
        bumpReactivity();
        return;
      }
      markFailure(entry, error);
      bumpReactivity();
      diagnosticsLogger.error('plugin', 'plugin.activation_failed', '插件激活失败', error, {
        plugin_id: pluginId,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    }
  }

  async function deactivatePlugin(pluginId: string): Promise<void> {
    const entry = pluginEntries.value.get(pluginId);
    if (!entry || entry.state === 'disabled' || entry.state === 'deactivating') return;
    // 使在途激活失效，避免停用后被"复活"（H-3）
    invalidatePluginActivations(pluginId);
    entry.state = 'deactivating';
    bumpReactivity();
    for (const registration of entry.registrations ?? []) registration.dispose();
    entry.registrations = undefined;
    entry.session?.dispose();
    entry.session = undefined;
    entry.state = 'disabled';
    bumpReactivity();
  }

  async function reloadPlugin(pluginId: string): Promise<void> {
    await deactivatePlugin(pluginId);
    await activatePlugin(pluginId);
  }

  async function togglePlugin(pluginId: string): Promise<void> {
    const entry = pluginEntries.value.get(pluginId);
    if (!entry) return;
    const enabled = !entry.enabled;
    entry.enabled = enabled;
    bumpReactivity();
    await invoke('set_plugin_config', {
      pluginId,
      config: { enabled, permissions: entry.manifest.permissions ?? [] },
    }).catch((error) =>
      diagnosticsLogger.warn('plugin', 'plugin.config_save_failed', '插件配置保存失败', {
        error: errorMessage(error),
        plugin_id: pluginId,
      }),
    );
    if (enabled) await activatePlugin(pluginId);
    else await deactivatePlugin(pluginId);
  }

  const entries = computed(() => Array.from(pluginEntries.value.values()));
  const enabledPlugins = computed(() => entries.value.filter((entry) => entry.enabled));
  const activePlugins = computed(() => entries.value.filter((entry) => entry.state === 'active'));

  return {
    loadPlugins,
    rescanPlugins,
    activatePlugin,
    deactivatePlugin,
    reloadPlugin,
    togglePlugin,
    entries,
    enabledPlugins,
    activePlugins,
    scanState,
    scanError,
    getEntry: (pluginId: string) => pluginEntries.value.get(pluginId),
  };
}

export function resetPluginLoaderForTests(): void {
  loaded = false;
  scanState.value = 'idle';
  scanError.value = '';
  scanPromise = null;
  pluginEntries.value = new Map();
  pluginGenerations.clear();
}
