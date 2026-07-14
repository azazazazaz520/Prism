use crate::{ai, store};
use crate::{with_ai_context, AppState};

/// 统一 AI 入口：根据 mode 路由处理
/// mode: "auto" | "add" | "summary" | "focus"
#[tauri::command]
pub async fn ai_execute(
    state: tauri::State<'_, AppState>,
    mode: String,
    input: String,
) -> Result<ai::AiExecuteResult, String> {
    let settings = state.with_config(crate::resolve_ai_settings)?;
    let (all_tasks, existing_tags, today_completed) = state.read_data(|data| {
        let all: Vec<store::Task> = data
            .tasks
            .iter()
            .filter(|t| !t.is_deleted)
            .cloned()
            .collect();
        let tags: Vec<String> = data
            .tasks
            .iter()
            .filter(|t| !t.is_deleted)
            .flat_map(|t| t.tags.clone())
            .collect();
        let today = chrono::Local::now().date_naive();
        let completed: Vec<store::Task> = data
            .tasks
            .iter()
            .filter(|t| {
                t.completed
                    && !t.is_deleted
                    && t.completed_at.as_deref().is_some_and(|d| {
                        chrono::DateTime::parse_from_rfc3339(d)
                            .map(|dt| dt.with_timezone(&chrono::Local).date_naive() == today)
                            .unwrap_or(false)
                    })
            })
            .cloned()
            .collect();
        (all, tags, completed)
    });
    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    ai::execute(
        &settings,
        &mode,
        &input,
        &all_tasks,
        &existing_tags,
        &today_completed,
        &today_str,
    )
    .await
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
            .filter(|t| {
                !t.completed
                    && !t.is_deleted
                    && t.due_date.as_deref().is_some_and(|d| d < today.as_str())
            })
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
        let tasks: Vec<store::Task> = data
            .tasks
            .iter()
            .filter(|t| !t.is_deleted)
            .cloned()
            .collect();
        Ok((settings.clone(), tasks))
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
