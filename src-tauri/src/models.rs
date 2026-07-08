use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ═══════════════════════════════════════════════════════════════
//  核心数据模型
// ═══════════════════════════════════════════════════════════════

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
    /// 最后更新时间（ISO 8601），用于跨设备 LWW 合并
    #[serde(default)]
    pub updated_at: String,
    /// 软删除标记，true 表示已删除但保留用于同步传播
    #[serde(default)]
    pub is_deleted: bool,
    /// 所属同步 Profile，null 表示仅本地存储
    #[serde(default)]
    pub profile_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyCompletion {
    pub task_id: String,
    pub date: String,
    /// 所属同步 Profile，null 表示仅本地存储
    #[serde(default)]
    pub profile_id: Option<String>,
}

/// AI 供应商（支持 OpenAI 等）
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

// ═══════════════════════════════════════════════════════════════
//  存储容器（对应磁盘 JSON 文件）
// ═══════════════════════════════════════════════════════════════

/// 结构化任务数据（存储于 data.json）
#[derive(Debug, Serialize, Deserialize)]
pub struct DataStore {
    pub version: u32,
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub daily_completions: Vec<DailyCompletion>,
}

/// 同步状态（存储于 sync.json，独立于用户偏好配置）
#[derive(Debug, Serialize, Deserialize)]
pub struct SyncStore {
    /// 设备配对用的同步码
    #[serde(default)]
    pub sync_code: Option<String>,
    /// Supabase profile ID
    #[serde(default)]
    pub profile_id: Option<String>,
    /// 上次成功同步的时间戳
    #[serde(default)]
    pub last_sync_at: Option<String>,
}

/// 应用配置（存储于 config.json）
#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigStore {
    #[serde(default)]
    pub vendors: Vec<Vendor>,
    #[serde(default)]
    pub active_vendor_id: Option<String>,
    /// 主题模式："auto" | "light" | "dark"
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_reminder_minutes")]
    pub reminder_minutes: u32,
    /// 模块启用状态（key=AppModule id, value=enabled）
    /// 模块不在 map 中时默认启用
    #[serde(default)]
    pub module_enabled: std::collections::HashMap<String, bool>,
    /// 自定义笔记目录路径（绝对路径，None 时使用默认 ~/.todo-app/notes）
    #[serde(default)]
    pub notes_dir: Option<PathBuf>,
}

/// 旧版单文件格式（仅用于迁移）
#[derive(Debug, Deserialize)]
pub struct LegacyStore {
    #[serde(default)]
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub daily_completions: Vec<DailyCompletion>,
    #[serde(default)]
    pub vendors: Vec<Vendor>,
    #[serde(default)]
    pub active_vendor_id: Option<String>,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_reminder_minutes")]
    pub reminder_minutes: u32,
}

// ═══════════════════════════════════════════════════════════════
//  默认值
// ═══════════════════════════════════════════════════════════════

pub fn default_reminder_minutes() -> u32 {
    30
}

pub fn default_theme() -> String {
    "auto".to_string()
}

pub fn default_data_store() -> DataStore {
    DataStore {
        version: 1,
        tasks: vec![],
        daily_completions: vec![],
    }
}

pub fn default_config_store() -> ConfigStore {
    ConfigStore {
        vendors: vec![],
        active_vendor_id: None,
        theme: default_theme(),
        reminder_minutes: default_reminder_minutes(),
        module_enabled: std::collections::HashMap::new(),
        notes_dir: None,
    }
}

pub fn default_sync_store() -> SyncStore {
    SyncStore {
        sync_code: None,
        profile_id: None,
        last_sync_at: None,
    }
}
