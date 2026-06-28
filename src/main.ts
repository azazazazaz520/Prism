import './styles/global.css';
import { createApp } from 'vue';
import { initTheme } from './composables/useTheme';
import App from './App.vue';
import FloatingWindow from './components/FloatingWindow.vue';
import ImportFloating from './components/ImportFloating.vue';

async function bootstrap() {
  await initTheme();

  const params = new URLSearchParams(window.location.search);
  const windowType = params.get('window');

  if (windowType === 'floating') {
    createApp(FloatingWindow).mount('#app');
  } else if (windowType === 'import') {
    createApp(ImportFloating).mount('#app');
  } else {
    createApp(App).mount('#app');
  }
}

bootstrap();
