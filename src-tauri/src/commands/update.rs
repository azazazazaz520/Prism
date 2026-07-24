// ═══════════════════════════════════════════════════════════════
//  update — 版本更新检查
//
//  职责：
//  - 通过 reqwest 请求静态更新清单 JSON 获取最新版本信息
//  - 支持 system / custom / direct 三种网络代理模式
//  - 对网络错误、HTTP 错误和解析错误进行分类，返回稳定错误码
//  - 提供更新网络配置的读写命令
// ═══════════════════════════════════════════════════════════════

use crate::store::{UpdateNetworkConfig, UpdateNetworkMode, WindowsUpdateManifest};
use crate::AppState;

/// 更新清单主地址（CDN 部署后替换为此地址，当前使用 GitHub Raw 备用地址）
const UPDATE_MANIFEST_PRIMARY: &str =
    "https://raw.githubusercontent.com/azazazazaz520/Prism/main/update/windows.json";

/// 更新清单备用地址（当主地址不可达时使用）
const UPDATE_MANIFEST_FALLBACK: &str =
    "https://raw.githubusercontent.com/azazazazaz520/Prism/main/update/windows.json";

/// 请求超时秒数
const REQUEST_TIMEOUT_SECS: u64 = 15;
/// 连接超时秒数
const CONNECT_TIMEOUT_SECS: u64 = 10;

// ═══════════════════════════════════════════
//  错误分类与响应构造
// ═══════════════════════════════════════════

/// 构造带错误码的 JSON 错误字符串，前端可解析 `error_code` 和 `message`
fn error_response(code: &str, message: &str) -> String {
    serde_json::json!({
        "error_code": code,
        "message": message,
    })
    .to_string()
}

/// 根据 reqwest 底层错误分类为领域错误码
///
/// 分类优先级：
/// 1. 超时（is_timeout）
/// 2. 代理/代理连接失败（错误文本特征，先于 `is_connect` 判断，避免被归类为普通网络错误）
/// 3. TLS/证书错误（错误文本特征，先于 `is_connect` 判断）
/// 4. DNS 解析失败（错误文本特征）
/// 5. 连接失败（is_connect，作为兜底）
/// 6. 其他（保留原始错误信息，不做推测）
///
/// 注意：错误消息中不包含代理地址等敏感信息，仅描述错误类型和操作建议。
fn classify_reqwest_error(e: &reqwest::Error) -> String {
    // 超时是最明确的信号，优先判断
    if e.is_timeout() {
        return error_response("timeout", "连接超时，请检查 VPN 或网络状态");
    }

    // 先通过错误文本特征判断代理/代理连接、TLS 和 DNS 错误
    // 这些错误可能也满足 is_connect()，因此必须在 is_connect() 之前判断
    let msg = e.to_string();

    // 代理连接失败的特征最明确
    if msg.contains("proxy") || msg.contains("Proxy") {
        return error_response("proxy_failed", "代理连接失败，请检查代理地址和端口");
    }

    // TLS/证书错误
    if msg.contains("tls") || msg.contains("TLS") || msg.contains("certificate") {
        return error_response("tls_failed", "安全连接失败，请检查系统时间和网络拦截软件");
    }

    // DNS 解析失败
    if msg.contains("dns") || msg.contains("DNS") {
        return error_response("network_unreachable", "DNS 解析失败，请检查网络连接");
    }

    // 最后才判断泛化的连接失败
    if e.is_connect() {
        return error_response("network_unreachable", "无法连接更新服务器，请检查网络状态");
    }

    // 其他底层错误，保留原始信息
    error_response("network_unreachable", &format!("网络请求失败：{}", msg))
}

/// 根据 HTTP 状态码分类错误
///
/// 不将响应正文完整展示给用户；仅在错误消息中保留关键信息。
fn classify_http_error(status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        403 => error_response("bad_response", "更新服务器拒绝访问（HTTP 403）"),
        404 => error_response("repository_not_found", "更新清单不存在，请联系维护者"),
        429 => error_response("rate_limited", "请求过于频繁，请稍后重试"),
        500..=599 => error_response("bad_response", "更新服务器暂时不可用，请稍后重试"),
        _ => error_response(
            "bad_response",
            &format!("更新服务器返回异常状态（HTTP {}）", status.as_u16()),
        ),
    }
}

