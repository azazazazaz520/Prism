import { ref, shallowRef } from 'vue';
import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';
import { diagnosticsLogger } from '../diagnostics/invoke-logged';
import { buildCapability } from '../plugin-api/capability-builder';
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

      // 构造注入的 prism 对象（权限裁剪后的 Capability 子集）
      const cap = buildCapability(`script:${entry.name}`, entry.permissions as PluginPermission[]);

      const prism = {
        tasks: cap.tasks,
        network: cap.network,
        ui: cap.api.ui,
        storage: cap.api.storage,
        log: (msg: string) => cap.api.diagnostics.log('info', msg),
      };

      // IIFE 执行：用 Function 构造器注入 prism 变量
      const wrapped = `
        return (async function(prism) {
          ${source}
        })(prism);
      `;
      const fn = new Function('prism', wrapped);
      await fn(prism);

      entry.status = 'done';
      entry.lastOutput = '执行完成';
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
