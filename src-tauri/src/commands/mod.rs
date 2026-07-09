pub mod ai;
pub mod config;
pub mod notes;
pub mod prompt;
pub mod screenshot;
pub mod tasks;

use std::collections::HashSet;
use std::sync::Mutex;

use serde::Serialize;

use crate::ai::AiSettings;
use crate::store;

/// 解析当前 AI 配置：优先用选中的供应商，否则用第一个启用的
pub(crate) fn resolve_ai_settings(config: &store::ConfigStore) -> Result<AiSettings, String> {
    // 1. 有 active_vendor_id 且供应商存在且启用
    if let Some(active_id) = &config.active_vendor_id {
        if let Some(v) = config
            .vendors
            .iter()
            .find(|v| v.id == *active_id && v.enabled)
        {
            return Ok(AiSettings {
                enabled: true,
                api_endpoint: format!("{}{}", v.base_url, v.api_path),
                api_key: v.api_key.clone(),
                model: v.model.clone(),
            });
        }
    }
    // 2. 找第一个启用的供应商
    if let Some(v) = config.vendors.iter().find(|v| v.enabled) {
        return Ok(AiSettings {
            enabled: true,
            api_endpoint: format!("{}{}", v.base_url, v.api_path),
            api_key: v.api_key.clone(),
            model: v.model.clone(),
        });
    }
    // 3. 无可用供应商
    Err("AI 未配置：请在设置中添加并启用供应商".into())
}

/// 应用全局状态，由 Tauri 托管，可在所有命令中访问
pub struct AppState {
    /// 任务数据存储（受 Mutex 保护，确保线程安全）
    pub data: Mutex<store::DataStore>,
    /// 应用配置（供应商、主题、提醒等）
    pub config: Mutex<store::ConfigStore>,
    /// 同步状态（配对码、profile、上次同步时间）
    pub sync: Mutex<store::SyncStore>,
    /// 当天已通知的任务 ID 集合，避免重复提醒
    pub notified_today: Mutex<HashSet<String>>,
}

impl AppState {
    /// 读锁快捷方式：锁定 DataStore → 执行只读操作 → 返回结果
    pub fn read_data<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&store::DataStore) -> R,
    {
        let data = self.data.lock().unwrap();
        f(&data)
    }

    /// 写锁快捷方式：锁定 DataStore → 执行修改 → 保存 → 返回结果
    pub fn write_data<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&mut store::DataStore) -> R,
    {
        let mut data = self.data.lock().unwrap();
        let result = f(&mut data);
        store::save_data(&data)?;
        Ok(result)
    }
}

/// 统一的 AI 命令前置：resolve 配置 + 安全获取数据快照。
/// 内部处理锁的获取和 AI 设置解析，调用方只需关注数据提取逻辑。
pub fn with_ai_context<F, R>(state: &AppState, f: F) -> Result<R, String>
where
    F: FnOnce(&AiSettings, &store::DataStore) -> Result<R, String>,
{
    let config = state.config.lock().unwrap();
    let settings = resolve_ai_settings(&config)?;
    let data = state.data.lock().unwrap();
    f(&settings, &data)
}

// ═══════════════════════════════════════════════════════════════
//  同步配置命令（从 commands/sync.rs 并入）
// ═══════════════════════════════════════════════════════════════

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
    state: tauri::State<AppState>,
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
