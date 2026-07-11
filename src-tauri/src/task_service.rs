use serde::Deserialize;

use crate::store;

/// 新增任务的参数（同时作为 Tauri 命令的请求体）
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTaskInput {
    pub title: String,
    pub due_date: Option<String>,
    pub tags: Option<Vec<String>>,
    pub important: Option<bool>,
    pub pinned: Option<bool>,
    pub is_daily: Option<bool>,
    pub parent_id: Option<String>,
}

/// 更新任务的参数（同时作为 Tauri 命令的请求体）
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskInput {
    pub id: String,
    pub title: String,
    pub due_date: Option<String>,
    pub tags: Vec<String>,
    pub important: bool,
    pub pinned: bool,
    pub is_daily: bool,
}

/// 获取所有活跃任务（过滤已软删除）
pub fn list(data: &store::DataStore) -> Vec<store::Task> {
    data.tasks
        .iter()
        .filter(|t| !t.is_deleted)
        .cloned()
        .collect()
}

/// 获取所有任务（包含已软删除，供同步配对）
pub fn list_all(data: &store::DataStore) -> Vec<store::Task> {
    data.tasks.clone()
}

/// 按截止日期筛选任务
pub fn list_by_date(data: &store::DataStore, date: &str) -> Vec<store::Task> {
    data.tasks
        .iter()
        .filter(|t| t.due_date.as_deref() == Some(date))
        .cloned()
        .collect()
}

/// 获取所有标签（去重排序）
pub fn all_tags(data: &store::DataStore) -> Vec<String> {
    let mut tags: Vec<String> = data.tasks.iter().flat_map(|t| t.tags.clone()).collect();
    tags.sort();
    tags.dedup();
    tags
}

/// 获取指定日期已完成的每日任务 ID 列表
pub fn daily_completions(data: &store::DataStore, date: &str) -> Vec<String> {
    data.daily_completions
        .iter()
        .filter(|dc| dc.date == date)
        .map(|dc| dc.task_id.clone())
        .collect()
}

/// 新增任务
pub fn add(data: &mut store::DataStore, input: AddTaskInput) -> store::Task {
    let now = chrono::Utc::now().to_rfc3339();
    let task = store::Task {
        id: uuid::Uuid::new_v4().to_string(),
        title: input.title,
        completed: false,
        created_at: now.clone(),
        completed_at: None,
        due_date: input.due_date,
        tags: input.tags.unwrap_or_default(),
        important: input.important.unwrap_or(false),
        pinned: input.pinned.unwrap_or(false),
        is_daily: input.is_daily.unwrap_or(false),
        parent_id: input.parent_id,
        updated_at: now,
        is_deleted: false,
        profile_id: None,
    };
    data.tasks.push(task.clone());
    task
}

/// 切换任务完成状态（自动记录完成/取消时间）
pub fn toggle(data: &mut store::DataStore, id: &str) -> Option<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let task = data.tasks.iter_mut().find(|t| t.id == id)?;
    task.completed = !task.completed;
    task.completed_at = if task.completed {
        Some(now.clone())
    } else {
        None
    };
    task.updated_at = now;
    Some(())
}

/// 切换每日任务的完成状态（按日期记录，支持跨天追踪）
/// 同时同步更新 task.completed，确保 Supabase 的 tasks 表能感知完成状态变更
pub fn toggle_daily(data: &mut store::DataStore, id: &str, date: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(pos) = data
        .daily_completions
        .iter()
        .position(|dc| dc.task_id == id && dc.date == date)
    {
        // 取消完成：移除 daily_completion
        data.daily_completions.remove(pos);
        // 若该任务当天不再有完成记录，则设 completed = false
        let still_completed = data
            .daily_completions
            .iter()
            .any(|dc| dc.task_id == id && dc.date == date);
        if !still_completed {
            if let Some(task) = data.tasks.iter_mut().find(|t| t.id == id) {
                task.completed = false;
                task.completed_at = None;
                task.updated_at = now;
            }
        }
    } else {
        // 完成：添加 daily_completion
        data.daily_completions.push(store::DailyCompletion {
            task_id: id.to_string(),
            date: date.to_string(),
            profile_id: None,
        });
        // 同步更新 task.completed，使 Supabase tasks 表反映完成状态
        if let Some(task) = data.tasks.iter_mut().find(|t| t.id == id) {
            if !task.completed {
                task.completed = true;
                task.completed_at = Some(now.clone());
                task.updated_at = now;
            }
        }
    }
}

/// 更新任务的所有字段
pub fn update(data: &mut store::DataStore, input: UpdateTaskInput) -> Option<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let task = data.tasks.iter_mut().find(|t| t.id == input.id)?;
    task.title = input.title;
    task.due_date = input.due_date;
    task.tags = input.tags;
    task.important = input.important;
    task.pinned = input.pinned;
    task.is_daily = input.is_daily;
    task.updated_at = now;
    Some(())
}

/// 软删除任务（含级联子任务删除 + 清理孤儿 daily_completions）
pub fn delete(data: &mut store::DataStore, id: &str) -> Option<()> {
    let now = chrono::Utc::now().to_rfc3339();
    // 标记主任务
    let task = data.tasks.iter_mut().find(|t| t.id == id)?;
    task.is_deleted = true;
    task.updated_at = now.clone();
    // 级联软删除子任务
    for child in data
        .tasks
        .iter_mut()
        .filter(|t| t.parent_id.as_deref() == Some(id))
    {
        child.is_deleted = true;
        child.updated_at = now.clone();
    }
    // 清理孤儿 daily_completions
    data.daily_completions.retain(|dc| dc.task_id != id);
    Some(())
}

/// 一键软删除所有已完成任务
pub fn clear_completed(data: &mut store::DataStore) {
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
    for id in &completed_ids {
        data.daily_completions.retain(|dc| &dc.task_id != id);
    }
}

/// 删除指定标签（从所有任务中移除该标签）
pub fn delete_tag(data: &mut store::DataStore, tag: &str) {
    for task in data.tasks.iter_mut() {
        task.tags.retain(|t| t != tag);
    }
}
