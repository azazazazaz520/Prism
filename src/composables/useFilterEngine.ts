import type { Task } from '../types';

/**
 * FilterEngine — 纯函数筛选引擎
 *
 * 零依赖、零副作用。所有函数接收数据、返回新数据。
 * 可独立单元测试，无需 mock 任何东西。
 */

/** 标准日期字符串 "YYYY-MM-DD" */
function todayStr(): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 按日期筛选任务 */
export function filterByDate(tasks: Task[], date: string | null): Task[] {
  if (!date) return tasks;
  return tasks.filter((t) => t.due_date === date);
}

/** 按标签筛选任务（选中任一标签即匹配） */
export function filterByTags(tasks: Task[], tags: string[]): Task[] {
  if (tags.length === 0) return tasks;
  return tasks.filter((t) => tags.some((tag) => t.tags.includes(tag)));
}

/** 组合筛选：日期 + 标签叠加 */
export function filterTasks(tasks: Task[], date: string | null, tags: string[]): Task[] {
  let result = tasks;
  result = filterByDate(result, date);
  result = filterByTags(result, tags);
  return [...result];
}

/** 从任务列表提取去重排序后的标签列表 */
export function tagsFromTasks(tasks: Task[]): string[] {
  const tags = [...new Set(tasks.flatMap((t) => t.tags))];
  tags.sort();
  return tags;
}

/** 每日完成任务 ID 转为查找 map */
export function dailyCompletionsMap(ids: string[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const id of ids) {
    map[id] = true;
  }
  return map;
}

/** 逾期任务计数 */
export function countOverdue(tasks: Task[]): number {
  const ts = todayStr();
  return tasks.filter((t) => t.due_date && t.due_date < ts && !t.completed).length;
}

/** 待办任务计数 */
export function countPending(tasks: Task[]): number {
  return tasks.filter((t) => !t.completed).length;
}

/** 获取今日日期字符串 */
export function getTodayStr(): string {
  return todayStr();
}

/**
 * LWW 合并纯函数：将远端任务合并到本地任务列表。
 * 返回合并后的新数组，不修改原数组。
 * >= 而非 >：手动同步时远端优先，防止 DB 直接修改后 updated_at 未变导致漏更新。
 */
export function mergeLWW(local: Task[], remote: Task[]): Task[] {
  if (remote.length === 0) return local;

  const merged = new Map(local.map((t) => [t.id, t]));

  for (const rt of remote) {
    const lt = merged.get(rt.id);
    if (!lt || new Date(rt.updated_at) >= new Date(lt.updated_at)) {
      merged.set(rt.id, rt);
    }
  }

  return [...merged.values()].filter((t) => !t.is_deleted);
}
