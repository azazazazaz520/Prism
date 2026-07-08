import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
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
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase 客户端未初始化');

      // 创建 profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .insert({ sync_code: code })
        .select('id')
        .single();

      if (profileError) throw profileError;

      // 创建 user_profile 映射
      const { error: mappingError } = await supabase.from('user_profiles').insert({
        user_id: user.value.id,
        profile_id: profile.id,
      });

      if (mappingError) throw mappingError;

      // 持久化同步码到本地配置
      await invoke('set_sync_config', { syncCode: code, profileId: profile.id });
      setProfileId(profile.id);

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
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase 客户端未初始化');

      // 查找 profile
      const { data: profile, error: findError } = await supabase
        .from('profiles')
        .select('id')
        .eq('sync_code', syncCode)
        .single();

      if (findError || !profile) {
        throw new Error('同步码无效，请检查后重试');
      }

      // 检查是否已加入
      const { data: existing } = await supabase
        .from('user_profiles')
        .select('user_id')
        .eq('user_id', user.value.id)
        .eq('profile_id', profile.id)
        .maybeSingle();

      if (!existing) {
        // 创建映射
        const { error: mappingError } = await supabase.from('user_profiles').insert({
          user_id: user.value.id,
          profile_id: profile.id,
        });

        if (mappingError) throw mappingError;
      }

      // 持久化
      await invoke('set_sync_config', { syncCode, profileId: profile.id });
      setProfileId(profile.id);

      // 将本地无 profile_id 的任务关联到该 profile 并推送
      await mergeLocalToProfile(profile.id);
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
      console.warn('[syncCode] mergeLocalToProfile failed:', e);
    }
  }

  /** 恢复已配对的 profile（启动时调用）
   *  优先使用本地存储的 profile_id（离线安全），
   *  仅当本地无 profile_id 时才查询 Supabase 验证。 */
  async function restoreProfile(): Promise<boolean> {
    const config = await getSyncConfig();
    if (!config.sync_code) return false;

    // 本地已有 profile_id → 直接使用，无需网络验证
    if (config.profile_id) {
      setProfileId(config.profile_id);
      return true;
    }

    // 本地无 profile_id → 查询 Supabase（仅在线时可用，5s 超时）
    const supabase = getSupabaseClient();
    try {
      const query = supabase
        .from('profiles')
        .select('id')
        .eq('sync_code', config.sync_code)
        .single();
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 5_000),
      );
      const { data: profile, error } = (await Promise.race([query, timeout])) as Awaited<
        typeof query
      >;

      if (error || !profile) return false;

      // 回填本地配置，下次启动可离线恢复
      await invoke('set_sync_config', { syncCode: config.sync_code, profileId: profile.id });
      setProfileId(profile.id);
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
