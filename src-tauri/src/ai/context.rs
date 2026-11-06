use crate::{ai, AppState};

/// 解析当前 AI 配置：优先用选中的供应商，否则用第一个启用的
pub(crate) fn resolve_ai_settings(
    config: &crate::models::ConfigStore,
) -> Result<ai::AiSettings, String> {
    if let Some(active_id) = &config.active_vendor_id {
        if let Some(v) = config
            .vendors
            .iter()
            .find(|v| v.id == *active_id && v.enabled)
        {
            return Ok(ai::AiSettings {
                enabled: true,
                api_endpoint: format!("{}{}", v.base_url, v.api_path),
                api_key: v.api_key.clone(),
                model: v.model.clone(),
            });
        }
    }
    if let Some(v) = config.vendors.iter().find(|v| v.enabled) {
        return Ok(ai::AiSettings {
            enabled: true,
            api_endpoint: format!("{}{}", v.base_url, v.api_path),
            api_key: v.api_key.clone(),
            model: v.model.clone(),
        });
    }
    Err("AI 未配置：请在设置中添加并启用供应商".into())
}

/// 解析 AI 配置，并在任务数据读锁内执行命令前置操作。
pub fn with_ai_context<F, R>(state: &AppState, f: F) -> Result<R, String>
where
    F: FnOnce(&ai::AiSettings, &crate::models::DataStore) -> Result<R, String>,
{
    let settings = state.with_config(resolve_ai_settings)?;
    state.read_data(|data| f(&settings, data))
}