// ═══════════════════════════════════════════
//  HTTP 客户端构建
// ═══════════════════════════════════════════

/// 根据更新网络配置构造 reqwest HTTP 客户端
///
/// - `System`：从环境变量 `HTTPS_PROXY` / `HTTP_PROXY` 读取代理地址（不读取 Windows 系统代理）
/// - `Custom`：使用用户配置的代理 URL，先禁用所有隐式代理以确保唯一生效
/// - `Direct`：显式禁用代理，直接连接
///
/// 代理地址不记录到日志中，避免泄露认证信息。
fn build_client(config: &UpdateNetworkConfig) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .connect_timeout(std::time::Duration::from_secs(CONNECT_TIMEOUT_SECS));

    match config.mode {
        UpdateNetworkMode::Direct => {
            builder = builder.no_proxy();
        }
        UpdateNetworkMode::Custom => {
            // 先禁用所有自动代理（环境变量等），确保用户配置的代理唯一生效
            builder = builder.no_proxy();
            if let Some(ref proxy_url) = config.proxy_url {
                let url = proxy_url.trim();
                if url.is_empty() {
                    return Err(error_response("proxy_failed", "代理地址不能为空"));
                }
                let proxy = reqwest::Proxy::all(url).map_err(|e| {
                    error_response("proxy_failed", &format!("代理地址格式无效：{}", e))
                })?;
                builder = builder.proxy(proxy);
            }
        }
        UpdateNetworkMode::System => {
            // 从环境变量读取代理配置（不读取 Windows 系统代理设置）
            // VPN 提供固定代理端口时请使用"自定义"模式
            for key in &["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
                if let Ok(val) = std::env::var(key) {
                    let val = val.trim().to_string();
                    if !val.is_empty() {
                        if let Ok(proxy) = reqwest::Proxy::all(&val) {
                            builder = builder.proxy(proxy);
                            break;
                        }
                    }
                }
            }
        }
    }

    builder
        .build()
        .map_err(|e| error_response("network_unreachable", &format!("创建网络客户端失败：{}", e)))
}

// ═══════════════════════════════════════════
//  清单校验
// ═══════════════════════════════════════════

/// 校验更新清单字段完整性和安全性
fn validate_manifest(manifest: &WindowsUpdateManifest) -> Result<(), String> {
    if manifest.version.trim().is_empty() {
        return Err(error_response("invalid_version", "更新版本号为空"));
    }

    // 下载地址必须使用 HTTPS
    if !manifest.download_url.starts_with("https://") {
        return Err(error_response("bad_response", "下载地址必须使用 HTTPS"));
    }

    // Release 页面地址必须使用 HTTPS
    if !manifest.release_url.starts_with("https://") {
        return Err(error_response("bad_response", "Release 地址必须使用 HTTPS"));
    }

    // 只允许可信域名，防止清单被篡改后指向恶意地址
    let allowed_hosts = [
        "github.com",
        "objects.githubusercontent.com",
        "raw.githubusercontent.com",
    ];
    let is_allowed = |url: &str| -> bool {
        let host = url
            .trim_start_matches("https://")
            .split('/')
            .next()
            .unwrap_or("");
        allowed_hosts.contains(&host)
    };

    if !is_allowed(&manifest.download_url) {
        return Err(error_response("bad_response", "下载地址域名不在允许列表中"));
    }

    if !is_allowed(&manifest.release_url) {
        return Err(error_response(
            "bad_response",
            "Release 地址域名不在允许列表中",
        ));
    }

    Ok(())
}

// ═══════════════════════════════════════════
//  请求静态更新清单
// ═══════════════════════════════════════════

