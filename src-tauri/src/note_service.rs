use serde::{Deserialize, Serialize};
mod search;

use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub(crate) const FILE_CHANGED_EXTERNALLY: &str = "FILE_CHANGED_EXTERNALLY";

/// 笔记文件元信息，包含内容和文件版本标识。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub content: String,
    /// 文件修改时间的纳秒级 Unix 时间戳，以字符串传输避免 JavaScript 精度损失
    pub mtime: String,
}

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

/// 笔记正文中的单处命中位置及其上下文片段。
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteSearchMatch {
    pub line: usize,
    pub column_utf16: usize,
    pub length_utf16: usize,
    pub excerpt: String,
}

/// 单篇笔记的全文搜索结果。
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteSearchFileResult {
    pub path: String,
    pub file_name_matched: bool,
    pub match_count: usize,
    pub matches: Vec<NoteSearchMatch>,
    pub mtime: Option<String>,
}

/// 单次笔记全文搜索的结果及扫描统计。
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteSearchResponse {
    pub request_id: u64,
    pub files: Vec<NoteSearchFileResult>,
    pub matched_file_count: usize,
    pub scanned_file_count: usize,
    pub failed_path_count: usize,
    pub truncated: bool,
}

const NOTE_SEARCH_MAX_FILES: usize = 200;

// ═══════════════════════════════════════════════════════════════
//  路径安全
// ═══════════════════════════════════════════════════════════════

/// 安全解析笔记相对路径，防止路径穿越攻击。
/// 支持不存在的路径：会先规范化最长的存在祖先目录，再拼接剩余部分。
pub fn resolve_note_path(base: &Path, rel: &str) -> Result<PathBuf, String> {
    let full = base.join(rel);
    let root = canonical_base_path(base)?;

    // 尝试规范化完整路径（路径存在时）
    if let Ok(canonical) = full.canonicalize() {
        return ensure_path_inside(canonical, &root);
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

    let canonical_existing = existing
        .canonicalize()
        .map_err(|e| format!("路径解析失败: {}", e))?;

    // 拼接回剩余路径段
    let mut resolved = canonical_existing;
    while let Some(segment) = trailing.pop() {
        resolved = resolved.join(segment);
    }

    // 再次规范化（如果拼接后的路径碰巧存在）并校验越界
    let final_path = resolved.canonicalize().unwrap_or(resolved);
    ensure_path_inside(final_path, &root)
}

fn canonical_base_path(base: &Path) -> Result<PathBuf, String> {
    base.canonicalize()
        .map_err(|e| format!("笔记目录解析失败: {}", e))
}

fn ensure_path_inside(path: PathBuf, root: &Path) -> Result<PathBuf, String> {
    if path.starts_with(root) {
        Ok(path)
    } else {
        Err("路径越界，拒绝访问".into())
    }
}

// ═══════════════════════════════════════════════════════════════
//  目录操作
// ═══════════════════════════════════════════════════════════════

/// 递归读取目录结构（仅 .md 文件）
pub fn read_dir_recursive(base: &Path, rel: &str) -> Vec<FileEntry> {
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
            entries.push(directory_entry(
                name,
                entry_rel.clone(),
                Some(read_dir_recursive(base, &entry_rel)),
            ));
        } else if name.to_lowercase().ends_with(".md") {
            entries.push(note_file_entry(name, entry_rel));
        }
    }

    sort_file_entries(&mut entries);

    entries
}

/// 读取指定目录的直接子项，不递归读取子目录。
pub fn read_dir_entries(base: &Path, rel: &str) -> Result<Vec<FileEntry>, String> {
    let dir = resolve_note_path(base, rel)?;
    let metadata = fs::metadata(&dir).map_err(|e| format!("读取目录元信息失败: {}", e))?;
    if !metadata.is_dir() {
        return Err("目标路径不是目录".into());
    }

    let mut entries = Vec::new();
    let read = fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {}", e))?;
    for entry in read {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let entry_rel = if rel.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel, name)
        };
        let file_type = entry
            .file_type()
            .map_err(|e| format!("读取目录项类型失败: {}", e))?;

        if file_type.is_dir() {
            entries.push(directory_entry(name, entry_rel, None));
        } else if file_type.is_file() && name.to_lowercase().ends_with(".md") {
            entries.push(note_file_entry(name, entry_rel));
        }
    }

    sort_file_entries(&mut entries);
    Ok(entries)
}

fn directory_entry(name: String, path: String, children: Option<Vec<FileEntry>>) -> FileEntry {
    FileEntry {
        name,
        path,
        is_dir: true,
        children,
    }
}

