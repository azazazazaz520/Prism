use crate::storage::secrets::{self, SystemSecretStore};
use crate::{ai, AppState};

/// 解析当前 AI 配置：优先用选中的供应商，否则用第一个启用的；API 密钥从凭据库读取。
pub(crate) fn resolve_ai_settings(
    config: &crate::models::ConfigStore,
) -> Result<ai::AiSettings, String> {
    let vendor = config
        .active_vendor_id
        .as_ref()
        .and_then(|active_id| {
            config
                .vendors
                .iter()
                .find(|v| v.fields.id == *active_id && v.fields.enabled)
        })
        .or_else(|| config.vendors.iter().find(|v| v.fields.enabled))
        .ok_or("AI 未配置：请在设置中添加并启用供应商")?;
    let api_key = secrets::vendor_api_key(&SystemSecretStore, vendor)?
        .ok_or("AI 未配置：请在设置中填写 API 密钥")?;
    Ok(ai::AiSettings {
        enabled: true,
        api_endpoint: format!("{}{}", vendor.fields.base_url, vendor.fields.api_path),
        api_key,
        model: vendor.fields.model.clone(),
    })
}

/// 解析 AI 配置，并在任务数据读锁内执行命令前置操作。
pub fn with_ai_context<F, R>(state: &AppState, f: F) -> Result<R, String>
where
    F: FnOnce(&ai::AiSettings, &crate::models::DataStore) -> Result<R, String>,
{
    let settings = state.with_config(resolve_ai_settings)?;
    state.read_data(|data| f(&settings, data))
}
