use std::fs;
use std::path::PathBuf;

use crate::logging::{LogLevel, LogWriter};
use crate::models::*;

// ═══════════════════════════════════════════════════════════════
//  路径解析
// ═══════════════════════════════════════════════════════════════

/// 获取 Workspace 根目录
pub fn get_workspace_dir() -> PathBuf {
    let mut path = dirs::home_dir().unwrap_or_default();
    path.push(".prism");
    path
}

/// 获取结构化日志目录
pub fn get_logs_dir() -> PathBuf {
    get_workspace_dir().join("logs")
}

/// 获取任务数据文件路径（data.json）
pub fn get_data_path() -> PathBuf {
    get_workspace_dir().join("data.json")
}

/// 获取同步状态文件路径（sync.json）
pub fn get_sync_path() -> PathBuf {
    get_workspace_dir().join("sync.json")
}

/// 获取应用配置文件路径（config.json）
pub fn get_config_path() -> PathBuf {
    get_workspace_dir().join("config.json")
}

/// 获取默认笔记工作区路径。
pub fn get_default_notes_dir() -> PathBuf {
    dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_default()
        .join("Prism")
}

/// 获取笔记目录（优先使用自定义路径，否则使用默认）
pub fn get_notes_dir(config: &ConfigStore) -> PathBuf {
    if let Some(ref custom_dir) = config.notes_dir {
        custom_dir.clone()
    } else {
        get_default_notes_dir()
    }
}

/// 获取插件目录
pub fn get_plugins_dir() -> PathBuf {
    get_workspace_dir().join("plugins")
}

/// 获取脚本目录
pub fn get_scripts_dir() -> PathBuf {
    get_workspace_dir().join("scripts")
}

// ═══════════════════════════════════════════════════════════════
//  Workspace 初始化
// ═══════════════════════════════════════════════════════════════

/// 确保应用数据目录和默认笔记工作区存在。
/// 目录创建失败时记录 stderr 但不阻塞启动（用户可能无权限写入父目录）
pub fn ensure_workspace(logger: &LogWriter) {
    let root = get_workspace_dir();
    if let Err(e) = fs::create_dir_all(&root) {
        eprintln!("[store] 无法创建 workspace 目录 {:?}: {}", root, e);
        record_workspace_error(logger, "persistence.workspace_create_failed", &root, &e);
    }
    let notes_dir_to_create = get_default_notes_dir();
    if let Err(e) = fs::create_dir_all(&notes_dir_to_create) {
        eprintln!("[store] 无法创建 notes 目录: {}", e);
        record_workspace_error(
            logger,
            "persistence.notes_create_failed",
            &notes_dir_to_create,
            &e,
        );
    }
    if let Err(e) = fs::create_dir_all(root.join("prompts")) {
        eprintln!("[store] 无法创建 prompts 目录: {}", e);
        record_workspace_error(
            logger,
            "persistence.prompts_create_failed",
            &root.join("prompts"),
            &e,
        );
    }
    if let Err(e) = fs::create_dir_all(root.join("plugins")) {
        eprintln!("[store] 无法创建 plugins 目录: {}", e);
        record_workspace_error(
            logger,
            "persistence.plugins_create_failed",
            &root.join("plugins"),
            &e,
        );
    }
    if let Err(e) = fs::create_dir_all(root.join("scripts")) {
        eprintln!("[store] 无法创建 scripts 目录: {}", e);
        record_workspace_error(
            logger,
            "persistence.scripts_create_failed",
            &root.join("scripts"),
            &e,
        );
    }
    // notes.meta.json 不存在时初始化为空数组
    let meta_path = root.join("notes.meta.json");
    if !meta_path.exists() {
        if let Err(e) = fs::write(&meta_path, "[]") {
            eprintln!("[store] 无法初始化 notes.meta.json: {}", e);
            record_workspace_error(
                logger,
                "persistence.notes_meta_create_failed",
                &meta_path,
                &e,
            );
        }
    }
}

fn record_workspace_error(
    logger: &LogWriter,
    event: &str,
    path: &std::path::Path,
    error: &std::io::Error,
) {
    let _ = logger.append_internal(
        LogLevel::Error,
        "persistence",
        event,
        "初始化工作区失败",
        serde_json::json!({ "path": path.display().to_string(), "error": error.to_string() }),
    );
}

// ═══════════════════════════════════════════════════════════════
//  JSON 持久化
// ═══════════════════════════════════════════════════════════════

/// 解析失败时将损坏文件备份为 `<文件名>.corrupt-<时间戳>`，保留用户数据以便手动恢复。
/// 备份成功后原文件被移走，后续写入将创建新文件。
fn backup_corrupt_file(path: &std::path::Path, logger: &LogWriter) {
    if !path.exists() {
        return;
    }
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "data".to_string());
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let backup = path.with_file_name(format!("{}.corrupt-{}", file_name, timestamp));
    match fs::rename(path, &backup) {
        Ok(()) => {
            let _ = logger.append_internal(
                LogLevel::Error,
                "persistence",
                "persistence.backup_created",
                "损坏数据文件已备份",
                serde_json::json!({ "backup": backup.display().to_string() }),
            );
        }
        Err(error) => {
            let _ = logger.append_internal(
                LogLevel::Error,
                "persistence",
                "persistence.backup_failed",
                "备份损坏数据文件失败",
                serde_json::json!({
                    "path": path.display().to_string(),
                    "error": error.to_string()
                }),
            );
        }
    }
}