fn note_file_entry(name: String, path: String) -> FileEntry {
    FileEntry {
        name,
        path,
        is_dir: false,
        children: None,
    }
}

fn sort_file_entries(entries: &mut [FileEntry]) {
    // 目录在前，文件在后；均按名称排序。
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

/// 读取笔记文件内容
pub fn read_note_content(base: &Path, rel_path: &str) -> Result<String, String> {
    let full = resolve_note_path(base, rel_path)?;
    fs::read_to_string(&full).map_err(|e| e.to_string())
}

/// 读取笔记文件内容及文件版本标识。
pub fn read_note_meta(base: &Path, rel_path: &str) -> Result<NoteMeta, String> {
    let full = resolve_note_path(base, rel_path)?;
    let metadata = fs::metadata(&full).map_err(|e| format!("读取文件元信息失败: {}", e))?;
    let mtime = file_mtime(&metadata)?;
    let content = fs::read_to_string(&full).map_err(|e| e.to_string())?;
    Ok(NoteMeta { content, mtime })
}

/// 获取笔记文件的版本标识（不读取内容，用于快速校验）。
pub fn get_note_mtime(base: &Path, rel_path: &str) -> Result<String, String> {
    let full = resolve_note_path(base, rel_path)?;
    let metadata = fs::metadata(&full).map_err(|e| format!("读取文件元信息失败: {}", e))?;
    file_mtime(&metadata)
}

fn file_mtime(metadata: &fs::Metadata) -> Result<String, String> {
    metadata
        .modified()
        .map_err(|e| format!("读取修改时间失败: {}", e))
        .map(|time| {
            time.duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
                .to_string()
        })
}

/// 搜索工作区内的 Markdown 文件名和正文，并返回最多 200 篇匹配笔记。
pub fn search_notes(
    base: &Path,
    request_id: u64,
    query: &str,
    skipped_paths: &[String],
    is_cancelled: impl Fn() -> bool,
) -> Result<NoteSearchResponse, String> {
    let root = base
        .canonicalize()
        .map_err(|error| format!("无法读取笔记工作区: {error}"))?;
    let query_lower = query.to_lowercase();
    let pattern = search::NoteSearchPattern::new(&query_lower);
    let skipped_paths: HashSet<String> = skipped_paths
        .iter()
        .map(|path| normalize_search_path(path))
        .collect();
    drop(fs::read_dir(&root).map_err(|error| format!("无法读取笔记工作区: {error}"))?);
    let mut entries = walkdir::WalkDir::new(&root)
        .min_depth(1)
        .follow_links(false)
        .into_iter();
    let mut results = NoteSearchResults::default();
    let mut scanned_file_count = 0;
    let mut failed_path_count = 0;

    while let Some(entry) = entries.next() {
        if is_cancelled() {
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                failed_path_count += 1;
                continue;
            }
        };
        let file_type = entry.file_type();
        if file_type.is_dir() {
            match entry.path().canonicalize() {
                Ok(path) if path.starts_with(&root) => {}
                _ => {
                    failed_path_count += 1;
                    entries.skip_current_dir();
                }
            }
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if !file_type.is_file() || !name.to_lowercase().ends_with(".md") {
            continue;
        }
        let relative_path = entry
            .path()
            .strip_prefix(&root)
            .unwrap()
            .to_string_lossy()
            .replace(std::path::MAIN_SEPARATOR, "/");
        if skipped_paths.contains(&normalize_search_path(&relative_path)) {
            continue;
        }

        scanned_file_count += 1;
        let file_name_matched = name.to_lowercase().contains(&query_lower);
        let path = match entry.path().canonicalize() {
            Ok(path) if path.starts_with(&root) => path,
            _ => {
                failed_path_count += 1;
                continue;
            }
        };
        let before = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => {
                failed_path_count += 1;
                if file_name_matched {
                    results.push(NoteSearchFileResult {
                        path: relative_path,
                        file_name_matched,
                        match_count: 0,
                        matches: Vec::new(),
                        mtime: None,
                    });
                }
                continue;
            }
        };
        let mtime = match file_mtime(&before) {
            Ok(mtime) => Some(mtime),
            Err(_) => {
                failed_path_count += 1;
                continue;
            }
        };
        let searched = fs::File::open(&path)
            .and_then(|file| search::search_note_reader(file, &pattern, &is_cancelled));
        let (match_count, matches) = match searched {
            Ok(matches) => matches,
            Err(_) => {
                if is_cancelled() {
                    break;
                }
                failed_path_count += 1;
                if file_name_matched {
                    results.push(NoteSearchFileResult {
                        path: relative_path,
                        file_name_matched,
                        match_count: 0,
                        matches: Vec::new(),
                        mtime,
                    });
                }
                continue;
            }
        };
        // 完成正文扫描和预览读取后，校验文件修改时间与长度。
        let after = fs::metadata(&path);
        let stable = after
            .as_ref()
            .ok()
            .and_then(|metadata| file_mtime(metadata).ok())
            == mtime
            && after
                .as_ref()
                .is_ok_and(|metadata| metadata.len() == before.len());
        if !stable {
            failed_path_count += 1;
            if file_name_matched {
                results.push(NoteSearchFileResult {
                    path: relative_path,
                    file_name_matched,
                    match_count: 0,
                    matches: Vec::new(),
                    mtime,
                });
            }
            continue;
        }

        if file_name_matched || match_count > 0 {
            results.push(NoteSearchFileResult {
                path: relative_path,
                file_name_matched,
                match_count,
                matches,
                mtime,
            });
        }
    }

    let matched_file_count = results.matched_file_count;
    let truncated = matched_file_count > NOTE_SEARCH_MAX_FILES;

    Ok(NoteSearchResponse {
        request_id,
        files: results.files,
        matched_file_count,
        scanned_file_count,
        failed_path_count,
        truncated,
    })
}

