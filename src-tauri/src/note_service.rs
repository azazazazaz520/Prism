use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

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

/// 安全解析笔记相对路径，防止路径穿越攻击。
/// 支持不存在的路径：会先规范化最长的存在祖先目录，再拼接剩余部分。
pub fn resolve_note_path(base: &Path, rel: &str) -> Result<PathBuf, String> {
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

/// 递归读取目录结构（仅 .md 文件）
pub fn read_dir_recursive(base: &PathBuf, rel: &str) -> Vec<FileEntry> {
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

/// 读取笔记文件内容
pub fn read_note_content(base: &Path, rel_path: &str) -> Result<String, String> {
    let full = resolve_note_path(base, rel_path)?;
    fs::read_to_string(&full).map_err(|e| e.to_string())
}

/// 写入笔记内容（自动创建父目录）
pub fn write_note_content(base: &Path, rel_path: &str, content: &str) -> Result<(), String> {
    let full = base.join(rel_path);
    // 确保目标路径在笔记目录内
    let _ = resolve_note_path(base, rel_path)?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
    }
    fs::write(&full, content).map_err(|e| format!("写入失败: {}", e))
}

/// 创建文件夹
pub fn create_note_dir_at(base: &Path, rel_path: &str) -> Result<(), String> {
    let full = base.join(rel_path);
    if let Some(parent) = full.parent() {
        let parent_rel = parent
            .strip_prefix(base)
            .map_err(|_| "路径越界".to_string())?;
        if !parent_rel.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
        }
    }
    // 校验目标路径在笔记目录内
    if full
        .canonicalize()
        .or_else(|_| {
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
pub fn delete_note_entry_at(base: &Path, rel_path: &str) -> Result<(), String> {
    let full = resolve_note_path(base, rel_path)?;
    trash::delete(&full).map_err(|e| format!("删除失败: {}", e))
}

/// 重命名文件或文件夹
pub fn rename_note_entry_at(base: &Path, rel_path: &str, new_name: &str) -> Result<(), String> {
    if new_name.contains('/') || new_name.contains('\\') {
        return Err("新名称不能包含路径分隔符".into());
    }
    if new_name.is_empty() {
        return Err("新名称不能为空".into());
    }

    let full = resolve_note_path(base, rel_path)?;
    let parent = full.parent().unwrap_or(&full);
    let new_path = parent.join(new_name);

    if new_path.exists() {
        return Err(format!("「{}」已存在", new_name));
    }

    fs::rename(&full, &new_path).map_err(|e| format!("重命名失败: {}", e))
}

/// 校验路径不在系统保护目录中
pub fn is_safe_notes_dir(path: &Path) -> Result<(), String> {
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

    for blocked in &[&system_root, &program_files, &program_files_x86] {
        if canonical.starts_with(blocked) {
            return Err("不允许将笔记目录设置在系统目录中".into());
        }
    }

    if canonical.parent().is_none() || canonical.ancestors().count() <= 1 {
        return Err("不允许将笔记目录设置在驱动器根目录".into());
    }

    Ok(())
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
        assert!(resolve_note_path(&base, "test.md").is_ok());
        assert!(resolve_note_path(&base, "../outside/escape.md").is_err());
        assert!(resolve_note_path(&base, "../../outside/escape.md").is_err());

        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn test_is_safe_notes_dir_rejects_drive_root() {
        let path = PathBuf::from("C:\\");
        if path.exists() {
            assert!(is_safe_notes_dir(&path).is_err());
        }
    }
}
