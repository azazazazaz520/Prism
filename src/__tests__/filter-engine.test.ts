import { describe, it, expect, vi } from 'vitest';
import {
  mergeLWW,
  mergeTasksLWW,
  dailyCompletionsMap,
  filterByDate,
  filterByTags,
  filterTasks,
  tagsFromTasks,
  countOverdue,
  countPending,
  getTodayStr,
  matchesTaskQuery,
} from '../composables/useFilterEngine';

// ═══════════════════════════════════════════════════════════════
//  测试目标：验证 FilterEngine 纯函数正确性
// ═══════════════════════════════════════════════════════════════

describe('mergeLWW', () => {
  it('返回本地任务当远端为空时', () => {
    const local = [
      { id: '1', title: 'A', updated_at: '2026-01-01T00:00:00Z', is_deleted: false } as any,
    ];
    const result = mergeLWW(local, []);
    expect(result).toEqual(local);
  });

  it('远端覆盖本地当 updated_at 更新时', () => {
    const local = [
      { id: '1', title: '旧标题', updated_at: '2026-01-01T00:00:00Z', is_deleted: false } as any,
    ];
    const remote = [
      { id: '1', title: '新标题', updated_at: '2026-01-02T00:00:00Z', is_deleted: false } as any,
    ];
    const result = mergeLWW(local, remote);
    expect(result[0].title).toBe('新标题');
  });

  it('过滤 is_deleted 任务', () => {
    const local = [
      { id: '1', title: 'A', updated_at: '2026-01-01T00:00:00Z', is_deleted: false } as any,
    ];
    const remote = [
      { id: '1', title: 'A', updated_at: '2026-01-02T00:00:00Z', is_deleted: true } as any,
    ];
    const result = mergeLWW(local, remote);
    expect(result).toHaveLength(0);
  });

  it('合并不重叠的新远端任务', () => {
    const local = [
      { id: '1', title: 'A', updated_at: '2026-01-01T00:00:00Z', is_deleted: false } as any,
    ];
    const remote = [
      { id: '2', title: 'B', updated_at: '2026-01-01T00:00:00Z', is_deleted: false } as any,
    ];
    const result = mergeLWW(local, remote);
    expect(result).toHaveLength(2);
  });
});

describe('mergeTasksLWW', () => {
  it('识别较新的远程任务变化', () => {
    const local = [
      { id: '1', title: '本地', updated_at: '2026-01-01T00:00:00Z', is_deleted: false } as any,
    ];
    const remote = [
      { id: '1', title: '远程', updated_at: '2026-01-01T00:00:01Z', is_deleted: false } as any,
    ];

    const result = mergeTasksLWW(local, remote);

    expect(result.changed).toBe(true);
    expect(result.tasks[0].title).toBe('远程');
  });

  it('重复收到相同远程任务时标记为未变化', () => {
    const local = [
      { id: '1', title: '本地', updated_at: '2026-01-01T00:00:00Z', is_deleted: false } as any,
    ];

    const result = mergeTasksLWW(local, [local[0]]);

    expect(result.changed).toBe(false);
    expect(result.tasks).toBe(local);
  });
});

describe('dailyCompletionsMap', () => {
  it('将 ID 数组转为查找 map', () => {
    expect(dailyCompletionsMap(['1', '3'])).toEqual({ '1': true, '3': true });
  });
  it('空数组返回空对象', () => {
    expect(dailyCompletionsMap([])).toEqual({});
  });
});

describe('filterByDate', () => {
  const tasks = [
    { id: '1', due_date: '2026-01-01' },
    { id: '2', due_date: null },
    { id: '3', due_date: '2026-01-01' },
  ] as any[];
  it('按指定日期筛选', () => {
    expect(filterByDate(tasks, '2026-01-01')).toHaveLength(2);
  });
  it('null 日期返回全部', () => {
    expect(filterByDate(tasks, null)).toEqual(tasks);
  });
});

describe('filterByTags', () => {
  const tasks = [
    { id: '1', tags: ['work'] },
    { id: '2', tags: ['home'] },
    { id: '3', tags: ['work', 'urgent'] },
  ] as any[];
  it('空标签返回全部', () => {
    expect(filterByTags(tasks, [])).toEqual(tasks);
  });
  it('单个标签匹配', () => {
    expect(filterByTags(tasks, ['work'])).toHaveLength(2);
  });
  it('多个标签匹配任一', () => {
    expect(filterByTags(tasks, ['work', 'home'])).toHaveLength(3);
  });
});

describe('filterTasks', () => {
  const tasks = [
    { id: '1', due_date: '2026-01-01', tags: ['work'] },
    { id: '2', due_date: null, tags: ['home'] },
    { id: '3', due_date: '2026-01-01', tags: ['home'] },
  ] as any[];
  it('日期 + 标签叠加筛选', () => {
    const result = filterTasks(tasks, '2026-01-01', ['home']);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('3');
  });
});

describe('matchesTaskQuery', () => {
  const task = {
    id: 'task-123',
    title: '整理项目文档',
    tags: ['项目', '文档'],
  } as any;

  it('按标题、标签和任务 ID 搜索', () => {
    expect(matchesTaskQuery(task, '项目文档')).toBe(true);
    expect(matchesTaskQuery(task, '文档')).toBe(true);
    expect(matchesTaskQuery(task, 'TASK-123')).toBe(true);
    expect(matchesTaskQuery(task, '不存在')).toBe(false);
  });
});

describe('tagsFromTasks', () => {
  it('去重排序', () => {
    const tasks = [{ tags: ['c', 'a'] }, { tags: ['b', 'a'] }] as any[];
    expect(tagsFromTasks(tasks)).toEqual(['a', 'b', 'c']);
  });
});

describe('countOverdue', () => {
  it('统计未完成的过期任务', () => {
    const today = getTodayStr();
    const yesterday = '2020-01-01'; // 肯定是过去的日期
    const tasks = [
      { due_date: yesterday, completed: false, is_deleted: false },
      { due_date: yesterday, completed: true, is_deleted: false },
      { due_date: null, completed: false, is_deleted: false },
    ] as any[];
    expect(countOverdue(tasks)).toBe(1); // 只有第一个算过期
  });
});

describe('countPending', () => {
  it('统计未完成任务数', () => {
    const tasks = [{ completed: false }, { completed: true }, { completed: false }] as any[];
    expect(countPending(tasks)).toBe(2);
  });
});
