import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';

// ═══════════════════════════════════════════════════════════════
//  prism:tasks API 工厂
// ═══════════════════════════════════════════════════════════════

/**
 * 为指定插件创建 Tasks API。
 * 根据 manifest 中声明的权限裁剪：
 * - tasks:read → 只读方法（list / listByDate）
 * - tasks:write → 完整 CRUD（create / update / toggle / delete）
 *
 * 所有方法直接调用 Rust 命令，权限校验由后端完成（第三层防线）。
 */
export function createTasksAPI(pluginId: string, permissions: string[]) {
  const canRead = permissions.includes('tasks:read');
  const canWrite = permissions.includes('tasks:write');

  return {
    /** 获取所有活跃任务（过滤已软删除） */
    list: canRead ? () => invoke<Task[]>('plugin_tasks_list', { pluginId }) : undefined,

    /** 获取指定日期的任务 */
    listByDate: canRead
      ? (date: string) => invoke<Task[]>('plugin_tasks_list_by_date', { pluginId, date })
      : undefined,

    /** 新增任务，返回创建后的任务对象 */
    create: canWrite
      ? (title: string, opts?: CreateTaskOpts) =>
          invoke<Task>('plugin_tasks_create', {
            pluginId,
            args: {
              title,
              due_date: opts?.dueDate,
              tags: opts?.tags,
              important: opts?.important,
              pinned: opts?.pinned,
              is_daily: opts?.isDaily,
              parent_id: opts?.parentId,
            },
          })
      : undefined,

    /** 更新任务属性 */
    update: canWrite
      ? (id: string, args: TaskUpdateArgs) =>
          invoke<void>('plugin_tasks_update', {
            pluginId,
            args: {
              id,
              title: args.title,
              due_date: args.dueDate ?? null,
              tags: args.tags ?? [],
              important: args.important ?? false,
              pinned: args.pinned ?? false,
              is_daily: args.isDaily ?? false,
            },
          })
      : undefined,

    /** 切换任务完成状态 */
    toggle: canWrite
      ? (id: string) => invoke<Task>('plugin_tasks_toggle', { pluginId, id })
      : undefined,

    /** 软删除任务 */
    delete: canWrite
      ? (id: string) => invoke<void>('plugin_tasks_delete', { pluginId, id })
      : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════
//  类型（与 Rust 端 Task 结构保持一致）
// ═══════════════════════════════════════════════════════════════

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  created_at: string;
  completed_at?: string | null;
  due_date?: string | null;
  tags: string[];
  important: boolean;
  pinned: boolean;
  is_daily: boolean;
  parent_id?: string | null;
  updated_at: string;
  is_deleted: boolean;
  profile_id?: string | null;
}

export interface CreateTaskOpts {
  dueDate?: string;
  tags?: string[];
  important?: boolean;
  pinned?: boolean;
  isDaily?: boolean;
  parentId?: string;
}

export interface TaskUpdateArgs {
  title: string;
  dueDate?: string | null;
  tags?: string[];
  important?: boolean;
  pinned?: boolean;
  isDaily?: boolean;
}
