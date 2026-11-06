mod json;
pub(crate) mod paths;
pub(crate) use json::{
    backup_data_for_queue_migration, backup_legacy_queue, load_config, load_data, load_sync,
    save_config, save_data, save_sync,
};

use crate::logging::{LogLevel, LogWriter};
use crate::models::{ConfigStore, DataStore};
use paths::{get_default_notes_dir, get_workspace_dir};
use std::fs;

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

/// 创建目录 → 返回 (DataStore, ConfigStore)
pub fn initialize(logger: &crate::logging::LogWriter) -> (DataStore, ConfigStore) {
    ensure_workspace(logger);
    (load_data(logger), load_config(logger))
}
