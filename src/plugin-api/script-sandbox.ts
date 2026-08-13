/**
 * 轻量脚本沙箱执行器。
 *
 * 将 `~/.prism/scripts/` 下的用户脚本放入独立 iframe
 * （`sandbox="allow-scripts"`、opaque origin）中执行，通过 postMessage RPC
 * 桥访问受限能力（任务、网络、隔离存储、日志），解决插件系统审查报告 S-2：
 * 脚本原先在主窗口上下文用 `new Function` 直接执行，可访问全部全局对象，
 * 权限声明形同虚设。
 *
 * 沙箱内显式删除 `__TAURI_INTERNALS__`、`fetch`、`XMLHttpRequest`、`WebSocket`，
 * 网络与存储一律经宿主 RPC 转发，由后端权限校验把关。
 */

import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';
import { diagnosticsLogger } from '../diagnostics/invoke-logged';

/** 脚本执行超时时间（毫秒），防止死循环卡死界面 */
export const SCRIPT_TIMEOUT_MS = 10_000;

export interface ScriptSandboxOptions {
  /** 脚本标识，格式为 `script:<name>`，作为后端权限校验的 pluginId */
  scriptId: string;
  /** 脚本声明的权限列表 */
  permissions: string[];
  /** 脚本源码 */
  source: string;
  /** 执行超时（毫秒），默认 SCRIPT_TIMEOUT_MS */
  timeoutMs?: number;
}

export interface ScriptSandboxResult {
  ok: boolean;
  error?: string;
}

function createChannelId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** 将字符串安全嵌入 srcdoc 的 script 元素（JSON 序列化 + 转义闭合标签） */
function embedString(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// ═══ 沙箱内引导脚本 ═══

const SCRIPT_BOOTSTRAP = String.raw`(() => {
  const config = __PRISM_CONFIG__;
  const scriptSource = __PRISM_SCRIPT_SOURCE__;
  const pending = new Map();
  let nextRequestId = 1;

  // 屏蔽宿主能力全局对象，网络与存储一律走 RPC（纵深防御）
  try { delete window.__TAURI_INTERNALS__; } catch (e) { /* 只读属性时忽略 */ }
  try { delete window.fetch; } catch (e) { /* 忽略 */ }
  try { delete window.XMLHttpRequest; } catch (e) { /* 忽略 */ }
  try { delete window.WebSocket; } catch (e) { /* 忽略 */ }

  function postToHost(message) {
    parent.postMessage({ ...message, channelId: config.channelId }, '*');
  }

  function rpc(method, args) {
    const id = nextRequestId++;
    postToHost({ kind: 'rpc', id, method, args });
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  window.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.kind === 'rpc-result' && pending.has(message.id)) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      message.ok ? item.resolve(message.value) : item.reject(new Error(message.error || 'RPC failed'));
    }
  });

  const storage = {
    async get(key) { return rpc('storage.get', [key]); },
    async set(key, value) { return rpc('storage.set', [key, value]); },
    async delete(key) { return rpc('storage.delete', [key]); },
    async keys() { return rpc('storage.keys', []); },
  };

  const has = (perm) => config.permissions.includes(perm);
  const prism = {
    pluginId: config.scriptId,
    tasks: {
      list: has('tasks:read') ? () => rpc('tasks.list', []) : undefined,
      listByDate: has('tasks:read') ? (date) => rpc('tasks.list-by-date', [date]) : undefined,
      create: has('tasks:write') ? (title, options) => rpc('tasks.create', [title, options || {}]) : undefined,
      update: has('tasks:write') ? (id, options) => rpc('tasks.update', [id, options || {}]) : undefined,
      toggle: has('tasks:write') ? (id) => rpc('tasks.toggle', [id]) : undefined,
      delete: has('tasks:write') ? (id) => rpc('tasks.delete', [id]) : undefined,
    },
    network: {
      fetch: has('network') || has('network:local')
        ? (url, options) => rpc('network.fetch', [url, options || {}])
        : undefined,
    },
    ui: {
      notice(message, level) {
        postToHost({ kind: 'log', level: level || 'info', message: String(message) });
      },
    },
    storage,
    log(message) {
      postToHost({ kind: 'log', level: 'info', message: String(message) });
    },
  };

  const factory = new Function(
    'prism',
    'return (async function(prism) {\n' + scriptSource + '\n})(prism);',
  );
  Promise.resolve()
    .then(() => factory(prism))
    .then(() => postToHost({ kind: 'done', ok: true }))
    .catch((error) => postToHost({ kind: 'done', ok: false, error: error?.message || String(error) }));
})();`;

// ═══ 宿主侧 RPC 方法 ═══

type RpcReply = { id: number; ok: boolean; value?: unknown; error?: string };

/** 宿主侧 RPC 方法分发（导出供单元测试覆盖，iframe 执行留待真实 Tauri 验收） */
export async function handleRpcMethod(
  scriptId: string,
  method: string,
  args: unknown[],
): Promise<unknown> {
  switch (method) {
    case 'storage.get': {
      const key = String(args[0]);
      const raw = localStorage.getItem(`plugin:${scriptId}:${key}`);
      return raw === null ? null : JSON.parse(raw);
    }
    case 'storage.set': {
      const key = String(args[0]);
      localStorage.setItem(`plugin:${scriptId}:${key}`, JSON.stringify(args[1]));
      return null;
    }
    case 'storage.delete': {
      localStorage.removeItem(`plugin:${scriptId}:${String(args[0])}`);
      return null;
    }
    case 'storage.keys': {
      const prefix = `plugin:${scriptId}:`;
      const result: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) result.push(k.slice(prefix.length));
      }
      return result;
    }
    case 'tasks.list':
      return invoke('plugin_tasks_list', { pluginId: scriptId });
    case 'tasks.list-by-date':
      return invoke('plugin_tasks_list_by_date', { pluginId: scriptId, date: String(args[0]) });
    case 'tasks.create':
      return invoke('plugin_tasks_create', { pluginId: scriptId, args: args[0] ?? {} });
    case 'tasks.update':
      return invoke('plugin_tasks_update', { pluginId: scriptId, args: args[0] ?? {} });
    case 'tasks.toggle':
      return invoke('plugin_tasks_toggle', { pluginId: scriptId, id: String(args[0]) });
    case 'tasks.delete':
      return invoke('plugin_tasks_delete', { pluginId: scriptId, id: String(args[0]) });
    case 'network.fetch':
      return invoke('plugin_network_fetch', {
        pluginId: scriptId,
        url: String(args[0]),
        options: args[1] ?? {},
      });
    default:
      throw new Error(`未知 RPC 方法: ${method}`);
  }
}

