use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Windows 版本更新清单（静态 JSON 文件格式）
///
/// 由 CD 流程在发布时自动生成，包含最新版本号、下载地址、哈希校验等信息。
/// 客户端请求此文件即可获知是否有新版本，避免直接访问 GitHub REST API。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowsUpdateManifest {
    /// 最新版本号，不含 `v` 前缀
    pub version: String,
    /// ISO 8601 发布时间
    pub release_date: String,
    /// 更新说明（Markdown 格式）
    pub release_notes: String,
    /// Windows 安装包 HTTPS 下载地址
    pub download_url: String,
    /// GitHub Release 页面地址
    pub release_url: String,
    /// 安装包 SHA-256（自动安装阶段使用，当前可为 null）
    #[serde(default)]
    pub sha256: Option<String>,
}

// ═══════════════════════════════════════════════════════════════
//  核心数据模型
// ═══════════════════════════════════════════════════════════════

/// 任务条目，支持软删除、标签、每日重复、父子拆解。
/// updated_at 用于跨设备 LWW 合并，is_deleted 保留用于同步传播。
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
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

/// 每日任务完成记录，按 (task_id, date) 追踪每日重复任务的完成状态。
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
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
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct DataStore {
    pub version: u32,
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub daily_completions: Vec<DailyCompletion>,
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub outbox: Vec<OutboxItem>,
    #[serde(default)]
    pub outbox_sequence: u64,
    #[serde(default)]
    pub legacy_queue_imported: bool,
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

/// 插件持久化配置，包含启用状态和权限列表。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginConfig {
    pub enabled: bool,
    #[serde(default)]
    pub permissions: Vec<String>,
}

/// 应用配置（存储于 config.json），包含供应商、主题、提醒、模块开关、
/// 笔记目录、仪表盘布局、插件配置等全部用户偏好。
#[derive(Debug, Serialize, Deserialize, Clone)]
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
    /// 自定义笔记目录路径（绝对路径，None 时使用默认文档目录下的 Prism）
    #[serde(default)]
    pub notes_dir: Option<PathBuf>,
    /// Pandoc 可执行文件的可选自定义路径；为空时自动从应用资源目录和 PATH 查找
    #[serde(default)]
    pub pandoc_path: Option<PathBuf>,
    /// Word 导出的默认 reference.docx 模板路径
    #[serde(default)]
    pub pandoc_reference_doc: Option<PathBuf>,
    /// 仪表盘布局配置（JSON 字符串，前端序列化）
    #[serde(default)]
    pub dashboard_layout: Option<String>,
    /// 插件配置（key=plugin.id, value=PluginConfig）
    #[serde(default)]
    pub plugins: std::collections::HashMap<String, PluginConfig>,
}

// ═══════════════════════════════════════════════════════════════
//  默认值
// ═══════════════════════════════════════════════════════════════

/// 默认提醒提前时间（30 分钟）
pub fn default_reminder_minutes() -> u32 {
    30
}

/// 默认主题模式（跟随系统）
pub fn default_theme() -> String {
    "auto".to_string()
}

/// 构造空的默认任务数据
pub fn default_data_store() -> DataStore {
    DataStore {
        version: 1,
        tasks: vec![],
        daily_completions: vec![],
        revision: 0,
        outbox: vec![],
        outbox_sequence: 0,
        legacy_queue_imported: false,
    }
}

/// 构造默认应用配置
pub fn default_config_store() -> ConfigStore {
    ConfigStore {
        vendors: vec![],
        active_vendor_id: None,
        theme: default_theme(),
        reminder_minutes: default_reminder_minutes(),
        module_enabled: std::collections::HashMap::new(),
        notes_dir: None,
        pandoc_path: None,
        pandoc_reference_doc: None,
        dashboard_layout: None,
        plugins: std::collections::HashMap::new(),
    }
}

