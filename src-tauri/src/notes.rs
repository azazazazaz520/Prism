use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

use crate::{store, AppState};

// ═══════════════════════════════════════════════════════════════
//  数据结构
// ═══════════════════════════════════════════════════════════════

/// 文件树节点（前端渲染用）
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    /// 相对路径（相对于 notes/ 目录）
    pub path: String,
    pub is_dir: bool,
    /// 目录的子节点（仅目录有，递归填充）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileEntry>>,
}

// ═══════════════════════════════════════════════════════════════
//  路径安全
// ═══════════════════════════════════════════════════════════════

/// 安全解析笔记相对路径，防止路径穿越攻击
/// 支持不存在的路径：会先规范化最长的存在祖先目录，再拼接剩余部分
fn resolve_note_path(base: &Path, rel: &str) -> Result<PathBuf, String> {
    let full = base.join(rel);

    // 尝试规范化完整路径（路径存在时）
    if let Ok(canonical) = full.canonicalize() {
        let root = base.canonicalize().unwrap_or_default();
        if !canonical.starts_with(&root) {
            return Err("路径越界，拒绝访问".into());
        }
        return Ok(canonical);
    }

    // 路径不存在：找到最长存在的祖先目录进行规范化
    let mut existing = full.clone();
    let mut trailing: Vec<std::ffi::OsString> = Vec::new();
    while !existing.exists() {
        if let Some(name) = existing.file_name().map(|n| n.to_os_string()) {
            trailing.push(name);
        }
        if let Some(parent) = existing.parent() {
            existing = parent.to_path_buf();
        } else {
            return Err("路径解析失败：无法定位有效祖先目录".into());
        }
    }

    let canonical_base = existing
        .canonicalize()
        .map_err(|e| format!("路径解析失败: {}", e))?;
    let root = base.canonicalize().unwrap_or_default();

    // 拼接回剩余路径段
    let mut resolved = canonical_base;
    while let Some(segment) = trailing.pop() {
        resolved = resolved.join(segment);
    }

    // 再次规范化（如果拼接后的路径碰巧存在）并校验越界
    let final_path = resolved.canonicalize().unwrap_or(resolved);
    if !final_path.starts_with(&root) {
        return Err("路径越界，拒绝访问".into());
    }
    Ok(final_path)
}

// ═══════════════════════════════════════════════════════════════
//  目录操作
// ═══════════════════════════════════════════════════════════════

/// 递归读取目录结构
fn read_dir_recursive(base: &PathBuf, rel: &str) -> Vec<FileEntry> {
    let dir = base.join(rel);
    let mut entries = Vec::new();

    let read = match fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(_) => return entries,
    };

    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let entry_rel = if rel.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel, name)
        };
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

        if is_dir {
            entries.push(FileEntry {
                name,
                path: entry_rel.clone(),
                is_dir: true,
                children: Some(read_dir_recursive(base, &entry_rel)),
            });
        } else if entry_rel.ends_with(".md") {
            entries.push(FileEntry {
                name,
                path: entry_rel,
                is_dir: false,
                children: None,
            });
        }
    }

    // 目录在前，文件在后；均按名称排序
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    entries
}

/// 列出 notes/ 目录的完整文件树
#[tauri::command]
pub fn list_note_tree(state: State<AppState>) -> Vec<FileEntry> {
    let config = state.config.lock().unwrap();
    let base = store::get_notes_dir(&config);
    read_dir_recursive(&base, "")
}

/// 读取笔记内容
#[tauri::command]
pub fn read_note(path: String, state: State<AppState>) -> Result<String, String> {
    let config = state.config.lock().unwrap();
    let base = store::get_notes_dir(&config);
    let full = resolve_note_path(&base, &path)?;
    fs::read_to_string(&full).map_err(|e| e.to_string())
}

/// 写入笔记内容（自动创建父目录）
#[tauri::command]
pub fn write_note(path: String, content: String, state: State<AppState>) -> Result<(), String> {
    let config = state.config.lock().unwrap();
    let base = store::get_notes_dir(&config);
    let full = base.join(&path);
    // 确保目标路径在笔记目录内
    let _ = resolve_note_path(&base, &path)?;
    // resolve_note_path 已确保安全性，但写入前父目录可能不存在
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
    }
    fs::write(&full, &content).map_err(|e| format!("写入失败: {}", e))
}

/// 创建文件夹
#[tauri::command]
pub fn create_note_dir(path: String, state: State<AppState>) -> Result<(), String> {
    let config = state.config.lock().unwrap();
    let base = store::get_notes_dir(&config);
    // 先校验路径不越界（需父目录已存在才能 canonicalize）
    let full = base.join(&path);
    // 确保父目录存在并在笔记目录内
    if let Some(parent) = full.parent() {
        let parent_rel = parent
            .strip_prefix(&base)
            .map_err(|_| "路径越界".to_string())?;
        if !parent_rel.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
        }
    }
    // 校验目标路径在笔记目录内（通过检查 join + strip_prefix）
    if full
        .canonicalize()
        .or_else(|_| {
            // 目录尚不存在时，校验父目录即可
            full.parent()
                .map(|p| p.to_path_buf())
                .unwrap_or(full.clone())
                .canonicalize()
        })
        .map(|c| !c.starts_with(base.canonicalize().unwrap_or_default()))
        .unwrap_or(true)
    {
        return Err("路径越界，拒绝访问".into());
    }
    fs::create_dir_all(&full).map_err(|e| format!("创建目录失败: {}", e))
}

