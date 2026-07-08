use std::fs;
use tauri::State;

use super::AppState;
use crate::note_service;
use crate::store;

/// 列出 notes/ 目录的完整文件树
#[tauri::command]
pub fn list_note_tree(state: State<AppState>) -> Vec<note_service::FileEntry> {
    let config = state.config.lock().unwrap();
    let base = store::get_notes_dir(&config);
    note_service::read_dir_recursive(&base, "")
}

/// 读取笔记内容
#[tauri::command]
pub fn read_note(path: String, state: State<AppState>) -> Result<String, String> {
    let config = state.config.lock().unwrap();
    let base = store::get_notes_dir(&config);
    note_service::read_note_content(&base, &path)
}

/// 写入笔记内容（自动创建父目录）
#[tauri::command]
pub fn write_note(path: String, content: String, state: State<AppState>) -> Result<(), String> {
    let config = state.config.lock().unwrap();
    let base = store::get_notes_dir(&config);
    note_service::write_note_content(&base, &path, &content)
}

/// 创建文件夹
#[tauri::command]
pub fn create_note_dir(path: String, state: State<AppState>) -> Result<(), String> {
    let config = state.config.lock().unwrap();
    let base = store::get_notes_dir(&config);
    note_service::create_note_dir_at(&base, &path)
}

/// 删除文件或文件夹（移入系统回收站）
#[tauri::command]
pub fn delete_note_entry(path: String, state: State<AppState>) -> Result<(), String> {
    let config = state.config.lock().unwrap();
    let base = store::get_notes_dir(&config);
    note_service::delete_note_entry_at(&base, &path)
}

/// 重命名文件或文件夹
#[tauri::command]
pub fn rename_note_entry(
    path: String,
    new_name: String,
    state: State<AppState>,
) -> Result<(), String> {
    let config = state.config.lock().unwrap();
    let base = store::get_notes_dir(&config);
    note_service::rename_note_entry_at(&base, &path, &new_name)
}

/// 获取当前笔记目录路径
#[tauri::command]
pub fn get_notes_directory(state: State<AppState>) -> String {
    let config = state.config.lock().unwrap();
    store::get_notes_dir(&config).to_string_lossy().to_string()
}

/// 设置自定义笔记目录
#[tauri::command]
pub fn set_notes_directory(dir_path: String, state: State<AppState>) -> Result<(), String> {
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

    let mut config = state.config.lock().unwrap();
    config.notes_dir = Some(path);
    store::save_config(&config)
}
