use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::models::PluginConfig;
use crate::persistence;
use crate::AppState;

// ═══════════════════════════════════════════════════════════════
//  路径沙箱
// ═══════════════════════════════════════════════════════════════

/// 解析插件目录内的文件路径，防止路径穿越攻击。
///
/// 使用 `canonicalize` 规范化路径后，校验其是否仍在
/// `<workspace>/plugins/<plugin_id>/` 目录之内。
/// 超出范围则返回 `Err`。
fn resolve_plugin_path(plugin_id: &str, relative_path: &str) -> Result<PathBuf, String> {
    let plugins_dir = persistence::get_plugins_dir();
    let full_path = plugins_dir.join(plugin_id).join(relative_path);

    // 规范化路径（解析 ../ 和符号链接）
    let canonical = full_path
        .canonicalize()
        .map_err(|e| format!("无法解析路径: {}", e))?;

    // 规范化插件根目录
    let plugin_root = plugins_dir.join(plugin_id);
    let canonical_root = plugin_root
        .canonicalize()
        .unwrap_or(plugin_root);

    // 校验路径前缀：必须在插件目录之内
    if !canonical.starts_with(&canonical_root) {
        return Err(format!(
            "路径穿越检测：'{}' 不在插件 '{}' 目录之内",
            relative_path, plugin_id
        ));
    }

    Ok(canonical)
}

// ═══════════════════════════════════════════════════════════════
//  清单结构（前端可见）
// ═══════════════════════════════════════════════════════════════

#[derive(Debug, Serialize, Clone)]
pub struct PluginManifestInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: String,
    pub main: String,
    pub engines: EnginesInfo,
    #[serde(default)]
    pub permissions: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct EnginesInfo {
    pub prism: String,
}

// ═══════════════════════════════════════════════════════════════
//  Tauri 命令
// ═══════════════════════════════════════════════════════════════

/// 扫描 `~/.prism/plugins/` 目录，读取所有插件的 manifest.json。
/// 解析失败的插件跳过并记录 stderr，不阻塞其他插件。
#[tauri::command]
pub fn scan_plugins() -> Vec<PluginManifestInfo> {
    let plugins_dir = persistence::get_plugins_dir();
    let mut manifests = Vec::new();

    let entries = match fs::read_dir(&plugins_dir) {
        Ok(e) => e,
        Err(_) => return manifests, // 目录不存在或无权限时返回空
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let plugin_id = match path.file_name().and_then(|n| n.to_str()) {
            Some(id) => id.to_string(),
            None => continue,
        };

        // 读取 manifest.json（路径已在插件目录内，无需额外沙箱检查）
        let manifest_path = path.join("manifest.json");
        let content = match fs::read_to_string(&manifest_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let manifest: serde_json::Value = match serde_json::from_str(&content) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[plugins] {} 的 manifest.json 解析失败: {}", plugin_id, e);
                continue;
            }
        };

        // 提取必要字段
        let id = manifest.get("id").and_then(|v| v.as_str()).unwrap_or(&plugin_id);
        let name = manifest
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(id);
        let version = manifest
            .get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("0.0.0");
        let description = manifest
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let author = manifest
            .get("author")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let main = manifest
            .get("main")
            .and_then(|v| v.as_str())
            .unwrap_or("main.js");
        let engines_prism = manifest
            .get("engines")
            .and_then(|v| v.get("prism"))
            .and_then(|v| v.as_str())
            .unwrap_or(">=0.1.0");
        let permissions: Vec<String> = manifest
            .get("permissions")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|p| p.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        manifests.push(PluginManifestInfo {
            id: id.to_string(),
            name: name.to_string(),
            version: version.to_string(),
            description,
            author: author.to_string(),
            main: main.to_string(),
            engines: EnginesInfo {
                prism: engines_prism.to_string(),
            },
            permissions,
        });
    }

    manifests
}

/// 获取所有已存储的插件配置
#[tauri::command]
pub fn get_plugin_configs(
    state: tauri::State<AppState>,
) -> std::collections::HashMap<String, PluginConfig> {
    state.with_config(|config| config.plugins.clone())
}

/// 保存单个插件的配置（启用/禁用状态 + 裁剪后权限）
#[tauri::command]
pub fn set_plugin_config(
    state: tauri::State<AppState>,
    plugin_id: String,
    config: PluginConfig,
) -> Result<(), String> {
    state.with_config_mut(|c| {
        c.plugins.insert(plugin_id, config);
    })
}

