import { ref, shallowRef } from 'vue';
import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';
import { diagnosticsLogger } from '../diagnostics/invoke-logged';
import { runScriptInSandbox } from '../plugin-api/script-sandbox';
import type { PluginPermission } from '../types';

// ═══════════════════════════════════════════════════════════════
//  类型
// ═══════════════════════════════════════════════════════════════

export interface ScriptEntry {
  name: string;
  description?: string;
  permissions: string[];
  status: 'idle' | 'running' | 'done' | 'error';
  lastOutput?: string;
}

export type ScriptScanState = 'idle' | 'scanning' | 'success' | 'error';

// ═══════════════════════════════════════════════════════════════
//  全局单例
// ═══════════════════════════════════════════════════════════════

const scripts = shallowRef<ScriptEntry[]>([]);
let loaded = false;
const scanState = ref<ScriptScanState>('idle');
const scanError = ref('');
let scanPromise: Promise<void> | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useScriptRunner() {
  async function performScan(): Promise<void> {
    try {
      const list =
        await invoke<{ name: string; description?: string; permissions: string[] }[]>(
          'scan_scripts',
        );
      const previous = new Map(scripts.value.map((script) => [script.name, script]));
      scripts.value = list.map((m) => ({
        name: m.name,
        description: m.description,
        permissions: m.permissions,
        status: previous.get(m.name)?.status ?? ('idle' as const),
        lastOutput: previous.get(m.name)?.lastOutput,
      }));
      loaded = true;
    } catch (e) {
      loaded = false;
      scanError.value = errorMessage(e);
      diagnosticsLogger.error('scripts', 'scripts.scan_failed', '扫描脚本失败', e);
    }
  }

  async function scanScripts(force: boolean): Promise<void> {
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

  async function loadScripts(): Promise<void> {
    await scanScripts(false);
  }

  async function rescanScripts(): Promise<void> {
    if (scripts.value.some((script) => script.status === 'running')) {
      scanError.value = '有脚本正在运行，请完成后再扫描。';
      scanState.value = 'error';
      return;
    }
    await scanScripts(true);
  }

  async function runScript(index: number) {
    const entry = scripts.value[index];
    if (!entry || entry.status === 'running') return;

    entry.status = 'running';
    entry.lastOutput = undefined;
    scripts.value = [...scripts.value]; // trigger reactivity

    try {
      const fileName = entry.name.endsWith('.js') ? entry.name : entry.name + '.js';
      const source: string = await invoke('read_script_content', { fileName });
      const scriptId = `script:${entry.name}`;
      const permissions = entry.permissions as PluginPermission[];

      // 将脚本声明权限持久化到 ConfigStore，使后端 check_plugin_permission
      // 对 script:<name> 的调用按持久化配置校验（审查报告 H-1：移除无条件放行）
      await invoke('set_plugin_config', {
        pluginId: scriptId,
        config: { enabled: true, permissions },
      }).catch((error) =>
        diagnosticsLogger.warn('script', 'script.config_save_failed', '脚本权限配置保存失败', {
          error: String(error),
          script_id: scriptId,
        }),
      );

      // 在隔离 iframe 沙箱中执行（审查报告 S-2），带执行超时
      const result = await runScriptInSandbox({ scriptId, permissions, source });
      if (result.ok) {
        entry.status = 'done';
        entry.lastOutput = '执行完成';
      } else {
        entry.status = 'error';
        entry.lastOutput = result.error || '执行失败';
      }
    } catch (e: any) {
      entry.status = 'error';
      entry.lastOutput = e?.message || String(e);
    }

    scripts.value = [...scripts.value];
  }

  return {
    scripts,
    loadScripts,
    rescanScripts,
    runScript,
    scanState,
    scanError,
  };
}

export function resetScriptRunnerForTests(): void {
  scripts.value = [];
  loaded = false;
  scanState.value = 'idle';
  scanError.value = '';
  scanPromise = null;
}
