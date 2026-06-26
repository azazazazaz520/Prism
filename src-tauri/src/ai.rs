use serde::{Deserialize, Serialize};

use crate::prompt;
use crate::store;

/// AI 调用所需的配置（从供应商解析而来）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiSettings {
    pub enabled: bool,
    pub api_endpoint: String,
    pub api_key: String,
    pub model: String,
}

// ═══════════════════════════════════════════════════════════════
//  LLM 响应解析用结构体
// ═══════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

// ═══════════════════════════════════════════════════════════════
//  各 AI 功能的输出结构体（与前端 types.ts 对齐）
// ═══════════════════════════════════════════════════════════════

#[derive(Debug, Serialize, Deserialize)]
pub struct ParsedTask {
    pub title: String,
    pub due_date: Option<String>,
    pub tags: Vec<String>,
    pub important: bool,
    pub pinned: bool,
    pub is_daily: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FocusItem {
    pub task_id: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FocusSuggestion {
    pub items: Vec<FocusItem>,
    pub summary: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SubTask {
    pub title: String,
    pub estimated_minutes: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OverdueSuggestion {
    pub task_id: String,
    pub action: String, // "reschedule" | "abandon" | "decompose"
    pub new_date: Option<String>,
    pub reason: String,
}

// ═══════════════════════════════════════════════════════════════
//  核心：通用 LLM 调用
// ═══════════════════════════════════════════════════════════════

/// 向 OpenAI 兼容 API 发送一次聊天完成请求，返回 LLM 文本回复。
async fn chat_completion(
    settings: &AiSettings,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    let api_endpoint = settings.api_endpoint.trim();
    let api_key = settings.api_key.trim();

    if api_endpoint.is_empty() || api_key.is_empty() {
        return Err("AI 未配置：请在设置中填写 API 端点和密钥".into());
    }

    let url = format!("{}/chat/completions", api_endpoint.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": settings.model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_message }
        ],
        "temperature": 0.3,
        "max_tokens": 1024
    });

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API 请求失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_body = resp.text().await.unwrap_or_default();
        return Err(format!("API 返回错误 ({}): {}", status, err_body));
    }

    let json: ChatResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析 API 响应失败: {}", e))?;

    json.choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| "API 返回空响应".into())
}

/// 从 LLM 文本中提取 JSON 对象（容错：允许 markdown 代码块包裹）
fn extract_json(text: &str) -> Result<String, String> {
    let trimmed = text.trim();

    // 尝试去除 ```json ... ``` 包裹
    if let Some(inner) = trimmed
        .strip_prefix("```json")
        .and_then(|s| s.strip_suffix("```"))
    {
        return Ok(inner.trim().to_string());
    }
    if let Some(inner) = trimmed
        .strip_prefix("```")
        .and_then(|s| s.strip_suffix("```"))
    {
        return Ok(inner.trim().to_string());
    }

    // 直接使用原始文本（可能已经是裸 JSON）
    Ok(trimmed.to_string())
}

/// 将任务序列化为安全的 JSON 字符串（防止注入）
fn task_to_summary(t: &store::Task) -> String {
    serde_json::json!({
        "id": t.id,
        "title": t.title,
        "due": t.due_date,
        "tags": t.tags,
        "important": t.important,
        "is_daily": t.is_daily,
    })
    .to_string()
}

// ═══════════════════════════════════════════════════════════════
//  功能 1：自然语言快速录入
// ═══════════════════════════════════════════════════════════════

pub async fn parse_input(
    settings: &AiSettings,
    text: &str,
    existing_tags: &[String],
) -> Result<ParsedTask, String> {
    let tags_hint = if existing_tags.is_empty() {
        "无已有标签".to_string()
    } else {
        format!("已有标签: {}", existing_tags.join(", "))
    };

    let system_prompt = prompt::load(prompt::PARSE_INPUT, &[("tags_hint", &tags_hint)]);
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let user_message = format!("今天是 {}。用户输入：{}", today, text);

    let response = chat_completion(settings, &system_prompt, &user_message).await?;
    let json_str = extract_json(&response)?;

    serde_json::from_str::<ParsedTask>(&json_str)
        .map_err(|e| format!("AI 返回格式异常: {}。原文: {}", e, response))
}

// ═══════════════════════════════════════════════════════════════
//  功能 2：智能今日聚焦
// ═══════════════════════════════════════════════════════════════

