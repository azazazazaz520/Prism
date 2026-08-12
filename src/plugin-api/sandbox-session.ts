import vueRuntime from 'vue/dist/vue.runtime.global.prod.js?raw';
import { diagnosticsLogger, invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';

export type SandboxViewLocation = 'sidebar' | 'panel' | 'settings' | 'rail' | 'page';

export interface SandboxViewSession {
  attach(container: HTMLElement, viewId: string): void;
  detach(container: HTMLElement): void;
}

export interface SandboxViewRegistration {
  id: string;
  location: SandboxViewLocation;
  title?: string;
  icon?: SandboxIcon;
}

export interface SandboxIcon {
  viewBox: string;
  nodes: Array<{
    tag: 'path' | 'circle' | 'rect';
    attrs: Record<string, string | number>;
  }>;
}

export interface SandboxMenuItem {
  id: string;
  label: string;
  icon?: string;
}

interface RpcRequest {
  kind: 'rpc';
  id: number;
  method: string;
  args: unknown[];
}

interface RpcResponse {
  kind: 'rpc-result';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

type MessageHandler = (request: RpcRequest) => Promise<unknown>;

/** 沙箱插件源码中由模块解析器使用的工厂函数参数名称。 */
export const SANDBOX_PLUGIN_FACTORY_PARAMETERS = [
  'window',
  'document',
  'localStorage',
  '__vue__',
] as const;

const SANDBOX_FACTORY_PARAMETER_LIST = SANDBOX_PLUGIN_FACTORY_PARAMETERS.map((name) =>
  JSON.stringify(name),
).join(', ');

export const SANDBOX_READY_TIMEOUT_MS = 10_000;

function createSandboxChannelId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const BOOTSTRAP = String.raw`(() => {
  const config = __PRISM_CONFIG__;
  const pluginSource = __PRISM_SOURCE__;
  const pending = new Map();
  const views = new Map();
  const commands = new Map();
  const menus = new Map();
  let disposed = false;
  let nextRequestId = 1;
  let nextDisposableId = 1;

  function postToHost(message) {
    parent.postMessage({ ...message, channelId: config.channelId }, '*');
  }

  function lifecycle(stage) {
    postToHost({ kind: 'lifecycle', stage });
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
      return;
    }
    if (message.kind === 'sandbox-command') {
      if (message.command === 'show-view') mountView(message.viewId);
      if (message.command === 'dispose') dispose();
      if (message.command === 'execute-command') executeCommand(message.commandId, message.args || []);
    }
    if (message.kind === 'theme-update') {
      for (const [name, value] of Object.entries(message.variables || {})) {
        document.documentElement.style.setProperty(name, String(value));
      }
      document.documentElement.style.colorScheme =
        document.documentElement.style.getPropertyValue('--theme-color-scheme') || 'light';
    }
  });

  const storageCache = new Map();
  const storage = {
    getItem(key) { return storageCache.has(key) ? storageCache.get(key) : null; },
    setItem(key, value) {
      const text = String(value);
      storageCache.set(key, text);
      void rpc('storage.set', [key, text]);
    },
    removeItem(key) {
      storageCache.delete(key);
      void rpc('storage.delete', [key]);
    },
    key(index) { return Array.from(storageCache.keys())[index] || null; },
    get length() { return storageCache.size; },
  };
  Object.defineProperty(window, 'localStorage', { configurable: false, value: storage });

  function disposable(kind, id) {
    const disposableId = nextDisposableId++;
    return {
      dispose() {
        postToHost({ kind: 'sandbox-dispose', disposableId, resource: kind, id });
      },
    };
  }

  const ctx = {
    pluginId: config.pluginId,
    runtimeId: 'plugin:' + config.pluginId,
    permissions: new Set(config.permissions),
    track(value) { return value; },
    dispose,
    log(level, message) { postToHost({ kind: 'log', level, message: String(message) }); },
    openUrl(url) { return rpc('open-url', [url]); },
    storage: {
      async get(key) { const value = await rpc('storage.get', [key]); if (value == null) return null; storageCache.set(key, value); return JSON.parse(value); },
      async set(key, value) { const raw = JSON.stringify(value); storageCache.set(key, raw); await rpc('storage.set', [key, raw]); },
      async delete(key) { storageCache.delete(key); await rpc('storage.delete', [key]); },
      async keys() { return rpc('storage.keys', []); },
      binary: {
        async get(key) { return rpc('storage.binary.get', [key]); },
        async set(key, value) { return rpc('storage.binary.set', [key, value]); },
        async delete(key) { return rpc('storage.binary.delete', [key]); },
        async keys() { return rpc('storage.binary.keys', []); },
      },
    },
    commands: {
      register(id, callback) {
        commands.set(id, callback);
        postToHost({ kind: 'command-register', id });
        return disposable('command', id);
      },
      async execute(id, ...args) { return executeCommand(id, args); },
    },
    views: {
      registerSidebar(id, component, options) { return registerView(id, 'sidebar', component, options); },
      registerPanel(id, component, options) { return registerView(id, 'panel', component, options); },
      registerSettings(id, component, options) { return registerView(id, 'settings', component, options); },
      registerRail(id, component, options) { return registerView(id, 'rail', component, options); },
      registerPage(id, component, options) { return registerView(id, 'page', component, options); },
      registerDomView(id, options) { return registerView(id, 'panel', options); },
    },
    menus: {
      register(location, items) {
        for (const item of items) menus.set(item.id, item.action);
        postToHost({
          kind: 'menu-register',
          location,
          items: items.map(({ id, label, icon }) => ({ id, label, icon })),
        });
        return disposable('menu', location);
      },
    },
    env: {
      get theme() { return document.documentElement.dataset.theme || 'auto'; },
      locale: 'zh-CN',
      vue: window.Vue,
    },
    tasks: {
      list: config.permissions.includes('tasks:read') ? () => rpc('tasks.list', []) : undefined,
      listByDate: config.permissions.includes('tasks:read') ? (date) => rpc('tasks.list-by-date', [date]) : undefined,
      create: config.permissions.includes('tasks:write') ? (title, options) => rpc('tasks.create', [title, options || {}]) : undefined,
      update: config.permissions.includes('tasks:write') ? (id, options) => rpc('tasks.update', [id, options || {}]) : undefined,
      toggle: config.permissions.includes('tasks:write') ? (id) => rpc('tasks.toggle', [id]) : undefined,
      delete: config.permissions.includes('tasks:write') ? (id) => rpc('tasks.delete', [id]) : undefined,
    },
    network: {
      fetch: config.permissions.includes('network') || config.permissions.includes('network:local')
        ? (url, options) => rpc('network.fetch', [url, options || {}])
        : undefined,
    },
  };

  function registerView(id, location, component, options) {
    const icon = options && typeof options.icon === 'object' ? options.icon : undefined;
    views.set(id, { location, component });
    postToHost({ kind: 'view-register', id, location, title: id, icon });
    return disposable('view', id);
  }

  function mountView(viewId) {
    const registration = views.get(viewId);
    if (!registration || !window.Vue) return;
    const root = document.getElementById('prism-plugin-view');
    if (!root) return;
    root.replaceChildren();
    if (registration.component && typeof registration.component === 'object') {
      const app = window.Vue.createApp(registration.component, { pluginId: config.pluginId });
      app.config.errorHandler = reportRuntimeError;
      app.mount(root);
    } else if (registration.component && typeof registration.component.mount === 'function') {
      registration.component.mount(root);
    }
  }

  async function executeCommand(id, args) {
    const callback = commands.get(id);
    if (!callback) throw new Error('Command not found: ' + id);
    return callback(...args);
  }

  function reportRuntimeError(error) {
    const message = error?.message || String(error);
    postToHost({ kind: 'runtime-error', error: message });
    let panel = document.getElementById('prism-plugin-runtime-error');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'prism-plugin-runtime-error';
      Object.assign(panel.style, {
        position: 'fixed', top: '16px', left: '16px', right: '16px', zIndex: '100000',
        padding: '12px 16px', border: '1px solid #ef4444', borderRadius: '6px',
        background: '#fef2f2', color: '#b91c1c', font: '12px system-ui, sans-serif',
        whiteSpace: 'pre-wrap',
      });
      document.body.appendChild(panel);
    }
    panel.textContent = '插件运行异常：' + message;
  }

  window.addEventListener('error', (event) => reportRuntimeError(event.error || event.message));
  window.addEventListener('unhandledrejection', (event) => reportRuntimeError(event.reason));

  async function dispose() {
    if (disposed) return;
    disposed = true;
    try { if (typeof window.__prism_deactivate__ === 'function') await window.__prism_deactivate__(ctx); } catch (error) { ctx.log('error', error?.message || String(error)); }
    menus.clear();
    commands.clear();
    views.clear();
    document.getElementById('prism-plugin-view')?.replaceChildren();
  }

  (async () => {
    try {
      lifecycle('storage_snapshot_started');
      const snapshot = await rpc('storage.snapshot', []);
      Object.entries(snapshot || {}).forEach(([key, value]) => storageCache.set(key, value));
      lifecycle('storage_snapshot_completed');
      const factory = new Function(${SANDBOX_FACTORY_PARAMETER_LIST}, pluginSource + '\nreturn { activate: typeof activate === "function" ? activate : undefined, deactivate: typeof deactivate === "function" ? deactivate : undefined };');
      const module = factory(window, document, storage, window.Vue);
      if (typeof module.activate !== 'function') throw new Error('插件未导出 activate 函数');
      lifecycle('activate_started');
      await module.activate(ctx);
      lifecycle('activate_completed');
      window.__prism_deactivate__ = module.deactivate;
      postToHost({ kind: 'ready' });
    } catch (error) {
      postToHost({ kind: 'error', error: error?.message || String(error) });
    }
  })();
})();`;

function createSrcdoc(
  pluginId: string,
  permissions: string[],
  source: string,
  channelId: string,
): string {
  const config = JSON.stringify({ pluginId, permissions, channelId });
  const pluginSource = JSON.stringify(source);
  return `<!doctype html><html><head><meta charset="utf-8"><style>:root{--theme-color-scheme:light}html,body,#prism-plugin-view{margin:0;min-height:100%;height:100%;overflow:auto;font-family:system-ui,sans-serif;background:var(--bg-primary,#f8fdfb);color:var(--text-primary,#1a2e2b)}</style><script>${vueRuntime}</script></head><body><div id="prism-plugin-view"></div><script>const __PRISM_CONFIG__=${config};const __PRISM_SOURCE__=${pluginSource};${BOOTSTRAP}</script></body></html>`;
}

export class SandboxPluginSession implements SandboxViewSession {
  readonly iframe = document.createElement('iframe');
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private requestId = 1;
  private onView: (registration: SandboxViewRegistration) => void = () => {};
  private onMenu: (location: string, items: SandboxMenuItem[]) => void = () => {};
  private pendingViews: SandboxViewRegistration[] = [];
  private pendingMenus: Array<{ location: string; items: SandboxMenuItem[] }> = [];
  private hasViewHandler = false;
  private hasMenuHandler = false;
  private ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private disposed = false;
  private readySettled = false;
  private readyTimeout?: ReturnType<typeof setTimeout>;
  private readonly channelId: string;
  private iframeLoaded = false;
  private sandboxReady = false;
  private attachedView?: { container: HTMLElement; viewId: string };
  private readonly themeObserver: MutationObserver;

  constructor(
    private readonly pluginId: string,
    private readonly permissions: string[],
    source: string,
  ) {
    this.channelId = createSandboxChannelId();
    this.iframe.setAttribute('sandbox', 'allow-scripts');
    this.iframe.setAttribute('data-plugin', pluginId);
    this.iframe.style.cssText =
      'display:none;width:100%;height:100%;border:0;background:transparent;';
    this.iframe.srcdoc = createSrcdoc(pluginId, permissions, source, this.channelId);
    this.iframe.addEventListener('load', this.handleIframeLoad);
    this.iframe.addEventListener('error', this.handleIframeError);
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = () => {
        if (this.readySettled) return;
        this.readySettled = true;
        if (this.readyTimeout) clearTimeout(this.readyTimeout);
        resolve();
      };
      this.rejectReady = (error) => {
        if (this.readySettled) return;
        this.readySettled = true;
        if (this.readyTimeout) clearTimeout(this.readyTimeout);
        reject(error);
      };
    });
    this.readyTimeout = setTimeout(() => {
      const error = new Error(`插件沙箱启动超时（${SANDBOX_READY_TIMEOUT_MS}ms）`);
      diagnosticsLogger.error('plugin', 'plugin.sandbox_timeout', '插件沙箱启动超时', error, {
        plugin_id: this.pluginId,
        timeout_ms: SANDBOX_READY_TIMEOUT_MS,
      });
      this.rejectReady(error);
    }, SANDBOX_READY_TIMEOUT_MS);
    window.addEventListener('message', this.handleMessage);
    document.body.appendChild(this.iframe);
    this.themeObserver = new MutationObserver(() => this.syncTheme());
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
    this.syncTheme();
    diagnosticsLogger.info('plugin', 'plugin.sandbox_created', '插件沙箱已创建', {
      plugin_id: this.pluginId,
    });
  }

  onViewRegistered(handler: (registration: SandboxViewRegistration) => void): void {
    this.onView = handler;
    this.hasViewHandler = true;
    for (const registration of this.pendingViews) handler(registration);
    this.pendingViews = [];
  }
  onMenuRegistered(handler: (location: string, items: SandboxMenuItem[]) => void): void {
    this.onMenu = handler;
    this.hasMenuHandler = true;
    for (const menu of this.pendingMenus) handler(menu.location, menu.items);
    this.pendingMenus = [];
  }

  async waitUntilReady(): Promise<void> {
    return this.ready;
  }

  attach(container: HTMLElement, viewId: string): void {
    if (this.disposed) return;
    this.attachedView = { container, viewId };
    container.replaceChildren(this.iframe);
    this.iframe.style.display = 'block';
    this.postShowView(viewId);
  }

  detach(container: HTMLElement): void {
    if (container.contains(this.iframe)) {
      this.attachedView = undefined;
      this.iframe.style.display = 'none';
      document.body.appendChild(this.iframe);
    }
  }

  async executeCommand(commandId: string, args: unknown[] = []): Promise<unknown> {
    await this.ready;
    this.iframe.contentWindow?.postMessage(
      { kind: 'sandbox-command', command: 'execute-command', commandId, args },
      '*',
    );
    return undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.themeObserver.disconnect();
    this.iframe.removeEventListener('load', this.handleIframeLoad);
    this.iframe.removeEventListener('error', this.handleIframeError);
    this.iframe.contentWindow?.postMessage({ kind: 'sandbox-command', command: 'dispose' }, '*');
    window.removeEventListener('message', this.handleMessage);
    this.iframe.remove();
    this.rejectReady(new Error('插件沙箱已关闭'));
    for (const item of this.pending.values()) item.reject(new Error('插件沙箱已关闭'));
    this.pending.clear();
    diagnosticsLogger.info('plugin', 'plugin.sandbox_disposed', '插件沙箱已释放', {
      plugin_id: this.pluginId,
    });
  }

  private readonly handleIframeLoad = () => {
    this.iframeLoaded = true;
    diagnosticsLogger.info('plugin', 'plugin.sandbox_iframe_loaded', '插件沙箱 iframe 已加载', {
      plugin_id: this.pluginId,
    });
    this.syncTheme();
    this.postAttachedView();
  };

  private readonly handleIframeError = () => {
    const error = new Error('插件沙箱 iframe 加载失败');
    diagnosticsLogger.error('plugin', 'plugin.sandbox_error', '插件沙箱 iframe 加载失败', error, {
      plugin_id: this.pluginId,
    });
    this.rejectReady(error);
  };

  private postShowView(viewId: string): void {
    if (!this.iframeLoaded || !this.sandboxReady) return;
    this.iframe.contentWindow?.postMessage(
      { kind: 'sandbox-command', command: 'show-view', viewId },
      '*',
    );
  }

  private postAttachedView(): void {
    if (this.attachedView) this.postShowView(this.attachedView.viewId);
  }

  private syncTheme(): void {
    const styles = getComputedStyle(document.documentElement);
    const variables: Record<string, string> = {};
    for (let index = 0; index < styles.length; index += 1) {
      const name = styles.item(index);
      if (name?.startsWith('--')) variables[name] = styles.getPropertyValue(name).trim();
    }
    const theme = document.documentElement.dataset.theme;
    variables['--theme-color-scheme'] =
      theme === 'light' ||
      (theme === 'auto' && !window.matchMedia('(prefers-color-scheme: dark)').matches)
        ? 'light'
        : 'dark';
    this.iframe.contentWindow?.postMessage({ kind: 'theme-update', variables }, '*');
  }

  private readonly handleMessage = (event: MessageEvent) => {
    const message = event.data as Record<string, unknown>;
    const sourceMatches = event.source === this.iframe.contentWindow;
    const channelMatches = message?.channelId === this.channelId;
    if (!sourceMatches && !channelMatches) return;
    if (!sourceMatches) {
      diagnosticsLogger.warn(
        'plugin',
        'plugin.sandbox_message_source_mismatch',
        '插件沙箱消息来源对象不一致，已通过会话通道校验',
        { plugin_id: this.pluginId, kind: String(message?.kind || 'unknown') },
      );
    }
    if (message.kind === 'lifecycle') {
      const stage = String(message.stage || 'unknown');
      const eventByStage: Record<string, string> = {
        storage_snapshot_started: 'plugin.sandbox_storage_snapshot_started',
        storage_snapshot_completed: 'plugin.sandbox_storage_snapshot_completed',
        activate_started: 'plugin.sandbox_activate_started',
        activate_completed: 'plugin.sandbox_activate_completed',
      };
      const logEvent = eventByStage[stage];
      if (logEvent) {
        const phase = stage.endsWith('_started') ? '开始' : '完成';
        diagnosticsLogger.info('plugin', logEvent, `插件沙箱阶段${phase}：${stage}`, {
          plugin_id: this.pluginId,
        });
      }
    }
    if (message.kind === 'ready') {
      this.sandboxReady = true;
      diagnosticsLogger.info('plugin', 'plugin.sandbox_ready', '插件沙箱已就绪', {
        plugin_id: this.pluginId,
      });
      this.resolveReady();
      this.postAttachedView();
    }
    if (message.kind === 'error') {
      const error = new Error(String(message.error || '插件沙箱启动失败'));
      diagnosticsLogger.error('plugin', 'plugin.sandbox_error', '插件沙箱启动失败', error, {
        plugin_id: this.pluginId,
      });
      this.rejectReady(error);
    }
    if (message.kind === 'runtime-error') {
      diagnosticsLogger.error(
        'plugin',
        'plugin.sandbox_runtime_error',
        '插件沙箱运行时异常',
        new Error(String(message.error || '插件沙箱运行时异常')),
        { plugin_id: this.pluginId },
      );
    }
    if (message.kind === 'view-register') {
      const registration = message as unknown as SandboxViewRegistration;
      if (!this.hasViewHandler) this.pendingViews.push(registration);
      else this.onView(registration);
    }
    if (message.kind === 'menu-register') {
      const location = String(message.location);
      const items = (message.items || []) as SandboxMenuItem[];
      if (!this.hasMenuHandler) this.pendingMenus.push({ location, items });
      else this.onMenu(location, items);
    }
    if (message.kind === 'rpc') this.handleRpc(message as unknown as RpcRequest);
  };

  private async handleRpc(request: RpcRequest): Promise<void> {
    const isStorageSnapshot = request.method === 'storage.snapshot';
    if (isStorageSnapshot) {
      diagnosticsLogger.info(
        'plugin',
        'plugin.sandbox_storage_snapshot_requested',
        '插件沙箱请求存储快照',
        { plugin_id: this.pluginId },
      );
    }
    try {
      const value = await this.handleHostRequest(request);
      this.reply({ kind: 'rpc-result', id: request.id, ok: true, value });
    } catch (error) {
      if (isStorageSnapshot) {
        diagnosticsLogger.error(
          'plugin',
          'plugin.sandbox_storage_snapshot_failed',
          '插件沙箱读取存储快照失败',
          error,
          { plugin_id: this.pluginId },
        );
      }
      this.reply({
        kind: 'rpc-result',
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleHostRequest(request: RpcRequest): Promise<unknown> {
    if (request.method.startsWith('storage.')) return this.handleStorageRequest(request);
    if (request.method.startsWith('tasks.')) return this.handleTaskRequest(request);
    if (request.method === 'open-url') {
      return invoke('open_url', { url: String(request.args[0]) });
    }
    if (request.method === 'network.fetch') return this.handleNetworkRequest(request);
    throw new Error(`未知的插件 RPC：${request.method}`);
  }

  private async handleStorageRequest(request: RpcRequest): Promise<unknown> {
    const [first, second] = request.args;
    switch (request.method) {
      case 'storage.snapshot':
        return readStorage(this.pluginId);
      case 'storage.get':
        return readStorage(this.pluginId)[String(first)] ?? null;
      case 'storage.set':
        writeStorage(this.pluginId, String(first), String(second));
        return null;
      case 'storage.delete':
        deleteStorage(this.pluginId, String(first));
        return null;
      case 'storage.keys':
        return Object.keys(readStorage(this.pluginId));
      case 'storage.binary.get':
        return binaryStorageGet(this.pluginId, String(first));
      case 'storage.binary.set':
        await binaryStorageSet(this.pluginId, String(first), second);
        return null;
      case 'storage.binary.delete':
        await binaryStorageDelete(this.pluginId, String(first));
        return null;
      case 'storage.binary.keys':
        return binaryStorageKeys(this.pluginId);
      default:
        throw new Error(`未知的存储请求：${request.method}`);
    }
  }

  private handleTaskRequest(request: RpcRequest): Promise<unknown> {
    const [first, second] = request.args;
    switch (request.method) {
      case 'tasks.list':
        return invoke('plugin_tasks_list', { pluginId: this.pluginId });
      case 'tasks.list-by-date':
        return invoke('plugin_tasks_list_by_date', {
          pluginId: this.pluginId,
          date: String(first),
        });
      case 'tasks.create':
        return invoke('plugin_tasks_create', {
          pluginId: this.pluginId,
          args: { title: first, ...((second as object) || {}) },
        });
      case 'tasks.update':
        return invoke('plugin_tasks_update', {
          pluginId: this.pluginId,
          args: { id: first, ...((second as object) || {}) },
        });
      case 'tasks.toggle':
        return invoke('plugin_tasks_toggle', { pluginId: this.pluginId, id: first });
      case 'tasks.delete':
        return invoke('plugin_tasks_delete', { pluginId: this.pluginId, id: first });
      default:
        return Promise.reject(new Error(`未知的任务请求：${request.method}`));
    }
  }

  private handleNetworkRequest(request: RpcRequest): Promise<unknown> {
    return invoke('plugin_network_fetch', {
      pluginId: this.pluginId,
      url: request.args[0],
      options: request.args[1],
    });
  }

  private reply(response: RpcResponse): void {
    this.iframe.contentWindow?.postMessage(response, '*');
  }
}

function storageKey(pluginId: string): string {
  return `plugin:${pluginId}:sandbox-storage`;
}
function readStorage(pluginId: string): Record<string, string> {
  let data: Record<string, string> = {};
  try {
    data = JSON.parse(localStorage.getItem(storageKey(pluginId)) || '{}') as Record<string, string>;
  } catch {
    data = {};
  }
  const prefix = `plugin:${pluginId}:`;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith(prefix) || key === storageKey(pluginId)) continue;
    const shortKey = key.slice(prefix.length);
    if (!(shortKey in data)) data[shortKey] = localStorage.getItem(key) || '';
  }
  if (Object.keys(data).length > 0)
    localStorage.setItem(storageKey(pluginId), JSON.stringify(data));
  return data;
}
function writeStorage(pluginId: string, key: string, value: string): void {
  const data = readStorage(pluginId);
  data[key] = value;
  localStorage.setItem(storageKey(pluginId), JSON.stringify(data));
}
function deleteStorage(pluginId: string, key: string): void {
  const data = readStorage(pluginId);
  delete data[key];
  localStorage.setItem(storageKey(pluginId), JSON.stringify(data));
}

const PLUGIN_BINARY_DB = 'prism-plugin-binary-storage';
const PLUGIN_BINARY_STORE = 'blobs';

function openBinaryStorageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PLUGIN_BINARY_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PLUGIN_BINARY_STORE))
        request.result.createObjectStore(PLUGIN_BINARY_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开插件二进制存储'));
  });
}