/// 读取插件目录内的文件内容（经路径沙箱校验）
#[tauri::command]
pub fn read_plugin_file(plugin_id: String, file_path: String) -> Result<String, String> {
    let safe_path = resolve_plugin_path(&plugin_id, &file_path)?;
    fs::read_to_string(&safe_path).map_err(|e| format!("读取文件失败: {}", e))
}

// ═══════════════════════════════════════════════════════════════
//  领域命令 — prism:tasks
// ═══════════════════════════════════════════════════════════════

/// 校验插件是否持有指定权限。
/// 从 ConfigStore.plugins 读取已持久化的权限列表，
/// 不信任前端传入的任何权限声明（第三层防线）。
fn check_plugin_permission(
    state: &AppState,
    plugin_id: &str,
    required: &str,
) -> Result<(), String> {
    let config = state.with_config(|c| c.plugins.get(plugin_id).cloned());
    match config {
        Some(cfg) if cfg.enabled && cfg.permissions.iter().any(|p| p == required) => Ok(()),
        Some(_) => Err(format!(
            "插件 '{}' 缺少权限 '{}'",
            plugin_id, required
        )),
        None => Err(format!("插件 '{}' 未找到或未启用", plugin_id)),
    }
}

/// 获取所有活跃任务（过滤已软删除），仅限 tasks:read 权限
#[tauri::command]
pub fn plugin_tasks_list(
    state: tauri::State<AppState>,
    plugin_id: String,
) -> Result<Vec<crate::store::Task>, String> {
    check_plugin_permission(&state, &plugin_id, "tasks:read")?;
    Ok(state.read_data(crate::task_service::list))
}

/// 获取指定日期的任务，仅限 tasks:read 权限
#[tauri::command]
pub fn plugin_tasks_list_by_date(
    state: tauri::State<AppState>,
    plugin_id: String,
    date: String,
) -> Result<Vec<crate::store::Task>, String> {
    check_plugin_permission(&state, &plugin_id, "tasks:read")?;
    Ok(state.read_data(|d| crate::task_service::list_by_date(d, &date)))
}

/// 获取当前同步 profile_id，用于插件任务自动关联到同步 Profile
fn current_profile_id(state: &AppState) -> Option<String> {
    state.with_sync(|s| s.profile_id.clone())
}

/// 新增任务，仅限 tasks:write 权限
/// 自动关联当前同步 profile_id，确保任务可被 Sync 系统推送
#[tauri::command]
pub fn plugin_tasks_create(
    state: tauri::State<AppState>,
    plugin_id: String,
    args: crate::task_service::AddTaskInput,
) -> Result<crate::store::Task, String> {
    check_plugin_permission(&state, &plugin_id, "tasks:write")?;
    let profile_id = current_profile_id(&state);
    state.write_data(|d| {
        let mut task = crate::task_service::add(d, args);
        task.profile_id = profile_id.clone();
        if let Some(t) = d.tasks.iter_mut().find(|t| t.id == task.id) {
            t.profile_id = profile_id;
        }
        task
    })
}

/// 更新任务（标题、标签、重要/置顶/每日标记），仅限 tasks:write 权限
#[tauri::command]
pub fn plugin_tasks_update(
    state: tauri::State<AppState>,
    plugin_id: String,
    args: crate::task_service::UpdateTaskInput,
) -> Result<(), String> {
    check_plugin_permission(&state, &plugin_id, "tasks:write")?;
    let profile_id = current_profile_id(&state);
    let task_id = args.id.clone();
    state.write_data(|d| {
        crate::task_service::update(d, args);
        if let Some(t) = d.tasks.iter_mut().find(|t| t.id == task_id) {
            t.profile_id = profile_id.clone();
        }
    })
}

/// 切换任务完成状态，仅限 tasks:write 权限
#[tauri::command]
pub fn plugin_tasks_toggle(
    state: tauri::State<AppState>,
    plugin_id: String,
    id: String,
) -> Result<crate::store::Task, String> {
    check_plugin_permission(&state, &plugin_id, "tasks:write")?;
    let profile_id = current_profile_id(&state);
    state
        .write_data(|d| {
            let opt = crate::task_service::toggle(d, &id);
            if let Some(ref t) = opt {
                if let Some(store_t) = d.tasks.iter_mut().find(|st| st.id == t.id) {
                    store_t.profile_id = profile_id.clone();
                }
            }
            opt
        })
        .and_then(|opt| opt.ok_or_else(|| format!("task not found: {id}")))
}

