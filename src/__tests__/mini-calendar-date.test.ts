import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import MiniCalendar from '../components/tasks/MiniCalendar.vue';
import { getTodayStr } from '../composables/useFilterEngine';

describe('迷你日历日期高亮', () => {
  it('日期属性变化后更新今天的高亮', async () => {
    const today = ref(getTodayStr());
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(
      defineComponent({
        setup: () => () => h(MiniCalendar, { tasks: [], selectedDate: null, today: today.value }),
      }),
    );
    app.mount(host);

    expect(host.querySelector('.mc-day.today')).not.toBeNull();
    today.value = '2000-01-01';
    await nextTick();
    expect(host.querySelector('.mc-day.today')).toBeNull();

    app.unmount();
    host.remove();
  });
});
