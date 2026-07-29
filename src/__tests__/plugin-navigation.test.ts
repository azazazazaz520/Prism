import { beforeEach, describe, expect, it } from 'vitest';
import { DisposableStore } from '../plugin-api/disposable';
import {
  activatePluginPage,
  clearViewRegistrations,
  createViewsAPI,
  deactivatePluginPage,
  getActivePageRegistrations,
  getViewRegistrations,
} from '../plugin-api/views-impl';

describe('插件页导航', () => {
  beforeEach(() => {
    clearViewRegistrations();
    deactivatePluginPage();
  });

  it('切换回主模块时可以清除当前插件页', () => {
    const store = new DisposableStore();
    const api = createViewsAPI('com.example.navigation', (item) => store.track(item));
    api.registerRail('com.example.navigation.rail', {} as any);
    api.registerPage('com.example.navigation.page', {} as any);

    activatePluginPage('com.example.navigation');
    expect(getActivePageRegistrations()).toHaveLength(1);

    deactivatePluginPage();
    expect(getActivePageRegistrations()).toHaveLength(0);
    expect(getViewRegistrations('page')).toHaveLength(1);
  });
});