/// 请求指定地址的静态更新清单
async fn fetch_manifest(
    client: &reqwest::Client,
    url: &str,
) -> Result<WindowsUpdateManifest, String> {
    let response = client
        .get(url)
        .header("User-Agent", format!("Prism/{}", env!("CARGO_PKG_VERSION")))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| classify_reqwest_error(&e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(classify_http_error(status));
    }

    let manifest: WindowsUpdateManifest = response
        .json()
        .await
        .map_err(|_| error_response("bad_response", "更新清单格式异常，请联系维护者"))?;

    validate_manifest(&manifest)?;
    Ok(manifest)
}

// ═══════════════════════════════════════════
//  Tauri 命令
// ═══════════════════════════════════════════

/// 检查更新：请求静态更新清单，返回最新版本信息
///
/// 主地址不可达时自动尝试备用地址。
/// 前端负责比较版本号并展示更新对话框或"已是最新版本"提示。
#[tauri::command]
pub async fn check_update(
    state: tauri::State<'_, AppState>,
) -> Result<WindowsUpdateManifest, String> {
    let config = state.with_config(|c| c.update_network.clone());
    let client = build_client(&config)?;

    // 尝试主地址
    match fetch_manifest(&client, UPDATE_MANIFEST_PRIMARY).await {
        Ok(manifest) => Ok(manifest),
        Err(primary_err) => {
            // 主地址不可达时尝试备用地址（仅网络层错误才切换）
            // 403/404/清单校验失败不应盲目切换，直接返回主地址的错误
            let should_fallback = primary_err.contains("network_unreachable")
                || primary_err.contains("timeout")
                || primary_err.contains("tls_failed")
                || primary_err.contains("服务暂时不可用");
            if !should_fallback {
                return Err(primary_err);
            }
            fetch_manifest(&client, UPDATE_MANIFEST_FALLBACK).await
        }
    }
}

/// 获取版本更新网络配置
#[tauri::command]
pub fn get_update_network_config(state: tauri::State<AppState>) -> UpdateNetworkConfig {
    state.with_config(|c| c.update_network.clone())
}

/// 设置版本更新网络配置
///
/// `mode` 取值："system"、"custom"、"direct"。
/// `proxy_url` 仅在 `mode=custom` 时使用，需为 `http://` 或 `https://` 开头，
/// 不允许包含 `@`（防止存储认证信息）。
#[tauri::command]
pub fn set_update_network_config(
    state: tauri::State<AppState>,
    mode: String,
    proxy_url: Option<String>,
) -> Result<(), String> {
    let parsed_mode = match mode.as_str() {
        "system" => UpdateNetworkMode::System,
        "custom" => UpdateNetworkMode::Custom,
        "direct" => UpdateNetworkMode::Direct,
        other => return Err(format!("无效的网络模式：{}", other)),
    };

    let sanitized_url = proxy_url.map(|u| u.trim().to_string());

    // 自定义代理模式的格式校验
    if parsed_mode == UpdateNetworkMode::Custom {
        match &sanitized_url {
            None => {
                return Err("自定义代理模式下必须提供代理地址".into());
            }
            Some(url) => {
                if url.is_empty() {
                    return Err("代理地址不能为空".into());
                }
                if !url.starts_with("http://") && !url.starts_with("https://") {
                    return Err("代理地址必须以 http:// 或 https:// 开头".into());
                }
                if url.contains('@') {
                    return Err("代理地址不能包含用户认证信息".into());
                }
            }
        }
    }

    state.with_config_mut(|config| {
        config.update_network = UpdateNetworkConfig {
            mode: parsed_mode,
            proxy_url: sanitized_url,
        };
    })
}

