// ═══════════════════════════════════════════════════════════════
//  提醒模块 — 后台线程检查到期任务并推送系统通知
//
//  通过 ReminderBackend trait 隔离纯逻辑与 Tauri 副作用，
//  核心时间计算和去重逻辑可脱离 Tauri 进行单元测试。
// ═══════════════════════════════════════════════════════════════

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// 提醒系统需要的任务快照
pub struct TaskSnapshot {
    pub id: String,
    pub title: String,
    pub due_date: String,
}

/// 提醒模块的抽象后端 — 生产用 Tauri 实现，测试用内存假数据
pub trait ReminderBackend: Send + Sync + 'static {
    /// 提醒阈值（分钟），0 表示关闭提醒
    fn reminder_minutes(&self) -> u32;
    /// 获取未完成且有截止日期的任务快照
    fn pending_tasks(&self) -> Vec<TaskSnapshot>;
    /// 推送系统通知
    fn notify(&self, title: &str, body: &str);
    /// 尝试标记任务为今日已通知。返回 true 表示首次标记（应发通知）。
    /// 内部处理日期变更时的集合重置。
    fn try_mark_notified(&self, task_id: &str, today: &str) -> bool;
}

// ═══════════════════════════════════════════════════════════════
//  Tauri 生产适配器
// ═══════════════════════════════════════════════════════════════

/// 基于 Tauri AppHandle 的生产级 ReminderBackend 实现。
///
/// 通过 AppHandle 访问 AppState 获取数据和配置，
/// 通过 Tauri Notification API 推送系统通知。
/// `notified_today` 去重集合由本结构体自行维护，不暴露给 AppState。
pub struct TauriBackend {
    handle: tauri::AppHandle,
    notified_today: Mutex<HashSet<String>>,
}

impl TauriBackend {
    pub fn new(handle: tauri::AppHandle) -> Self {
        Self {
            handle,
            notified_today: Mutex::new(HashSet::new()),
        }
    }
}

impl ReminderBackend for TauriBackend {
    fn reminder_minutes(&self) -> u32 {
        let state = self.handle.state::<crate::AppState>();
        state.with_config(|c| c.reminder_minutes)
    }

    fn pending_tasks(&self) -> Vec<TaskSnapshot> {
        let state = self.handle.state::<crate::AppState>();
        state.read_data(|d| {
            d.tasks
                .iter()
                .filter(|t| !t.completed && t.due_date.is_some())
                .map(|t| TaskSnapshot {
                    id: t.id.clone(),
                    title: t.title.clone(),
                    due_date: t.due_date.clone().unwrap(),
                })
                .collect()
        })
    }

    fn notify(&self, title: &str, body: &str) {
        use tauri_plugin_notification::NotificationExt;
        let _ = self
            .handle
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show();
    }

    fn try_mark_notified(&self, task_id: &str, today: &str) -> bool {
        let mut notified = self.notified_today.lock().unwrap();
        // 日期变更时重置集合
        if !notified.contains(today) {
            notified.clear();
            notified.insert(today.to_string());
        }
        if notified.contains(task_id) {
            false
        } else {
            notified.insert(task_id.to_string());
            true
        }
    }
}

// ═══════════════════════════════════════════════════════════════
//  提醒循环（纯逻辑，可脱离 Tauri 单测）
// ═══════════════════════════════════════════════════════════════

/// 启动后台提醒线程：每 60 秒检查到期任务并通知。
///
/// `running` 标志用于优雅关闭，主窗口关闭时设为 false。
pub fn start(backend: Arc<dyn ReminderBackend>, running: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        while running.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_secs(60));
            if !running.load(Ordering::SeqCst) {
                break;
            }

            let reminder = backend.reminder_minutes();
            if reminder == 0 {
                continue;
            }

            let tasks = backend.pending_tasks();
            let local_now = chrono::Local::now();
            let today = local_now.format("%Y-%m-%d").to_string();
            let local_offset = local_now.offset();

            for task in &tasks {
                let due_str = format!("{}T23:59:59{}", task.due_date, local_offset);
                let due_time = match chrono::DateTime::parse_from_rfc3339(&due_str) {
                    Ok(t) => t,
                    Err(_) => continue,
                };
                let diff_min = (due_time.timestamp() - local_now.timestamp()) / 60;
                if diff_min > 0
                    && diff_min <= reminder as i64
                    && backend.try_mark_notified(&task.id, &today)
                {
                    backend.notify(
                        "⏰ 任务即将到期",
                        &format!("\"{}\" 将在 {} 分钟后到期", task.title, diff_min),
                    );
                }
            }
        }
    });
}