/// 软删除任务，仅限 tasks:write 权限
#[tauri::command]
pub fn plugin_tasks_delete(
    state: tauri::State<AppState>,
    plugin_id: String,
    id: String,
) -> Result<(), String> {
    check_plugin_permission(&state, &plugin_id, "tasks:write")?;
    let profile_id = current_profile_id(&state);
    state.write_data(|d| {
        crate::task_service::delete(d, &id);
        // 更新 profile_id 确保删除操作同步到远端
        if let Some(t) = d.tasks.iter_mut().find(|t| t.id == id) {
            t.profile_id = profile_id;
        }
    })
}

// ═══════════════════════════════════════════════════════════════
//  领域命令 — prism:network
// ═══════════════════════════════════════════════════════════════

/// 网络请求选项（前端 JSON 序列化传入）
#[derive(Debug, Deserialize)]
pub struct NetworkFetchOptions {
    #[serde(default = "default_method")]
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: Option<String>,
}

fn default_method() -> String {
    "GET".to_string()
}

/// 网络请求响应（返回给前端）
#[derive(Debug, Serialize)]
pub struct NetworkFetchResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

/// 从 URL 字符串中提取主机名（手动解析，无额外依赖）
fn extract_host(url: &str) -> Option<&str> {
    let pos = url.find("://")?;
    let after = &url[pos + 3..];
    let end = after
        .find(|c: char| ['/', '?', '#', ':'].contains(&c))
        .unwrap_or(after.len());
    Some(&after[..end])
}

/// 校验目标 URL 是否合法。
/// - `network` 权限：仅允许公网地址
/// - `network:local` 权限：额外允许 localhost / LAN 地址
fn validate_network_url(url: &str, has_local_perm: bool) -> Result<(), String> {
    let host = extract_host(url).ok_or_else(|| "URL 格式无效，缺少 :// 标记".to_string())?;

    if host.is_empty() {
        return Err("URL 主机名为空".to_string());
    }

    // 判断是否为本地/私有地址
    let is_local = match host {
        "localhost" | "127.0.0.1" | "0.0.0.0" | "[::1]" | "::1" => true,
        other => {
            other.starts_with("10.")
                || other.starts_with("192.168.")
                || {
                    // 172.16.0.0/12
                    if other.starts_with("172.") && other.len() > 4 {
                        let rest = &other[4..]; // skip "172."
                        let parts: Vec<&str> = rest.split('.').collect();
                        parts.len() >= 2
                            && parts[0]
                                .parse::<u8>()
                                .map(|n| (16..=31).contains(&n))
                                .unwrap_or(false)
                    } else {
                        false
                    }
                }
        }
    };

    if is_local && !has_local_perm {
        return Err(format!(
            "禁止访问内网地址 '{}'，需 network:local 权限",
            host
        ));
    }

    Ok(())
}

/// HTTP 代理请求（通过 Rust Host 发出，避免浏览器 CORS/混合内容限制）
/// 仅限 network 权限（公网）或 network:local 权限（公网 + 内网）
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

    validate_network_url(&url, has_local)?;

    let opts = options.unwrap_or(NetworkFetchOptions {
        method: "GET".to_string(),
        headers: HashMap::new(),
        body: None,
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let mut req = client.request(
        reqwest::Method::from_bytes(opts.method.as_bytes())
            .map_err(|e| format!("无效的 HTTP 方法: {}", e))?,
        &url,
    );

    // 设置自定义请求头
    for (key, value) in &opts.headers {
        req = req.header(key.as_str(), value.as_str());
    }

    // 设置请求体
    if let Some(body) = &opts.body {
        req = req.body(body.clone());
    }

    let resp = req.send().await.map_err(|e| format!("请求失败: {}", e))?;

    let status = resp.status().as_u16();
    let resp_headers: HashMap<String, String> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let body = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    Ok(NetworkFetchResponse {
        status,
        headers: resp_headers,
        body,
    })
}
