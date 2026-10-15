use crate::tasks::service;
use crate::tasks::service::{AddTaskInput, UpdateTaskInput};
use crate::AppState;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSnapshot {
    revision: u64,
    tasks: Vec<crate::models::Task>,
    daily_completions: Vec<crate::models::DailyCompletion>,
    outbox_count: usize,
    legacy_queue_imported: bool,
}

#[tauri::command]
pub fn get_task_snapshot(state: tauri::State<AppState>) -> TaskSnapshot {
    state.read_data(|data| TaskSnapshot {
        revision: data.revision,
        tasks: service::list(data),
        daily_completions: data.daily_completions.clone(),
        outbox_count: data.outbox.len(),
        legacy_queue_imported: data.legacy_queue_imported,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTasksBatchInput {
    pub tasks: Vec<AddTaskInput>,
}

#[derive(Debug, Serialize)]
pub struct AddTasksBatchResult {
    pub created: Vec<crate::models::Task>,
}

// ═══════════════════════════════════════════════════════════════
//  只读命令 — 通过 AppState::read_data 一行委托
// ═══════════════════════════════════════════════════════════════

#[tauri::command]
pub fn get_tasks(state: tauri::State<AppState>) -> Vec<crate::models::Task> {
    state.read_data(service::list)
}

#[tauri::command]
pub fn get_all_tasks_including_deleted(state: tauri::State<AppState>) -> Vec<crate::models::Task> {
    state.read_data(service::list_all)
}

#[tauri::command]
pub fn get_tasks_by_date(state: tauri::State<AppState>, date: String) -> Vec<crate::models::Task> {
    state.read_data(|d| service::list_by_date(d, &date))
}

#[tauri::command]
pub fn get_all_tags(state: tauri::State<AppState>) -> Vec<String> {
    state.read_data(service::all_tags)
}

/// 按指定日期获取已完成的每日任务 ID。
///
/// `date` 采用 YYYY-MM-DD 格式。返回值的每个元素都是一个任务 ID，
/// 用于刷新指定日期的界面完成状态。
#[tauri::command]
pub fn get_daily_completions(state: tauri::State<AppState>, date: String) -> Vec<String> {
    state.read_data(|d| service::daily_completions(d, &date))
}

/// 获取本地保存的全部每日完成记录。
///
/// 返回所有日期的 `DailyCompletion` 完整记录，包括任务 ID、日期和 Profile 归属，
/// 用于同步快照校正和 Profile 配对迁移。
#[tauri::command]
pub fn get_all_daily_completions(
    state: tauri::State<AppState>,
) -> Vec<crate::models::DailyCompletion> {
    state.read_data(|d| d.daily_completions.clone())
}

/// 按今日完成记录校正每日任务状态，并返回发生变化的任务。
#[tauri::command]
pub fn reset_daily_tasks(
    state: tauri::State<AppState>,
    today: String,
) -> Result<Vec<crate::models::Task>, String> {
    state.write_data(|d| service::reset_daily_tasks(d, &today))
}

// ═══════════════════════════════════════════════════════════════
//  写命令 — 通过 AppState::write_data 一行委托
// ═══════════════════════════════════════════════════════════════

#[tauri::command]
pub fn add_task(
    state: tauri::State<AppState>,
    args: AddTaskInput,
) -> Result<crate::models::Task, String> {
    state
        .write_data(|d| service::add(d, args))
        .map(|task| state.saved_task(task))
}

/// 原子批量新增任务：全部参数校验和持久化成功后才提交内存状态。
#[tauri::command]
pub fn add_tasks_batch(
    state: tauri::State<AppState>,
    args: AddTasksBatchInput,
) -> Result<AddTasksBatchResult, String> {
    state
        .write_data_candidate(|data| service::add_batch(data, args.tasks))
        .map(|created| AddTasksBatchResult {
            created: created
                .into_iter()
                .map(|task| state.saved_task(task))
                .collect(),
        })
}

/// 设置指定的完成状态，返回带后端时间戳的任务快照。
#[tauri::command]
pub fn toggle_task(
    state: tauri::State<AppState>,
    id: String,
    completed: bool,
) -> Result<crate::models::Task, String> {
    state
        .write_data_candidate(|d| {
            service::set_completed(d, &id, completed).ok_or_else(|| format!("task not found: {id}"))
        })
        .map(|task| state.saved_task(task))
}

/// 按日期记录每日完成状态，支持跨天追踪
#[tauri::command]
pub fn toggle_daily_task(
    state: tauri::State<AppState>,
    id: String,
    date: String,
    completed: bool,
) -> Result<(), String> {
    state.write_data_candidate(|d| {
        chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|_| "日期无效")?;
        service::set_daily_completed(d, &id, &date, completed)
            .ok_or_else(|| format!("task not found: {id}"))?;
        Ok(())
    })
}

#[tauri::command]
pub fn update_task(
    state: tauri::State<AppState>,
    args: UpdateTaskInput,
) -> Result<crate::models::Task, String> {
    state
        .write_data_candidate(|d| service::update(d, args).ok_or_else(|| "任务不存在".into()))
        .map(|task| state.saved_task(task))
}

/// 软删除指定任务（标记 is_deleted = true，保留数据用于同步传播）
#[tauri::command]
pub fn delete_task(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    state.write_data(|d| {
        service::delete(d, &id);
    })
}

/// 恢复指定的软删除任务，供前端撤销删除操作使用
#[tauri::command]
pub fn restore_task(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    state.write_data(|d| service::restore(d, &id)).map(|_| ())
}

/// 一键软删除所有已完成任务
#[tauri::command]
pub fn clear_completed(state: tauri::State<AppState>) -> Result<(), String> {
    state.write_data(|d| {
        service::clear_completed(d);
    })
}

/// 删除指定标签（从所有任务中移除该标签）
#[tauri::command]
pub fn delete_tag(state: tauri::State<AppState>, tag: String) -> Result<(), String> {
    state.write_data(|d| {
        service::delete_tag(d, &tag);
    })
}

/// 合并远端完成记录，并在完整快照校正时保留待同步的本地操作。
#[tauri::command]
pub fn sync_remote_daily_completions(
    state: tauri::State<AppState>,
    remote_completions: Vec<crate::models::DailyCompletion>,
    replace_snapshot: Option<bool>,
    profile_id: Option<String>,
    snapshot_revision: Option<u64>,
) -> Result<bool, String> {
    state.write_remote_data(|data| {
        Ok(service::merge_daily_snapshot(
            data,
            remote_completions,
            replace_snapshot.unwrap_or(false),
            profile_id.as_deref(),
            snapshot_revision,
        ))
    })
}

/// 将远端拉回的任务合并到本地 data.json（LWW 策略）。
/// 仅覆盖 updated_at 不低于本地的远端任务，防止离线重启后已同步删除的远端任务意外恢复。
/// 本地未同步的新任务不受影响。
#[tauri::command]
pub fn sync_local_tasks(
    state: tauri::State<AppState>,
    remote_tasks: Vec<crate::models::Task>,
) -> Result<(), String> {
    state.write_remote_data(|d| {
        for rt in &remote_tasks {
            if let Some(idx) = d.tasks.iter().position(|t| t.id == rt.id) {
                if rt.updated_at >= d.tasks[idx].updated_at {
                    d.tasks[idx] = rt.clone();
                }
            } else if !rt.is_deleted {
                d.tasks.push(rt.clone());
            }
        }
        Ok(())
    })
}

/// 从本地删除指定每日完成记录（Realtime DELETE 事件时调用）
#[tauri::command]
pub fn delete_daily_completion(
    state: tauri::State<AppState>,
    task_id: String,
    date: String,
) -> Result<(), String> {
    state.write_remote_data(|d| {
        if !crate::tasks::outbox::pending_daily(d, &task_id, &date) {
            d.daily_completions
                .retain(|dc| !(dc.task_id == task_id && dc.date == date));
        }
        Ok(())
    })
}