/// 累计全部匹配文件，并按文件名命中优先、路径排序保留前 200 篇。
#[derive(Default)]
struct NoteSearchResults {
    files: Vec<NoteSearchFileResult>,
    matched_file_count: usize,
}

impl NoteSearchResults {
    fn push(&mut self, result: NoteSearchFileResult) {
        self.matched_file_count += 1;
        let index = self
            .files
            .binary_search_by(|existing| {
                result
                    .file_name_matched
                    .cmp(&existing.file_name_matched)
                    .then_with(|| {
                        existing
                            .path
                            .to_lowercase()
                            .cmp(&result.path.to_lowercase())
                    })
                    .then_with(|| existing.path.cmp(&result.path))
            })
            .unwrap_or_else(|index| index);
        if index < NOTE_SEARCH_MAX_FILES {
            self.files.insert(index, result);
            self.files.truncate(NOTE_SEARCH_MAX_FILES);
        }
    }
}

fn normalize_search_path(path: &str) -> String {
    let path = path.replace('\\', "/");
    if cfg!(windows) {
        path.to_lowercase()
    } else {
        path
    }
}

#[cfg(test)]
fn search_note_content(content: &str, query_lower: &str) -> (usize, Vec<NoteSearchMatch>) {
    search::search_note_reader(
        std::io::Cursor::new(content.as_bytes()),
        &search::NoteSearchPattern::new(query_lower),
        &|| false,
    )
    .unwrap()
}

/// 写入笔记内容（自动创建父目录）。
///
/// 若提供了 `expected_mtime`，写入前会校验文件的当前修改时间是否匹配。
/// 不匹配时返回 `"FILE_CHANGED_EXTERNALLY"`，前端应提示用户处理冲突。
pub fn write_note_content(
    base: &Path,
    rel_path: &str,
    content: &str,
    expected_mtime: Option<String>,
) -> Result<String, String> {
    let full = resolve_note_path(base, rel_path)?;
    check_expected_mtime(&full, expected_mtime)?;

    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
    }
    write_note_atomically(&full, content)?;
    let metadata = fs::metadata(&full).map_err(|e| format!("读取写入后文件元信息失败: {}", e))?;
    file_mtime(&metadata)
}

