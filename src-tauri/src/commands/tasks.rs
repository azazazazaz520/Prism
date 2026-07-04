use super::{AddTaskArgs, AppState, UpdateTaskArgs};
use crate::store;

/// 获取所有任务列表（过滤已软删除）
#[tauri::command]
pub fn get_tasks(state: tauri::State<AppState>) -> Vec<store::Task> {
    state
        .data
        .lock()
        .unwrap()
        .tasks
        .iter()
        .filter(|t| !t.is_deleted)
        .cloned()
        .collect()
}

/// 新增任务
#[tauri::command]
pub fn add_task(state: tauri::State<AppState>, args: AddTaskArgs) -> Result<store::Task, String> {
    let mut data = state.data.lock().unwrap();
    let now = chrono::Utc::now().to_rfc3339();
    let task = store::Task {
        id: uuid::Uuid::new_v4().to_string(),
        title: args.title,
        completed: false,
        created_at: now.clone(),
        completed_at: None,
        due_date: args.due_date,
        tags: args.tags.unwrap_or_default(),
        important: args.important.unwrap_or(false),
        pinned: args.pinned.unwrap_or(false),
        is_daily: args.is_daily.unwrap_or(false),
        parent_id: args.parent_id,
        updated_at: now,
        is_deleted: false,
        profile_id: None,
    };
    data.tasks.push(task.clone());
    store::save_data(&data)?;
    Ok(task)
}

/// 切换任务完成状态（自动记录完成/取消时间）
#[tauri::command]
pub fn toggle_task(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(task) = data.tasks.iter_mut().find(|t| t.id == id) {
        task.completed = !task.completed;
        task.completed_at = if task.completed { Some(now.clone()) } else { None };
        task.updated_at = now;
    }
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
    if let Some(pos) = data
        .daily_completions
        .iter()
        .position(|dc| dc.task_id == id && dc.date == date)
    {
        data.daily_completions.remove(pos);
    } else {
        data.daily_completions
            .push(store::DailyCompletion { task_id: id, date, profile_id: None });
    }
    store::save_data(&data)
}

/// 更新任务的所有字段
#[tauri::command]
pub fn update_task(state: tauri::State<AppState>, args: UpdateTaskArgs) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(task) = data.tasks.iter_mut().find(|t| t.id == args.id) {
        task.title = args.title;
        task.due_date = args.due_date;
        task.tags = args.tags;
        task.important = args.important;
        task.pinned = args.pinned;
        task.is_daily = args.is_daily;
        task.updated_at = now;
    }
    store::save_data(&data)
}

/// 软删除指定任务（标记 is_deleted = true，保留数据用于同步传播）
#[tauri::command]
pub fn delete_task(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(task) = data.tasks.iter_mut().find(|t| t.id == id) {
        task.is_deleted = true;
        task.updated_at = now.clone();
    }
    // 级联软删除子任务（parent_id 指向被删任务的）
    for child in data.tasks.iter_mut().filter(|t| t.parent_id.as_deref() == Some(&id)) {
        child.is_deleted = true;
        child.updated_at = now.clone();
    }
    // 清理孤儿 daily_completions
    data.daily_completions.retain(|dc| dc.task_id != id);
    store::save_data(&data)
}

/// 一键软删除所有已完成任务
#[tauri::command]
pub fn clear_completed(state: tauri::State<AppState>) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    let now = chrono::Utc::now().to_rfc3339();
    let completed_ids: Vec<String> = data
        .tasks
        .iter()
        .filter(|t| t.completed && !t.is_deleted)
        .map(|t| t.id.clone())
        .collect();
    for task in data.tasks.iter_mut() {
        if task.completed && !task.is_deleted {
            task.is_deleted = true;
            task.updated_at = now.clone();
        }
    }
    // 清理已软删除任务的 daily_completions
    for id in &completed_ids {
        data.daily_completions.retain(|dc| &dc.task_id != id);
    }
    store::save_data(&data)
}

/// 按截止日期筛选任务
#[tauri::command]
pub fn get_tasks_by_date(state: tauri::State<AppState>, date: String) -> Vec<store::Task> {
    state
        .data
        .lock()
        .unwrap()
        .tasks
        .iter()
        .filter(|t| t.due_date.as_deref() == Some(&date))
        .cloned()
        .collect()
}

/// 获取所有标签（去重排序）
#[tauri::command]
pub fn get_all_tags(state: tauri::State<AppState>) -> Vec<String> {
    let data = state.data.lock().unwrap();
    let mut tags: Vec<String> = data.tasks.iter().flat_map(|t| t.tags.clone()).collect();
    tags.sort();
    tags.dedup();
    tags
}

/// 删除指定标签（从所有任务中移除该标签）
#[tauri::command]
pub fn delete_tag(state: tauri::State<AppState>, tag: String) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    for task in data.tasks.iter_mut() {
        task.tags.retain(|t| t != &tag);
    }
    store::save_data(&data)
}

/// 获取指定日期已完成的每日任务 ID 列表
#[tauri::command]
pub fn get_daily_completions(state: tauri::State<AppState>, date: String) -> Vec<String> {
    state
        .data
        .lock()
        .unwrap()
        .daily_completions
        .iter()
        .filter(|dc| dc.date == date)
        .map(|dc| dc.task_id.clone())
        .collect()
}
