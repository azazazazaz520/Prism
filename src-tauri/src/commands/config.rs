use crate::store;
use crate::AppState;
use tauri::{LogicalSize, Manager};

// ── 窗口管理 ──────────────────────────────

/// 切换到悬浮小窗模式（隐藏主窗口）
#[tauri::command]
pub fn show_floating_window(app: tauri::AppHandle) -> Result<(), String> {
    let float_win = app
        .get_webview_window("floating")
        .ok_or("floating window not found")?;
    if let Some(main_win) = app.get_webview_window("main") {
        main_win.hide().map_err(|e| e.to_string())?;
    }
    float_win.show().map_err(|e| e.to_string())?;
    float_win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let main_win = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
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

// ── 提醒设置 ──────────────────────────────

/// 设置任务到期提醒的提前分钟数（0 表示关闭提醒）
#[tauri::command]
pub fn set_reminder_minutes(state: tauri::State<AppState>, minutes: u32) -> Result<(), String> {
    state.with_config_mut(|config| {
        config.reminder_minutes = minutes;
    })
}

#[tauri::command]
pub fn get_reminder_minutes(state: tauri::State<AppState>) -> u32 {
    state.with_config(|config| config.reminder_minutes)
}

// ── AI 设置查询 ──────────────────────────────

/// 获取 AI 配置状态：激活供应商 ID + 是否有启用的供应商
#[tauri::command]
pub fn get_ai_settings_all(state: tauri::State<AppState>) -> serde_json::Value {
    state.with_config(|config| {
        serde_json::json!({
            "active_vendor_id": config.active_vendor_id,
            "has_enabled_vendor": config.vendors.iter().any(|v| v.enabled),
        })
    })
}

// ── 供应商 CRUD ──────────────────────────────

#[tauri::command]
pub fn get_vendors(state: tauri::State<AppState>) -> Vec<store::Vendor> {
    state.with_config(|config| config.vendors.clone())
}

#[tauri::command]
pub fn add_vendor(
    state: tauri::State<AppState>,
    vendor: store::Vendor,
) -> Result<store::Vendor, String> {
    state.with_config_mut(|config| {
        config.vendors.push(vendor.clone());
        vendor
    })
}

#[tauri::command]
pub fn update_vendor(state: tauri::State<AppState>, vendor: store::Vendor) -> Result<(), String> {
    state.with_config_mut(|config| {
        if let Some(v) = config.vendors.iter_mut().find(|v| v.id == vendor.id) {
            *v = vendor;
        }
    })
}

/// 删除供应商，若为当前激活项则清除激活状态
#[tauri::command]
pub fn delete_vendor(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    state.with_config_mut(|config| {
        config.vendors.retain(|v| v.id != id);
        if config.active_vendor_id.as_deref() == Some(&id) {
            config.active_vendor_id = None;
        }
    })
}

#[tauri::command]
pub fn set_active_vendor(state: tauri::State<AppState>, id: Option<String>) -> Result<(), String> {
    state.with_config_mut(|config| {
        config.active_vendor_id = id;
    })
}

// ── 主题 ──────────────────────────────

#[tauri::command]
pub fn get_theme(state: tauri::State<AppState>) -> String {
    state.with_config(|config| config.theme.clone())
}

#[tauri::command]
pub fn set_theme(state: tauri::State<AppState>, theme: String) -> Result<(), String> {
    state.with_config_mut(|config| {
        config.theme = theme;
    })
}

// ── 模块配置 ──────────────────────────────

#[tauri::command]
pub fn get_module_enabled(
    state: tauri::State<AppState>,
) -> std::collections::HashMap<String, bool> {
    state.with_config(|config| config.module_enabled.clone())
}

#[tauri::command]
pub fn set_module_enabled(
    state: tauri::State<AppState>,
    module_id: String,
    enabled: bool,
) -> Result<(), String> {
    state.with_config_mut(|config| {
        config.module_enabled.insert(module_id, enabled);
    })
}
