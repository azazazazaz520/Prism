pub(crate) mod export;
mod files;
pub(crate) mod recovery;
mod search;
pub(crate) mod watcher;

pub(crate) use files::{
    create_note_dir_at, delete_note_entry_at, get_note_mtime, is_safe_notes_dir, read_dir_entries,
    read_dir_recursive, read_note_content, read_note_meta, rename_note_entry_at, resolve_note_path,
    write_note_content,
};
pub(crate) use search::search_notes;
use serde::{Deserialize, Serialize};

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
