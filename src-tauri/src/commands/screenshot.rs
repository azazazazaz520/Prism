use base64::Engine;
use serde::Serialize;
use tauri::Manager;

#[derive(Debug, Serialize)]
pub struct ScreenshotCapturePayload {
    pub source: &'static str,
    pub text: &'static str,
    pub image_base64: String,
    pub width: i32,
    pub height: i32,
}

/// 区域截图：选区 → 裁剪为 PNG → 编码 Base64 → 弹出导入窗
#[tauri::command]
pub async fn crop_screenshot(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    let png_bytes = crate::screenshot::capture_screen_region(x, y, width, height)?;
    let base64_img = base64::engine::general_purpose::STANDARD.encode(&png_bytes);

    // 弹出导入窗，注入截图 Base64 数据供前端预览
    if let Some(win) = app.get_webview_window("import") {
        let _ = win.show();
        let _ = win.set_focus();
        let data = ScreenshotCapturePayload {
            source: "region",
            text: "",
            image_base64: base64_img,
            width,
            height,
        };
        let payload = serde_json::to_string(&data).map_err(|e| format!("截图载荷编码失败: {e}"))?;
        let _ = win.eval(format!("window.__screenshotResult = {};", payload));
    }
    Ok(())
}
