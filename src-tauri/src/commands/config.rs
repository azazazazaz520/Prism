use crate::app::tray::{self, CloseToTrayStatus};
use crate::logging::LogLevel;
use crate::models::{Vendor, VendorInput, VendorView};
use crate::storage::secrets::{self, SystemSecretStore};
use crate::AppState;
use std::path::PathBuf;
use tauri::{Emitter, Manager};

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

/// 读取关闭到托盘的完整设置与运行状态快照。
#[tauri::command]
pub fn get_close_to_tray(app: tauri::AppHandle) -> CloseToTrayStatus {
    app.state::<tray::CloseToTrayState>().snapshot(&app)
}

/// 提交关闭到托盘的目标值；成功后返回最新快照。
#[tauri::command]
pub async fn set_close_to_tray(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<CloseToTrayStatus, String> {
    tray::set_enabled(app, enabled).await
}

// ═══════════════════════════════════════════
//  AI 设置查询
// ═══════════════════════════════════════════

/// 获取 AI 配置状态：激活供应商 ID + 是否有启用的供应商
#[tauri::command]
pub fn get_ai_settings_all(state: tauri::State<AppState>) -> serde_json::Value {
    state.with_config(|config| {
        serde_json::json!({
            "active_vendor_id": config.active_vendor_id,
            "has_enabled_vendor": config.vendors.iter().any(|v| v.fields.enabled),
        })
    })
}

// ═══════════════════════════════════════════
//  供应商 CRUD
// ═══════════════════════════════════════════

#[tauri::command]
pub fn get_vendors(state: tauri::State<AppState>) -> Result<Vec<VendorView>, String> {
    let vendors = state.with_config(|config| config.vendors.clone());
    vendors
        .into_iter()
        .map(|vendor| {
            let has_api_key = secrets::vendor_api_key(&SystemSecretStore, &vendor)?.is_some();
            Ok(VendorView {
                fields: vendor.fields,
                has_api_key,
            })
        })
        .collect()
}

/// 新增供应商：密钥先写入凭据库，配置保存失败时回滚凭据。
#[tauri::command]
pub fn add_vendor(
    state: tauri::State<AppState>,
    vendor: VendorInput,
) -> Result<VendorView, String> {
    let store = SystemSecretStore;
    let id = vendor.fields.id.clone();
    let has_api_key = secrets::save_vendor_api_key(&store, &id, vendor.api_key.as_deref())?;
    let saved = Vendor {
        fields: vendor.fields.clone(),
        legacy_api_key: None,
    };
    if let Err(error) = state.with_config_mut(|config| config.vendors.push(saved)) {
        if has_api_key {
            let _ = secrets::delete_vendor_api_key(&store, &id);
        }
        return Err(error);
    }
    Ok(VendorView {
        fields: vendor.fields,
        has_api_key,
    })
}

/// 更新供应商；提交的密钥为空时保留已保存的密钥。
#[tauri::command]
pub fn update_vendor(state: tauri::State<AppState>, vendor: VendorInput) -> Result<(), String> {
    let key_replaced = secrets::save_vendor_api_key(
        &SystemSecretStore,
        &vendor.fields.id,
        vendor.api_key.as_deref(),
    )?;
    state.with_config_mut(|config| {
        if let Some(v) = config
            .vendors
            .iter_mut()
            .find(|v| v.fields.id == vendor.fields.id)
        {
            v.fields = vendor.fields;
            if key_replaced {
                v.legacy_api_key = None;
            }
        }
    })
}

/// 删除供应商，若为当前激活项则清除激活状态；凭据删除失败只记录日志，不影响配置结果。
#[tauri::command]
pub fn delete_vendor(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    state.with_config_mut(|config| {
        config.vendors.retain(|v| v.fields.id != id);
        if config.active_vendor_id.as_deref() == Some(&id) {
            config.active_vendor_id = None;
        }
    })?;
    if let Err(error) = secrets::delete_vendor_api_key(&SystemSecretStore, &id) {
        let _ = state.logger.append_internal(
            LogLevel::Error,
            "secrets",
            "secrets.vendor_delete_failed",
            "供应商已删除，但凭据删除失败",
            serde_json::json!({ "error": error }),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn set_active_vendor(state: tauri::State<AppState>, id: Option<String>) -> Result<(), String> {
    state.with_config_mut(|config| {
        config.active_vendor_id = id;
    })
}

// ═══════════════════════════════════════════
//  主题
// ═══════════════════════════════════════════

#[tauri::command]
pub fn get_theme(state: tauri::State<AppState>) -> String {
    state.with_config(|config| config.theme.clone())
}

#[tauri::command]
pub fn set_theme(
    state: tauri::State<AppState>,
    theme: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    state.with_config_mut(|config| {
        config.theme = theme.clone();
    })?;
    // 广播主题变更到所有窗口（悬浮窗/导入窗等独立 webview）
    app.emit("theme-changed", theme)
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ═══════════════════════════════════════════
//  模块配置
// ═══════════════════════════════════════════

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

/// 获取仪表盘布局配置
#[tauri::command]
pub fn get_dashboard_layout(state: tauri::State<AppState>) -> Option<String> {
    state.with_config(|config| config.dashboard_layout.clone())
}

/// 保存仪表盘布局配置
#[tauri::command]
pub fn set_dashboard_layout(state: tauri::State<AppState>, layout: String) -> Result<(), String> {
    state.with_config_mut(|config| {
        config.dashboard_layout = Some(layout);
    })
}

/// 获取用户配置的 Pandoc 路径；为空时由导出命令自动发现。
#[tauri::command]
pub fn get_pandoc_path(state: tauri::State<AppState>) -> Option<String> {
    state.with_config(|config| {
        config
            .pandoc_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string())
    })
}

/// 设置用户配置的 Pandoc 路径；传入空值可恢复自动发现。
#[tauri::command]
pub fn set_pandoc_path(state: tauri::State<AppState>, path: Option<String>) -> Result<(), String> {
    let next_path = path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from);
    if let Some(path) = &next_path {
        if !path.is_file() {
            return Err("PANDOC_INVALID: 指定的 Pandoc 路径不存在或不是可执行文件".into());
        }
    }
    state.with_config_mut(|config| {
        config.pandoc_path = next_path;
    })
}
