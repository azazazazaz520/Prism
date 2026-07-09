use serde::Serialize;
use std::fs;
use std::io::ErrorKind;

use crate::prompt;
use crate::store;

/// 前端可见的 Prompt 元数据（不包含完整内容体）。
#[derive(Debug, Serialize, Clone)]
pub struct PromptMeta {
    pub name: String,
    /// 该模板接受的 `{{variable}}` 占位符列表
    pub vars: Vec<String>,
    /// 用户是否已在文件系统中自定义此 Prompt
    pub is_customized: bool,
}

/// 列出所有已注册 Prompt 的元数据。
/// 前端可据此渲染 Prompt 设置列表。
#[tauri::command]
pub fn list_prompts() -> Vec<PromptMeta> {
    let dir = store::get_workspace_dir().join("prompts");
    prompt::all()
        .iter()
        .map(|t| PromptMeta {
            name: t.name.to_string(),
            vars: t.vars.iter().map(|s| s.to_string()).collect(),
            is_customized: dir.join(t.name).exists(),
        })
        .collect()
}

/// 获取单个 Prompt 的完整内容（优先文件，回退默认值）。
#[tauri::command]
pub fn get_prompt(name: String) -> Result<String, String> {
    let path = store::get_workspace_dir().join("prompts").join(&name);
    match fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        Err(err) => match err.kind() {
            ErrorKind::NotFound => prompt::all()
                .iter()
                .find(|t| t.name == name)
                .map(|t| t.default_content.to_string())
                .ok_or_else(|| format!("未知的 Prompt: {}", name)),
            _ => Err(format!("读取 Prompt 文件失败: {}: {}", path.display(), err)),
        },
    }
}

/// 更新 Prompt 内容（写入文件）。
/// 如果文件尚不存在则创建；此后该 Prompt 的 `is_customized` 变为 true。
#[tauri::command]
pub fn update_prompt(name: String, content: String) -> Result<(), String> {
    // 验证 name 在注册表中存在
    if !prompt::all().iter().any(|t| t.name == name) {
        return Err(format!("未知的 Prompt: {}", name));
    }
    let dir = store::get_workspace_dir().join("prompts");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(&name), &content).map_err(|e| e.to_string())
}

/// 重置 Prompt 为默认值（删除用户自定义文件）。
/// 此后 `load()` 将回退到编译时默认内容。
#[tauri::command]
pub fn reset_prompt(name: String) -> Result<(), String> {
    if !prompt::all().iter().any(|t| t.name == name) {
        return Err(format!("未知的 Prompt: {}", name));
    }
    let path = store::get_workspace_dir().join("prompts").join(&name);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
