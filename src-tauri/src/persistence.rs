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

/// 获取笔记目录（优先使用自定义路径，否则使用默认）
pub fn get_notes_dir(config: &ConfigStore) -> PathBuf {
    if let Some(ref custom_dir) = config.notes_dir {
        custom_dir.clone()
    } else {
        get_workspace_dir().join("notes")
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

/// 确保 Workspace 目录结构存在（notes/、prompts/、plugins/、notes.meta.json）
/// 目录创建失败时记录 stderr 但不阻塞启动（用户可能无权限写入父目录）
pub fn ensure_workspace(logger: &LogWriter) {
    let root = get_workspace_dir();
    if let Err(e) = fs::create_dir_all(&root) {
        eprintln!("[store] 无法创建 workspace 目录 {:?}: {}", root, e);
        record_workspace_error(logger, "persistence.workspace_create_failed", &root, &e);
    }
    if let Err(e) = fs::create_dir_all(root.join("notes")) {
        eprintln!("[store] 无法创建 notes 目录: {}", e);
        record_workspace_error(
            logger,
            "persistence.notes_create_failed",
            &root.join("notes"),
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

/// 从磁盘加载任务数据，文件不存在或解析失败时返回默认空数据
pub fn load_data(logger: &LogWriter) -> DataStore {
    let path = get_data_path();
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|error| {
            let _ = logger.append_internal(
                LogLevel::Error,
                "persistence",
                "persistence.data_parse_failed",
                "任务数据解析失败，已使用默认数据",
                serde_json::json!({ "path": path.display().to_string(), "error": error.to_string() }),
            );
            default_data_store()
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => default_data_store(),
        Err(error) => {
            let _ = logger.append_internal(
                LogLevel::Error,
                "persistence",
                "persistence.data_read_failed",
                "读取任务数据失败，已使用默认数据",
                serde_json::json!({ "path": path.display().to_string(), "error": error.to_string() }),
            );
            default_data_store()
        }
    }
}

/// 将任务数据序列化写入磁盘
pub fn save_data(store: &DataStore) -> Result<(), String> {
    let path = get_data_path();
    let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// 从磁盘加载应用配置，文件不存在或解析失败时返回默认配置
pub fn load_config(logger: &LogWriter) -> ConfigStore {
    let path = get_config_path();
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|error| {
            let _ = logger.append_internal(
                LogLevel::Error,
                "persistence",
                "persistence.config_parse_failed",
                "应用配置解析失败，已使用默认配置",
                serde_json::json!({ "path": path.display().to_string(), "error": error.to_string() }),
            );
            default_config_store()
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => default_config_store(),
        Err(error) => {
            let _ = logger.append_internal(
                LogLevel::Error,
                "persistence",
                "persistence.config_read_failed",
                "读取应用配置失败，已使用默认配置",
                serde_json::json!({ "path": path.display().to_string(), "error": error.to_string() }),
            );
            default_config_store()
        }
    }
}

/// 将应用配置序列化写入磁盘
pub fn save_config(store: &ConfigStore) -> Result<(), String> {
    let path = get_config_path();
    let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// 从磁盘加载同步状态，文件不存在或解析失败时返回默认空状态
pub fn load_sync(logger: &LogWriter) -> SyncStore {
    let path = get_sync_path();
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|error| {
            let _ = logger.append_internal(
                LogLevel::Error,
                "persistence",
                "persistence.sync_parse_failed",
                "同步状态解析失败，已使用默认状态",
                serde_json::json!({ "path": path.display().to_string(), "error": error.to_string() }),
            );
            default_sync_store()
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => default_sync_store(),
        Err(error) => {
            let _ = logger.append_internal(
                LogLevel::Error,
                "persistence",
                "persistence.sync_read_failed",
                "读取同步状态失败，已使用默认状态",
                serde_json::json!({ "path": path.display().to_string(), "error": error.to_string() }),
            );
            default_sync_store()
        }
    }
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
}
