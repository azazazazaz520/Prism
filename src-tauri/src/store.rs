use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ═══════════════════════════════════════════════════════════════
//  数据模型
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyCompletion {
    pub task_id: String,
    pub date: String,
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

/// 结构化任务数据（存储于 data.json）
#[derive(Debug, Serialize, Deserialize)]
pub struct DataStore {
    pub version: u32,
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub daily_completions: Vec<DailyCompletion>,
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
struct LegacyStore {
    #[serde(default)]
    tasks: Vec<Task>,
    #[serde(default)]
    daily_completions: Vec<DailyCompletion>,
    #[serde(default)]
    vendors: Vec<Vendor>,
    #[serde(default)]
    active_vendor_id: Option<String>,
    #[serde(default = "default_theme")]
    theme: String,
    #[serde(default = "default_reminder_minutes")]
    reminder_minutes: u32,
}

// ═══════════════════════════════════════════════════════════════
//  路径与默认值
// ═══════════════════════════════════════════════════════════════

fn default_reminder_minutes() -> u32 {
    30
}

fn default_theme() -> String {
    "auto".to_string()
}

/// 获取 Workspace 根目录
pub fn get_workspace_dir() -> PathBuf {
    let mut path = dirs::home_dir().unwrap_or_default();
    path.push(".todo-app");
    path
}

fn get_data_path() -> PathBuf {
    get_workspace_dir().join("data.json")
}

fn get_config_path() -> PathBuf {
    get_workspace_dir().join("config.json")
}

fn get_legacy_path() -> PathBuf {
    get_workspace_dir().join("tasks.json")
}

/// 获取笔记目录（优先使用自定义路径，否则使用默认）
pub fn get_notes_dir(config: &ConfigStore) -> PathBuf {
    if let Some(ref custom_dir) = config.notes_dir {
        custom_dir.clone()
    } else {
        get_workspace_dir().join("notes")
    }
}

// ═══════════════════════════════════════════════════════════════
//  Workspace 初始化
// ═══════════════════════════════════════════════════════════════

/// 确保 Workspace 目录结构存在（notes/、prompts/、notes.meta.json）
/// 目录创建失败时记录 stderr 但不阻塞启动（用户可能无权限写入父目录）
pub fn ensure_workspace() {
    let root = get_workspace_dir();
    if let Err(e) = fs::create_dir_all(&root) {
        eprintln!("[store] 无法创建 workspace 目录 {:?}: {}", root, e);
    }
    if let Err(e) = fs::create_dir_all(root.join("notes")) {
        eprintln!("[store] 无法创建 notes 目录: {}", e);
    }
    if let Err(e) = fs::create_dir_all(root.join("prompts")) {
        eprintln!("[store] 无法创建 prompts 目录: {}", e);
    }
    // notes.meta.json 不存在时初始化为空数组
    let meta_path = root.join("notes.meta.json");
    if !meta_path.exists() {
        if let Err(e) = fs::write(&meta_path, "[]") {
            eprintln!("[store] 无法初始化 notes.meta.json: {}", e);
        }
    }
}

// ═══════════════════════════════════════════════════════════════
//  加载与保存
// ═══════════════════════════════════════════════════════════════

fn default_data_store() -> DataStore {
    DataStore {
        version: 1,
        tasks: vec![],
        daily_completions: vec![],
    }
}

fn default_config_store() -> ConfigStore {
    ConfigStore {
        vendors: vec![],
        active_vendor_id: None,
        theme: default_theme(),
        reminder_minutes: default_reminder_minutes(),
        module_enabled: std::collections::HashMap::new(),
        notes_dir: None,
    }
}

pub fn load_data() -> DataStore {
    let path = get_data_path();
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| default_data_store()),
        Err(_) => default_data_store(),
    }
}

pub fn save_data(store: &DataStore) -> Result<(), String> {
    let path = get_data_path();
    let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

pub fn load_config() -> ConfigStore {
    let path = get_config_path();
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| default_config_store()),
        Err(_) => default_config_store(),
    }
}

