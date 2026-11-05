import { describe, expect, it, vi } from 'vitest';
import { createCloseToTrayController, type CloseToTrayStatus } from '../composables/useCloseToTray';

vi.mock('../diagnostics/invoke-logged', () => ({
  invokeWithDiagnostics: vi.fn(),
  diagnosticsLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function snapshot(overrides: Partial<CloseToTrayStatus> = {}): CloseToTrayStatus {
  return {
    enabled: false,
    available: false,
    updating: false,
    revision: 0,
    error: null,
    ...overrides,
  };
}

function createHarness() {
  const listeners = new Set<(status: CloseToTrayStatus) => void>();
  const invoke = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(
    async () => undefined,
  );
  const listenStatus = vi.fn(async (handler: (status: CloseToTrayStatus) => void) => {
    listeners.add(handler);
    return () => listeners.delete(handler);
  });
  return {
    invoke,
    listenStatus,
    emit: (status: CloseToTrayStatus) => {
      for (const listener of [...listeners]) listener(status);
    },
  };
}

describe('关闭到托盘设置', () => {
  it('提交明确目标值并应用后端返回的快照', async () => {
    const harness = createHarness();
    harness.invoke.mockImplementation(async (command) => {
      if (command === 'get_close_to_tray') return snapshot({ revision: 1 });
      return snapshot({ enabled: true, available: true, revision: 2 });
    });
    const controller = createCloseToTrayController({
      invoke: harness.invoke as never,
      listenStatus: harness.listenStatus,
    });

    await controller.initialize();
    const applied = await controller.setEnabled(true);

    expect(applied).toBe(true);
    expect(harness.invoke).toHaveBeenLastCalledWith('set_close_to_tray', { enabled: true });
    expect(controller.status.value?.enabled).toBe(true);
    expect(controller.error.value).toBeNull();
    controller.dispose();
  });

  it('提交失败后重新读取实际状态并展示原因', async () => {
    const harness = createHarness();
    let queryCount = 0;
    harness.invoke.mockImplementation(async (command) => {
      if (command === 'set_close_to_tray') throw new Error('托盘初始化失败：缺少应用图标');
      queryCount += 1;
      return snapshot({ enabled: false, revision: queryCount });
    });
    const controller = createCloseToTrayController({
      invoke: harness.invoke as never,
      listenStatus: harness.listenStatus,
    });

    await controller.initialize();
    const applied = await controller.setEnabled(true);

    expect(applied).toBe(false);
    expect(queryCount).toBe(2);
    expect(controller.error.value).toBe('托盘初始化失败：缺少应用图标');
    expect(controller.status.value?.enabled).toBe(false);
    expect(controller.busy.value).toBe(false);
    controller.dispose();
  });
});
