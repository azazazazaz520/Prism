pub mod ai;
pub mod config;
pub mod notes;
pub mod prompt;
pub mod screenshot;
pub mod tasks;

use serde::Serialize;

use crate::AppState;

/// 聚合同步配置的返回结构
#[derive(Debug, Serialize)]
pub struct SyncConfig {
    pub sync_code: Option<String>,
    pub profile_id: Option<String>,
    pub last_sync_at: Option<String>,
}

/// 获取完整同步配置
#[tauri::command]
pub fn get_sync_config(state: tauri::State<AppState>) -> SyncConfig {
    state.with_sync(|sync| SyncConfig {
        sync_code: sync.sync_code.clone(),
        profile_id: sync.profile_id.clone(),
        last_sync_at: sync.last_sync_at.clone(),
    })
}

/// 设置同步配置（部分更新：传入字段替换，未传入字段保持不变）
#[tauri::command]
pub fn set_sync_config(
    state: tauri::State<AppState>,
    sync_code: Option<String>,
    profile_id: Option<String>,
    last_sync_at: Option<String>,
) -> Result<(), String> {
    state.with_sync_mut(|sync| {
        if let Some(v) = sync_code {
            sync.sync_code = Some(v);
        }
        if let Some(v) = profile_id {
            sync.profile_id = Some(v);
        }
        if let Some(v) = last_sync_at {
            sync.last_sync_at = Some(v);
        }
    })
}
