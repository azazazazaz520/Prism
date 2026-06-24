use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub completed: bool,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub due_date: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub important: bool,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub is_daily: bool,
    /// 父任务 ID，拆解产生的子任务指向其父任务
    #[serde(default)]
    pub parent_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyCompletion {
    pub task_id: String,
    pub date: String,
}

fn default_reminder_minutes() -> u32 {
    30
}

fn default_ai_settings() -> AiSettings {
    AiSettings {
        enabled: false,
        api_endpoint: String::new(),
        api_key: String::new(),
        model: "gpt-4o-mini".to_string(),
    }
}

/// AI 服务配置（持久化到 tasks.json）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiSettings {
    /// 是否启用 AI 功能
    pub enabled: bool,
    /// OpenAI 兼容 API 端点地址
    pub api_endpoint: String,
    /// API 密钥
    pub api_key: String,
    /// 使用的模型名称
    pub model: String,
}

/// AI 供应商（支持OpenAI等）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Vendor {
    pub id: String,
    /// 显示名称
    pub name: String,
    /// 供应商类型
    pub provider: String,
    /// API 密钥
    pub api_key: String,
    /// API 基础地址
    pub base_url: String,
    /// API 路径
    pub api_path: String,
    /// 模型名称
    pub model: String,
    /// 是否启用
    pub enabled: bool,
    /// 是否为默认供应商
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskStore {
    pub version: u32,
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub daily_completions: Vec<DailyCompletion>,
    #[serde(default = "default_reminder_minutes")]
    pub reminder_minutes: u32,
    /// AI 服务配置（兼容旧版，新逻辑优先用 vendors）
    #[serde(default = "default_ai_settings")]
    pub ai_settings: AiSettings,
    /// AI 供应商列表
    #[serde(default)]
    pub vendors: Vec<Vendor>,
    /// 当前激活的供应商 ID（None 表示用 ai_settings 或第一个启用的供应商）
    #[serde(default)]
    pub active_vendor_id: Option<String>,
}

fn get_store_path() -> PathBuf {
    let mut path = dirs::home_dir().unwrap_or_default();
    path.push(".todo-app");
    fs::create_dir_all(&path).ok();
    path.push("tasks.json");
    path
}

pub fn load_tasks() -> TaskStore {
    let path = get_store_path();
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| TaskStore {
            version: 1,
            tasks: vec![],
            daily_completions: vec![],
            reminder_minutes: 30,
            ai_settings: default_ai_settings(),
            vendors: vec![],
            active_vendor_id: None,
        }),
        Err(_) => TaskStore {
            version: 1,
            tasks: vec![],
            daily_completions: vec![],
            reminder_minutes: 30,
            ai_settings: default_ai_settings(),
            vendors: vec![],
            active_vendor_id: None,
        },
    }
}

pub fn save_tasks(store: &TaskStore) -> Result<(), String> {
    let path = get_store_path();
    let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_store_has_no_tasks() {
        let store = TaskStore {
            version: 1,
            tasks: vec![],
            daily_completions: vec![],
            reminder_minutes: 30,
            ai_settings: default_ai_settings(),
            vendors: vec![],
            active_vendor_id: None,
        };
        assert_eq!(store.tasks.len(), 0);
    }

    #[test]
    fn test_task_serialization() {
        let task = Task {
            id: "test-id".to_string(),
            title: "测试任务".to_string(),
            completed: false,
            created_at: "2026-05-17T00:00:00+08:00".to_string(),
            completed_at: None,
            due_date: Some("2026-05-21".to_string()),
            tags: vec![],
            important: false,
            pinned: false,
            is_daily: false,
            parent_id: None,
        };
        let json = serde_json::to_string(&task).unwrap();
        let parsed: Task = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.title, "测试任务");
        assert!(!parsed.completed);
        assert!(parsed.completed_at.is_none());
        assert_eq!(parsed.due_date, Some("2026-05-21".to_string()));
    }
}
