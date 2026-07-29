import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  optimizeDeps: {
    // 项目包含多个独立的 HTML 设计稿；开发应用只应从正式入口开始扫描依赖。
    entries: ['index.html'],
  },
  server: {
    port: 1420,
    strictPort: true,
  },
});
