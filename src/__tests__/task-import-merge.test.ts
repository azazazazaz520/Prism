import { describe, expect, it } from 'vitest';
import { selectNewImportedTasks } from '../composables/useTaskStore';
import type { Task } from '../types';

function task(id: string): Task {
  return {
    id,
    title: `任务 ${id}`,
    completed: false,
    created_at: '2026-08-19T09:00:00Z',
    completed_at: null,
    due_date: null,
    tags: [],
    important: false,
    pinned: false,
    is_daily: false,
    parent_id: null,
    updated_at: '2026-08-19T09:00:00Z',
    is_deleted: false,
    profile_id: null,
  };
}

describe('导入任务事件合并', () => {
  it('过滤主窗口已有任务和同一事件中的重复任务', () => {
    const existing = task('existing');
    const added = task('added');

    expect(selectNewImportedTasks([existing], [existing, added, added])).toEqual([added]);
  });
});
