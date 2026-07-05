use crate::store;
use serde::Serialize;

/// 聚合同步配置的返回结构
#[derive(Debug, Serialize)]
pub struct SyncConfig {
    pub sync_code: Option<String>,
    pub profile_id: Option<String>,
    pub last_sync_at: Option<String>,
}

/// 获取完整同步配置
#[tauri::command]
pub fn get_sync_config(state: tauri::State<super::AppState>) -> SyncConfig {
    let sync = state.sync.lock().unwrap();
    SyncConfig {
        sync_code: sync.sync_code.clone(),
        profile_id: sync.profile_id.clone(),
        last_sync_at: sync.last_sync_at.clone(),
    }
}

/// 设置同步配置（部分更新：传入字段替换，未传入字段保持不变）
#[tauri::command]
pub fn set_sync_config(
    state: tauri::State<super::AppState>,
    sync_code: Option<String>,
    profile_id: Option<String>,
    last_sync_at: Option<String>,
) -> Result<(), String> {
    let mut sync = state.sync.lock().unwrap();
    if sync_code.is_some() {
        sync.sync_code = sync_code;
    }
    if profile_id.is_some() {
        sync.profile_id = profile_id;
    }
    if last_sync_at.is_some() {
        sync.last_sync_at = last_sync_at;
    }
    store::save_sync(&sync)
}
