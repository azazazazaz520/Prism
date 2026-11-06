use crate::models::WindowsUpdateManifest;

/// 检查最新 Windows 发布清单。
#[tauri::command]
pub async fn check_update() -> Result<WindowsUpdateManifest, String> {
    crate::update::check_update().await
}
