import { ref } from 'vue';
import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';
import type { Vendor } from '../types';

/**
 * AiStatus — AI 供应商可用性检测
 *
 * 全局单例：aiEnabled 跨组件共享，load() 在 App.vue 挂载时调用一次。
 * 不管理供应商 CRUD——只暴露"是否有可用 AI"的布尔状态。
 */
/** AI 供应商状态的全局单例 ref */
const aiEnabled = ref(false);

/** AI 状态 composable：检查是否有可用的 AI 供应商 */
export function useAiStatus() {
  /** 检查是否配置了启用的 AI 供应商 */
  async function load() {
    try {
      const vendors = await invoke<Vendor[]>('get_vendors');
      aiEnabled.value = vendors.some((v) => v.enabled);
    } catch {
      aiEnabled.value = false;
    }
  }

  return {
    aiEnabled,
    load,
  };
}
