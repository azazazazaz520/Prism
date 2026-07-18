import { describe, it, expect } from 'vitest';
import { createTasksAPI } from '../plugin-api/tasks-impl';

describe('Tasks API', () => {
  const pluginId = 'com.example.test';

  describe('权限裁剪', () => {
    it('tasks:read 仅提供只读方法', () => {
      const api = createTasksAPI(pluginId, ['tasks:read']);
      expect(api.list).toBeDefined();
      expect(api.listByDate).toBeDefined();
      expect(api.create).toBeUndefined();
      expect(api.update).toBeUndefined();
      expect(api.toggle).toBeUndefined();
      expect(api.delete).toBeUndefined();
    });

    it('tasks:write 同时提供读写方法', () => {
      const api = createTasksAPI(pluginId, ['tasks:read', 'tasks:write']);
      expect(api.list).toBeDefined();
      expect(api.listByDate).toBeDefined();
      expect(api.create).toBeDefined();
      expect(api.update).toBeDefined();
      expect(api.toggle).toBeDefined();
      expect(api.delete).toBeDefined();
    });

    it('仅有 tasks:write 无 tasks:read 时只提供写方法', () => {
      const api = createTasksAPI(pluginId, ['tasks:write']);
      expect(api.list).toBeUndefined();
      expect(api.listByDate).toBeUndefined();
      expect(api.create).toBeDefined();
      expect(api.update).toBeDefined();
      expect(api.toggle).toBeDefined();
      expect(api.delete).toBeDefined();
    });

    it('无任何任务权限时所有方法为 undefined', () => {
      const api = createTasksAPI(pluginId, []);
      expect(api.list).toBeUndefined();
      expect(api.listByDate).toBeUndefined();
      expect(api.create).toBeUndefined();
      expect(api.update).toBeUndefined();
      expect(api.toggle).toBeUndefined();
      expect(api.delete).toBeUndefined();
    });

    it('network 权限不影响 tasks 方法', () => {
      const api = createTasksAPI(pluginId, ['network']);
      expect(api.list).toBeUndefined();
      expect(api.create).toBeUndefined();
    });
  });

  describe('pluginId 隔离', () => {
    it('不同插件 ID 创建独立的 API 实例', () => {
      const api1 = createTasksAPI('com.a', ['tasks:read', 'tasks:write']);
      const api2 = createTasksAPI('com.b', ['tasks:read']);
      expect(api1.create).toBeDefined();
      expect(api2.create).toBeUndefined();
    });
  });
});
