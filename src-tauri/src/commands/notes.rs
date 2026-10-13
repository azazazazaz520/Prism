use std::fs;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::file_watcher::FileWatcher;
use crate::note_recovery;
use crate::note_service;
use crate::workspace_windows::WorkspaceWindows;
use crate::AppState;

/// 列出 notes/ 目录的完整文件树
#[tauri::command]
pub fn list_note_tree(
    window: WebviewWindow,
    workspaces: State<WorkspaceWindows>,
) -> Result<Vec<note_service::FileEntry>, String> {
    let base = workspaces.directory(window.label())?;
    Ok(note_service::read_dir_recursive(&base, ""))
}

/// 列出笔记目录的直接子项，子目录在前端展开时按需读取。
#[tauri::command]
pub fn list_note_dir(
    path: String,
    window: WebviewWindow,
    workspaces: State<WorkspaceWindows>,
) -> Result<Vec<note_service::FileEntry>, String> {
    let base = workspaces.directory(window.label())?;
    note_service::read_dir_entries(&base, &path)
}

/// 在后台扫描当前笔记工作区，并返回正文命中位置与上下文片段。
#[tauri::command]
pub async fn search_notes(
    request_id: u64,
    query: String,
    skipped_paths: Vec<String>,
    window: WebviewWindow,
    workspaces: State<'_, WorkspaceWindows>,
) -> Result<note_service::NoteSearchResponse, String> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return Err("搜索关键词不能为空".into());
    }

    let base = workspaces.directory(window.label())?;
    let current_generation = workspaces.search_generation(window.label())?;
    let generation = current_generation.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn_blocking(move || {
        note_service::search_notes(&base, request_id, &query, &skipped_paths, || {
            current_generation.load(Ordering::SeqCst) != generation
        })
    })
    .await
    .map_err(|error| format!("笔记搜索任务失败: {error}"))?
}

/// 使正在运行的笔记搜索失效。
#[tauri::command]
pub fn cancel_note_search(
    window: WebviewWindow,
    workspaces: State<WorkspaceWindows>,
) -> Result<(), String> {
    workspaces
        .search_generation(window.label())?
        .fetch_add(1, Ordering::SeqCst);
    Ok(())
}

/// 读取笔记内容
#[tauri::command]
pub fn read_note(
    path: String,
    window: WebviewWindow,
    workspaces: State<WorkspaceWindows>,
) -> Result<String, String> {
    let base = workspaces.directory(window.label())?;
    note_service::read_note_content(&base, &path)
}

/// 读取笔记内容及文件修改时间（用于外部变更检测）
#[tauri::command]
pub fn read_note_meta(
    path: String,
    window: WebviewWindow,
    workspaces: State<WorkspaceWindows>,
) -> Result<note_service::NoteMeta, String> {
    let base = workspaces.directory(window.label())?;
    note_service::read_note_meta(&base, &path)
}

/// 获取笔记文件修改时间（不读取内容，用于快速校验）
#[tauri::command]
pub fn get_note_mtime(
    path: String,
    window: WebviewWindow,
    workspaces: State<WorkspaceWindows>,
) -> Result<String, String> {
    let base = workspaces.directory(window.label())?;
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
    window: WebviewWindow,
    workspaces: State<WorkspaceWindows>,
) -> Result<String, String> {
    let base = workspaces.directory(window.label())?;
    note_service::write_note_content(&base, &path, &content, expected_mtime)
}

/// 创建文件夹
#[tauri::command]
pub fn create_note_dir(
    path: String,
    window: WebviewWindow,
    workspaces: State<WorkspaceWindows>,
) -> Result<(), String> {
    let base = workspaces.directory(window.label())?;
    note_service::create_note_dir_at(&base, &path)
}

/// 删除文件或文件夹（移入系统回收站）
#[tauri::command]
pub fn delete_note_entry(
    path: String,
    window: WebviewWindow,
    workspaces: State<WorkspaceWindows>,
) -> Result<(), String> {
    let base = workspaces.directory(window.label())?;
    note_service::delete_note_entry_at(&base, &path)
}

/// 重命名文件或文件夹
#[tauri::command]
pub fn rename_note_entry(
    path: String,
    new_name: String,
    window: WebviewWindow,
    workspaces: State<WorkspaceWindows>,
) -> Result<(), String> {
    let base = workspaces.directory(window.label())?;
    note_service::rename_note_entry_at(&base, &path, &new_name)
}

/// 获取当前笔记目录路径
#[tauri::command]
pub fn get_notes_directory(
    window: WebviewWindow,
    workspaces: State<WorkspaceWindows>,
) -> Result<String, String> {
    Ok(workspaces
        .directory(window.label())?
        .to_string_lossy()
        .into_owned())
}

/// 切换当前窗口的笔记目录，主窗口同时更新下次启动的默认目录。
#[tauri::command]
pub fn set_notes_directory(
    dir_path: String,
    app_handle: AppHandle,
    window: WebviewWindow,
    workspaces: State<WorkspaceWindows>,
    state: State<AppState>,
) -> Result<(), String> {
    workspaces.directory(window.label())?;
    let path = std::path::PathBuf::from(&dir_path);
    if !path.is_dir() {
        return Err("所选路径不是文件夹".into());
    }
    note_service::is_safe_notes_dir(&path)?;
    fs::read_dir(&path).map_err(|error| format!("无法读取目录：{error}"))?;
    let watcher = FileWatcher::start(app_handle, path.clone(), window.label().to_string())?;
    if window.label() == "main" {
        state.with_config_mut(|config| {
            config.notes_dir = Some(path.clone());
        })?;
    }
    workspaces.replace(window.label(), path, watcher);
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
    window: WebviewWindow,
) -> Result<note_recovery::NoteRecoverySummary, String> {
    let workspace_path = window
        .state::<WorkspaceWindows>()
        .directory(window.label())?;
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
    window: WebviewWindow,
    workspaces: State<WorkspaceWindows>,
) -> Result<note_recovery::NoteRecoveryRestoreResult, String> {
    let workspace_path = workspaces.directory(window.label())?;
    note_recovery::restore(&id, &workspace_path)
}
