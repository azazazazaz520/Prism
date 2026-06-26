use super::AppState;
use crate::store;
use tauri::Manager;

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

/// 切换回主窗口模式（隐藏悬浮窗）
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

// ── 提醒设置 ──────────────────────────────

/// 设置任务到期提醒的提前分钟数（0 表示关闭提醒）
#[tauri::command]
pub fn set_reminder_minutes(state: tauri::State<AppState>, minutes: u32) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config.reminder_minutes = minutes;
    store::save_config(&config)
}

/// 获取当前提醒设置（分钟数）
#[tauri::command]
pub fn get_reminder_minutes(state: tauri::State<AppState>) -> u32 {
    state.config.lock().unwrap().reminder_minutes
}

// ── AI 设置查询 ──────────────────────────────

/// 获取 AI 配置状态（是否已配置可用供应商）
#[tauri::command]
pub fn get_ai_settings_all(state: tauri::State<AppState>) -> serde_json::Value {
    let config = state.config.lock().unwrap();
    serde_json::json!({
        "active_vendor_id": config.active_vendor_id,
        "has_enabled_vendor": config.vendors.iter().any(|v| v.enabled),
    })
}

// ── 供应商 CRUD ──────────────────────────────

/// 获取所有供应商
#[tauri::command]
pub fn get_vendors(state: tauri::State<AppState>) -> Vec<store::Vendor> {
    state.config.lock().unwrap().vendors.clone()
}

/// 添加供应商
#[tauri::command]
pub fn add_vendor(
    state: tauri::State<AppState>,
    vendor: store::Vendor,
) -> Result<store::Vendor, String> {
    let mut config = state.config.lock().unwrap();
    config.vendors.push(vendor.clone());
    store::save_config(&config)?;
    Ok(vendor)
}

/// 更新供应商
#[tauri::command]
pub fn update_vendor(state: tauri::State<AppState>, vendor: store::Vendor) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    if let Some(v) = config.vendors.iter_mut().find(|v| v.id == vendor.id) {
        *v = vendor;
    }
    store::save_config(&config)
}

/// 删除供应商
#[tauri::command]
pub fn delete_vendor(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config.vendors.retain(|v| v.id != id);
    // 如果删除的是当前激活的供应商，清除激活状态
    if config.active_vendor_id.as_deref() == Some(&id) {
        config.active_vendor_id = None;
    }
    store::save_config(&config)
}

/// 设置激活的供应商
#[tauri::command]
pub fn set_active_vendor(state: tauri::State<AppState>, id: Option<String>) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config.active_vendor_id = id;
    store::save_config(&config)
}

// ── 主题 ──────────────────────────────

/// 获取当前主题设置
#[tauri::command]
pub fn get_theme(state: tauri::State<AppState>) -> String {
    state.config.lock().unwrap().theme.clone()
}

/// 设置主题模式并持久化
#[tauri::command]
pub fn set_theme(state: tauri::State<AppState>, theme: String) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config.theme = theme;
    store::save_config(&config)
}

// ── 模块配置 ──────────────────────────────

/// 获取所有模块的启用状态
#[tauri::command]
pub fn get_module_enabled(
    state: tauri::State<AppState>,
) -> std::collections::HashMap<String, bool> {
    state.config.lock().unwrap().module_enabled.clone()
}

/// 设置单个模块的启用状态
#[tauri::command]
pub fn set_module_enabled(
    state: tauri::State<AppState>,
    module_id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config.module_enabled.insert(module_id, enabled);
    store::save_config(&config)
}
