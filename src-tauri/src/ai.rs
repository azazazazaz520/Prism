use serde::{Deserialize, Serialize};

use crate::store;

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
    settings: &store::AiSettings,
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

// ═══════════════════════════════════════════════════════════════
//  功能 1：自然语言快速录入
// ═══════════════════════════════════════════════════════════════

pub async fn parse_input(
    settings: &store::AiSettings,
    text: &str,
    existing_tags: &[String],
) -> Result<ParsedTask, String> {
    let tags_hint = if existing_tags.is_empty() {
        "无已有标签".to_string()
    } else {
        format!("已有标签: {}", existing_tags.join(", "))
    };

    let system_prompt = format!(
        "你是一个 TODO 应用的任务解析助手。用户会用自然语言描述一个待办事项，\
         你需要将其解析为结构化的任务。\n\n\
         规则：\n\
         - title: 去除时间/标签/标记后的纯任务描述\n\
         - due_date: 从\"明天/周五/下周一/5月20日\"等表达中提取，格式 YYYY-MM-DD。\
         如果没有截止日期则为 null。今天的日期请根据用户消息中的上下文推断。\n\
         - tags: 从 #标签 格式中提取标签名列表\n\
         - important: 出现\"重要/紧急/!\"标记时为 true\n\
         - pinned: 出现\"置顶/📌\"标记时为 true\n\
         - is_daily: 出现\"每日/每天/日常\"时为 true\n\n\
         {}\n\n\
         请**只**返回一个 JSON 对象，不要包含其他文字。格式示例：\n\
         {{\"title\":\"提交报告\",\"due_date\":\"2026-06-27\",\"tags\":[\"工作\"],\"important\":true,\"pinned\":false,\"is_daily\":false}}",
        tags_hint
    );

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
    settings: &store::AiSettings,
    tasks: &[store::Task],
) -> Result<FocusSuggestion, String> {
    // 仅发送未完成任务摘要（保护隐私）
    let task_summaries: Vec<String> = tasks
        .iter()
        .filter(|t| !t.completed)
        .map(|t| {
            format!(
                "id={}, title=\"{}\", due={}, tags=[{}], important={}",
                t.id,
                t.title,
                t.due_date.as_deref().unwrap_or("无"),
                t.tags.join(","),
                t.important
            )
        })
        .collect();

    if task_summaries.is_empty() {
        return Ok(FocusSuggestion {
            items: vec![],
            summary: "当前没有待办任务，享受清闲时光 ☀️".into(),
        });
    }

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let system_prompt = format!(
        "你是一个 TODO 应用的智能排序助手。根据以下未完成任务列表，\
         综合考虑截止日期紧迫度、重要性标记、任务描述中的关键词，\
         推荐今天应优先处理的 3-5 项任务，并给出简短理由。\n\n\
         今天是 {}。\n\n\
         请**只**返回一个 JSON 对象，格式如下（不要包含其他文字）：\n\
         {{\"items\":[{{\"task_id\":\"...\",\"reason\":\"明天到期且标记重要\"}}],\
         \"summary\":\"一句话总结今日任务概况\"}}",
        today
    );

    let response = chat_completion(settings, &system_prompt, &task_summaries.join("\n")).await?;
    let json_str = extract_json(&response)?;

    serde_json::from_str::<FocusSuggestion>(&json_str)
        .map_err(|e| format!("AI 返回格式异常: {}。原文: {}", e, response))
}

// ═══════════════════════════════════════════════════════════════
//  功能 3：任务智能拆解
// ═══════════════════════════════════════════════════════════════