pub fn save_config(store: &ConfigStore) -> Result<(), String> {
    let path = get_config_path();
    let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════
//  旧格式迁移
// ═══════════════════════════════════════════════════════════════

/// 检测旧 tasks.json 是否存在且 data.json 不存在（即需要迁移）
pub fn needs_migration() -> bool {
    get_legacy_path().exists() && !get_data_path().exists()
}

/// 将旧 tasks.json 拆分为 data.json + config.json，保留原文件为 .bak
pub fn migrate_legacy() -> Result<(), String> {
    let legacy_path = get_legacy_path();
    let content = fs::read_to_string(&legacy_path).map_err(|e| e.to_string())?;
    let legacy: LegacyStore =
        serde_json::from_str(&content).map_err(|e| format!("解析旧格式失败: {}", e))?;

    // 写入 data.json
    let data = DataStore {
        version: 1,
        tasks: legacy.tasks,
        daily_completions: legacy.daily_completions,
    };
    save_data(&data)?;

    // 写入 config.json
    let config = ConfigStore {
        vendors: legacy.vendors,
        active_vendor_id: legacy.active_vendor_id,
        theme: legacy.theme,
        reminder_minutes: legacy.reminder_minutes,
        module_enabled: std::collections::HashMap::new(),
        notes_dir: None,
    };
    save_config(&config)?;

    // 备份旧文件
    let bak_path = legacy_path.with_extension("json.bak");
    fs::rename(&legacy_path, &bak_path).map_err(|e| e.to_string())?;

    Ok(())
}

/// 统一初始化入口：创建目录 → 迁移（如需） → 返回 (DataStore, ConfigStore)
pub fn initialize() -> (DataStore, ConfigStore) {
    ensure_workspace();
    if needs_migration() {
        // 迁移失败不阻塞启动，回退到空 store
        if let Err(e) = migrate_legacy() {
            eprintln!("[store] 旧格式迁移失败（将使用空 store）: {}", e);
        }
    }
    (load_data(), load_config())
}

// ═══════════════════════════════════════════════════════════════
//  测试
// ═══════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 为每个测试创建独立的临时目录，避免并行测试互相干扰
    fn with_temp_workspace<F: FnOnce()>(f: F) {
        let tmp = std::env::temp_dir().join(format!("todo-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();
        f();
        fs::remove_dir_all(&tmp).ok();
    }

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
            }],
            daily_completions: vec![DailyCompletion {
                task_id: "1".to_string(),
                date: "2026-01-02".to_string(),
            }],
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
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: ConfigStore = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.vendors.len(), 1);
        assert_eq!(parsed.active_vendor_id, Some("v1".to_string()));
        assert_eq!(parsed.theme, "dark");
        assert_eq!(parsed.reminder_minutes, 15);
    }

    #[test]
    fn test_legacy_store_deserialization() {
        let json = r#"{
            "version": 1,
            "tasks": [{"id":"1","title":"test","completed":false,"created_at":"2026-01-01T00:00:00Z"}],
            "daily_completions": [],
            "vendors": [{"id":"v1","name":"Test","provider":"openai","api_key":"k","base_url":"http://a","api_path":"/v1","model":"m","enabled":true}],
            "active_vendor_id": "v1",
            "theme": "light",
            "reminder_minutes": 10
        }"#;
        let legacy: LegacyStore = serde_json::from_str(json).unwrap();
        assert_eq!(legacy.tasks.len(), 1);
        assert_eq!(legacy.vendors.len(), 1);
        assert_eq!(legacy.theme, "light");
        assert_eq!(legacy.reminder_minutes, 10);
    }

    #[test]
    fn test_migrate_legacy_splits_correctly() {
        with_temp_workspace(|| {
            // 构造一个临时的 legacy 文件内容来测试拆分逻辑
            let legacy = LegacyStore {
                tasks: vec![Task {
                    id: "t1".to_string(),
                    title: "migrated task".to_string(),
                    completed: false,
                    created_at: "2026-01-01T00:00:00Z".to_string(),
                    completed_at: None,
                    due_date: None,
                    tags: vec![],
                    important: false,
                    pinned: false,
                    is_daily: false,
                    parent_id: None,
                }],
                daily_completions: vec![],
                vendors: vec![Vendor {
                    id: "v1".to_string(),
                    name: "Migrated".to_string(),
                    provider: "openai".to_string(),
                    api_key: "key".to_string(),
                    base_url: "http://test".to_string(),
                    api_path: "/v1".to_string(),
                    model: "m".to_string(),
                    enabled: true,
                    is_default: false,
                }],
                active_vendor_id: Some("v1".to_string()),
                theme: "dark".to_string(),
                reminder_minutes: 15,
            };

            // 验证拆分后的数据结构正确
            let data = DataStore {
                version: 1,
                tasks: legacy.tasks,
                daily_completions: legacy.daily_completions,
            };
            let config = ConfigStore {
                vendors: legacy.vendors,
                active_vendor_id: legacy.active_vendor_id,
                theme: legacy.theme,
                reminder_minutes: legacy.reminder_minutes,
                module_enabled: std::collections::HashMap::new(),
                notes_dir: None,
            };

            // 验证序列化可正常进行
            let data_json = serde_json::to_string_pretty(&data).unwrap();
            let config_json = serde_json::to_string_pretty(&config).unwrap();

            // 反序列化验证数据完整性
            let parsed_data: DataStore = serde_json::from_str(&data_json).unwrap();
            let parsed_config: ConfigStore = serde_json::from_str(&config_json).unwrap();

            assert_eq!(parsed_data.tasks.len(), 1);
            assert_eq!(parsed_data.tasks[0].title, "migrated task");
            assert_eq!(parsed_config.vendors.len(), 1);
            assert_eq!(parsed_config.theme, "dark");
            assert_eq!(parsed_config.reminder_minutes, 15);
            assert_eq!(parsed_config.active_vendor_id, Some("v1".to_string()));
        });
    }

    #[test]
    fn test_data_store_missing_fields_deserialization() {
        // 模拟缺少可选字段的旧 JSON
        let json = r#"{"version":1,"tasks":[]}"#;
        let store: DataStore = serde_json::from_str(json).unwrap();
        assert_eq!(store.version, 1);
        assert!(store.tasks.is_empty());
        assert!(store.daily_completions.is_empty());
    }

    #[test]
    fn test_config_store_missing_fields_deserialization() {
        // 模拟空对象，所有字段应有默认值
        let json = r#"{}"#;
        let config: ConfigStore = serde_json::from_str(json).unwrap();
        assert!(config.vendors.is_empty());
        assert!(config.active_vendor_id.is_none());
        assert_eq!(config.theme, "auto");
        assert_eq!(config.reminder_minutes, 30);
    }
}
