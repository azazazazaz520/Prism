use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv6Addr, ToSocketAddrs};
use std::time::Duration;
use url::Url;

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

/// 解析域名并校验解析结果是否为公网 IP。
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
pub async fn fetch(
    has_local: bool,
    url: String,
    options: Option<NetworkFetchOptions>,
) -> Result<NetworkFetchResponse, String> {
    validate_network_url(&url, has_local)?;

    // 域名解析结果复核（指向内网的域名 / DNS rebinding 拦截）
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
                // 重定向目标的域名解析结果同样复核
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

    #[test]
    fn test_resolved_host_short_circuits() {
        // localhost 名称不触发 DNS 解析
        assert!(validate_resolved_host("localhost", 80, false).is_ok());
        assert!(validate_resolved_host("svc.localhost", 80, false).is_ok());
        // 声明 network:local 权限时不额外拦截
        assert!(validate_resolved_host("example.com", 80, true).is_ok());
    }
}
