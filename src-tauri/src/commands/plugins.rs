use std::collections::HashMap;
use std::fs;
use std::net::{IpAddr, Ipv6Addr, ToSocketAddrs};
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use url::Url;

use crate::models::PluginConfig;
use crate::persistence;
use crate::AppState;

// ═══════════════════════════════════════════════════════════════
//  路径沙箱
// ═══════════════════════════════════════════════════════════════

/// 校验插件 ID 格式：反向域名风格，至少两段，
/// 段内仅允许 ASCII 字母数字、连字符与下划线。
/// 拒绝路径分隔符、`.`/`..` 段与空段，防止路径构造注入（审查报告 H-7）。
fn is_valid_plugin_id(plugin_id: &str) -> bool {
    if plugin_id.is_empty() || plugin_id.len() > 128 {
        return false;
    }
    let mut segment_count = 0;
    for segment in plugin_id.split('.') {
        segment_count += 1;
        if segment.is_empty()
            || !segment
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return false;
        }
    }
    segment_count >= 2
}

/// 校验脚本 ID 格式：`script:` 前缀 + 合法名称。
fn is_valid_script_id(plugin_id: &str) -> bool {
    match plugin_id.strip_prefix("script:") {
        Some(name) => {
            !name.is_empty()
                && name.len() <= 128
                && name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        }
        None => false,
    }
}

/// 可调用方 ID（插件或脚本）的格式校验。
fn is_valid_callable_id(plugin_id: &str) -> bool {
    is_valid_plugin_id(plugin_id) || is_valid_script_id(plugin_id)
}

/// 解析插件目录内的文件路径，防止路径穿越攻击。
///
/// 使用 `canonicalize` 规范化路径后，校验其是否仍在
/// `<workspace>/plugins/<plugin_id>/` 目录之内。
/// 超出范围则返回 `Err`。
fn resolve_plugin_path(plugin_id: &str, relative_path: &str) -> Result<PathBuf, String> {
    if !is_valid_plugin_id(plugin_id) {
        return Err(format!("非法插件 ID: '{}'", plugin_id));
    }
    let plugins_dir = persistence::get_plugins_dir();
    let full_path = plugins_dir.join(plugin_id).join(relative_path);

    // 规范化路径（解析 ../ 和符号链接）
    let canonical = full_path
        .canonicalize()
        .map_err(|e| format!("无法解析路径: {}", e))?;

    // 规范化插件根目录
    let plugin_root = plugins_dir.join(plugin_id);
    let canonical_root = plugin_root.canonicalize().unwrap_or(plugin_root);

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
        if let Some(manifest) = read_plugin_manifest(&entry.path()) {
            manifests.push(manifest);
        }
    }

    manifests
}

fn read_plugin_manifest(plugin_dir: &std::path::Path) -> Option<PluginManifestInfo> {
    if !plugin_dir.is_dir() {
        return None;
    }

    let plugin_id = plugin_dir.file_name()?.to_str()?.to_string();
    let manifest_path = plugin_dir.join("manifest.json");
    let content = fs::read_to_string(&manifest_path).ok()?;
    let manifest = match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(value) => value,
        Err(error) => {
            eprintln!(
                "[plugins] {} 的 manifest.json 解析失败: {}",
                plugin_id, error
            );
            return None;
        }
    };

    // manifest 声明的 id 必须通过格式校验，否则跳过该插件（审查报告 H-7）
    if let Some(id) = manifest.get("id").and_then(serde_json::Value::as_str) {
        if !is_valid_plugin_id(id) {
            eprintln!("[plugins] {} 的 manifest.id 非法: {}", plugin_id, id);
            return None;
        }
    }

    Some(parse_plugin_manifest(&plugin_id, &manifest))
}

