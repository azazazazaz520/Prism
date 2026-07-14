import type { PluginContext, PluginPermission, Disposable } from '../types';
import { DisposableStore } from './disposable';

/**
 * 创建 PluginContext 实例。
 * 在 activate() 调用之前由 Plugin Loader 构造并注入。
 */
export function createPluginContext(
  pluginId: string,
  permissions: PluginPermission[],
): PluginContext {
  const runtimeId = `plugin:${pluginId}`;
  const store = new DisposableStore();
  const perms = new Set(permissions) as ReadonlySet<PluginPermission>;

  // ── 命令注册表（内存） ──────────────────────────
  const commandRegistry = new Map<string, () => void | Promise<void>>();

  const ctx: PluginContext = {
    pluginId,
    runtimeId,
    permissions: perms,

    // ── 资源追踪 ──────────────────────────────────
    track<T extends Disposable>(d: T): T {
      return store.track(d);
    },

    dispose(): void {
      commandRegistry.clear();
      store.dispose();
    },

    // ── 日志 ──────────────────────────────────────
    log(level, message) {
      const prefix = `[${runtimeId}]`;
      switch (level) {
        case 'error':
          console.error(prefix, message);
          break;
        case 'warn':
          console.warn(prefix, message);
          break;
        case 'debug':
          console.debug(prefix, message);
          break;
        default:
          console.log(prefix, message);
      }
    },

    // ── 命令扩展点 ────────────────────────────────
    commands: {
      register(id: string, callback: () => void | Promise<void>): Disposable {
        // 运行时 ID 前缀校验
        const prefix = `${pluginId}.`;
        if (!id || !id.startsWith(prefix)) {
          throw new TypeError(`命令 ID "${id}" 必须以 "${prefix}" 为前缀`);
        }

        if (commandRegistry.has(id)) {
          ctx.log('warn', `命令 "${id}" 被覆盖注册`);
        }
        commandRegistry.set(id, callback);

        let disposed = false;
        return {
          dispose() {
            if (disposed) return;
            disposed = true;
            commandRegistry.delete(id);
          },
        };
      },

      async execute(id: string, ..._args: unknown[]): Promise<void> {
        if (store.isDisposed) {
          throw new Error(`[${pluginId}] 会话已过期`);
        }
        const callback = commandRegistry.get(id);
        if (!callback) {
          throw new Error(`命令 "${id}" 未注册`);
        }
        await callback();
      },
    },
  };

  return ctx;
}
