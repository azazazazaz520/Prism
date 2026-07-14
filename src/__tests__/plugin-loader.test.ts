import { describe, it, expect, beforeEach } from 'vitest';
import type { PluginManifest, PluginDiagnostics } from '../types';

// ── 桩数据 ──────────────────────────────────────

interface PluginEntry {
  manifest: PluginManifest;
  enabled: boolean;
  activated: boolean;
  diagnostics: PluginDiagnostics;
}

type PluginState = 'disabled' | 'activating' | 'active' | 'deactivating';

const validManifest: PluginManifest = {
  id: 'com.example.test',
  name: '测试插件',
  version: '1.0.0',
  author: 'test',
  main: 'main.js',
  engines: { prism: '>=0.1.0' },
  permissions: ['tasks:read'],
};

// ── 纯逻辑测试（不依赖 Tauri） ──────────────────

function mergeManifestsWithConfigs(
  manifests: PluginManifest[],
  configs: Record<string, { enabled: boolean; permissions: string[] }>,
): PluginEntry[] {
  const entries: PluginEntry[] = [];
  for (const m of manifests) {
    const cfg = configs[m.id];
    entries.push({
      manifest: m,
      enabled: cfg?.enabled ?? false,
      activated: false,
      diagnostics: { status: 'ok', errorCount: 0 },
    });
  }
  return entries;
}

function checkEngines(required: string, current: string): boolean {
  if (!required) return true;
  let range = required;
  if (range.startsWith('>=')) range = range.slice(2);
  const [ma, mi, pa] = current.split('.').map(Number);
  const [mb, pb, rb] = range.split('.').map(Number);
  if (ma !== mb) return (ma ?? 0) >= (mb ?? 0);
  if (mi !== pb) return (mi ?? 0) >= (pb ?? 0);
  return (pa ?? 0) >= (rb ?? 0);
}

function transitionState(
  current: PluginState,
  action: 'activate' | 'deactivate' | 'activateDone' | 'deactivateDone' | 'error',
): PluginState | null {
  const transitions: Record<PluginState, Record<string, PluginState | null>> = {
    disabled: {
      activate: 'activating',
      deactivate: null,
      activateDone: null,
      deactivateDone: null,
      error: null,
    },
    activating: {
      activate: null,
      deactivate: null,
      activateDone: 'active',
      deactivateDone: null,
      error: 'disabled',
    },
    active: {
      activate: null,
      deactivate: 'deactivating',
      activateDone: null,
      deactivateDone: null,
      error: null,
    },
    deactivating: {
      activate: null,
      deactivate: null,
      activateDone: null,
      deactivateDone: 'disabled',
      error: 'disabled',
    },
  };
  return transitions[current]?.[action] ?? null;
}

function classifyError(error: unknown): 'fatal' | 'business' {
  if (error instanceof Error && error.message.includes('activate')) return 'fatal';
  return 'business';
}

describe('Plugin Loader 核心逻辑', () => {
  describe('合并 manifest 与 config', () => {
    it('无 config 时默认 disabled', () => {
      const entries = mergeManifestsWithConfigs([validManifest], {});
      expect(entries).toHaveLength(1);
      expect(entries[0].enabled).toBe(false);
    });

    it('config 中有匹配项时应用配置', () => {
      const entries = mergeManifestsWithConfigs([validManifest], {
        'com.example.test': { enabled: true, permissions: ['tasks:read'] },
      });
      expect(entries[0].enabled).toBe(true);
    });

    it('config 中无匹配但 manifest 存在时仍创建条目', () => {
      const entries = mergeManifestsWithConfigs([validManifest], {
        'other.plugin': { enabled: true, permissions: [] },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].manifest.id).toBe('com.example.test');
    });
  });

  describe('版本检查', () => {
    it('相同版本通过', () => {
      expect(checkEngines('>=0.1.0', '0.1.0')).toBe(true);
    });

    it('更高要求被拒绝', () => {
      expect(checkEngines('>=0.2.0', '0.1.0')).toBe(false);
    });

    it('宽松要求通过', () => {
      expect(checkEngines('>=0.0.5', '0.1.0')).toBe(true);
    });
  });

  describe('状态机', () => {
    it('disabled → activate → activating', () => {
      expect(transitionState('disabled', 'activate')).toBe('activating');
    });

    it('activating → activateDone → active', () => {
      expect(transitionState('activating', 'activateDone')).toBe('active');
    });

    it('activating → error → disabled', () => {
      expect(transitionState('activating', 'error')).toBe('disabled');
    });

    it('active → deactivate → deactivating', () => {
      expect(transitionState('active', 'deactivate')).toBe('deactivating');
    });

    it('deactivating → deactivateDone → disabled', () => {
      expect(transitionState('deactivating', 'deactivateDone')).toBe('disabled');
    });

    it('非法转换返回 null', () => {
      expect(transitionState('disabled', 'deactivate')).toBeNull();
      expect(transitionState('active', 'activate')).toBeNull();
    });
  });

  describe('错误分类', () => {
    it('activate 相关错误判定为致命', () => {
      expect(classifyError(new Error('activate failed'))).toBe('fatal');
    });

    it('普通业务异常不判定为致命', () => {
      expect(classifyError(new Error('something failed'))).toBe('business');
    });
  });
});