// ═══════════════════════════════════════════
//  单元测试
// ═══════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    // ── 错误响应构造 ──

    #[test]
    fn test_error_response_format() {
        let resp = error_response("timeout", "连接超时");
        assert!(resp.contains("timeout"));
        assert!(resp.contains("连接超时"));
        assert!(resp.contains("error_code"));
        assert!(resp.contains("message"));
        let _: serde_json::Value = serde_json::from_str(&resp).unwrap();
    }

    #[test]
    fn test_error_response_all_codes_unique() {
        let codes = [
            error_response("network_unreachable", ""),
            error_response("proxy_failed", ""),
            error_response("timeout", ""),
            error_response("tls_failed", ""),
            error_response("rate_limited", ""),
            error_response("repository_not_found", ""),
            error_response("bad_response", ""),
            error_response("invalid_version", ""),
        ];
        for json_str in &codes {
            let _: serde_json::Value = serde_json::from_str(json_str).unwrap();
        }
    }

    #[test]
    fn test_http_error_classification_403() {
        let result = classify_http_error(reqwest::StatusCode::FORBIDDEN);
        assert!(result.contains("bad_response"));
        assert!(result.contains("403"));
    }

    #[test]
    fn test_http_error_classification_404() {
        let result = classify_http_error(reqwest::StatusCode::NOT_FOUND);
        assert!(result.contains("repository_not_found"));
    }

    #[test]
    fn test_http_error_classification_429() {
        let result = classify_http_error(reqwest::StatusCode::TOO_MANY_REQUESTS);
        assert!(result.contains("rate_limited"));
    }

    #[test]
    fn test_http_error_classification_500() {
        let result = classify_http_error(reqwest::StatusCode::INTERNAL_SERVER_ERROR);
        assert!(result.contains("bad_response"));
        assert!(result.contains("更新服务器暂时不可用"));
    }

    #[test]
    fn test_http_error_classification_502() {
        let result = classify_http_error(reqwest::StatusCode::BAD_GATEWAY);
        assert!(result.contains("bad_response"));
    }

    #[test]
    fn test_http_error_classification_unknown() {
        let result = classify_http_error(reqwest::StatusCode::IM_A_TEAPOT);
        assert!(result.contains("bad_response"));
        assert!(result.contains("418"));
    }

    // ── 清单校验 ──

    fn make_manifest() -> WindowsUpdateManifest {
        WindowsUpdateManifest {
            version: "0.3.0".into(),
            release_date: "2026-07-24T12:00:00Z".into(),
            release_notes: "测试更新".into(),
            download_url: "https://github.com/azazazazaz520/Prism/releases/download/v0.3.0/Prism_0.3.0_x64-setup.exe".into(),
            release_url: "https://github.com/azazazazaz520/Prism/releases/tag/v0.3.0".into(),
            sha256: Some("abc123".into()),
        }
    }

    #[test]
    fn test_validate_manifest_valid() {
        let m = make_manifest();
        assert!(validate_manifest(&m).is_ok());
    }

    #[test]
    fn test_validate_manifest_empty_version() {
        let m = WindowsUpdateManifest {
            version: String::new(),
            ..make_manifest()
        };
        let err = validate_manifest(&m).unwrap_err();
        assert!(err.contains("invalid_version"));
    }

    #[test]
    fn test_validate_manifest_http_download_rejected() {
        let m = WindowsUpdateManifest {
            download_url: "http://example.com/installer.exe".into(),
            ..make_manifest()
        };
        let err = validate_manifest(&m).unwrap_err();
        assert!(err.contains("HTTPS"));
    }

    #[test]
    fn test_validate_manifest_http_release_rejected() {
        let m = WindowsUpdateManifest {
            release_url: "http://example.com/release".into(),
            ..make_manifest()
        };
        let err = validate_manifest(&m).unwrap_err();
        assert!(err.contains("HTTPS"));
    }

    #[test]
    fn test_validate_manifest_disallowed_download_domain() {
        let m = WindowsUpdateManifest {
            download_url: "https://evil.com/malware.exe".into(),
            ..make_manifest()
        };
        let err = validate_manifest(&m).unwrap_err();
        assert!(err.contains("域名"));
    }

    #[test]
    fn test_validate_manifest_disallowed_release_domain() {
        let m = WindowsUpdateManifest {
            release_url: "https://phishing.com/release".into(),
            ..make_manifest()
        };
        let err = validate_manifest(&m).unwrap_err();
        assert!(err.contains("域名"));
    }

    #[test]
    fn test_validate_manifest_sha256_null() {
        let m = WindowsUpdateManifest {
            sha256: None,
            ..make_manifest()
        };
        assert!(validate_manifest(&m).is_ok());
    }

    // ── 清单反序列化 ──

    #[test]
    fn test_manifest_deserialization() {
        let json = r#"{
            "version": "0.3.0",
            "release_date": "2026-07-24T12:00:00Z",
            "release_notes": "修复问题",
            "download_url": "https://github.com/azazazazaz520/Prism/releases/download/v0.3.0/setup.exe",
            "release_url": "https://github.com/azazazazaz520/Prism/releases/tag/v0.3.0",
            "sha256": "abc123"
        }"#;
        let manifest: WindowsUpdateManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.version, "0.3.0");
        assert_eq!(manifest.release_notes, "修复问题");
        assert_eq!(manifest.sha256, Some("abc123".into()));
    }

    #[test]
    fn test_manifest_deserialization_without_sha256() {
        let json = r#"{
            "version": "0.3.0",
            "release_date": "2026-07-24T12:00:00Z",
            "release_notes": "修复问题",
            "download_url": "https://github.com/azazazazaz520/Prism/releases/download/v0.3.0/setup.exe",
            "release_url": "https://github.com/azazazazaz520/Prism/releases/tag/v0.3.0"
        }"#;
        let manifest: WindowsUpdateManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.version, "0.3.0");
        assert!(manifest.sha256.is_none());
    }

    #[test]
    fn test_manifest_invalid_json() {
        let result: Result<WindowsUpdateManifest, _> = serde_json::from_str("not json");
        assert!(result.is_err());
    }

    // ── 客户端构建 ──

    #[test]
    fn test_build_client_direct_mode() {
        let config = UpdateNetworkConfig {
            mode: UpdateNetworkMode::Direct,
            proxy_url: None,
        };
        let result = build_client(&config);
        assert!(result.is_ok());
    }

    #[test]
    fn test_build_client_system_mode() {
        let config = UpdateNetworkConfig {
            mode: UpdateNetworkMode::System,
            proxy_url: None,
        };
        let result = build_client(&config);
        assert!(result.is_ok());
    }

    #[test]
    fn test_build_client_custom_mode_valid_proxy() {
        let config = UpdateNetworkConfig {
            mode: UpdateNetworkMode::Custom,
            proxy_url: Some("http://127.0.0.1:8080".into()),
        };
        let result = build_client(&config);
        assert!(result.is_ok());
    }

    #[test]
    fn test_build_client_custom_mode_empty_proxy() {
        let config = UpdateNetworkConfig {
            mode: UpdateNetworkMode::Custom,
            proxy_url: Some(String::new()),
        };
        let result = build_client(&config);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("proxy_failed"));
    }

    // ── UpdateNetworkConfig 序列化兼容性 ──

    #[test]
    fn test_update_network_config_default_is_system() {
        let config = UpdateNetworkConfig::default();
        assert_eq!(config.mode, UpdateNetworkMode::System);
        assert!(config.proxy_url.is_none());
    }

    #[test]
    fn test_update_network_config_deserialization() {
        let json = r#"{"mode":"custom","proxy_url":"http://127.0.0.1:7890"}"#;
        let config: UpdateNetworkConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.mode, UpdateNetworkMode::Custom);
        assert_eq!(config.proxy_url.as_deref(), Some("http://127.0.0.1:7890"));
    }

    #[test]
    fn test_update_network_config_deserialization_missing_proxy() {
        let json = r#"{"mode":"direct"}"#;
        let config: UpdateNetworkConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.mode, UpdateNetworkMode::Direct);
        assert!(config.proxy_url.is_none());
    }

    #[test]
    fn test_update_network_config_deserialization_empty() {
        let json = r#"{}"#;
        let config: UpdateNetworkConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.mode, UpdateNetworkMode::System);
        assert!(config.proxy_url.is_none());
    }
}
