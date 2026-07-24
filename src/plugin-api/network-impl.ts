import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';

// ═══════════════════════════════════════════════════════════════
//  prism:network API 工厂
// ═══════════════════════════════════════════════════════════════

/**
 * 为指定插件创建 Network API。
 * - `network` 权限：仅允许公网地址
 * - `network:local` 权限：额外允许 localhost / LAN 地址
 *
 * 所有请求通过 Rust Host HTTP 代理发出，
 * 地址校验由后端完成（第三层防线），30s 超时。
 */
export function createNetworkAPI(pluginId: string, permissions: string[]) {
  const hasNet = permissions.includes('network') || permissions.includes('network:local');

  return {
    /** 发起 HTTP 请求（通过 Rust Host 代理） */
    fetch: hasNet
      ? (url: string, options?: FetchOptions) =>
          invoke<FetchResponse>('plugin_network_fetch', { pluginId, url, options })
      : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════
//  类型
// ═══════════════════════════════════════════════════════════════

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
