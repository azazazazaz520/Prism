use crate::plugins::{discovery, network, protocol, security};
use crate::{models::PluginConfig, AppState};
use discovery::{PluginManifestInfo, ScriptMeta};
use network::{NetworkFetchOptions, NetworkFetchResponse};

fn check_plugin_permission(
    state: &AppState,
    plugin_id: &str,
    required: &str,
) -> Result<(), String> {
    state.with_config(|config| security::check_plugin_permission(config, plugin_id, required))
}

#[tauri::command]
pub fn scan_plugins() -> Vec<PluginManifestInfo> {
    discovery::scan_plugins()
}

/// 获取所有已存储的插件配置
#[tauri::command]
pub fn get_plugin_configs(
    state: tauri::State<AppState>,
) -> std::collections::HashMap<String, PluginConfig> {
    state.with_config(|config| config.plugins.clone())
}

/// 保存单个插件或脚本的配置（启用/禁用状态 + 裁剪后权限）。
/// 对 plugin_id 做格式校验，防止污染 ConfigStore。
#[tauri::command]
pub fn set_plugin_config(
    state: tauri::State<AppState>,
    plugin_id: String,
    config: PluginConfig,
) -> Result<(), String> {
    if !security::is_valid_callable_id(&plugin_id) {
        return Err(format!("非法插件 ID: '{}'", plugin_id));
    }
    state.with_config_mut(|c| {
        c.plugins.insert(plugin_id, config);
    })
}

#[tauri::command]
pub fn read_plugin_file(plugin_id: String, file_path: String) -> Result<String, String> {
    discovery::read_plugin_file(plugin_id, file_path)
}

/// 获取所有活跃任务（过滤已软删除），仅限 tasks:read 权限
#[tauri::command]
pub fn plugin_tasks_list(
    state: tauri::State<AppState>,
    plugin_id: String,
) -> Result<Vec<crate::models::Task>, String> {
    check_plugin_permission(&state, &plugin_id, "tasks:read")?;
    Ok(state.read_data(crate::tasks::service::list))
}

/// 获取指定日期的任务，仅限 tasks:read 权限
#[tauri::command]
pub fn plugin_tasks_list_by_date(
    state: tauri::State<AppState>,
    plugin_id: String,
    date: String,
) -> Result<Vec<crate::models::Task>, String> {
    check_plugin_permission(&state, &plugin_id, "tasks:read")?;
    Ok(state.read_data(|d| crate::tasks::service::list_by_date(d, &date)))
}

/// 新增任务，仅限 tasks:write 权限。
#[tauri::command]
pub fn plugin_tasks_create(
    state: tauri::State<AppState>,
    plugin_id: String,
    args: crate::tasks::service::AddTaskInput,
) -> Result<crate::models::Task, String> {
    check_plugin_permission(&state, &plugin_id, "tasks:write")?;
    state
        .write_data(|data| crate::tasks::service::add(data, args))
        .map(|task| state.saved_task(task))
}

/// 更新请求提供的任务字段，仅限 tasks:write 权限。
#[tauri::command]
pub fn plugin_tasks_update(
    state: tauri::State<AppState>,
    plugin_id: String,
    args: crate::tasks::service::UpdateTaskInput,
) -> Result<(), String> {
    check_plugin_permission(&state, &plugin_id, "tasks:write")?;
    state.write_data_candidate(|data| {
        crate::tasks::service::update(data, args)
            .map(|_| ())
            .ok_or_else(|| "任务不存在".into())
    })
}

/// 设置或切换任务完成状态，仅限 tasks:write 权限。
#[tauri::command]
pub fn plugin_tasks_toggle(
    state: tauri::State<AppState>,
    plugin_id: String,
    id: String,
    completed: Option<bool>,
) -> Result<crate::models::Task, String> {
    check_plugin_permission(&state, &plugin_id, "tasks:write")?;
    state
        .write_data_candidate(|data| {
            let daily_task = data
                .tasks
                .iter()
                .find(|task| task.id == id && task.is_daily)
                .cloned();
            let task = if let Some(daily) = daily_task {
                crate::tasks::service::set_daily_completed(
                    data,
                    &id,
                    &chrono::Local::now().format("%Y-%m-%d").to_string(),
                    completed.unwrap_or(!daily.completed),
                )
            } else {
                match completed {
                    Some(target) => crate::tasks::service::set_completed(data, &id, target),
                    None => crate::tasks::service::toggle(data, &id),
                }
            };
            task.ok_or_else(|| format!("task not found: {id}"))
        })
        .map(|task| state.saved_task(task))
}

/// 软删除任务，仅限 tasks:write 权限。
#[tauri::command]
pub fn plugin_tasks_delete(
    state: tauri::State<AppState>,
    plugin_id: String,
    id: String,
) -> Result<(), String> {
    check_plugin_permission(&state, &plugin_id, "tasks:write")?;
    state.write_data_candidate(|data| {
        crate::tasks::service::delete(data, &id).ok_or_else(|| "任务不存在".into())
    })
}

#[tauri::command]
pub async fn plugin_network_fetch(
    state: tauri::State<'_, AppState>,
    plugin_id: String,
    url: String,
    options: Option<NetworkFetchOptions>,
) -> Result<NetworkFetchResponse, String> {
    let has_local = check_plugin_permission(&state, &plugin_id, "network:local").is_ok();
    if !has_local {
        check_plugin_permission(&state, &plugin_id, "network")?;
    }
    network::fetch(has_local, url, options).await
}

#[tauri::command]
pub fn scan_scripts() -> Vec<ScriptMeta> {
    discovery::scan_scripts()
}

#[tauri::command]
pub fn read_script_content(file_name: String) -> Result<String, String> {
    discovery::read_script_content(file_name)
}

#[tauri::command]
pub fn register_plugin_module(
    state: tauri::State<AppState>,
    plugin_id: String,
    token: String,
    source: String,
) -> Result<String, String> {
    protocol::register_plugin_module(&state, plugin_id, token, source)
}
