pub mod ai;
pub mod config;
pub mod screenshot;
pub mod tasks;

use std::collections::HashSet;
use std::sync::Mutex;

use serde::Deserialize;

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
    /// 当天已通知的任务 ID 集合，避免重复提醒
    pub notified_today: Mutex<HashSet<String>>,
}

/// 新增任务的请求参数（聚合为 struct 避免参数过多）
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTaskArgs {
    pub title: String,
    pub due_date: Option<String>,
    pub tags: Option<Vec<String>>,
    pub important: Option<bool>,
    pub pinned: Option<bool>,
    pub is_daily: Option<bool>,
    pub parent_id: Option<String>,
}

/// 更新任务的请求参数（聚合为 struct 避免参数过多）
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskArgs {
    pub id: String,
    pub title: String,
    pub due_date: Option<String>,
    pub tags: Vec<String>,
    pub important: bool,
    pub pinned: bool,
    pub is_daily: bool,
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
