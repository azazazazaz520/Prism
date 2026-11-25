use serde::Serialize;

use crate::storage::secrets::{self, SystemSecretStore};
use crate::AppState;

/// 聚合同步配置的返回结构
#[derive(Debug, Serialize)]
pub struct SyncConfig {
    pub sync_code: Option<String>,
    pub profile_id: Option<String>,
    pub last_sync_at: Option<String>,
}

/// 获取完整同步配置；同步码从系统凭据库读取
#[tauri::command]
pub fn get_sync_config(state: tauri::State<AppState>) -> Result<SyncConfig, String> {
    state.with_sync(|sync| {
        Ok(SyncConfig {
            sync_code: secrets::sync_code(&SystemSecretStore, sync)?,
            profile_id: sync.profile_id.clone(),
            last_sync_at: sync.last_sync_at.clone(),
        })
    })
}

/// 设置同步配置（部分更新：传入字段替换，未传入字段保持不变）；同步码写入系统凭据库
#[tauri::command]
pub fn set_sync_config(
    state: tauri::State<AppState>,
    sync_code: Option<String>,
    profile_id: Option<String>,
    last_sync_at: Option<String>,
) -> Result<(), String> {
    let code_replaced = secrets::save_sync_code(&SystemSecretStore, sync_code.as_deref())?;
    state.with_sync_mut(|sync| {
        if code_replaced {
            sync.legacy_sync_code = None;
        }
        if let Some(v) = profile_id {
            sync.profile_id = Some(v);
        }
        if let Some(v) = last_sync_at {
            sync.last_sync_at = Some(v);
        }
    })
}