/// 删除文件或文件夹（移入系统回收站）
#[tauri::command]
pub fn delete_note_entry(path: String, state: State<AppState>) -> Result<(), String> {
    let config = state.config.lock().unwrap();
    let base = store::get_notes_dir(&config);
    let full = resolve_note_path(&base, &path)?;
    trash::delete(&full).map_err(|e| format!("删除失败: {}", e))
}

/// 重命名文件或文件夹
#[tauri::command]
pub fn rename_note_entry(
    path: String,
    new_name: String,
    state: State<AppState>,
) -> Result<(), String> {
    // 校验新名称不含路径分隔符
    if new_name.contains('/') || new_name.contains('\\') {
        return Err("新名称不能包含路径分隔符".into());
    }
    if new_name.is_empty() {
        return Err("新名称不能为空".into());
    }

    let config = state.config.lock().unwrap();
    let base = store::get_notes_dir(&config);
    let full = resolve_note_path(&base, &path)?;
    let parent = full.parent().unwrap_or(&full);
    let new_path = parent.join(&new_name);

    // 检查目标路径是否已存在
    if new_path.exists() {
        return Err(format!("「{}」已存在", new_name));
    }

    fs::rename(&full, &new_path).map_err(|e| format!("重命名失败: {}", e))
}

/// 获取当前笔记目录路径
#[tauri::command]
pub fn get_notes_directory(state: State<AppState>) -> String {
    let config = state.config.lock().unwrap();
    store::get_notes_dir(&config).to_string_lossy().to_string()
}

/// 校验路径不在系统保护目录中
fn is_safe_notes_dir(path: &Path) -> Result<(), String> {
    // 获取系统关键目录
    let system_root = std::env::var("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or(PathBuf::from("C:\\Windows"));
    let program_files = std::env::var("ProgramFiles")
        .map(PathBuf::from)
        .unwrap_or(PathBuf::from("C:\\Program Files"));
    let program_files_x86 = std::env::var("ProgramFiles(x86)")
        .map(PathBuf::from)
        .unwrap_or(PathBuf::from("C:\\Program Files (x86)"));

    let canonical = path
        .canonicalize()
        .map_err(|e| format!("路径解析失败: {}", e))?;

    // 检查是否在系统目录中
    for blocked in &[&system_root, &program_files, &program_files_x86] {
        if canonical.starts_with(blocked) {
            return Err("不允许将笔记目录设置在系统目录中".into());
        }
    }

    // 检查是否为驱动器根目录
    if canonical.parent().is_none() || canonical.ancestors().count() <= 1 {
        return Err("不允许将笔记目录设置在驱动器根目录".into());
    }

    Ok(())
}

// ═══════════════════════════════════════════════════════════════
//  配置管理
// ═══════════════════════════════════════════════════════════════

/// 设置自定义笔记目录
#[tauri::command]
pub fn set_notes_directory(dir_path: String, state: State<AppState>) -> Result<(), String> {
    // 验证路径是否存在且可写
    let path = std::path::PathBuf::from(&dir_path);
    if !path.exists() {
        return Err(format!("路径不存在: {}", dir_path));
    }
    if !path.is_dir() {
        return Err("路径不是目录".into());
    }

    // 安全检查：拒绝系统目录
    is_safe_notes_dir(&path)?;

    // 尝试写入测试文件以验证权限
    let test_file = path.join(".todo_test_write");
    if let Err(e) = fs::write(&test_file, "") {
        return Err(format!("无法写入目录: {}", e));
    }
    fs::remove_file(&test_file).ok();

    // 更新配置
    let mut config = state.config.lock().unwrap();
    config.notes_dir = Some(path);
    store::save_config(&config)
}

// ═══════════════════════════════════════════════════════════════
//  测试
// ═══════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_entry_serialization() {
        let entry = FileEntry {
            name: "test.md".to_string(),
            path: "inbox/test.md".to_string(),
            is_dir: false,
            children: None,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("test.md"));
        assert!(json.contains("inbox/test.md"));
        assert!(!json.contains("children"));
    }

    #[test]
    fn test_dir_entry_serialization() {
        let entry = FileEntry {
            name: "inbox".to_string(),
            path: "inbox".to_string(),
            is_dir: true,
            children: Some(vec![]),
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("inbox"));
        assert!(json.contains("children"));
    }

    #[test]
    fn test_resolve_note_path_rejects_traversal() {
        let tmp = std::env::temp_dir().join(format!("prism-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(tmp.join("notes")).unwrap();
        fs::create_dir_all(tmp.join("outside")).unwrap();

        let base = tmp.join("notes");
        // 正常路径应通过
        assert!(resolve_note_path(&base, "test.md").is_ok());
        // 路径穿越应被拒绝
        assert!(resolve_note_path(&base, "../outside/escape.md").is_err());
        // 绝对路径越界应被拒绝（unix-only 概念，Windows 也适用）
        assert!(resolve_note_path(&base, "../../outside/escape.md").is_err());

        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn test_is_safe_notes_dir_rejects_drive_root() {
        let path = PathBuf::from("C:\\");
        // 驱动器根应被拒绝（如果 path 实际存在且可被 canonicalize）
        // 此测试在 CI 环境中 C:\ 存在
        if path.exists() {
            assert!(is_safe_notes_dir(&path).is_err());
        }
    }
}