pub async fn daily_focus(
    settings: &AiSettings,
    tasks: &[store::Task],
) -> Result<FocusSuggestion, String> {
    // 仅发送未完成任务摘要（保护隐私）
    let task_summaries: Vec<String> = tasks
        .iter()
        .filter(|t| !t.completed)
        .map(task_to_summary)
        .collect();

    if task_summaries.is_empty() {
        return Ok(FocusSuggestion {
            items: vec![],
            summary: "当前没有待办任务，享受清闲时光 ☀️".into(),
        });
    }

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let system_prompt = prompt::load(prompt::DAILY_FOCUS, &[("today", &today)]);

    let response = chat_completion(settings, &system_prompt, &task_summaries.join("\n")).await?;
    let json_str = extract_json(&response)?;

    serde_json::from_str::<FocusSuggestion>(&json_str)
        .map_err(|e| format!("AI 返回格式异常: {}。原文: {}", e, response))
}

// ═══════════════════════════════════════════════════════════════
//  功能 3：任务智能拆解
// ═══════════════════════════════════════════════════════════════

pub async fn decompose(
    settings: &AiSettings,
    task_title: &str,
    existing_subtasks: &[String],
) -> Result<Vec<SubTask>, String> {
    let subtask_hint = if existing_subtasks.is_empty() {
        String::new()
    } else {
        format!(
            "\n已有的子任务（不要重复）：\n{}",
            existing_subtasks.join("\n")
        )
    };

    let system_prompt = prompt::load(prompt::DECOMPOSE, &[("subtask_hint", &subtask_hint)]);

    let response = chat_completion(settings, &system_prompt, task_title).await?;
    let json_str = extract_json(&response)?;

    serde_json::from_str::<Vec<SubTask>>(&json_str)
        .map_err(|e| format!("AI 返回格式异常: {}。原文: {}", e, response))
}

// ═══════════════════════════════════════════════════════════════
//  功能 4：过期任务智能处理建议
// ═══════════════════════════════════════════════════════════════

pub async fn overdue_suggest(
    settings: &AiSettings,
    overdue_tasks: &[store::Task],
) -> Result<Vec<OverdueSuggestion>, String> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    // 构建过期任务摘要
    let task_infos: Vec<String> = overdue_tasks.iter().map(task_to_summary).collect();

    if task_infos.is_empty() {
        return Ok(vec![]);
    }

    let system_prompt = prompt::load(prompt::OVERDUE_SUGGEST, &[("today", &today)]);

    let response = chat_completion(settings, &system_prompt, &task_infos.join("\n")).await?;
    let json_str = extract_json(&response)?;

    serde_json::from_str::<Vec<OverdueSuggestion>>(&json_str)
        .map_err(|e| format!("AI 返回格式异常: {}。原文: {}", e, response))
}

// ═══════════════════════════════════════════════════════════════
//  功能 5：AI 助手自由对话
// ═══════════════════════════════════════════════════════════════

pub async fn chat(
    settings: &AiSettings,
    message: &str,
    tasks: &[store::Task],
) -> Result<String, String> {
    // 构建任务上下文（仅摘要，保护隐私）
    let pending: Vec<String> = tasks
        .iter()
        .filter(|t| !t.completed)
        .map(|t| {
            serde_json::json!({
                "title": t.title,
                "due": t.due_date,
                "important": t.important,
            })
            .to_string()
        })
        .collect();

    let context = if pending.is_empty() {
        "当前没有待办任务。".to_string()
    } else {
        format!("当前待办任务：\n{}", pending.join("\n"))
    };

    let system_prompt = prompt::load(prompt::CHAT, &[("context", &context)]);

    chat_completion(settings, &system_prompt, message).await
}

// ═══════════════════════════════════════════════════════════════
//  功能 6：JSON 结构解释
// ═══════════════════════════════════════════════════════════════

pub async fn json_explain(settings: &AiSettings, json_text: &str) -> Result<String, String> {
    let system_prompt = prompt::load(prompt::JSON_EXPLAIN, &[]);
    chat_completion(settings, &system_prompt, json_text).await
}

// ═══════════════════════════════════════════════════════════════
//  功能 7：正则表达式 AI 生成
// ═══════════════════════════════════════════════════════════════

pub async fn regex_generate(settings: &AiSettings, description: &str) -> Result<String, String> {
    let system_prompt = prompt::load(prompt::REGEX_GENERATE, &[]);
    chat_completion(settings, &system_prompt, description).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_json_plain() {
        let result = extract_json(r#"{"title":"test"}"#).unwrap();
        assert_eq!(result, r#"{"title":"test"}"#);
    }

    #[test]
    fn test_extract_json_with_markdown() {
        let result = extract_json("```json\n{\"title\":\"test\"}\n```").unwrap();
        assert_eq!(result, r#"{"title":"test"}"#);
    }

    #[test]
    fn test_extract_json_with_plain_markdown() {
        let result = extract_json("```\n{\"title\":\"test\"}\n```").unwrap();
        assert_eq!(result, r#"{"title":"test"}"#);
    }

    #[test]
    fn test_empty_focus_on_no_tasks() {
        let suggestion = FocusSuggestion {
            items: vec![],
            summary: "当前没有待办任务".into(),
        };
        assert!(suggestion.items.is_empty());
    }
}
