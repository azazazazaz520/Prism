use super::{with_ai_context, AppState};
use crate::{ai, store};

/// 自然语言解析输入
#[tauri::command]
pub async fn ai_parse_input(
    state: tauri::State<'_, AppState>,
    text: String,
) -> Result<ai::ParsedTask, String> {
    let (settings, existing_tags) = with_ai_context(&state, |settings, data| {
        let existing_tags: Vec<String> = data.tasks.iter().flat_map(|t| t.tags.clone()).collect();
        Ok((settings.clone(), existing_tags))
    })?;
    ai::parse_input(&settings, &text, &existing_tags).await
}

/// 聊天记录批量任务提取
#[tauri::command]
pub async fn ai_parse_wechat(
    state: tauri::State<'_, AppState>,
    text: String,
) -> Result<Vec<ai::ParsedTask>, String> {
    let (settings, existing_tags) = with_ai_context(&state, |settings, data| {
        let existing_tags: Vec<String> = data.tasks.iter().flat_map(|t| t.tags.clone()).collect();
        Ok((settings.clone(), existing_tags))
    })?;
    ai::parse_wechat(&settings, &text, &existing_tags).await
}

/// 今日聚焦建议
#[tauri::command]
pub async fn ai_daily_focus(
    state: tauri::State<'_, AppState>,
) -> Result<ai::FocusSuggestion, String> {
    let (settings, tasks) = with_ai_context(&state, |settings, data| {
        Ok((settings.clone(), data.tasks.clone()))
    })?;
    ai::daily_focus(&settings, &tasks).await
}

/// 任务智能拆解
#[tauri::command]
pub async fn ai_decompose(
    state: tauri::State<'_, AppState>,
    task_id: String,
) -> Result<Vec<ai::SubTask>, String> {
    let (settings, task_title, existing_subtasks) = with_ai_context(&state, |settings, data| {
        let task_title = data
            .tasks
            .iter()
            .find(|t| t.id == task_id)
            .map(|t| t.title.clone())
            .ok_or("任务不存在".to_string())?;
        let existing_subtasks: Vec<String> = data
            .tasks
            .iter()
            .filter(|t| t.parent_id.as_deref() == Some(&task_id))
            .map(|t| t.title.clone())
            .collect();
        Ok((settings.clone(), task_title, existing_subtasks))
    })?;
    ai::decompose(&settings, &task_title, &existing_subtasks).await
}

/// 过期任务处理建议
#[tauri::command]
pub async fn ai_overdue_suggest(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ai::OverdueSuggestion>, String> {
    let (settings, overdue) = with_ai_context(&state, |settings, data| {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let overdue: Vec<store::Task> = data
            .tasks
            .iter()
            .filter(|t| !t.completed && t.due_date.as_deref().is_some_and(|d| d < today.as_str()))
            .cloned()
            .collect();
        Ok((settings.clone(), overdue))
    })?;
    ai::overdue_suggest(&settings, &overdue).await
}

/// AI 助手自由对话
#[tauri::command]
pub async fn ai_chat(state: tauri::State<'_, AppState>, message: String) -> Result<String, String> {
    let (settings, tasks) = with_ai_context(&state, |settings, data| {
        Ok((settings.clone(), data.tasks.clone()))
    })?;
    ai::chat(&settings, &message, &tasks).await
}

/// AI 解释 JSON 结构
#[tauri::command]
pub async fn ai_json_explain(
    state: tauri::State<'_, AppState>,
    json_text: String,
) -> Result<String, String> {
    let settings = with_ai_context(&state, |settings, _data| Ok(settings.clone()))?;
    ai::json_explain(&settings, &json_text).await
}

/// AI 生成正则表达式
#[tauri::command]
pub async fn ai_regex_generate(
    state: tauri::State<'_, AppState>,
    description: String,
) -> Result<String, String> {
    let settings = with_ai_context(&state, |settings, _data| Ok(settings.clone()))?;
    ai::regex_generate(&settings, &description).await
}