pub async fn decompose(
    settings: &store::AiSettings,
    task_title: &str,
    existing_subtasks: &[String],
) -> Result<Vec<SubTask>, String> {
    let subtask_hint = if existing_subtasks.is_empty() {
        String::new()
    } else {
        format!("\n已有的子任务（不要重复）：\n{}", existing_subtasks.join("\n"))
    };

    let system_prompt = format!(
        "你是一个任务管理助手。把一个抽象的大任务拆解成 3-5 个具体可执行的小步骤。\
         每个步骤应该是有明确完成标准的具体动作。{}\n\n\
         请**只**返回一个 JSON 数组，格式如下（不要包含其他文字）：\n\
         [{{\"title\":\"...\",\"estimated_minutes\":30}}, ...]\n\
         estimated_minutes 为估计耗时（分钟），可为 null。",
        subtask_hint
    );

    let response = chat_completion(settings, &system_prompt, task_title).await?;
    let json_str = extract_json(&response)?;

    serde_json::from_str::<Vec<SubTask>>(&json_str)
        .map_err(|e| format!("AI 返回格式异常: {}。原文: {}", e, response))
}

// ═══════════════════════════════════════════════════════════════
//  功能 4：过期任务智能处理建议
// ═══════════════════════════════════════════════════════════════

pub async fn overdue_suggest(
    settings: &store::AiSettings,
    overdue_tasks: &[store::Task],
) -> Result<Vec<OverdueSuggestion>, String> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    // 构建过期任务摘要
    let task_infos: Vec<String> = overdue_tasks
        .iter()
        .map(|t| {
            format!(
                "id={}, title=\"{}\", due={}, tags=[{}], important={}",
                t.id,
                t.title,
                t.due_date.as_deref().unwrap_or("无"),
                t.tags.join(","),
                t.important
            )
        })
        .collect();

    if task_infos.is_empty() {
        return Ok(vec![]);
    }

    let system_prompt = format!(
        "你是一个任务管理助手。以下任务已过期（当前日期 {}），请对每个任务给出处理建议。\n\n\
         action 取值：\n\
         - \"reschedule\": 重新安排到新日期（给出 new_date）\n\
         - \"abandon\": 建议放弃（任务可能不再需要）\n\
         - \"decompose\": 任务太大需要拆解为子任务\n\n\
         请**只**返回一个 JSON 数组，格式如下（不要包含其他文字）：\n\
         [{{\"task_id\":\"...\",\"action\":\"reschedule\",\"new_date\":\"2026-07-01\",\"reason\":\"...\"}}, ...]\n\
         new_date 仅在 action 为 reschedule 时需要，其他情况为 null。",
        today
    );

    let response = chat_completion(settings, &system_prompt, &task_infos.join("\n")).await?;
    let json_str = extract_json(&response)?;

    serde_json::from_str::<Vec<OverdueSuggestion>>(&json_str)
        .map_err(|e| format!("AI 返回格式异常: {}。原文: {}", e, response))
}

// ═══════════════════════════════════════════════════════════════
//  功能 5：AI 助手自由对话
// ═══════════════════════════════════════════════════════════════

pub async fn chat(
    settings: &store::AiSettings,
    message: &str,
    tasks: &[store::Task],
) -> Result<String, String> {
    // 构建任务上下文（仅摘要，保护隐私）
    let pending: Vec<String> = tasks
        .iter()
        .filter(|t| !t.completed)
        .map(|t| {
            let due = t.due_date.as_deref().unwrap_or("无");
            format!("- [{}] {} (截止:{})", if t.important { "!" } else { " " }, t.title, due)
        })
        .collect();

    let context = if pending.is_empty() {
        "当前没有待办任务。".to_string()
    } else {
        format!("当前待办任务：\n{}", pending.join("\n"))
    };

    let system_prompt = format!(
        "你是一个 TODO 应用的 AI 助手，帮助用户管理任务。你可以：\n\
         - 分析任务优先级\n\
         - 建议任务排序\n\
         - 帮助拆解复杂任务\n\
         - 回答关于任务管理的问题\n\n\
         以下是用户当前的任务数据（仅标题和截止日期）：\n{}",
        context
    );

    chat_completion(settings, &system_prompt, message).await
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
