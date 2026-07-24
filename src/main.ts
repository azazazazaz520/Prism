import './styles/global.css';
import { createApp } from 'vue';
import type { Component } from 'vue';
import { initTheme } from './composables/useTheme';
import { installGlobalDiagnostics } from './diagnostics/logger';
import { diagnosticsLogger } from './diagnostics/invoke-logged';
import type { Logger } from './diagnostics/logger';
import App from './App.vue';
import FloatingWindow from './components/FloatingWindow.vue';
import ImportFloating from './components/ImportFloating.vue';
import ScreenshotSelector from './components/ScreenshotSelector.vue';

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
