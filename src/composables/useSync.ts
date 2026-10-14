import { ref, watch } from 'vue';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { useAuth, getSupabaseClient } from './useAuth';
import type { Task, DailyCompletion } from '../types';
import { diagnosticsLogger } from '../diagnostics/invoke-logged';

import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';
import {
  createOutboxConsumer,
  normalizeOperation,
  outboxCount,
  type QueueOperation,
} from './useOutbox';

const isOnline = ref(navigator.onLine);
const syncStatus = ref<'idle' | 'syncing' | 'error' | 'offline' | 'unauthorized'>(
  navigator.onLine ? 'idle' : 'offline',
);
const lastSyncAt = ref<string | null>(null);
let syncNetworkListenersBound = false;
let outboxConsumer: ReturnType<typeof createOutboxConsumer> | null = null;

/** 当前设备所属的 profile_id，由 useSyncCode 设置 */
const currentProfileId = ref<string | null>(null);

/** 当前 Realtime 频道及其重试状态。频道生命周期必须随 Profile 切换和退出登录结束。 */
let activeRealtimeChannel: RealtimeChannel | null = null;
let realtimeRetryTimer: ReturnType<typeof setTimeout> | null = null;
let realtimeSubscriptionGeneration = 0;

/** 分页大小 */
const PAGE_SIZE = 500;

/** 按实体键幂等发送，任务更新以数据库时间戳条件保持 LWW。 */
export async function sendOutboxOperation(
  client: SupabaseClient,
  operation: QueueOperation,
  signal: AbortSignal,
) {
  if (operation.table === 'tasks') {
    const inserted = await client
      .from('tasks')
      .upsert(operation.data, { onConflict: 'id', ignoreDuplicates: true })
      .abortSignal(signal);
    if (inserted.error) throw inserted.error;
    const updated = await client
      .from('tasks')
      .update(operation.data)
      .eq('id', operation.data.id)
      .lte('updated_at', operation.data.updated_at)
      .select('id,updated_at')
      .abortSignal(signal);
    if (updated.error) throw updated.error;
    const modifiedAt = Date.parse(String(operation.data.updated_at));
    if (updated.data.length > 0) {
      if (Date.parse(updated.data[0].updated_at) !== modifiedAt)
        throw new Error('远端任务修改时间与发送版本不一致');
      return updated;
    }
    const remote = await client
      .from('tasks')
      .select('updated_at')
      .eq('id', operation.data.id)
      .abortSignal(signal)
      .maybeSingle();
    if (remote.error) throw remote.error;
    if (!remote.data || !(Date.parse(remote.data.updated_at) > modifiedAt))
      throw new Error('远端任务尚未确认写入');
    return remote;
  }
  if (operation.type === 'delete') {
    let query = client
      .from('daily_completions')
      .delete()
      .eq('task_id', operation.data.task_id)
      .eq('date', operation.data.date);
    query =
      operation.data.profile_id == null
        ? query.is('profile_id', null).eq('user_id', operation.data.user_id)
        : query.eq('profile_id', operation.data.profile_id);
    return query.abortSignal(signal);
  }
  return client
    .from('daily_completions')
    .upsert(operation.data, { onConflict: 'task_id,date' })
    .abortSignal(signal);
}