/// 构造空的默认同步状态
pub fn default_sync_store() -> SyncStore {
    SyncStore {
        sync_code: None,
        profile_id: None,
        last_sync_at: None,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QueueOperation {
    #[serde(rename = "type")]
    pub kind: String,
    pub table: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OutboxItem {
    pub id: String,
    pub sequence: u64,
    #[serde(flatten)]
    pub operation: QueueOperation,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_data_store_is_empty() {
        let store = default_data_store();
        assert_eq!(store.tasks.len(), 0);
        assert_eq!(store.daily_completions.len(), 0);
        assert_eq!(store.version, 1);
    }

    #[test]
    fn test_default_config_store_has_defaults() {
        let config = default_config_store();
        assert!(config.vendors.is_empty());
        assert!(config.active_vendor_id.is_none());
        assert_eq!(config.theme, "auto");
        assert_eq!(config.reminder_minutes, 30);
        assert!(config.plugins.is_empty());
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
            updated_at: "2026-05-17T00:00:00+08:00".to_string(),
            is_deleted: false,
            profile_id: None,
        };
        let json = serde_json::to_string(&task).unwrap();
        let parsed: Task = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.title, "测试任务");
        assert!(!parsed.completed);
        assert!(parsed.completed_at.is_none());
        assert_eq!(parsed.due_date, Some("2026-05-21".to_string()));
    }

    #[test]
    fn test_data_store_roundtrip() {
        let store = DataStore {
            version: 1,
            tasks: vec![Task {
                id: "1".to_string(),
                title: "hello".to_string(),
                completed: true,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                completed_at: Some("2026-01-02T00:00:00Z".to_string()),
                due_date: None,
                tags: vec!["tag1".to_string()],
                important: true,
                pinned: false,
                is_daily: false,
                parent_id: None,
                updated_at: "2026-01-01T00:00:00Z".to_string(),
                is_deleted: false,
                profile_id: None,
            }],
            daily_completions: vec![DailyCompletion {
                task_id: "1".to_string(),
                date: "2026-01-02".to_string(),
                profile_id: None,
            }],
            ..default_data_store()
        };
        let json = serde_json::to_string(&store).unwrap();
        let parsed: DataStore = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.tasks.len(), 1);
        assert_eq!(parsed.tasks[0].title, "hello");
        assert_eq!(parsed.daily_completions.len(), 1);
    }

    #[test]
    fn test_config_store_roundtrip() {
        let config = ConfigStore {
            vendors: vec![Vendor {
                id: "v1".to_string(),
                name: "Test".to_string(),
                provider: "openai".to_string(),
                api_key: "key".to_string(),
                base_url: "https://api.test.com".to_string(),
                api_path: "/v1".to_string(),
                model: "gpt-4".to_string(),
                enabled: true,
                is_default: false,
            }],
            active_vendor_id: Some("v1".to_string()),
            theme: "dark".to_string(),
            reminder_minutes: 15,
            module_enabled: std::collections::HashMap::new(),
            notes_dir: None,
            pandoc_path: None,
            pandoc_reference_doc: None,
            dashboard_layout: None,
            plugins: std::collections::HashMap::new(),
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: ConfigStore = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.vendors.len(), 1);
        assert_eq!(parsed.active_vendor_id, Some("v1".to_string()));
        assert_eq!(parsed.theme, "dark");
        assert_eq!(parsed.reminder_minutes, 15);
    }

    #[test]
    fn test_data_store_missing_fields_deserialization() {
        let json = r#"{"version":1,"tasks":[]}"#;
        let store: DataStore = serde_json::from_str(json).unwrap();
        assert_eq!(store.version, 1);
        assert!(store.tasks.is_empty());
        assert!(store.daily_completions.is_empty());
    }

    #[test]
    fn test_config_store_missing_fields_deserialization() {
        let json = r#"{}"#;
        let config: ConfigStore = serde_json::from_str(json).unwrap();
        assert!(config.vendors.is_empty());
        assert!(config.active_vendor_id.is_none());
        assert_eq!(config.theme, "auto");
        assert_eq!(config.reminder_minutes, 30);
        assert!(config.plugins.is_empty());
    }
}
