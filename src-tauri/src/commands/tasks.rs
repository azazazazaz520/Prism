use super::AppState;
use crate::store;
use crate::task_service;
use crate::task_service::{AddTaskInput, UpdateTaskInput};

// ═══════════════════════════════════════════════════════════════
//  只读命令 — 通过 AppState::read_data 一行委托
// ═══════════════════════════════════════════════════════════════

#[tauri::command]
pub fn get_tasks(state: tauri::State<AppState>) -> Vec<store::Task> {
    state.read_data(task_service::list)
}

#[tauri::command]
pub fn get_all_tasks_including_deleted(state: tauri::State<AppState>) -> Vec<store::Task> {
    state.read_data(task_service::list_all)
}

#[tauri::command]
pub fn get_tasks_by_date(state: tauri::State<AppState>, date: String) -> Vec<store::Task> {
    state.read_data(|d| task_service::list_by_date(d, &date))
}

#[tauri::command]
pub fn get_all_tags(state: tauri::State<AppState>) -> Vec<String> {
    state.read_data(task_service::all_tags)
}

#[tauri::command]
pub fn get_daily_completions(state: tauri::State<AppState>, date: String) -> Vec<String> {
    state.read_data(|d| task_service::daily_completions(d, &date))
}

// ═══════════════════════════════════════════════════════════════
//  写命令 — 通过 AppState::write_data 一行委托
// ═══════════════════════════════════════════════════════════════

#[tauri::command]
pub fn add_task(state: tauri::State<AppState>, args: AddTaskInput) -> Result<store::Task, String> {
    state.write_data(|d| task_service::add(d, args))
}

/// 切换完成状态，自动记录完成/取消时间
#[tauri::command]
pub fn toggle_task(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    state.write_data(|d| {
        task_service::toggle(d, &id);
    })
}

/// 按日期记录每日完成状态，支持跨天追踪
#[tauri::command]
pub fn toggle_daily_task(
    state: tauri::State<AppState>,
    id: String,
    date: String,
) -> Result<(), String> {
    state.write_data(|d| {
        task_service::toggle_daily(d, &id, &date);
    })
}

#[tauri::command]
pub fn update_task(state: tauri::State<AppState>, args: UpdateTaskInput) -> Result<(), String> {
    state.write_data(|d| {
        task_service::update(d, args);
    })
}

/// 软删除指定任务（标记 is_deleted = true，保留数据用于同步传播）
#[tauri::command]
pub fn delete_task(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    state.write_data(|d| {
        task_service::delete(d, &id);
    })
}

/// 一键软删除所有已完成任务
#[tauri::command]
pub fn clear_completed(state: tauri::State<AppState>) -> Result<(), String> {
    state.write_data(|d| {
        task_service::clear_completed(d);
    })
}

/// 删除指定标签（从所有任务中移除该标签）
#[tauri::command]
pub fn delete_tag(state: tauri::State<AppState>, tag: String) -> Result<(), String> {
    state.write_data(|d| {
        task_service::delete_tag(d, &tag);
    })
}

/// 合并远端每日完成记录到本地（只增不删，清理由 cleanStaleDailyCompletions 补齐）
#[tauri::command]
pub fn sync_remote_daily_completions(
    state: tauri::State<AppState>,
    remote_completions: Vec<store::DailyCompletion>,
) -> Result<(), String> {
    state.write_data(|d| {
        for remote in remote_completions {
            let exists = d
                .daily_completions
                .iter()
                .any(|dc| dc.task_id == remote.task_id && dc.date == remote.date);
            if !exists {
                d.daily_completions.push(remote);
            }
        }
    })
}

/// 将远端拉回的任务合并到本地 data.json（LWW），防止离线重启后僵尸任务复活。
/// 仅覆盖 updated_at 不低于本地的远端任务；本地未同步的新任务不受影响。
#[tauri::command]
pub fn sync_local_tasks(
    state: tauri::State<AppState>,
    remote_tasks: Vec<store::Task>,
) -> Result<(), String> {
    state.write_data(|d| {
        for rt in &remote_tasks {
            if let Some(idx) = d.tasks.iter().position(|t| t.id == rt.id) {
                if rt.updated_at >= d.tasks[idx].updated_at {
                    d.tasks[idx] = rt.clone();
                }
            } else if !rt.is_deleted {
                d.tasks.push(rt.clone());
            }
        }
    })
}

/// 从本地删除指定每日完成记录（Realtime DELETE 事件时调用）
#[tauri::command]
pub fn delete_daily_completion(
    state: tauri::State<AppState>,
    task_id: String,
    date: String,
) -> Result<(), String> {
    state.write_data(|d| {
        d.daily_completions
            .retain(|dc| !(dc.task_id == task_id && dc.date == date));
    })
}
