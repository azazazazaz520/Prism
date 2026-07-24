export interface Task {
  id: string;
  title: string;
  completed: boolean;
  created_at: string;
  completed_at: string | null;
  due_date: string | null;
  tags: string[];
  important: boolean;
  pinned: boolean;
  is_daily: boolean;
  /** 父任务 ID，拆解产生的子任务指向其父任务 */
  parent_id: string | null;
  /** 最后更新时间（ISO 8601），用于跨设备 LWW 同步 */
  updated_at: string;
  /** 软删除标记 */
  is_deleted: boolean;
  /** 所属 profile，用于跨设备数据隔离；null 表示仅本地存储 */
  profile_id?: string | null;
}

export interface DailyCompletion {
  task_id: string;
  date: string;
  /** 所属 profile，用于跨设备数据隔离 */
  profile_id?: string | null;
}

// ── 同步相关类型 ──────────────────────────────

/** 跨设备用户组 */
export interface SyncProfile {
  id: string;
  sync_code: string;
  created_at: string;
}

/** 匿名用户到 profile 的映射 */
export interface UserProfile {
  user_id: string;
  profile_id: string;
  joined_at: string;
}

// ── 侧边栏模块 ──────────────────────────────

/** 侧边栏导航的功能模块 */
export type AppModule = 'tasks' | 'ai-assistant' | 'floating' | 'settings' | 'notes' | 'devtools';

/** 模块注册表描述符（数据驱动侧边栏和设置开关） */
export interface ModuleDescriptor {
  id: AppModule;
  label: string;
  /** SVG path 数据（纯线条风格） */
  iconPath: string;
  /** 是否为动作模块（悬浮窗）而非视图切换 */
  isAction?: boolean;
}

// ── AI 相关类型 ──────────────────────────────

/** AI 供应商 */
export interface Vendor {
  id: string;
  name: string;
  provider: string;
  api_key: string;
  base_url: string;
  api_path: string;
  model: string;
  enabled: boolean;
  is_default: boolean;
}

/** 供应商预设 */
export interface VendorPreset {
  provider: string;
  name: string;
  base_url: string;
  api_path: string;
  model: string;
}

/** 设置页子模块 */
export type SettingsSubModule =
  | 'preferences'
  | 'vendors'
  | 'sync'
  | 'prompts'
  | 'plugins'
  | 'scripts'
  | 'about';

/** AI 自然语言解析后的结构化任务 */
export interface ParsedTask {
  title: string;
  due_date: string | null;
  tags: string[];
  important: boolean;
  pinned: boolean;
  is_daily: boolean;
}

/** AI 命令面板的执行模式 */
export type AiMode = 'auto' | 'add' | 'summary' | 'focus';

/** 统一 AI 执行结果 */
export interface AiExecuteResult {
  mode: string;
  text: string;
  tasks: ParsedTask[];
  focus: FocusSuggestion | null;
}

/** 今日聚焦建议（AI 按优先级排序的结果） */
export interface FocusSuggestion {
  items: { task_id: string; reason: string }[];
  summary: string;
}

/** 任务拆解产生的子任务 */
export interface SubTask {
  title: string;
  estimated_minutes: number | null;
}

/** 过期任务的 AI 处理建议 */
export interface OverdueSuggestion {
  task_id: string;
  action: 'reschedule' | 'abandon' | 'decompose';
  new_date?: string;
  reason: string;
}

/** AI 助手对话消息 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ── 笔记相关类型 ──────────────────────────────

/** 文件树节点 */
export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileEntry[];
}

// ── Prompt 管理相关类型 ──────────────────────────────

// ── Prompt 管理相关类型 ──────────────────────────────

/** 单个 Prompt 模板的元数据（前端可见，不含完整内容） */
export interface PromptMeta {
  name: string;
  /** 该模板接受的 `{{variable}}` 占位符列表 */
  vars: string[];
  /** 用户是否已在文件系统中自定义此 Prompt */
  is_customized: boolean;
}

// ── 仪表盘相关类型 ──────────────────────────────

/** Widget 网格尺寸 */
export interface WidgetSize {
  w: number;
  h: number;
}

/** 单个 Widget 的定义（内建组件） */
export interface WidgetDefinition {
  id: string;
  title: string;
  icon: string;
  defaultSize: WidgetSize;
  minSize?: WidgetSize;
}

/** 仪表盘布局持久化结构 */
export interface DashboardLayout {
  widgets: {
    id: string;
    enabled: boolean;
    position: { x: number; y: number };
    size: WidgetSize;
  }[];
  columns: number;
}

// ── 插件系统类型 ──────────────────────────────

