import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import DatePicker from '../components/tasks/DatePicker.vue';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('日期选择器跨月显示', () => {
  it('跨月后重新打开时显示当前月份', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 30, 23, 59));
    const visible = ref(false);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(
      defineComponent({
        setup: () => () => h(DatePicker, { visible: visible.value }),
      }),
    );
    app.mount(host);

    vi.setSystemTime(new Date(2026, 9, 1, 0, 1));
    visible.value = true;
    await nextTick();

    expect(document.querySelector('.dp-month')?.textContent).toContain('2026年 10月');
    app.unmount();
    host.remove();
  });
});
