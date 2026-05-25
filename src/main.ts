import { createApp } from 'vue';
import App from './App.vue';
import FloatingWindow from './components/FloatingWindow.vue';

const params = new URLSearchParams(window.location.search);
const isFloating = params.get('window') === 'floating';

if (isFloating) {
  createApp(FloatingWindow).mount('#app');
} else {
  createApp(App).mount('#app');
}
