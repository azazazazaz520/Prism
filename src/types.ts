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
}

export interface DailyCompletion {
  task_id: string;
  date: string;
}

// ── 侧边栏模块 ──────────────────────────────

/** 侧边栏导航的 5 个功能模块 */
export type AppModule = 'tasks' | 'ai-assistant' | 'calendar' | 'floating' | 'settings';

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
export type SettingsSubModule = 'preferences' | 'vendors' | 'models';

/** AI 自然语言解析后的结构化任务 */
export interface ParsedTask {
  title: string;
  due_date: string | null;
  tags: string[];
  important: boolean;
  pinned: boolean;
  is_daily: boolean;
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
