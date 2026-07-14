import type { PluginPermission } from '../types';
import { createTasksAPI } from './tasks-impl';

// ═══════════════════════════════════════════════════════════════
//  错误类型
// ═══════════════════════════════════════════════════════════════

export class PermissionError extends Error {
  pluginId: string;
  permission: string;
  operation: string;
  constructor(pluginId: string, permission: string, operation: string) {
    super(`[${pluginId}] 缺少权限 ${permission} 以执行 ${operation}`);
    this.name = 'PermissionError';
    this.pluginId = pluginId;
    this.permission = permission;
    this.operation = operation;
  }
}

export class SessionExpiredError extends Error {
  pluginId: string;
  constructor(pluginId: string) {
    super(`[${pluginId}] 会话已过期`);
    this.name = 'SessionExpiredError';
    this.pluginId = pluginId;
  }
}

// ═══════════════════════════════════════════════════════════════
//  Capability 产物类型
// ═══════════════════════════════════════════════════════════════

export interface Capability {
  api: CoreAPI;
  commands: CommandsStub;
  tasks?: TasksStub | undefined;
  network?: NetworkStub | undefined;
  invalidate(): void;
}

interface CoreAPI {
  ui: UIStub;
  storage: StorageStub;
  diagnostics: DiagnosticsStub;
}

interface UIStub {
  notice(message: string, level?: 'info' | 'warn' | 'error'): void;
  // Phase 2: dialog, input
}

interface StorageStub {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

interface DiagnosticsStub {
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

interface CommandsStub {
  // 命令注册在 PluginContext 层，此处仅为 Capability 注入占位
  // Phase 1 中命令通过 PluginContext.commands.register 完成
}

interface TasksStub {
  list?(): Promise<unknown[]>;
  listByDate?(date: string): Promise<unknown[]>;
  create?(title: string, opts?: unknown): Promise<unknown>;
  update?(id: string, fields: unknown): Promise<unknown>;
  toggle?(id: string): Promise<unknown>;
  delete?(id: string): Promise<void>;
}

interface NetworkStub {
  fetch(url: string, options?: unknown): Promise<unknown>;
}

// ═══════════════════════════════════════════════════════════════
//  Capability Builder
// ═══════════════════════════════════════════════════════════════

/**
 * 根据 manifest.permissions 构造权限裁剪后的 Capability 对象。
 * 这是 Layer 2 防护——Capability API 层调用时校验权限。
 */
export function buildCapability(pluginId: string, permissions: PluginPermission[]): Capability {
  const permSet = new Set(permissions);
  let expired = false;

  function ensureAlive(): void {
    if (expired) throw new SessionExpiredError(pluginId);
  }

  function requirePerm(perm: PluginPermission): void {
    if (!permSet.has(perm)) {
      throw new PermissionError(pluginId, perm, '');
    }
  }

  // ── 始终可用的 core API ─────────────────────────

  const api: CoreAPI = {
    ui: {
      notice(message, level = 'info') {
        ensureAlive();
        const prefix = `[${pluginId}]`;
        switch (level) {
          case 'error':
            console.error(prefix, message);
            break;
          case 'warn':
            console.warn(prefix, message);
            break;
          default:
            console.log(prefix, message);
        }
      },
    },
    storage: {
      async get<T>(key: string): Promise<T | null> {
        ensureAlive();
        const raw = localStorage.getItem(`plugin:${pluginId}:${key}`);
        if (!raw) return null;
        try {
          return JSON.parse(raw) as T;
        } catch {
          return null;
        }
      },
      async set(key: string, value: unknown): Promise<void> {
        ensureAlive();
        localStorage.setItem(`plugin:${pluginId}:${key}`, JSON.stringify(value));
      },
      async delete(key: string): Promise<void> {
        ensureAlive();
        localStorage.removeItem(`plugin:${pluginId}:${key}`);
      },
      async keys(): Promise<string[]> {
        ensureAlive();
        const prefix = `plugin:${pluginId}:`;
        const result: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(prefix)) {
            result.push(k.slice(prefix.length));
          }
        }
        return result;
      },
    },
    diagnostics: {
      log(level, message) {
        ensureAlive();
        const prefix = `[diag:${pluginId}]`;
        switch (level) {
          case 'error':
            console.error(prefix, message);
            break;
          case 'warn':
            console.warn(prefix, message);
            break;
          default:
            console.log(prefix, message);
        }
      },
    },
  };

  const commands: CommandsStub = {};

  // ── tasks 模块（需权限） ──────────────────────────

  const tasksAPI = createTasksAPI(pluginId, permissions);

  let tasks: TasksStub | undefined;
  if (permSet.has('tasks:read') || permSet.has('tasks:write')) {
    tasks = {
      list: tasksAPI.list
        ? async () => {
            ensureAlive();
            return tasksAPI.list!();
          }
        : undefined,
      listByDate: tasksAPI.listByDate
        ? async (date: string) => {
            ensureAlive();
            return tasksAPI.listByDate!(date);
          }
        : undefined,
      create: tasksAPI.create
        ? async (title: string, opts?: unknown) => {
            ensureAlive();
            return tasksAPI.create!(title, opts as any);
          }
        : undefined,
      update: tasksAPI.update
        ? async (id: string, fields: unknown) => {
            ensureAlive();
            return tasksAPI.update!(id, fields as any);
          }
        : undefined,
      toggle: tasksAPI.toggle
        ? async (id: string) => {
            ensureAlive();
            return tasksAPI.toggle!(id);
          }
        : undefined,
      delete: tasksAPI.delete
        ? async (id: string) => {
            ensureAlive();
            return tasksAPI.delete!(id);
          }
        : undefined,
    };
  }

  // ── network 模块（需权限） ───────────────────────

  let network: NetworkStub | undefined;
  if (permSet.has('network')) {
    network = {
      async fetch(_url: string, _options?: unknown): Promise<unknown> {
        ensureAlive();
        requirePerm('network');
        // Phase 3: 通过 Rust Host 代理
        throw new Error('network.fetch 尚未实现（Phase 3）');
      },
    };
  }

  return {
    api,
    commands,
    tasks,
    network,
    invalidate() {
      expired = true;
    },
  };
}
