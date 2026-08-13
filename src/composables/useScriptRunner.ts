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

// ═══════════════════════════════════════════════════════════════
//  全局单例
// ═══════════════════════════════════════════════════════════════

const scripts = shallowRef<ScriptEntry[]>([]);
let loaded = false;

export function useScriptRunner() {
  async function loadScripts() {
    if (loaded) return;
    loaded = true;
    try {
      const list =
        await invoke<{ name: string; description?: string; permissions: string[] }[]>(
          'scan_scripts',
        );
      scripts.value = list.map((m) => ({
        name: m.name,
        description: m.description,
        permissions: m.permissions,
        status: 'idle' as const,
      }));
    } catch (e) {
      diagnosticsLogger.error('scripts', 'scripts.scan_failed', '扫描脚本失败', e);
    }
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
    runScript,
  };
}