fn check_expected_mtime(path: &Path, expected_mtime: Option<String>) -> Result<(), String> {
    let Some(expected) = expected_mtime else {
        return Ok(());
    };

    match fs::metadata(path) {
        Ok(metadata) => {
            if file_mtime(&metadata)? == expected {
                Ok(())
            } else {
                Err(FILE_CHANGED_EXTERNALLY.into())
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(FILE_CHANGED_EXTERNALLY.into())
        }
        Err(error) => Err(format!("读取文件元信息失败: {}", error)),
    }
}

fn write_note_atomically(target: &Path, content: &str) -> Result<(), String> {
    let temporary = temporary_note_path(target)?;
    let result = (|| -> Result<(), String> {
        let mut file =
            fs::File::create(&temporary).map_err(|e| format!("创建临时文件失败: {}", e))?;
        file.write_all(content.as_bytes())
            .map_err(|e| format!("写入临时文件失败: {}", e))?;
        file.sync_all()
            .map_err(|e| format!("刷新临时文件失败: {}", e))?;
        replace_note_file(&temporary, target)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn temporary_note_path(target: &Path) -> Result<PathBuf, String> {
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "写入失败：文件名无效".to_string())?;
    Ok(target.with_file_name(format!(".{}.prism-{}.tmp", file_name, uuid::Uuid::new_v4())))
}

fn replace_note_file(temporary: &Path, target: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_COPY_ALLOWED, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };

        let temporary: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
        let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            MoveFileExW(
                PCWSTR(temporary.as_ptr()),
                PCWSTR(target.as_ptr()),
                MOVEFILE_COPY_ALLOWED | MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        }
        .map_err(|e| format!("替换笔记文件失败: {}", e))?;
        Ok(())
    }

    #[cfg(not(windows))]
    {
        fs::rename(temporary, target).map_err(|e| format!("替换笔记文件失败: {}", e))
    }
}

/// 创建文件夹
pub fn create_note_dir_at(base: &Path, rel_path: &str) -> Result<(), String> {
    let full = resolve_note_path(base, rel_path)?;
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
    fn test_write_note_content_replaces_target_without_leaving_temporary_file() {
        let tmp = std::env::temp_dir().join(format!("prism-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();

        assert!(write_note_content(&tmp, "example.md", "第一版", None).is_ok());
        assert_eq!(
            fs::read_to_string(tmp.join("example.md")).unwrap(),
            "第一版"
        );

        assert!(write_note_content(&tmp, "example.md", "第二版", None).is_ok());
        assert_eq!(
            fs::read_to_string(tmp.join("example.md")).unwrap(),
            "第二版"
        );
        let temporary_files = fs::read_dir(&tmp)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".prism-"))
            .count();
        assert_eq!(temporary_files, 0);

        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn test_read_dir_entries_only_reads_one_level() {
        let tmp = std::env::temp_dir().join(format!("prism-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(tmp.join("notes/nested/deep")).unwrap();
        fs::write(tmp.join("notes/root.md"), "root").unwrap();
        fs::write(tmp.join("notes/ignored.txt"), "ignored").unwrap();
        fs::write(tmp.join("notes/nested/child.md"), "child").unwrap();

        let entries = read_dir_entries(&tmp.join("notes"), "").unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().any(|entry| entry.path == "root.md"));
        let nested = entries.iter().find(|entry| entry.path == "nested").unwrap();
        assert!(nested.is_dir);
        assert!(nested.children.is_none());

        fs::remove_dir_all(&tmp).ok();
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

    #[test]
    fn test_search_note_content_matches_unicode_and_omits_task_markers() {
        let content = "计划 Project PROJECT 计划 <!-- prism-task:task_1 -->\n- [ ] 任务标题 <!-- prism-task:task_2 -->\n😀命中";

        let (count, matches) = search_note_content(content, "计划");
        assert_eq!(count, 2);
        assert_eq!(
            matches
                .iter()
                .map(|matched| matched.column_utf16)
                .collect::<Vec<_>>(),
            vec![0, 19]
        );

        let (count, matches) = search_note_content(content, "project");
        assert_eq!(count, 2);
        assert_eq!(
            matches
                .iter()
                .map(|matched| matched.column_utf16)
                .collect::<Vec<_>>(),
            vec![3, 11]
        );

        assert_eq!(search_note_content(content, "task_1").0, 0);
        assert_eq!(search_note_content(content, "任务标题").0, 1);
        let (_, matches) = search_note_content(content, "命中");
        assert_eq!(matches[0].line, 3);
        assert_eq!(matches[0].column_utf16, 2);
        let (count, matches) = search_note_content("aaaa\r\nİİ", "aa");
        assert_eq!(count, 3);
        assert_eq!(matches[2].column_utf16, 2);
        let (count, matches) = search_note_content("aaaa\r\nİİ", "i");
        assert_eq!(count, 2);
        assert_eq!(matches[1].line, 2);
        assert_eq!(matches[1].column_utf16, 1);
        assert_eq!(matches[1].length_utf16, 1);
        assert_eq!(
            search_note_content("<!-- ordinary needle -->", "needle").0,
            1
        );
        assert_eq!(
            search_note_content("<!-- prism-task:needle -->", "needle").0,
            0
        );
    }

    #[test]
    fn test_search_notes_scans_nested_markdown_and_skips_unsaved_paths() {
        let tmp = std::env::temp_dir().join(format!("prism-test-{}", uuid::Uuid::new_v4()));
        let notes = tmp.join("notes");
        fs::create_dir_all(notes.join("nested")).unwrap();
        fs::write(notes.join("content.md"), "Needle body Needle").unwrap();
        fs::write(notes.join("nested/Needle-title.md"), "no body match").unwrap();
        fs::write(notes.join("nested/skip.md"), "Needle unsaved version").unwrap();
        fs::write(notes.join("ignored.txt"), "Needle").unwrap();

        let response =
            search_notes(&notes, 7, "needle", &["nested/skip.md".into()], || false).unwrap();

        assert_eq!(response.request_id, 7);
        assert_eq!(response.scanned_file_count, 2);
        assert_eq!(response.matched_file_count, 2);
        assert!(!response.truncated);
        assert_eq!(response.files[0].path, "nested/Needle-title.md");
        assert!(response.files[0].file_name_matched);
        assert_eq!(response.files[1].match_count, 2);

        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn test_search_notes_streams_large_lines_and_finds_matches_at_file_end() {
        let tmp = std::env::temp_dir().join(format!("prism-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();
        let prefix_length = 2 * 1024 * 1024 - 2;
        let prefix = vec![b'x'; prefix_length];
        let marker = format!(
            "<!-- prism-task:needle_{} -->",
            "a".repeat(search::READ_BUFFER_BYTES)
        );
        let mut file = fs::File::create(tmp.join("large.md")).unwrap();
        file.write_all(&prefix).unwrap();
        file.write_all("😀Needle".as_bytes()).unwrap();
        file.write_all(marker.as_bytes()).unwrap();
        file.write_all(b"Needle\r\n").unwrap();
        file.write_all(&prefix).unwrap();
        file.write_all("尾😀Needle needle".as_bytes()).unwrap();
        drop(file);

        let response = search_notes(&tmp, 8, "needle", &[], || false).unwrap();
        fs::remove_dir_all(&tmp).ok();

        assert_eq!(response.scanned_file_count, 1);
        assert_eq!(response.failed_path_count, 0);
        assert_eq!(response.matched_file_count, 1);
        assert!(!response.truncated);
        let result = &response.files[0];
        assert_eq!(result.path, "large.md");
        assert_eq!(result.match_count, 4);
        assert_eq!(result.matches.len(), 3);
        assert_eq!(result.matches[0].line, 1);
        assert_eq!(result.matches[0].column_utf16, prefix_length + 2);
        assert_eq!(
            result.matches[1].column_utf16,
            prefix_length + "😀Needle".encode_utf16().count() + marker.encode_utf16().count()
        );
        assert_eq!(result.matches[2].line, 2);
        assert_eq!(result.matches[2].column_utf16, prefix_length + 3);
        assert_eq!(result.matches[2].length_utf16, 6);
        assert!(result
            .matches
            .iter()
            .all(|matched| matched.excerpt.contains("Needle")
                && !matched.excerpt.contains("prism-task")
                && matched.excerpt.chars().count() <= 167));
    }

    #[test]
    fn test_search_note_reader_cancels_within_large_line() {
        let content = vec![b'x'; search::READ_BUFFER_BYTES * 4];
        let mut input = std::io::Cursor::new(content);
        let checks = std::cell::Cell::new(0);
        let result = search::search_note_reader(
            &mut input,
            &search::NoteSearchPattern::new("needle"),
            &|| {
                checks.set(checks.get() + 1);
                checks.get() >= 2
            },
        );

        assert_eq!(result.unwrap_err().kind(), std::io::ErrorKind::Interrupted);
        assert!(input.position() <= search::READ_BUFFER_BYTES as u64);
    }

    #[test]
    fn test_search_notes_limits_displayed_files_and_counts_all_matches() {
        let tmp = std::env::temp_dir().join(format!("prism-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();
        for index in 0..NOTE_SEARCH_MAX_FILES + 1 {
            fs::write(tmp.join(format!("{index:03}.md")), "needle").unwrap();
        }
        fs::write(tmp.join("z-Needle-title.md"), "other content").unwrap();

        let response = search_notes(&tmp, 9, "needle", &[], || false).unwrap();
        fs::remove_dir_all(&tmp).ok();

        assert_eq!(response.scanned_file_count, NOTE_SEARCH_MAX_FILES + 2);
        assert_eq!(response.matched_file_count, NOTE_SEARCH_MAX_FILES + 2);
        assert_eq!(response.failed_path_count, 0);
        assert!(response.truncated);
        assert_eq!(response.files.len(), NOTE_SEARCH_MAX_FILES);
        assert_eq!(response.files[0].path, "z-Needle-title.md");
        assert_eq!(response.files[1].path, "000.md");
        assert_eq!(response.files.last().unwrap().path, "198.md");
    }
}
