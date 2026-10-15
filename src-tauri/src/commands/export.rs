use crate::notes::export::{self, ExportDocxOptions, ExportDocxResult};
use crate::AppState;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State, WebviewWindow};

/// 使用 Pandoc 将当前笔记导出为 Word 文档。
#[tauri::command]
pub async fn export_note_to_docx(
    options: ExportDocxOptions,
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExportDocxResult, String> {
    let notes_dir = app
        .state::<crate::app::workspace_windows::WorkspaceWindows>()
        .directory(window.label())?;
    let configured_pandoc = state.with_config(|config| config.pandoc_path.clone());
    let configured_reference = state.with_config(|config| config.pandoc_reference_doc.clone());
    let reference_doc = options
        .reference_doc
        .clone()
        .map(PathBuf::from)
        .or(configured_reference);

    export::export_note_to_docx(
        app.path().resource_dir().ok(),
        notes_dir,
        configured_pandoc,
        options,
        reference_doc,
    )
    .await
}

/// 返回当前 Pandoc 检测结果，供设置界面和导出前诊断使用。
#[tauri::command]
pub async fn get_pandoc_info(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let configured = state.with_config(|config| config.pandoc_path.clone());
    export::pandoc_info(
        app.path().resource_dir().ok().as_deref(),
        configured.as_deref(),
    )
    .await
}
