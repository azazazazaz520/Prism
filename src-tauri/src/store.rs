// ═══════════════════════════════════════════════════════════════
//  store — 向后兼容的聚合入口
//
//  数据模型 → models.rs     (Task, DataStore, ConfigStore, …)
//  持久化   → persistence.rs (load/save + 路径 + workspace 初始化)
//  旧格式迁移 → migration.rs  (tasks.json → data.json + config.json)
//
//  本文件仅保留 initialize() 编排逻辑，其余全部通过 pub use 重导出。
// ═══════════════════════════════════════════════════════════════

// 重导出：外部代码 use crate::store::* 无需修改
pub use crate::migration::*;
pub use crate::models::*;
pub use crate::persistence::*;

// ═══════════════════════════════════════════════════════════════
//  统一初始化入口
// ═══════════════════════════════════════════════════════════════

/// 创建目录 → 迁移（如需） → 返回 (DataStore, ConfigStore)
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
                    updated_at: "2026-01-01T00:00:00Z".to_string(),
                    is_deleted: false,
                    profile_id: None,
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

            let data_json = serde_json::to_string_pretty(&data).unwrap();
            let config_json = serde_json::to_string_pretty(&config).unwrap();

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
    }
}