/// 读取并解析 JSON 文件：文件不存在时返回默认值；
/// 解析失败时记录日志、备份损坏文件并返回默认值。
fn load_json_or_default<T>(
    path: &std::path::Path,
    logger: &LogWriter,
    default: T,
    parse_event: &str,
    parse_description: &str,
    read_event: &str,
    read_description: &str,
) -> T
where
    T: serde::de::DeserializeOwned,
{
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|error| {
            let _ = logger.append_internal(
                LogLevel::Error,
                "persistence",
                parse_event,
                parse_description,
                serde_json::json!({ "path": path.display().to_string(), "error": error.to_string() }),
            );
            backup_corrupt_file(path, logger);
            default
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => default,
        Err(error) => {
            let _ = logger.append_internal(
                LogLevel::Error,
                "persistence",
                read_event,
                read_description,
                serde_json::json!({ "path": path.display().to_string(), "error": error.to_string() }),
            );
            default
        }
    }
}

/// 从磁盘加载任务数据，文件不存在或解析失败时返回默认空数据
pub fn load_data(logger: &LogWriter) -> DataStore {
    load_json_or_default(
        &get_data_path(),
        logger,
        default_data_store(),
        "persistence.data_parse_failed",
        "任务数据解析失败，已使用默认数据",
        "persistence.data_read_failed",
        "读取任务数据失败，已使用默认数据",
    )
}

/// 将任务数据序列化写入磁盘
pub fn save_data(store: &DataStore) -> Result<(), String> {
    let path = get_data_path();
    let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// 从磁盘加载应用配置，文件不存在或解析失败时返回默认配置
pub fn load_config(logger: &LogWriter) -> ConfigStore {
    load_json_or_default(
        &get_config_path(),
        logger,
        default_config_store(),
        "persistence.config_parse_failed",
        "应用配置解析失败，已使用默认配置",
        "persistence.config_read_failed",
        "读取应用配置失败，已使用默认配置",
    )
}

/// 将应用配置序列化写入磁盘
pub fn save_config(store: &ConfigStore) -> Result<(), String> {
    let path = get_config_path();
    let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// 从磁盘加载同步状态，文件不存在或解析失败时返回默认空状态
pub fn load_sync(logger: &LogWriter) -> SyncStore {
    load_json_or_default(
        &get_sync_path(),
        logger,
        default_sync_store(),
        "persistence.sync_parse_failed",
        "同步状态解析失败，已使用默认状态",
        "persistence.sync_read_failed",
        "读取同步状态失败，已使用默认状态",
    )
}

/// 将同步状态序列化写入磁盘
pub fn save_sync(store: &SyncStore) -> Result<(), String> {
    let path = get_sync_path();
    let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logs_dir_is_inside_workspace() {
        assert_eq!(get_logs_dir(), get_workspace_dir().join("logs"));
    }

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "prism-persist-test-{}",
            uuid::Uuid::new_v4().simple()
        ))
    }

    #[test]
    fn load_json_or_default_parses_valid_content() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        let logger = LogWriter::new(dir.clone()).unwrap();
        let path = dir.join("data.json");
        fs::write(&path, r#"{"version":1,"tasks":[]}"#).unwrap();

        let loaded: serde_json::Value = load_json_or_default(
            &path,
            &logger,
            serde_json::json!(null),
            "e1",
            "d1",
            "e2",
            "d2",
        );
        assert_eq!(loaded["version"], 1);
        assert!(path.exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn load_json_or_default_returns_default_when_missing() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        let logger = LogWriter::new(dir.clone()).unwrap();
        let path = dir.join("missing.json");

        let loaded: serde_json::Value = load_json_or_default(
            &path,
            &logger,
            serde_json::json!({"fallback": true}),
            "e1",
            "d1",
            "e2",
            "d2",
        );
        assert_eq!(loaded, serde_json::json!({"fallback": true}));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn load_json_or_default_backs_up_corrupt_file() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        let logger = LogWriter::new(dir.clone()).unwrap();
        let path = dir.join("data.json");
        fs::write(&path, "{ not valid json ]").unwrap();

        let loaded: serde_json::Value = load_json_or_default(
            &path,
            &logger,
            serde_json::json!(null),
            "e1",
            "d1",
            "e2",
            "d2",
        );
        assert_eq!(loaded, serde_json::json!(null));
        // 原文件已被移走，替换为备份文件
        assert!(!path.exists());
        let backups: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.contains(".corrupt-"))
            .collect();
        assert_eq!(backups.len(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }
}