fn parse_plugin_manifest(plugin_id: &str, manifest: &serde_json::Value) -> PluginManifestInfo {
    let id = manifest
        .get("id")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(plugin_id);
    let name = string_field(manifest, "name", id);
    let version = string_field(manifest, "version", "0.0.0");
    let description = manifest
        .get("description")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let author = string_field(manifest, "author", "unknown");
    let main = string_field(manifest, "main", "main.js");
    let prism_engine = manifest
        .get("engines")
        .and_then(|engines| engines.get("prism"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or(">=0.1.0");

    PluginManifestInfo {
        id: id.to_string(),
        name: name.to_string(),
        version: version.to_string(),
        description,
        author: author.to_string(),
        main: main.to_string(),
        engines: EnginesInfo {
            prism: prism_engine.to_string(),
        },
        permissions: read_permissions(manifest),
    }
}

fn string_field<'a>(manifest: &'a serde_json::Value, field: &str, default: &'a str) -> &'a str {
    manifest
        .get(field)
        .and_then(serde_json::Value::as_str)
        .unwrap_or(default)
}

/// 合法权限标识集合（后端第三层防线，过滤 manifest 声明的非法权限）
const VALID_PERMISSIONS: [&str; 4] = ["tasks:read", "tasks:write", "network", "network:local"];

fn read_permissions(manifest: &serde_json::Value) -> Vec<String> {
    manifest
        .get("permissions")
        .and_then(serde_json::Value::as_array)
        .map(|permissions| {
            permissions
                .iter()
                .filter_map(|permission| {
                    permission
                        .as_str()
                        .filter(|p| VALID_PERMISSIONS.contains(p))
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 获取所有已存储的插件配置
#[tauri::command]
pub fn get_plugin_configs(
    state: tauri::State<AppState>,
) -> std::collections::HashMap<String, PluginConfig> {
    state.with_config(|config| config.plugins.clone())
}

/// 保存单个插件或脚本的配置（启用/禁用状态 + 裁剪后权限）。
/// 对 plugin_id 做格式校验，防止污染 ConfigStore（审查报告 H-7）。
#[tauri::command]
pub fn set_plugin_config(
    state: tauri::State<AppState>,
    plugin_id: String,
    config: PluginConfig,
) -> Result<(), String> {
    if !is_valid_callable_id(&plugin_id) {
        return Err(format!("非法插件 ID: '{}'", plugin_id));
    }
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
/// 脚本（ID 以 `script:` 开头）同样以 `script:<name>` 为 key 持久化在
/// ConfigStore 中，由前端运行脚本前写入声明权限，走同一校验路径
fn check_plugin_permission(
    state: &AppState,
    plugin_id: &str,
    required: &str,
) -> Result<(), String> {
    let config = state.with_config(|c| c.plugins.get(plugin_id).cloned());
    match config {
        Some(cfg) if cfg.enabled && cfg.permissions.iter().any(|p| p == required) => Ok(()),
        Some(_) => Err(format!("插件 '{}' 缺少权限 '{}'", plugin_id, required)),
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

/// 判断 IP 是否为本地/私有地址。
///
/// 覆盖范围：
/// - IPv4：环回（127.0.0.0/8）、私网（10/8、172.16/12、192.168/16）、
///   链路本地（169.254/16）、未指定（0.0.0.0）、组播（224.0.0.0/4）
/// - IPv6：环回（::1）、未指定（::）、组播、唯一本地（fc00::/7）、
///   链路本地（fe80::/10），以及 IPv4 映射地址（::ffff:0:0/96）按映射的 IPv4 判定
fn is_local_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_multicast()
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || v6.is_unicast_link_local()
                || is_unique_local_v6(v6)
                || v6
                    .to_ipv4_mapped()
                    .is_some_and(|v4| is_local_ip(&IpAddr::V4(v4)))
        }
    }
}

/// 判断 IPv6 是否属于唯一本地地址段 fc00::/7
fn is_unique_local_v6(v6: &Ipv6Addr) -> bool {
    let octets = v6.octets();
    octets[0] & 0xfe == 0xfc
}

/// 判断主机名是否为合法的公网域名。
///
/// 仅允许 ASCII 字母数字与连字符构成的标签，且：
/// - 标签不得以连字符开头或结尾；
/// - 标签不得为纯数字（纯数字标签会被系统解析为 IP 字面量变体，
///   如 `127.1`、`2130706433`，属于 SSRF 绕过手段）；
/// - 标签不得以 `0x` 开头（十六进制 IP 字面量，如 `0x7f000001`）；
/// - 允许末尾单个点（完全限定域名）。
fn is_valid_public_domain(host: &str) -> bool {
    let trimmed = host.trim_end_matches('.');
    if trimmed.is_empty() {
        return false;
    }
    trimmed.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && !label.starts_with("0x")
            && !label.starts_with("0X")
            && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            && !label.chars().all(|c| c.is_ascii_digit())
    })
}

/// 校验目标 URL 是否合法。
/// - `network` 权限：仅允许公网地址
/// - `network:local` 权限：额外允许 localhost / LAN 地址
///
/// 校验规则：
/// 1. 使用 `url` crate 严格解析，拒绝带用户凭据的 URL（`user:pass@host` 可绕过主机校验）；
/// 2. IP 地址按标准解析后检查本地/私网段，拒绝 `169.254.0.0/16`、IPv4 映射 IPv6 等变体；
/// 3. 域名仅接受标准公网域名形态，`localhost`（含 `.localhost`、`.local` 后缀）按本地处理；
/// 4. 纯数字标签等 IP 字面量变体（`127.1`、`2130706433`）直接拒绝。
fn validate_network_url(url_str: &str, has_local_perm: bool) -> Result<(), String> {
    let url = Url::parse(url_str).map_err(|e| format!("URL 格式无效: {}", e))?;

    if !url.username().is_empty() || url.password().is_some() {
        return Err("URL 不允许包含用户凭据".to_string());
    }

    let is_local = match url.host() {
        // url crate 已按 WHATWG 规范将 IP 字面量变体（127.1、2130706433、0x7f000001 等）
        // 规范化为标准 IPv4 地址，此处按标准地址判定
        Some(url::Host::Ipv4(v4)) => is_local_ip(&IpAddr::V4(v4)),
        Some(url::Host::Ipv6(v6)) => is_local_ip(&IpAddr::V6(v6)),
        Some(url::Host::Domain(domain)) => {
            let lower = domain.to_ascii_lowercase();
            let is_local_hostname =
                lower == "localhost" || lower.ends_with(".localhost") || lower.ends_with(".local");
            if !is_local_hostname && !is_valid_public_domain(&lower) {
                return Err(format!("主机名无效: {}", domain));
            }
            is_local_hostname
        }
        None => return Err("URL 缺少主机名".to_string()),
    };

    if is_local && !has_local_perm {
        let host = url.host_str().unwrap_or_default();
        return Err(format!(
            "禁止访问内网地址 '{}'，需 network:local 权限",
            host
        ));
    }

    Ok(())
}

/// 解析域名并校验解析结果是否为公网 IP（审查报告 H-1）。
///
/// 域名形态校验无法阻止"域名指向内网"与 DNS rebinding，此处对 DNS 解析
/// 结果逐 IP 复核：任何解析 IP 命中本地/私网段即拒绝。
/// 仅对非 localhost 域名且未声明 `network:local` 权限时执行；
/// IP 字面量已在 `validate_network_url` 校验。
fn validate_resolved_host(host: &str, port: u16, has_local_perm: bool) -> Result<(), String> {
    let lower = host.to_ascii_lowercase();
    let is_local_hostname =
        lower == "localhost" || lower.ends_with(".localhost") || lower.ends_with(".local");
    if is_local_hostname || has_local_perm {
        return Ok(());
    }
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("域名解析失败: {}", e))?;
    for address in addresses {
        if is_local_ip(&address.ip()) {
            return Err(format!(
                "域名 '{}' 解析到内网地址 '{}'，已拒绝",
                host,
                address.ip()
            ));
        }
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

    // H-1：域名解析结果复核（指向内网的域名 / DNS rebinding 拦截）
    let parsed_url = Url::parse(&url).map_err(|e| format!("URL 格式无效: {}", e))?;
    if let (Some(host), Some(port)) = (parsed_url.host_str(), parsed_url.port_or_known_default()) {
        validate_resolved_host(host, port, has_local)?;
    }

    let opts = options.unwrap_or(NetworkFetchOptions {
        method: "GET".to_string(),
        headers: HashMap::new(),
        body: None,
    });

    // 重定向每跳重新执行安全校验，防止服务端 302 跳转到内网绕过检查；
    // 最多跟随 4 跳，避免重定向环
    let redirect_policy = reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= 4 {
            return attempt.error("重定向次数过多".to_string());
        }
        match validate_network_url(attempt.url().as_str(), has_local) {
            Ok(()) => {
                // H-1：重定向目标的域名解析结果同样复核
                if let (Some(host), Some(port)) = (
                    attempt.url().host_str(),
                    attempt.url().port_or_known_default(),
                ) {
                    if let Err(e) = validate_resolved_host(host, port, has_local) {
                        return attempt.error(format!("重定向目标被安全策略拒绝: {}", e));
                    }
                }
                attempt.follow()
            }
            Err(e) => attempt.error(format!("重定向目标被安全策略拒绝: {}", e)),
        }
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(redirect_policy)
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

    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    Ok(NetworkFetchResponse {
        status,
        headers: resp_headers,
        body,
    })
}

// ═══════════════════════════════════════════════════════════════
//  轻量脚本
// ═══════════════════════════════════════════════════════════════

/// 单个脚本的元数据（前端可见）
#[derive(Debug, Serialize, Clone)]
pub struct ScriptMeta {
    pub name: String,
    pub description: Option<String>,
    pub permissions: Vec<String>,
}

/// 扫描 `~/.prism/scripts/` 目录，列出所有 .js 文件及其 ==PrismScript== 头部
#[tauri::command]
pub fn scan_scripts() -> Vec<ScriptMeta> {
    let dir = persistence::get_scripts_dir();
    let mut scripts = Vec::new();

    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return scripts,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("js") {
            continue;
        }

        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // 解析 ==PrismScript== 头部
        let meta = parse_script_header(&content);
        let name = if meta.name.is_empty() {
            path.file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        } else {
            meta.name
        };

        scripts.push(ScriptMeta {
            name,
            description: meta.description,
            permissions: meta.permissions,
        });
    }

    scripts
}

/// 读取脚本文件内容
#[tauri::command]
pub fn read_script_content(file_name: String) -> Result<String, String> {
    let dir = persistence::get_scripts_dir();
    let path = dir.join(&file_name);
    // 路径沙箱：确保文件在 scripts 目录内
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("路径解析失败: {}", e))?;
    let dir_canonical = dir.canonicalize().unwrap_or(dir);
    if !canonical.starts_with(&dir_canonical) {
        return Err("路径穿越检测".to_string());
    }
    fs::read_to_string(&canonical).map_err(|e| format!("读取失败: {}", e))
}

/// 解析 ==PrismScript== 注释头
fn parse_script_header(content: &str) -> ScriptMeta {
    let mut name = None;
    let mut description = None;
    let mut permissions = Vec::new();
    let mut in_header = false;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed == "// ==PrismScript==" {
            in_header = true;
            continue;
        }
        if trimmed == "// ==/PrismScript==" {
            break;
        }
        if !in_header {
            // 文件不以 ==PrismScript== 开头，不是脚本文件
            break;
        }

        if let Some(rest) = trimmed.strip_prefix("// @name ") {
            name = Some(rest.trim().to_string());
        } else if let Some(rest) = trimmed.strip_prefix("// @description ") {
            description = Some(rest.trim().to_string());
        } else if let Some(rest) = trimmed.strip_prefix("// @permission ") {
            permissions.push(rest.trim().to_string());
        }
    }

    ScriptMeta {
        name: name.unwrap_or_default(),
        description,
        permissions,
    }
}

// ═══════════════════════════════════════════════════════════════
//  prism-api 模块加载
// ═══════════════════════════════════════════════════════════════

/// 将插件主模块源码注册到内存中，返回 URL 供 import() 加载。
/// token 用于一次性安全校验，protocol handler 响应后即销。
#[tauri::command]
pub fn register_plugin_module(
    state: tauri::State<AppState>,
    plugin_id: String,
    token: String,
    source: String,
) -> Result<String, String> {
    let mut modules = state.plugin_modules.lock().unwrap();
    modules.insert(token.clone(), source);
    Ok(format!(
        "prism-api://localhost/module.js?pluginId={}&token={}",
        urlencoding(&plugin_id),
        urlencoding(&token)
    ))
}

fn urlencoding(s: &str) -> String {
    // 简单的手动 URL 编码，避免引入额外依赖
    s.replace('%', "%25")
        .replace(' ', "%20")
        .replace('&', "%26")
        .replace('=', "%3D")
        .replace('?', "%3F")
}

// ═══════════════════════════════════════════════════════════════
//  测试
// ═══════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_public_url_allowed_without_local_perm() {
        assert!(validate_network_url("https://api.example.com/v1/tasks", false).is_ok());
        assert!(validate_network_url("https://8.8.8.8/dns", false).is_ok());
        assert!(validate_network_url("https://example.com./path", false).is_ok());
    }

    #[test]
    fn test_localhost_blocked_without_local_perm() {
        assert!(validate_network_url("http://localhost:3000", false).is_err());
        assert!(validate_network_url("http://127.0.0.1:8080", false).is_err());
        assert!(validate_network_url("http://[::1]:8080", false).is_err());
        assert!(validate_network_url("http://mybox.local/", false).is_err());
        assert!(validate_network_url("http://svc.localhost/", false).is_err());
    }

    #[test]
    fn test_localhost_allowed_with_local_perm() {
        assert!(validate_network_url("http://localhost:3000", true).is_ok());
        assert!(validate_network_url("http://192.168.1.10:8080", true).is_ok());
        assert!(validate_network_url("http://[::1]:8080", true).is_ok());
    }

    #[test]
    fn test_private_and_link_local_networks_blocked() {
        assert!(validate_network_url("http://10.0.0.1/", false).is_err());
        assert!(validate_network_url("http://172.16.0.1/", false).is_err());
        assert!(validate_network_url("http://172.31.255.254/", false).is_err());
        assert!(validate_network_url("http://192.168.0.1/", false).is_err());
        // 云元数据服务（链路本地）
        assert!(validate_network_url("http://169.254.169.254/latest/meta-data", false).is_err());
        // IPv6 唯一本地与链路本地
        assert!(validate_network_url("http://[fc00::1]/", false).is_err());
        assert!(validate_network_url("http://[fe80::1]/", false).is_err());
        // 未指定与组播地址
        assert!(validate_network_url("http://0.0.0.0/", false).is_err());
        assert!(validate_network_url("http://224.0.0.1/", false).is_err());
    }

    #[test]
    fn test_ip_variant_bypasses_blocked() {
        // IPv4 映射 IPv6（::ffff:127.0.0.1 等价于 127.0.0.1）
        assert!(validate_network_url("http://[::ffff:127.0.0.1]/", false).is_err());
        assert!(validate_network_url("http://[::ffff:10.0.0.1]/", false).is_err());
        // 非标准 IP 字面量变体
        assert!(validate_network_url("http://127.1/", false).is_err());
        assert!(validate_network_url("http://2130706433/", false).is_err());
        assert!(validate_network_url("http://0x7f000001/", false).is_err());
    }

    #[test]
    fn test_url_with_credentials_blocked() {
        assert!(validate_network_url("http://admin:secret@127.0.0.1:8080/", false).is_err());
        assert!(validate_network_url("http://user@example.com/", false).is_err());
    }

    #[test]
    fn test_invalid_hosts_blocked() {
        assert!(validate_network_url("", false).is_err());
        assert!(validate_network_url("not-a-url", false).is_err());
        // 域名标签非法（下划线、纯数字标签）
        assert!(validate_network_url("http://bad_host.com/", false).is_err());
        assert!(validate_network_url("http://999.999.1.1/", false).is_err());
    }

    #[test]
    fn test_localhost_case_insensitive() {
        assert!(validate_network_url("http://LOCALHOST/", false).is_err());
        assert!(validate_network_url("http://LoCaLhOsT/", true).is_ok());
    }

    // ═══ 插件 ID 格式校验（审查报告 H-7） ═══

    #[test]
    fn test_valid_plugin_ids_accepted() {
        assert!(is_valid_plugin_id("com.prism.hello"));
        assert!(is_valid_plugin_id("com.example.my-plugin_v2"));
        assert!(is_valid_plugin_id("a.b.c"));
    }

    #[test]
    fn test_invalid_plugin_ids_rejected() {
        assert!(!is_valid_plugin_id(""));
        assert!(!is_valid_plugin_id("hello"));
        assert!(!is_valid_plugin_id("../../.prism"));
        assert!(!is_valid_plugin_id("a..b"));
        assert!(!is_valid_plugin_id("a/b"));
        assert!(!is_valid_plugin_id("a\\b"));
        assert!(!is_valid_plugin_id("a:b"));
        assert!(!is_valid_plugin_id(".hidden"));
        assert!(!is_valid_plugin_id("trailing."));
        assert!(!is_valid_plugin_id(&"x".repeat(200)));
    }

    #[test]
    fn test_script_ids() {
        assert!(is_valid_script_id("script:my-script.js"));
        assert!(is_valid_script_id("script:my_script"));
        assert!(!is_valid_script_id("script:"));
        assert!(!is_valid_script_id("script:../evil"));
        assert!(!is_valid_script_id("script:a/b"));
        assert!(!is_valid_script_id("plugin"));
    }

    #[test]
    fn test_callable_ids() {
        assert!(is_valid_callable_id("com.prism.hello"));
        assert!(is_valid_callable_id("script:test"));
        assert!(!is_valid_callable_id("../../x"));
        assert!(!is_valid_callable_id("script:"));
    }

    // ═══ 域名解析结果校验（审查报告 H-1） ═══

    #[test]
    fn test_resolved_host_short_circuits() {
        // localhost 名称不触发 DNS 解析
        assert!(validate_resolved_host("localhost", 80, false).is_ok());
        assert!(validate_resolved_host("svc.localhost", 80, false).is_ok());
        // 声明 network:local 权限时不额外拦截
        assert!(validate_resolved_host("example.com", 80, true).is_ok());
    }
}
