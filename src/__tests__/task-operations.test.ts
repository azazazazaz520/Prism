import { describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import TaskItem from '../components/tasks/TaskItem.vue';
import { filterTasks, matchesTaskQuery, mergeLWW } from '../composables/useFilterEngine';
import { selectNewImportedTasks } from '../composables/useTaskStore';
import { type Task } from '../types';

describe('mergeLWW', () => {
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

vi.mock('../plugin-api/menus-impl', () => ({ getMenuRegistrations: () => [] }));

vi.mock('../composables/useContextMenu', () => ({
  useContextMenu: () => ({ openContextMenu: vi.fn() }),
}));

describe('任务菜单字段提交', () => {
  it('菜单打开后其他窗口更新标签，点击置顶只提交置顶字段', async () => {
    const task = ref<Task>({
      id: 'task',
      title: '标题',
      tags: ['旧标签'],
      completed: false,
      created_at: '2026-10-13T00:00:00Z',
      updated_at: '2026-10-13T00:00:00Z',
      completed_at: null,
      due_date: null,
      important: false,
      pinned: false,
      is_daily: false,
      is_deleted: false,
      parent_id: null,
    });
    const update = vi.fn();
    const toggle = vi.fn();
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp({
      render: () =>
        h(TaskItem, {
          task: task.value,
          isDailyCompleted: false,
          onUpdateMeta: update,
          onToggle: toggle,
        }),
    });
    app.mount(root);
    try {
      root.querySelector<HTMLButtonElement>('.task-menu-btn')!.click();
      await nextTick();
      task.value = { ...task.value, tags: ['新标签'] };
      await nextTick();
      const pin = [...document.querySelectorAll<HTMLButtonElement>('.task-menu .menu-item')].find(
        (button) => button.textContent?.includes('置顶'),
      );
      pin!.click();
      expect(update).toHaveBeenCalledWith('task', { pinned: true });
      root.querySelector<HTMLElement>('.task-checkbox')!.click();
      expect(toggle).toHaveBeenCalledWith('task', true);
    } finally {
      app.unmount();
      root.remove();
    }
  });
});
