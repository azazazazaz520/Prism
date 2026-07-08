import { ref, watch } from 'vue';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useAuth, getSupabaseClient } from './useAuth';
import type { Task, DailyCompletion } from '../types';

/** 离线操作队列：网络断开时暂存本地，恢复后批量推送 */
const OFFLINE_QUEUE_KEY = 'prism_offline_queue';

interface OfflineQueueItem {
  type: 'upsert' | 'delete';
  table: string;
  data: Record<string, unknown>;
}

function loadOfflineQueue(): OfflineQueueItem[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistOfflineQueue(queue: OfflineQueueItem[]) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

const offlineQueue: OfflineQueueItem[] = loadOfflineQueue();
/** 同步状态指示器 */
const isOnline = ref(navigator.onLine);
/** 同步状态：启动时根据实际网络状态初始化，避免离线启动显示"已同步" */
const syncStatus = ref<'idle' | 'syncing' | 'error' | 'offline' | 'unauthorized'>(
  navigator.onLine ? 'idle' : 'offline',
);
const lastSyncAt = ref<string | null>(null);

/** 队列重试定时器：push 失败后延迟重试，防止 Tauri 中 online 事件不可靠 */
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const RETRY_DELAY_MS = 10_000;

function scheduleRetry(fn: () => void) {
  if (retryTimer) return; // 已有待执行的重试，去重
  retryTimer = setTimeout(() => {
    retryTimer = null;
    fn();
  }, RETRY_DELAY_MS);
}

/** 当前设备所属的 profile_id，由 useSyncCode 设置 */
const currentProfileId = ref<string | null>(null);

/** 分页大小 */
const PAGE_SIZE = 500;

export function useSync() {
  const { user, isLoggedIn } = useAuth();

  window.addEventListener('online', () => {
    isOnline.value = true;
    flushOfflineQueue();
  });
  window.addEventListener('offline', () => {
    isOnline.value = false;
    syncStatus.value = 'offline';
  });

  /** 获取当前认证用户 ID */
  function userId(): string | undefined {
    return user.value?.id;
  }

  /** 获取/设置当前 profile_id，供 useSyncCode 调用 */
  function getProfileId(): string | null {
    return currentProfileId.value;
  }

  function setProfileId(id: string | null) {
    currentProfileId.value = id;
  }

  /** 监听登录状态变化，刷新离线队列 */
  watch(isLoggedIn, (val) => {
    if (val) {
      flushOfflineQueue();
    } else {
      currentProfileId.value = null;
      syncStatus.value = 'idle';
    }
  });

  // ── 上行同步 ──

  async function pushTask(task: Task): Promise<void> {
    const uid = userId();
    if (!uid) return;
    const profileId = getProfileId();
    const supabase = getSupabaseClient();

    if (!isOnline.value) {
      offlineQueue.push({
        type: 'upsert',
        table: 'tasks',
        data: {
          ...(task as unknown as Record<string, unknown>),
          profile_id: profileId,
          user_id: uid,
        },
      });
      persistOfflineQueue(offlineQueue);
      return;
    }

    try {
      syncStatus.value = 'syncing';
      const { error } = await supabase.from('tasks').upsert({
        id: task.id,
        title: task.title,
        completed: task.completed,
        created_at: task.created_at,
        completed_at: task.completed_at,
        due_date: task.due_date,
        tags: task.tags,
        important: task.important,
        pinned: task.pinned,
        is_daily: task.is_daily,
        parent_id: task.parent_id,
        updated_at: task.updated_at,
        is_deleted: task.is_deleted,
        user_id: uid,
        profile_id: profileId,
      });

      if (error) throw error;
      lastSyncAt.value = new Date().toISOString();
      syncStatus.value = 'idle';
      // 成功推送后消费离线队列，确保离线期间积累的操作被同步。
      // 这同时修复了 Tauri webview 中 navigator.onLine 不可靠、
      // online 事件不触发导致队列永远卡住的问题。
      flushOfflineQueue();
    } catch (e) {
      console.error('同步任务失败:', e);
      syncStatus.value = 'error';
      offlineQueue.push({
        type: 'upsert',
        table: 'tasks',
        data: {
          ...(task as unknown as Record<string, unknown>),
          profile_id: profileId,
          user_id: uid,
        },
      });
      persistOfflineQueue(offlineQueue);
      // 延迟重试：Tauri webview 中 online 事件可能不触发，定期自愈
      scheduleRetry(() => flushOfflineQueue());
    }
  }

  async function pushDailyCompletion(dc: DailyCompletion): Promise<void> {
    const uid = userId();
    if (!uid) return;
    const profileId = getProfileId();
    const supabase = getSupabaseClient();

    if (!isOnline.value) {
      offlineQueue.push({
        type: 'upsert',
        table: 'daily_completions',
        data: {
          task_id: dc.task_id,
          date: dc.date,
          user_id: uid,
          profile_id: profileId,
        },
      });
      persistOfflineQueue(offlineQueue);
      return;
    }

    try {
      const { error } = await supabase.from('daily_completions').upsert({
        task_id: dc.task_id,
        date: dc.date,
        user_id: uid,
        profile_id: profileId,
      });

      if (error) throw error;
      // 成功推送后消费离线队列
      flushOfflineQueue();
    } catch (e) {
      console.error('同步每日完成记录失败:', e);
      offlineQueue.push({
        type: 'upsert',
        table: 'daily_completions',
        data: {
          task_id: dc.task_id,
          date: dc.date,
          user_id: uid,
          profile_id: profileId,
        },
      });
      persistOfflineQueue(offlineQueue);
      scheduleRetry(() => flushOfflineQueue());
    }
  }

  /** 从 Supabase 删除每日完成记录（取消完成时调用） */
  async function pushDeleteDailyCompletion(taskId: string, date: string): Promise<void> {
    const uid = userId();
    if (!uid) return;
    const profileId = getProfileId();
    const supabase = getSupabaseClient();

    if (!isOnline.value) {
      offlineQueue.push({
        type: 'delete',
        table: 'daily_completions',
        data: { task_id: taskId, date, user_id: uid, profile_id: profileId },
      });
      persistOfflineQueue(offlineQueue);
      return;
    }

    try {
      const { error } = await supabase
        .from('daily_completions')
        .delete()
        .eq('task_id', taskId)
        .eq('date', date)
        .eq('user_id', uid)
        .eq('profile_id', profileId);

      if (error) throw error;
      // 成功推送后消费离线队列
      flushOfflineQueue();
    } catch (e) {
      console.error('删除每日完成记录失败:', e);
      offlineQueue.push({
        type: 'delete',
        table: 'daily_completions',
        data: { task_id: taskId, date, user_id: uid, profile_id: profileId },
      });
      persistOfflineQueue(offlineQueue);
      scheduleRetry(() => flushOfflineQueue());
    }
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
      console.error('拉取远程每日完成记录失败:', e);
      return [];
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
      console.error('拉取远程任务失败:', e);
      return allTasks.length > 0 ? allTasks : [];
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

    const supabase = getSupabaseClient();

    const channel = supabase
      .channel('tasks-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `profile_id=eq.${profileId}` },
        (payload) => {
          // DELETE 事件 payload.new 为 null，从 payload.old 读取被删任务
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
          // DELETE 事件 payload.new 为 null，payload.old 存有被删记录
          const dc = (payload.new || payload.old) as DailyCompletion;
          const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
          if (dc) onDailyCompletionChange(dc, eventType);
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          syncStatus.value = 'idle';
        } else if (status === 'CHANNEL_ERROR') {
          syncStatus.value = 'error';
          setTimeout(() => subscribeToChanges(onTaskChange, onDailyCompletionChange), 5000);
        }
      });

    return channel;
  }

  // ── 离线队列 ──

  /**
   * 刷新离线队列：网络恢复后将暂存的操作批量推送到 Supabase。
   * 采用「先清空再逐条推送」策略：清空后若某条失败则重新入队。
   * 若队列未清空，自动调度重试，覆盖 Tauri webview 中 online 事件不可靠的场景。
   */
  async function flushOfflineQueue(): Promise<void> {
    if (offlineQueue.length === 0) return;
    const supabase = getSupabaseClient();

    syncStatus.value = 'syncing';
    const queue = [...offlineQueue];
    offlineQueue.length = 0;
    persistOfflineQueue(offlineQueue);

    for (const item of queue) {
      try {
        if (item.type === 'delete') {
          await supabase.from(item.table).delete().match(item.data);
        } else {
          await supabase.from(item.table).upsert(item.data);
        }
      } catch (e) {
        offlineQueue.push(item);
        persistOfflineQueue(offlineQueue);
        console.error('离线队列推送失败:', e);
      }
    }

    if (offlineQueue.length > 0) {
      // 队列未清空（网络仍未恢复），调度重试
      syncStatus.value = 'error';
      scheduleRetry(() => flushOfflineQueue());
    } else {
      syncStatus.value = 'idle';
    }
  }

  return {
    syncStatus,
    lastSyncAt,
    currentProfileId,
    getProfileId,
    setProfileId,
    pushTask,
    pushDailyCompletion,
    pushDeleteDailyCompletion,
    pullTasks,
    pullDailyCompletions,
    subscribeToChanges,
    flushOfflineQueue,
  };
}
