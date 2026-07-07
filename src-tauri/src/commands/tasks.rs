use super::{AddTaskArgs, AppState, UpdateTaskArgs};
use crate::store;
use crate::task_service::{AddTaskInput, TaskService, UpdateTaskInput};

/// 获取所有任务列表（过滤已软删除）
#[tauri::command]
pub fn get_tasks(state: tauri::State<AppState>) -> Vec<store::Task> {
    let data = state.data.lock().unwrap();
    TaskService::list(&data)
}

/// 获取所有任务列表（包含已软删除，供同步配对时批量推送）
#[tauri::command]
pub fn get_all_tasks_including_deleted(state: tauri::State<AppState>) -> Vec<store::Task> {
    let data = state.data.lock().unwrap();
    TaskService::list_all(&data)
}

/// 新增任务
#[tauri::command]
pub fn add_task(state: tauri::State<AppState>, args: AddTaskArgs) -> Result<store::Task, String> {
    let mut data = state.data.lock().unwrap();
    let task = TaskService::add(
        &mut data,
        AddTaskInput {
            title: args.title,
            due_date: args.due_date,
            tags: args.tags,
            important: args.important,
            pinned: args.pinned,
            is_daily: args.is_daily,
            parent_id: args.parent_id,
        },
    );
    store::save_data(&data)?;
    Ok(task)
}

/// 切换任务完成状态（自动记录完成/取消时间）
#[tauri::command]
pub fn toggle_task(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    TaskService::toggle(&mut data, &id);
    store::save_data(&data)
}

/// 切换每日任务的完成状态（按日期记录，支持跨天追踪）
#[tauri::command]
pub fn toggle_daily_task(
    state: tauri::State<AppState>,
    id: String,
    date: String,
) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    TaskService::toggle_daily(&mut data, &id, &date);
    store::save_data(&data)
}

/// 更新任务的所有字段
#[tauri::command]
pub fn update_task(state: tauri::State<AppState>, args: UpdateTaskArgs) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    TaskService::update(
        &mut data,
        UpdateTaskInput {
            id: args.id,
            title: args.title,
            due_date: args.due_date,
            tags: args.tags,
            important: args.important,
            pinned: args.pinned,
            is_daily: args.is_daily,
        },
    );
    store::save_data(&data)
}

/// 软删除指定任务（标记 is_deleted = true，保留数据用于同步传播）
#[tauri::command]
pub fn delete_task(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    TaskService::delete(&mut data, &id);
    store::save_data(&data)
}

/// 一键软删除所有已完成任务
#[tauri::command]
pub fn clear_completed(state: tauri::State<AppState>) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    TaskService::clear_completed(&mut data);
    store::save_data(&data)
}

/// 按截止日期筛选任务
#[tauri::command]
pub fn get_tasks_by_date(state: tauri::State<AppState>, date: String) -> Vec<store::Task> {
    let data = state.data.lock().unwrap();
    TaskService::list_by_date(&data, &date)
}

/// 获取所有标签（去重排序）
#[tauri::command]
pub fn get_all_tags(state: tauri::State<AppState>) -> Vec<String> {
    let data = state.data.lock().unwrap();
    TaskService::all_tags(&data)
}

/// 删除指定标签（从所有任务中移除该标签）
#[tauri::command]
pub fn delete_tag(state: tauri::State<AppState>, tag: String) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    TaskService::delete_tag(&mut data, &tag);
    store::save_data(&data)
}

/// 获取指定日期已完成的每日任务 ID 列表
#[tauri::command]
pub fn get_daily_completions(state: tauri::State<AppState>, date: String) -> Vec<String> {
    let data = state.data.lock().unwrap();
    TaskService::daily_completions(&data, &date)
}

/// 合并远端每日完成记录到本地（双向 LWW 合并）
/// 参数 `remote_completions` 为远端的所有 daily_completions 记录
#[tauri::command]
pub fn sync_remote_daily_completions(
    state: tauri::State<AppState>,
    remote_completions: Vec<store::DailyCompletion>,
) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    for remote in remote_completions {
        let exists = data
            .daily_completions
            .iter()
            .any(|dc| dc.task_id == remote.task_id && dc.date == remote.date);
        if !exists {
            data.daily_completions.push(remote);
        }
    }
    store::save_data(&data)
}

/// 从本地删除指定每日完成记录（Realtime DELETE 事件时调用）
#[tauri::command]
pub fn delete_daily_completion(
    state: tauri::State<AppState>,
    task_id: String,
    date: String,
) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    data.daily_completions
        .retain(|dc| !(dc.task_id == task_id && dc.date == date));
    store::save_data(&data)
}