/** 插件权限标识 */
export type PluginPermission = 'tasks:read' | 'tasks:write' | 'network' | 'network:local';

/** 插件清单（manifest.json 结构） */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author: string;
  license?: string;
  main: string;
  engines: { prism: string };
  activationEvents?: string[];
  permissions?: PluginPermission[];
  contributes?: {
    commands?: { id: string; title: string }[];
    views?: { id: string; title: string; location: 'sidebar' | 'panel' }[];
    menus?: { id: string; command: string; location: 'task-context' | 'editor-context' }[];
  };
}

/** 插件诊断信息 */
export interface PluginDiagnostics {
  status: 'ok' | 'error';
  lastError?: string;
  errorCount: number;
  lastErrorAt?: string;
  deactivatedAt?: string;
}

/** 可丢弃资源 */
export interface Disposable {
  dispose(): void;
}

/** 插件上下文（注入给每个插件的 activate(ctx)） */
export interface PluginContext {
  readonly pluginId: string;
  readonly runtimeId: string;
  readonly permissions: ReadonlySet<PluginPermission>;
  track<T extends Disposable>(disposable: T): T;
  dispose(): void;
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void;
  commands: {
    register(id: string, callback: () => void | Promise<void>): Disposable;
    execute(id: string, ...args: unknown[]): Promise<void>;
  };
  views: {
    registerSidebar(id: string, component: unknown): Disposable;
    registerPanel(id: string, component: unknown): Disposable;
    registerSettings(id: string, component: unknown): Disposable;
    registerRail(id: string, component: unknown): Disposable;
    registerPage(id: string, component: unknown): Disposable;
    registerDomView(
      id: string,
      opts: { mount(container: HTMLElement): void; unmount(): void },
    ): Disposable;
  };
  menus: {
    register(
      location: string,
      items: { id: string; label: string; icon?: string; action: () => void | Promise<void> }[],
    ): Disposable;
  };
  env: {
    readonly theme: string;
    readonly locale: string;
    readonly vue: {
      ref: (...args: any[]) => any;
      computed: (...args: any[]) => any;
      h: (...args: any[]) => any;
      defineComponent: (...args: any[]) => any;
      createApp: (...args: any[]) => any;
      onUnmounted: (hook: () => void) => void;
    };
  };
  tasks: {
    readonly list?: () => Promise<unknown[]>;
    readonly listByDate?: (date: string) => Promise<unknown[]>;
    readonly create?: (...args: any[]) => Promise<unknown>;
    readonly update?: (...args: any[]) => Promise<unknown>;
    readonly toggle?: (id: string) => Promise<unknown>;
    readonly delete?: (id: string) => Promise<void>;
  };
  network: {
    readonly fetch?: (...args: any[]) => Promise<unknown>;
  };
}

/** Capability 会话（Plugin Loader 内部使用） */
export interface CapabilitySession {
  pluginId: string;
  permissions: PluginPermission[];
  /** 一次性随机 token，activate 期间有效，Protocol Handler 响应后即销 */
  token: string;
  createdAt: number;
}

/** 插件 API 层自定义错误 */
export class PluginPermissionError extends Error {
  pluginId: string;
  permission: string;
  operation: string;
  constructor(pluginId: string, permission: string, operation: string) {
    super(`[${pluginId}] 缺少权限 ${permission} 以执行 ${operation}`);
    this.name = 'PluginPermissionError';
    this.pluginId = pluginId;
    this.permission = permission;
    this.operation = operation;
  }
}

export class PluginSessionExpiredError extends Error {
  pluginId: string;
  constructor(pluginId: string) {
    super(`[${pluginId}] 会话已过期`);
    this.name = 'PluginSessionExpiredError';
    this.pluginId = pluginId;
  }
}

// ── 更新相关类型 ──────────────────────────────

/** GitHub Release 信息（与旧版兼容，新增可选字段） */
export interface ReleaseInfo {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
  /** 独立的 Release 页面地址（静态清单模式可用） */
  release_url?: string;
}

/** 更新检查错误码 */
export type UpdateCheckErrorCode =
  | 'network_unreachable'
  | 'proxy_failed'
  | 'timeout'
  | 'tls_failed'
  | 'rate_limited'
  | 'repository_not_found'
  | 'bad_response'
  | 'invalid_version';

/** 更新检查错误响应（Rust 端返回的 JSON 串） */
export interface UpdateCheckErrorResponse {
  error_code: UpdateCheckErrorCode;
  message: string;
}

/** Windows 版本更新清单（静态 JSON 文件格式） */
export interface WindowsUpdateManifest {
  version: string;
  release_date: string;
  release_notes: string;
  download_url: string;
  release_url: string;
  sha256: string | null;
}
