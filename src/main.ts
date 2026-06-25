import './styles/global.css';
import { createApp } from 'vue';
import { initTheme } from './composables/useTheme';
import App from './App.vue';
import FloatingWindow from './components/FloatingWindow.vue';

async function bootstrap() {
  await initTheme();

  const params = new URLSearchParams(window.location.search);
  const isFloating = params.get('window') === 'floating';

  if (isFloating) {
    createApp(FloatingWindow).mount('#app');
  } else {
    createApp(App).mount('#app');
  }
}

bootstrap();