export function useSync() {
  const { user, isLoggedIn } = useAuth();

  if (!syncNetworkListenersBound) {
    syncNetworkListenersBound = true;
    window.addEventListener('online', () => {
      isOnline.value = true;
      void flushOutbox().catch((error) =>
        diagnosticsLogger.warn('sync', 'sync.online_flush_failed', '网络恢复后发送失败', {
          error: String(error),
        }),
      );
    });
    window.addEventListener('offline', () => {
      isOnline.value = false;
      syncStatus.value = 'offline';
    });
  }

  /** 获取当前认证用户 ID */
  function userId(): string | undefined {
    return user.value?.id;
  }

  /** 获取/设置当前 profile_id，供 useSyncCode 调用 */
  function getProfileId(): string | null {
    return currentProfileId.value;
  }

  function setProfileId(id: string | null) {
    if (currentProfileId.value !== id) {
      void unsubscribeFromChanges();
    }
    currentProfileId.value = id;
  }

  async function unsubscribeFromChanges(): Promise<void> {
    realtimeSubscriptionGeneration += 1;
    if (realtimeRetryTimer) {
      clearTimeout(realtimeRetryTimer);
      realtimeRetryTimer = null;
    }

    const channel = activeRealtimeChannel;
    activeRealtimeChannel = null;
    if (channel) await channel.unsubscribe();
  }

  /** 会话退出时释放当前 Profile 和远端订阅。 */
  watch(isLoggedIn, (val) => {
    if (!val) {
      currentProfileId.value = null;
      syncStatus.value = 'idle';
      void unsubscribeFromChanges();
    }
  });

  if (!outboxConsumer) {
    outboxConsumer = createOutboxConsumer(
      () => isOnline.value && isLoggedIn.value && !!userId(),
      async (item, signal) => {
        const config = await invoke<{ profile_id: string | null; sync_code: string | null }>(
          'get_sync_config',
        );
        if (config.sync_code && currentProfileId.value !== config.profile_id)
          throw new Error('同步 Profile 尚未恢复');
        const operation = normalizeOperation(item, currentProfileId.value, userId()!);
        const client = getSupabaseClient();
        syncStatus.value = 'syncing';
        try {
          const result = await sendOutboxOperation(client, operation, signal);
          if (result.error) throw result.error;
          syncStatus.value = 'idle';
          return result;
        } catch (error) {
          syncStatus.value = 'error';
          throw error;
        }
      },
    );
  }

  async function flushOutbox(): Promise<void> {
    await outboxConsumer!.initialize();
    await outboxConsumer!.flush();
  }

  /** 拉取远端的每日完成记录 */
  async function pullDailyCompletions(): Promise<DailyCompletion[]> {
    const profileId = getProfileId();
    if (!profileId) return [];

    const supabase = getSupabaseClient();
    const allDCs: DailyCompletion[] = [];
    let page = 0;

    try {
      do {
        const { data, error } = await supabase
          .from('daily_completions')
          .select('*')
          .eq('profile_id', profileId)
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
          .order('date', { ascending: false });

        if (error) throw error;

        const batch = (data || []) as DailyCompletion[];
        allDCs.push(...batch);
        page++;

        if (batch.length < PAGE_SIZE) break;
      } while (true);

      return allDCs;
    } catch (e) {
      diagnosticsLogger.error(
        'sync',
        'sync.pull_daily_completions_failed',
        '拉取远程每日完成记录失败',
        e,
        {
          profile_id: profileId,
          page,
        },
      );
      syncStatus.value = 'error';
      throw e;
    }
  }

  // ── 下行同步 ──

  /** 分页拉取远端任务，支持增量（仅拉取 lastSyncAt 之后）和强制全量两种模式 */
  async function pullTasks(forceFull = false): Promise<Task[]> {
    const profileId = getProfileId();
    if (!profileId) return [];

    const supabase = getSupabaseClient();
    const allTasks: Task[] = [];
    let cursor: string | undefined;

    try {
      do {
        let query = supabase
          .from('tasks')
          .select('*')
          .eq('profile_id', profileId)
          .order('updated_at', { ascending: true })
          .limit(PAGE_SIZE);

        if (!forceFull && lastSyncAt.value && !cursor) {
          query = query.gt('updated_at', lastSyncAt.value);
        }
        if (cursor) {
          query = query.gt('updated_at', cursor);
        }

        const { data, error } = await query;
        if (error) throw error;

        const page = (data || []) as Task[];
        allTasks.push(...page);

        cursor = page.length === PAGE_SIZE ? page[page.length - 1].updated_at : undefined;
      } while (cursor);

      lastSyncAt.value = new Date().toISOString();
      return allTasks;
    } catch (e) {
      diagnosticsLogger.error('sync', 'sync.pull_tasks_failed', '拉取远程任务失败', e, {
        profile_id: profileId,
        force_full: forceFull,
        task_count: allTasks.length,
      });
      syncStatus.value = 'error';
      throw e;
    }
  }

  async function subscribeToChanges(
    onTaskChange: (task: Task) => void,
    onDailyCompletionChange: (
      dc: DailyCompletion,
      eventType: 'INSERT' | 'UPDATE' | 'DELETE',
    ) => void,
  ): Promise<RealtimeChannel | null> {
    const profileId = getProfileId();
    if (!profileId) return null;

    await unsubscribeFromChanges();

    const supabase = getSupabaseClient();

    // 用随机后缀避免 HMR 重载时频道名冲突
    const channelName = `tasks-changes-${Math.random().toString(36).slice(2, 8)}`;
    const generation = realtimeSubscriptionGeneration;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `profile_id=eq.${profileId}` },
        (payload) => {
          const task = (payload.new || payload.old) as Task;
          if (task) onTaskChange(task);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'daily_completions',
          filter: `profile_id=eq.${profileId}`,
        },
        (payload) => {
          const dc = (payload.new || payload.old) as DailyCompletion;
          const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
          if (dc) onDailyCompletionChange(dc, eventType);
        },
      );
    activeRealtimeChannel = channel;

    channel.subscribe((status) => {
      if (
        generation !== realtimeSubscriptionGeneration ||
        activeRealtimeChannel !== channel ||
        getProfileId() !== profileId
      ) {
        return;
      }

      if (status === 'SUBSCRIBED') {
        syncStatus.value = 'idle';
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        syncStatus.value = 'error';
        if (realtimeRetryTimer) return;

        // 5 秒后重建当前 Profile 的频道；退出登录或切换 Profile 后不再重试旧频道。
        realtimeRetryTimer = setTimeout(() => {
          realtimeRetryTimer = null;
          if (
            generation !== realtimeSubscriptionGeneration ||
            getProfileId() !== profileId ||
            !isOnline.value
          ) {
            return;
          }

          void (async () => {
            await unsubscribeFromChanges();
            if (getProfileId() === profileId && isOnline.value) {
              await subscribeToChanges(onTaskChange, onDailyCompletionChange);
            }
          })().catch((e) => {
            diagnosticsLogger.warn('sync', 'sync.realtime_retry_failed', 'Realtime 重连失败', {
              error: e instanceof Error ? e.message : String(e),
            });
          });
        }, 5_000);
      }
    });
    return channel;
  }

  return {
    syncStatus,
    lastSyncAt,
    offlineQueueCount: outboxCount,
    currentProfileId,
    getProfileId,
    setProfileId,
    pullTasks,
    pullDailyCompletions,
    subscribeToChanges,
    unsubscribeFromChanges,
    flushOutbox,
  };
}
