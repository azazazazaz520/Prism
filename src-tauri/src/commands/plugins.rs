use std::fs;
use std::path::PathBuf;

use serde::Serialize;

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
