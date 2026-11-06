// ═══════════════════════════════════════════════════════════════
//  update — 版本更新检查
//
//  职责：
//  - 通过 reqwest 请求静态更新清单 JSON 获取最新版本信息
//  - 对网络错误、HTTP 错误和解析错误进行分类，返回稳定错误码
//  - 支持主地址失败时自动切换备用地址
// ═══════════════════════════════════════════════════════════════

use crate::models::WindowsUpdateManifest;

/// 更新清单主地址（GitHub Release 静态资源，始终与最新 Release 同步）
const UPDATE_MANIFEST_PRIMARY: &str =
    "https://github.com/azazazazaz520/Prism/releases/latest/download/windows.json";

/// 更新清单备用地址（当主地址不可达时使用，回退到仓库原始文件）
const UPDATE_MANIFEST_FALLBACK: &str =
    "https://raw.githubusercontent.com/azazazazaz520/Prism/master/update/windows.json";

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
/// 分类优先级：超时 → 代理/TLS/DNS 文本特征 → 连接失败 → 其他。
/// 错误消息中不包含敏感信息。
fn classify_reqwest_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        return error_response("timeout", "连接超时，请检查 VPN 或网络状态");
    }

    let msg = e.to_string();

    if msg.contains("proxy") || msg.contains("Proxy") {
        return error_response("proxy_failed", "代理连接失败，请检查代理地址和端口");
    }

    if msg.contains("tls") || msg.contains("TLS") || msg.contains("certificate") {
        return error_response("tls_failed", "安全连接失败，请检查系统时间和网络拦截软件");
    }

    if msg.contains("dns") || msg.contains("DNS") {
        return error_response("network_unreachable", "DNS 解析失败，请检查网络连接");
    }

    if e.is_connect() {
        return error_response("network_unreachable", "无法连接更新服务器，请检查网络状态");
    }

    error_response("network_unreachable", &format!("网络请求失败：{}", msg))
}

/// 根据 HTTP 状态码分类错误
fn classify_http_error(status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        403 => error_response("bad_response", "更新服务器拒绝访问（HTTP 403）"),
        404 => error_response("repository_not_found", "更新清单不存在，请联系维护者"),
        429 => error_response("rate_limited", "更新服务请求过于频繁"),
        500..=599 => error_response("bad_response", "更新服务器暂时不可用，请稍后重试"),
        _ => error_response(
            "bad_response",
            &format!("更新服务器返回异常状态（HTTP {}）", status.as_u16()),
        ),
    }
}

// ═══════════════════════════════════════════
//  HTTP 客户端
// ═══════════════════════════════════════════

/// 构造默认的 HTTP 客户端（不手动配置代理，由 reqwest 和操作系统处理网络层）
fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .connect_timeout(std::time::Duration::from_secs(CONNECT_TIMEOUT_SECS))
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

    if !manifest.download_url.starts_with("https://") {
        return Err(error_response("bad_response", "下载地址必须使用 HTTPS"));
    }

    if !manifest.release_url.starts_with("https://") {
        return Err(error_response("bad_response", "Release 地址必须使用 HTTPS"));
    }

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

    if let Some(hash) = &manifest.sha256 {
        let is_valid_sha256 = hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit());
        if !is_valid_sha256 {
            return Err(error_response(
                "bad_response",
                "更新清单中的 SHA-256 校验值格式无效",
            ));
        }
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

/// 判断错误响应是否属于可以切换备用地址的网络错误
fn should_fallback(error: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(error)
        .ok()
        .and_then(|value| value.get("error_code")?.as_str().map(str::to_owned))
        .is_some_and(|code| {
            matches!(
                code.as_str(),
                "network_unreachable" | "timeout" | "tls_failed"
            )
        })
}

// ═══════════════════════════════════════════
//  更新检查
// ═══════════════════════════════════════════

/// 检查更新：请求静态更新清单，返回最新版本信息
///
/// 网络代理由 reqwest 和操作系统处理，不在应用中维护代理配置。
/// 主地址失败时自动尝试备用地址。
pub async fn check_update() -> Result<WindowsUpdateManifest, String> {
    let client = build_client()?;

    match fetch_manifest(&client, UPDATE_MANIFEST_PRIMARY).await {
        Ok(manifest) => Ok(manifest),
        Err(primary_err) => {
            if !should_fallback(&primary_err) {
                return Err(primary_err);
            }
            fetch_manifest(&client, UPDATE_MANIFEST_FALLBACK).await
        }
    }
}

// ═══════════════════════════════════════════
//  单元测试
// ═══════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    fn make_manifest() -> WindowsUpdateManifest {
        WindowsUpdateManifest {
            version: "0.3.0".into(),
            release_date: "2026-07-24T12:00:00Z".into(),
            release_notes: "测试更新".into(),
            download_url: "https://github.com/azazazazaz520/Prism/releases/download/v0.3.0/Prism_0.3.0_x64-setup.exe".into(),
            release_url: "https://github.com/azazazazaz520/Prism/releases/tag/v0.3.0".into(),
            sha256: Some("abc123def4567890abc123def4567890abc123def4567890abc123def4567890".into()),
        }
    }

    #[test]
    fn test_validate_manifest_valid() {
        assert!(validate_manifest(&make_manifest()).is_ok());
    }

    #[test]
    fn test_validate_manifest_disallowed_download_domain() {
        let m = WindowsUpdateManifest {
            download_url: "https://evil.com/malware.exe".into(),
            ..make_manifest()
        };
        assert!(validate_manifest(&m).unwrap_err().contains("域名"));
    }

    #[test]
    fn test_validate_manifest_sha256_invalid_length() {
        let m = WindowsUpdateManifest {
            sha256: Some("too-short".into()),
            ..make_manifest()
        };
        assert!(validate_manifest(&m).unwrap_err().contains("SHA-256"));
    }

    #[test]
    fn test_fallback_follows_error_category() {
        assert!(should_fallback(&error_response("network_unreachable", "")));
        assert!(!should_fallback(&error_response("bad_response", "")));
    }
}
