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

export function usePluginLoader() {
  async function loadPlugins(): Promise<void> {
    if (loaded) return;
    loaded = true;
    try {
      const manifests = await invoke<PluginManifest[]>('scan_plugins');
      const configs = await invoke<Record<string, PluginConfig>>('get_plugin_configs');
      const map = new Map<string, PluginEntry>();

      for (const raw of manifests) {
        if (!validateManifest(raw)) continue;
        const manifest = raw as PluginManifest;
        const config = configs[manifest.id];
        let lastError: string | undefined;
        if (
          manifest.contributes?.commands?.some((item) => !item.id.startsWith(`${manifest.id}.`))
        ) {
          lastError = '插件命令 ID 必须以插件 ID 为前缀';
        }
        map.set(manifest.id, {
          manifest,
          enabled: config?.enabled ?? false,
          state: 'disabled',
          diagnostics: {
            status: lastError ? 'error' : 'ok',
            errorCount: lastError ? 1 : 0,
            lastError,
          },
          lastError,
        });
      }
      pluginEntries.value = map;

      for (const [id, entry] of map) {
        if (!entry.enabled) continue;
        const permissions = entry.manifest.permissions ?? [];
        if (JSON.stringify(configs[id]?.permissions ?? []) !== JSON.stringify(permissions)) {
          void invoke('set_plugin_config', {
            pluginId: id,
            config: { enabled: true, permissions },
          });
        }
        void activatePlugin(id);
      }
    } catch (error) {
      diagnosticsLogger.error('plugin', 'plugin.scan_failed', '插件扫描失败', error);
    }
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
        registrations.push(
          registerSandboxView(
            pluginId,
            session,
            registration,
            registration.location === 'rail' ? () => activatePluginPage(pluginId) : undefined,
          ),
        );
      });
      session.onMenuRegistered((location, items) => {
        registrations.push(
          registerSandboxMenus(pluginId, location as any, items, async (commandId) => {
            await session.executeCommand(commandId);
          }),
        );
      });
      await session.waitUntilReady();
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
      entry.session?.dispose();
      entry.session = undefined;
      for (const registration of registrations) registration.dispose();
      for (const registration of entry.registrations ?? []) registration.dispose();
      entry.registrations = undefined;
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
        error: String(error),
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
    activatePlugin,
    deactivatePlugin,
    reloadPlugin,
    togglePlugin,
    entries,
    enabledPlugins,
    activePlugins,
    getEntry: (pluginId: string) => pluginEntries.value.get(pluginId),
  };
}

export function resetPluginLoaderForTests(): void {
  loaded = false;
  pluginEntries.value = new Map();
}
