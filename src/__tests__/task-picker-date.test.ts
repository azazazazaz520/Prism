import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';
import TaskPicker from '../components/tasks/TaskPicker.vue';
import { getTodayStr } from '../composables/useFilterEngine';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('任务选择器日期标签', () => {
  it('按本地日期显示今天到期的任务', () => {
    const today = getTodayStr();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(
      `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}T16:00:00.000Z`,
    );

    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(TaskPicker, {
      visible: true,
      tasks: [
        {
          id: 'task-today',
          title: '今日任务',
          due_date: today,
          tags: [],
          completed: false,
          is_deleted: false,
          is_daily: false,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    });
    app.mount(host);

    expect(document.querySelector('.task-picker-meta')?.textContent).toBe('今天');
    app.unmount();
  });
});