function binaryStorageKey(pluginId: string, key: string): string {
  return `${pluginId}\u0000${key}`;
}

async function binaryStorageGet(pluginId: string, key: string): Promise<unknown> {
  const db = await openBinaryStorageDb();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(PLUGIN_BINARY_STORE, 'readonly')
      .objectStore(PLUGIN_BINARY_STORE)
      .get(binaryStorageKey(pluginId, key));
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error('读取插件二进制存储失败'));
  });
}

async function binaryStorageSet(pluginId: string, key: string, value: unknown): Promise<void> {
  const db = await openBinaryStorageDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PLUGIN_BINARY_STORE, 'readwrite');
    transaction.objectStore(PLUGIN_BINARY_STORE).put(value, binaryStorageKey(pluginId, key));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('写入插件二进制存储失败'));
  });
}

async function binaryStorageDelete(pluginId: string, key: string): Promise<void> {
  const db = await openBinaryStorageDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PLUGIN_BINARY_STORE, 'readwrite');
    transaction.objectStore(PLUGIN_BINARY_STORE).delete(binaryStorageKey(pluginId, key));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('删除插件二进制存储失败'));
  });
}

async function binaryStorageKeys(pluginId: string): Promise<string[]> {
  const db = await openBinaryStorageDb();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(PLUGIN_BINARY_STORE, 'readonly')
      .objectStore(PLUGIN_BINARY_STORE)
      .getAllKeys();
    request.onsuccess = () => {
      const prefix = `${pluginId}\u0000`;
      resolve(
        request.result
          .filter((key): key is string => typeof key === 'string' && key.startsWith(prefix))
          .map((key) => key.slice(prefix.length)),
      );
    };
    request.onerror = () => reject(request.error || new Error('读取插件二进制存储键失败'));
  });
}
