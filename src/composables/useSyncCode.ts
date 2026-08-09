import { ref } from 'vue';
import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';
import { diagnosticsLogger } from '../diagnostics/invoke-logged';
import { useSync } from './useSync';
import { useAuth, getSupabaseClient } from './useAuth';

/**
 * SyncCode — 跨设备配对与 Profile 管理
 *
 * 配对流程：
 * 设备A generateSyncCode() → 创建 Supabase profile + sync_code →
 * 设备B joinProfile(code) → 查找并加入已有 profile → mergeLocalToProfile()
 *
 * 全局单例：isPairing / pairError 跨组件共享。
 */
/** 同步配置返回类型 */
interface SyncConfig {
  sync_code: string | null;
  profile_id: string | null;
  last_sync_at: string | null;
}

/** 同步码配对状态 */
const isPairing = ref(false);
const pairError = ref<string | null>(null);

export function useSyncCode() {
  const { user, isLoggedIn } = useAuth();
  const { setProfileId, getProfileId } = useSync();

  /** 获取伪随机 UUID */
  function generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /** 从 Rust 读取同步配置 */
  async function getSyncConfig(): Promise<SyncConfig> {
    return invoke<SyncConfig>('get_sync_config');
  }

  /** 通过受保护的 Edge Function 创建或加入 profile，避免直接读取同步码表。 */
  async function pairProfile(action: 'create' | 'join', syncCode: string): Promise<string> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('pair-profile', {
      body: { action, sync_code: syncCode.trim() },
    });

    if (error || !data?.profile_id) {
      throw new Error(action === 'join' ? '同步码无效，请检查后重试' : '生成同步码失败');
    }

    return data.profile_id as string;
  }

  /** 判断当前设备是否已配对 */
  async function hasProfile(): Promise<boolean> {
    const config = await getSyncConfig();
    if (!config.sync_code) return false;
    return getProfileId() !== null;
  }

  /** 生成同步码并创建 profile */
  async function generateSyncCode(): Promise<string> {
    if (!isLoggedIn.value || !user.value) {
      throw new Error('请先完成匿名登录');
    }

    isPairing.value = true;
    pairError.value = null;

    try {
      const code = generateUUID();
      const profileId = await pairProfile('create', code);

      // 持久化同步码到本地配置
      await invoke('set_sync_config', { syncCode: code, profileId });
      setProfileId(profileId);

      return code;
    } catch (e) {
      const message = e instanceof Error ? e.message : '生成同步码失败';
      pairError.value = message;
      throw e;
    } finally {
      isPairing.value = false;
    }
  }

  /** 设备 B 输入同步码加入已有 profile */
  async function joinProfile(syncCode: string): Promise<void> {
    if (!isLoggedIn.value || !user.value) {
      throw new Error('请先完成匿名登录');
    }

    isPairing.value = true;
    pairError.value = null;

    try {
      const profileId = await pairProfile('join', syncCode);

      // 持久化
      await invoke('set_sync_config', { syncCode: syncCode.trim(), profileId });
      setProfileId(profileId);

      // 将本地无 profile_id 的任务关联到该 profile 并推送
      await mergeLocalToProfile(profileId);
    } catch (e) {
      const message = e instanceof Error ? e.message : '配对失败';
      pairError.value = message;
      throw e;
    } finally {
      isPairing.value = false;
    }
  }

  /** 将本地任务批量关联到 profile 并推送到 Supabase */
  async function mergeLocalToProfile(profileId: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase || !user.value) return;

    try {
      const localTasks = await invoke<any[]>('get_all_tasks_including_deleted');
      const unlinkedTasks = localTasks.filter((t) => !t.profile_id);

      if (unlinkedTasks.length === 0) return;

      for (const task of unlinkedTasks) {
        await supabase.from('tasks').upsert({
          ...task,
          profile_id: profileId,
          user_id: user.value.id,
        });
      }
    } catch (e) {
      diagnosticsLogger.warn(
        'sync',
        'sync.merge_local_to_profile_failed',
        '合并本地任务到远端 profile 失败',
        {
          error: e instanceof Error ? e.message : String(e),
        },
      );
    }
  }

  /**
   * 确保当前用户在 user_profiles 中有记录。
   * 匿名登录 session 过期/重建后 auth.uid() 会变化，
   * 若 restoreProfile 只恢复 profile_id 而不重新关联用户，
   * RLS 会拒绝后续 push 操作。
   * 失败时静默忽略，由离线队列兜底。
   */
  async function ensureProfileMembership(syncCode: string): Promise<void> {
    if (!user.value) return;

    try {
      await pairProfile('join', syncCode);
    } catch (e) {
      diagnosticsLogger.warn(
        'sync',
        'sync.ensure_profile_membership_failed',
        '确保同步 profile 成员关系失败',
        {
          error: e instanceof Error ? e.message : String(e),
        },
      );
    }
  }

  /** 恢复已配对的 profile（启动时调用）
   *  优先使用本地存储的 profile_id（离线安全），
   *  仅当本地无 profile_id 时才查询 Supabase 验证。
   *  恢复后异步确保 user_profiles 成员关系，
   *  防止匿名 session 变化导致 RLS 拒绝后续操作。 */
  async function restoreProfile(): Promise<boolean> {
    const config = await getSyncConfig();
    if (!config.sync_code) return false;

    // 本地已有 profile_id → 直接使用，无需网络验证
    if (config.profile_id) {
      setProfileId(config.profile_id);
      // 异步确保当前用户仍在 user_profiles 中
      // fire-and-forget — 失败由 pushTask 离线队列兜底
      ensureProfileMembership(config.sync_code);
      return true;
    }

    // 本地无 profile_id → 通过受保护接口恢复（仅在线时可用，5s 超时）
    try {
      const query = pairProfile('join', config.sync_code);
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 5_000),
      );
      const profileId = await Promise.race([query, timeout]);

      // 回填本地配置，下次启动可离线恢复
      await invoke('set_sync_config', { syncCode: config.sync_code, profileId });
      setProfileId(profileId);
      return true;
    } catch {
      return false;
    }
  }

  return {
    isPairing,
    pairError,
    getSyncConfig,
    hasProfile,
    generateSyncCode,
    joinProfile,
    restoreProfile,
    mergeLocalToProfile,
  };
}
