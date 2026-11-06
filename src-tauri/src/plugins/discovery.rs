use super::security::{is_valid_plugin_id, resolve_plugin_path};
use serde::Serialize;
use std::fs;

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
//  插件扫描
// ═══════════════════════════════════════════════════════════════

/// 扫描 `~/.prism/plugins/` 目录，读取所有插件的 manifest.json。
/// 解析失败的插件跳过并记录 stderr，不阻塞其他插件。
pub fn scan_plugins() -> Vec<PluginManifestInfo> {
    let plugins_dir = crate::storage::paths::get_plugins_dir();
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

    // manifest 声明的 id 必须通过格式校验，否则跳过该插件
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

/// 读取插件目录内的文件内容（经路径沙箱校验）
pub fn read_plugin_file(plugin_id: String, file_path: String) -> Result<String, String> {
    let safe_path = resolve_plugin_path(&plugin_id, &file_path)?;
    fs::read_to_string(&safe_path).map_err(|e| format!("读取文件失败: {}", e))
}

/// 单个脚本的元数据（前端可见）
#[derive(Debug, Serialize, Clone)]
pub struct ScriptMeta {
    pub name: String,
    pub description: Option<String>,
    pub permissions: Vec<String>,
}

/// 扫描 `~/.prism/scripts/` 目录，列出所有 .js 文件及其 ==PrismScript== 头部
pub fn scan_scripts() -> Vec<ScriptMeta> {
    let dir = crate::storage::paths::get_scripts_dir();
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
pub fn read_script_content(file_name: String) -> Result<String, String> {
    let dir = crate::storage::paths::get_scripts_dir();
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
