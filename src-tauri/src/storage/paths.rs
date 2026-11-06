use crate::models::ConfigStore;
use std::path::PathBuf;

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
