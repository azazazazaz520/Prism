use std::fs;
use tauri::{AppHandle, State};

use crate::file_watcher::FileWatcher;
use crate::note_recovery;
use crate::note_service;
use crate::store;
use crate::AppState;

/// 列出 notes/ 目录的完整文件树
#[tauri::command]
pub fn list_note_tree(state: State<AppState>) -> Vec<note_service::FileEntry> {
    let base = state.with_config(store::get_notes_dir);
    note_service::read_dir_recursive(&base, "")
}

/// 列出笔记目录的直接子项，子目录在前端展开时按需读取。
#[tauri::command]
pub fn list_note_dir(
    path: String,
    state: State<AppState>,
) -> Result<Vec<note_service::FileEntry>, String> {
    let base = state.with_config(store::get_notes_dir);
    note_service::read_dir_entries(&base, &path)
}

/// 读取笔记内容
#[tauri::command]
pub fn read_note(path: String, state: State<AppState>) -> Result<String, String> {
    let base = state.with_config(store::get_notes_dir);
    note_service::read_note_content(&base, &path)
}

/// 读取笔记内容及文件修改时间（用于外部变更检测）
#[tauri::command]
pub fn read_note_meta(
    path: String,
    state: State<AppState>,
) -> Result<note_service::NoteMeta, String> {
    let base = state.with_config(store::get_notes_dir);
    note_service::read_note_meta(&base, &path)
}

/// 获取笔记文件修改时间（不读取内容，用于快速校验）
#[tauri::command]
pub fn get_note_mtime(path: String, state: State<AppState>) -> Result<String, String> {
    let base = state.with_config(store::get_notes_dir);
    note_service::get_note_mtime(&base, &path)
}

/// 写入笔记内容（自动创建父目录）。
/// 可选 `expectedMtime` 用于外部变更检测：
/// 若文件在读取后被外部修改，写入将返回 FILE_CHANGED_EXTERNALLY 错误。
#[tauri::command]
pub fn write_note(
    path: String,
    content: String,
    expected_mtime: Option<String>,
    state: State<AppState>,
) -> Result<String, String> {
    let base = state.with_config(store::get_notes_dir);
    note_service::write_note_content(&base, &path, &content, expected_mtime)
}

/// 创建文件夹
#[tauri::command]
pub fn create_note_dir(path: String, state: State<AppState>) -> Result<(), String> {
    let base = state.with_config(store::get_notes_dir);
    note_service::create_note_dir_at(&base, &path)
}

/// 删除文件或文件夹（移入系统回收站）
#[tauri::command]
pub fn delete_note_entry(path: String, state: State<AppState>) -> Result<(), String> {
    let base = state.with_config(store::get_notes_dir);
    note_service::delete_note_entry_at(&base, &path)
}

/// 重命名文件或文件夹
#[tauri::command]
pub fn rename_note_entry(
    path: String,
    new_name: String,
    state: State<AppState>,
) -> Result<(), String> {
    let base = state.with_config(store::get_notes_dir);
    note_service::rename_note_entry_at(&base, &path, &new_name)
}

/// 获取当前笔记目录路径
#[tauri::command]
pub fn get_notes_directory(state: State<AppState>) -> String {
    state.with_config(|config| store::get_notes_dir(config).to_string_lossy().to_string())
}

/// 设置自定义笔记目录
#[tauri::command]
pub fn set_notes_directory(
    dir_path: String,
    app_handle: AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    let path = std::path::PathBuf::from(&dir_path);
    if !path.exists() {
        return Err(format!("路径不存在: {}", dir_path));
    }
    if !path.is_dir() {
        return Err("路径不是目录".into());
    }

    note_service::is_safe_notes_dir(&path)?;

    // 尝试写入测试文件以验证权限
    let test_file = path.join(".todo_test_write");
    if let Err(e) = fs::write(&test_file, "") {
        return Err(format!("无法写入目录: {}", e));
    }
    fs::remove_file(&test_file).ok();

    // 先准备新监听器；配置持久化失败时，旧配置和旧监听器仍然保持有效。
    let watcher = FileWatcher::start(app_handle, path.clone())?;

    state.with_config_mut(|config| {
        config.notes_dir = Some(path);
    })?;

    *state.file_watcher.lock().unwrap() = Some(watcher);
    Ok(())
}

/// 保存笔记恢复快照。快照写入应用数据目录，不进入用户笔记工作区。
#[tauri::command]
pub fn save_note_recovery(
    note_path: String,
    content: String,
    generation: u64,
    document_mtime: Option<String>,
    reason: String,
    error_message: Option<String>,
    state: State<AppState>,
) -> Result<note_recovery::NoteRecoverySummary, String> {
    let workspace_path = state.with_config(store::get_notes_dir);
    note_recovery::save(
        &workspace_path,
        note_path,
        content,
        generation,
        document_mtime,
        reason,
        error_message,
    )
}

/// 列出应用数据目录中可恢复的笔记快照。
#[tauri::command]
pub fn list_note_recoveries() -> Result<Vec<note_recovery::NoteRecoverySummary>, String> {
    note_recovery::list()
}

/// 读取指定恢复快照的完整正文。
#[tauri::command]
pub fn read_note_recovery(id: String) -> Result<note_recovery::NoteRecoverySnapshot, String> {
    note_recovery::read(&id)
}

/// 删除指定恢复快照。
#[tauri::command]
pub fn delete_note_recovery(id: String) -> Result<(), String> {
    note_recovery::delete(&id)
}

/// 按快照基准版本恢复笔记，并校验恢复后的正文。
#[tauri::command]
pub fn restore_note_recovery(
    id: String,
    state: State<AppState>,
) -> Result<note_recovery::NoteRecoveryRestoreResult, String> {
    let workspace_path = state.with_config(store::get_notes_dir);
    note_recovery::restore(&id, &workspace_path)
}
