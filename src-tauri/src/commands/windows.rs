use tauri::{LogicalSize, Manager};

/// 显示并聚焦悬浮小窗。
#[tauri::command]
pub fn show_floating_window(app: tauri::AppHandle) -> Result<(), String> {
    let float_win = app
        .get_webview_window("floating")
        .ok_or("floating window not found")?;
    float_win.show().map_err(|e| e.to_string())?;
    float_win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let main_win =
        crate::app::workspace_windows::application_window(&app).ok_or("没有可用的工作区窗口")?;
    if let Some(float_win) = app.get_webview_window("floating") {
        float_win.hide().map_err(|e| e.to_string())?;
    }
    main_win.show().map_err(|e| e.to_string())?;
    main_win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// 调整悬浮窗高度：展开（控制面板可见）/ 收起（仅任务卡片行）
#[tauri::command]
pub fn resize_floating_window(app: tauri::AppHandle, expanded: bool) -> Result<(), String> {
    let win = app
        .get_webview_window("floating")
        .ok_or("floating window not found")?;
    if expanded {
        win.set_size(LogicalSize::new(260.0, 310.0))
            .map_err(|e| e.to_string())?;
    } else {
        win.set_size(LogicalSize::new(260.0, 155.0))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 打开导入悬浮窗（从剪贴板/聊天记录批量提取任务）
#[tauri::command]
pub fn show_import_window(app: tauri::AppHandle) -> Result<(), String> {
    let import_win = app
        .get_webview_window("import")
        .ok_or("import window not found")?;
    import_win.show().map_err(|e| e.to_string())?;
    import_win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn hide_import_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(import_win) = app.get_webview_window("import") {
        import_win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 关闭选区窗
#[tauri::command]
pub fn hide_selector_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("selector") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 用系统默认浏览器打开 URL（仅允许 http / https 协议，防止命令注入）
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    let lower = trimmed.to_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err("仅允许 http:// 和 https:// 协议的 URL".into());
    }
    open::that(trimmed).map_err(|e| e.to_string())
}
