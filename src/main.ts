import './styles/global.css';
import { createApp } from 'vue';
import type { Component } from 'vue';
import { initTheme } from './composables/useTheme';
import { installGlobalDiagnostics } from './diagnostics/logger';
import { diagnosticsLogger } from './diagnostics/invoke-logged';
import type { Logger } from './diagnostics/logger';
import App from './App.vue';
import FloatingWindow from './components/overlays/FloatingWindow.vue';
import ImportFloating from './components/overlays/ImportFloating.vue';
import ScreenshotSelector from './components/overlays/ScreenshotSelector.vue';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';

function mountApp(component: Component, logger: Logger) {
  const app = createApp(component);
  app.config.errorHandler = (error, instance, info) => {
    logger.error('vue', 'vue.component_error', '捕获到 Vue 组件异常', error, {
      info,
      has_instance: Boolean(instance),
    });
  };
  app.mount('#app');
}

function dispatchOAuthCallback(url: string): void {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'prism:' ||
      parsed.hostname !== 'oauth' ||
      parsed.pathname !== '/callback'
    ) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent('prism:oauth-callback', {
        detail: {
          provider: parsed.searchParams.get('provider'),
          code: parsed.searchParams.get('code'),
          error: parsed.searchParams.get('error'),
        },
      }),
    );
  } catch {
    console.warn('[auth] 忽略无效的 Prism OAuth 回调 URL');
  }
}

async function installOAuthDeepLinkListener(): Promise<void> {
  try {
    const current = await getCurrent();
    current?.forEach(dispatchOAuthCallback);
    await onOpenUrl((urls) => urls.forEach(dispatchOAuthCallback));
  } catch (error) {
    // 深链仅用于 OAuth 回调，不应阻止主界面启动。
    console.warn('[auth] 深链监听不可用，继续启动主界面', error);
  }
}

async function bootstrap() {
  const logger = diagnosticsLogger;
  const removeGlobalDiagnostics = installGlobalDiagnostics(logger);
  window.addEventListener(
    'beforeunload',
    () => {
      removeGlobalDiagnostics();
      void logger.dispose();
    },
    { once: true },
  );

  try {
    await installOAuthDeepLinkListener();
    await initTheme();

    const params = new URLSearchParams(window.location.search);
    const windowType = params.get('window');

    if (windowType === 'floating') {
      mountApp(FloatingWindow, logger);
    } else if (windowType === 'import') {
      mountApp(ImportFloating, logger);
    } else if (windowType === 'selector') {
      mountApp(ScreenshotSelector, logger);
    } else {
      mountApp(App, logger);
    }
  } catch (error) {
    logger.error('window', 'window.bootstrap_failed', 'Prism 初始化失败', error);
    await logger.dispose();
    throw error;
  }
}

bootstrap().catch((error) => {
  console.error('[bootstrap] Prism 初始化失败:', error);
});
