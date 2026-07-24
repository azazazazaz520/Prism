import { ref, watchEffect } from 'vue';
import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';

export type ThemeMode = 'auto' | 'light' | 'dark' | 'hud';

const theme = ref<ThemeMode>('auto');

function apply(mode: ThemeMode) {
  document.documentElement.setAttribute('data-theme', mode);
}

async function loadFromBackend(): Promise<ThemeMode> {
  try {
    const saved = await invoke<string>('get_theme');
    if (saved === 'light' || saved === 'dark' || saved === 'auto' || saved === 'hud') {
      return saved as ThemeMode;
    }
  } catch {
    /* 首次运行 */
  }
  return 'auto';
}

/** 持久化主题到后端 */
async function saveToBackend(mode: ThemeMode) {
  try {
    await invoke('set_theme', { theme: mode });
  } catch {
    // ignore
  }
}

/** 初始化：加载偏好 + 应用 */
export async function initTheme() {
  theme.value = await loadFromBackend();
  apply(theme.value);
}

/** 切换主题并持久化 */
export async function setTheme(mode: ThemeMode) {
  theme.value = mode;
  apply(mode);
  await saveToBackend(mode);
}

/** 当前主题（响应式） */
export function useTheme() {
  return { theme, setTheme };
}
