import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { Vendor } from '../types';

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
