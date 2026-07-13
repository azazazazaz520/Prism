use std::fs;
use std::path::PathBuf;

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

pub fn get_data_path() -> PathBuf {
    get_workspace_dir().join("data.json")
}

pub fn get_sync_path() -> PathBuf {
    get_workspace_dir().join("sync.json")
}

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
    if let Err(e) = fs::create_dir_all(root.join("plugins")) {
        eprintln!("[store] 无法创建 plugins 目录: {}", e);
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
//  JSON 持久化
// ═══════════════════════════════════════════════════════════════

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

pub fn load_sync() -> SyncStore {
    let path = get_sync_path();
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| default_sync_store()),
        Err(_) => default_sync_store(),
    }
}

pub fn save_sync(store: &SyncStore) -> Result<(), String> {
    let path = get_sync_path();
    let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}
