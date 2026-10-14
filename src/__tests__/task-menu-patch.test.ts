import { describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import TaskItem from '../components/tasks/TaskItem.vue';
import type { Task } from '../types';

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