// ═══ 沙箱执行入口 ═══

/**
 * 在隔离 iframe 中执行脚本源码，返回执行结果。
 * 超时或 iframe 加载失败时以失败结果返回，不抛出。
 */
export function runScriptInSandbox(options: ScriptSandboxOptions): Promise<ScriptSandboxResult> {
  const timeoutMs = options.timeoutMs ?? SCRIPT_TIMEOUT_MS;
  return new Promise<ScriptSandboxResult>((resolve) => {
    const channelId = createChannelId();
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.style.display = 'none';

    // 配置直接嵌入对象字面量（仅转义闭合标签），源码嵌入 JSON 字符串
    const configJson = JSON.stringify({
      scriptId: options.scriptId,
      permissions: options.permissions,
      channelId,
    }).replace(/</g, '\\u003c');
    const source = embedString(options.source);
    iframe.srcdoc =
      `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" ` +
      `content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'">` +
      `<style>html,body{margin:0;height:100%;overflow:auto}</style></head>` +
      `<body><script>const __PRISM_CONFIG__=${configJson};` +
      `const __PRISM_SCRIPT_SOURCE__=${source};${SCRIPT_BOOTSTRAP}<\/script></body></html>`;

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    const finish = (result: ScriptSandboxResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      cleanup();
      resolve(result);
    };

    const sendReply = (reply: RpcReply) => {
      iframe.contentWindow?.postMessage({ kind: 'rpc-result', channelId, ...reply }, '*');
    };

    const onMessage = (event: MessageEvent) => {
      const message = event.data as Record<string, unknown> | undefined;
      if (!message || message.channelId !== channelId) return;
      if (message.kind === 'rpc') {
        const request = message as { id: number; method: string; args: unknown[] };
        handleRpcMethod(options.scriptId, request.method, request.args)
          .then((value) => sendReply({ id: request.id, ok: true, value }))
          .catch((error) => {
            const text = error instanceof Error ? error.message : String(error);
            sendReply({ id: request.id, ok: false, error: text });
          });
        return;
      }
      if (message.kind === 'log') {
        const level = String(message.level || 'info');
        const text = String(message.message || '');
        diagnosticsLogger.info('script', 'script.sandbox_log', text, {
          script_id: options.scriptId,
          level,
        });
        return;
      }
      if (message.kind === 'done') {
        finish({
          ok: Boolean(message.ok),
          error: message.error ? String(message.error) : undefined,
        });
      }
    };

    window.addEventListener('message', onMessage);
    timer = setTimeout(() => {
      finish({ ok: false, error: `脚本执行超时（${timeoutMs}ms）` });
    }, timeoutMs);

    iframe.addEventListener('load', () => {
      // 等待沙箱内主动上报 done；加载本身不触发结果
    });
    document.body.appendChild(iframe);
  });
}
