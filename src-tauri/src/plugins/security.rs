use std::path::PathBuf;

/// 校验插件 ID 格式：反向域名风格，至少两段，
/// 段内仅允许 ASCII 字母数字、连字符与下划线。
/// 拒绝路径分隔符、`.`/`..` 段与空段，防止路径构造注入。
pub(crate) fn is_valid_plugin_id(plugin_id: &str) -> bool {
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
pub(crate) fn is_valid_script_id(plugin_id: &str) -> bool {
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
pub(crate) fn is_valid_callable_id(plugin_id: &str) -> bool {
    is_valid_plugin_id(plugin_id) || is_valid_script_id(plugin_id)
}

/// 解析插件目录内的文件路径，防止路径穿越攻击。
///
/// 使用 `canonicalize` 规范化路径后，校验其是否仍在
/// `<workspace>/plugins/<plugin_id>/` 目录之内。
/// 超出范围则返回 `Err`。
pub(crate) fn resolve_plugin_path(plugin_id: &str, relative_path: &str) -> Result<PathBuf, String> {
    if !is_valid_plugin_id(plugin_id) {
        return Err(format!("非法插件 ID: '{}'", plugin_id));
    }
    let plugins_dir = crate::storage::paths::get_plugins_dir();
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

/// 校验插件是否持有指定权限。
/// 从 ConfigStore.plugins 读取已持久化的权限列表，
/// 不信任前端传入的任何权限声明（第三层防线）。
/// 脚本（ID 以 `script:` 开头）同样以 `script:<name>` 为 key 持久化在
/// ConfigStore 中，由前端运行脚本前写入声明权限，走同一校验路径
pub(crate) fn check_plugin_permission(
    config: &crate::models::ConfigStore,
    plugin_id: &str,
    required: &str,
) -> Result<(), String> {
    let config = config.plugins.get(plugin_id).cloned();
    match config {
        Some(cfg) if cfg.enabled && cfg.permissions.iter().any(|p| p == required) => Ok(()),
        Some(_) => Err(format!("插件 '{}' 缺少权限 '{}'", plugin_id, required)),
        None => Err(format!("插件 '{}' 未找到或未启用", plugin_id)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
}
