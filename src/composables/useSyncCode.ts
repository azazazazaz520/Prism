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
  const { setProfileId, getProfileId, flushOfflineQueue } = useSync();

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
        const { error } = await supabase.from('tasks').upsert({
          ...task,
          profile_id: profileId,
          user_id: user.value.id,
        });
        if (error) throw error;
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

  /** 恢复已配对的 profile（启动时调用）
   *  在线时必须等待受保护的配对接口完成成员关系恢复，
   *  防止匿名 session 变化或启动竞态导致后续 RLS 写入被拒绝；
   *  离线时才使用本地 profile_id 继续保留本地优先与离线队列语义。 */
  async function restoreProfile(): Promise<boolean> {
    const config = await getSyncConfig();
    if (!config.sync_code) return false;

    // 网络不可用时不能调用 Edge Function，但仍需保留本地 Profile，
    // 使任务修改进入带有正确 profile_id 的离线队列。
    if (!navigator.onLine) {
      if (config.profile_id) {
        setProfileId(config.profile_id);
        return true;
      }
      return false;
    }

    try {
      // 无论本地是否已有 profile_id，都重新 join 一次：该接口同时确保
      // 当前匿名用户在 user_profiles 中有成员关系，而不是只恢复一个旧 ID。
      const profileId = await pairProfile('join', config.sync_code);

      if (profileId !== config.profile_id) {
        await invoke('set_sync_config', { syncCode: config.sync_code, profileId });
      }
      setProfileId(profileId);
      // 认证恢复后再消费旧队列，避免用未恢复的身份字段重放任务。
      await flushOfflineQueue();
      return true;
    } catch (e) {
      setProfileId(null);
      diagnosticsLogger.warn('sync', 'sync.restore_profile_failed', '恢复同步 profile 失败', {
        error: e instanceof Error ? e.message : String(e),
      });
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
