import { describe, it, expect } from 'vitest';
import { createNetworkAPI } from '../plugin-api/network-impl';

describe('Network API', () => {
  const pluginId = 'com.example.test';

  describe('权限裁剪', () => {
    it('network 权限提供 fetch', () => {
      const api = createNetworkAPI(pluginId, ['network']);
      expect(api.fetch).toBeDefined();
    });

    it('network:local 权限提供 fetch', () => {
      const api = createNetworkAPI(pluginId, ['network:local']);
      expect(api.fetch).toBeDefined();
    });

    it('无网络权限时 fetch 为 undefined', () => {
      const api = createNetworkAPI(pluginId, []);
      expect(api.fetch).toBeUndefined();
    });

    it('tasks:read 权限不影响 network', () => {
      const api = createNetworkAPI(pluginId, ['tasks:read']);
      expect(api.fetch).toBeUndefined();
    });
  });

  describe('插件隔离', () => {
    it('不同插件创建独立实例', () => {
      const api1 = createNetworkAPI('com.a', ['network']);
      const api2 = createNetworkAPI('com.b', []);
      expect(api1.fetch).toBeDefined();
      expect(api2.fetch).toBeUndefined();
    });
  });
});
