//! 笔记正文的流式字面搜索，维护查询窗口并输出 UTF-16 命中位置与有限上下文。

use std::collections::VecDeque;
use std::io::{self, BufRead, BufReader, Read, Seek};

use super::files::file_mtime;
use super::{NoteSearchFileResult, NoteSearchMatch, NoteSearchResponse};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

pub(super) const READ_BUFFER_BYTES: usize = 64 * 1024;
const PREVIEW_MATCHES: usize = 3;

pub(super) struct NoteSearchPattern {
    bytes: Vec<u8>,
    fallback: Vec<usize>,
}

impl NoteSearchPattern {
    /// 为已转为小写的 UTF-8 查询构建 KMP 前缀回退表，供工作区内全部文件复用。
    pub(super) fn new(query_lower: &str) -> Self {
        let bytes = query_lower.as_bytes().to_vec();
        let mut fallback = vec![0; bytes.len()];
        let mut matched = 0;
        for index in 1..bytes.len() {
            while matched > 0 && bytes[index] != bytes[matched] {
                matched = fallback[matched - 1];
            }
            if bytes[index] == bytes[matched] {
                matched += 1;
            }
            fallback[index] = matched;
        }
        Self { bytes, fallback }
    }
}

struct SearchReader<'a, R, F> {
    input: BufReader<R>,
    /// 已消费正文的逻辑字节位置，用于回退和预览定位。
    offset: u64,
    is_cancelled: &'a F,
}

impl<R: Read + Seek, F: Fn() -> bool> SearchReader<'_, R, F> {
    /// 解码一个完整 UTF-8 字符并推进逻辑位置，在缓冲耗尽时检查取消信号。
    fn read_char(&mut self) -> io::Result<Option<char>> {
        if self.input.buffer().is_empty() && (self.is_cancelled)() {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "笔记搜索已取消"));
        }
        let Some(first) = self.input.fill_buf()?.first().copied() else {
            return Ok(None);
        };
        let width = match first {
            0..=0x7f => 1,
            0xc2..=0xdf => 2,
            0xe0..=0xef => 3,
            0xf0..=0xf4 => 4,
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "笔记正文包含无效 UTF-8",
                ))
            }
        };
        let mut bytes = [0; 4];
        self.input.read_exact(&mut bytes[..width])?;
        let character = std::str::from_utf8(&bytes[..width])
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?
            .chars()
            .next()
            .unwrap();
        self.offset += width as u64;
        Ok(Some(character))
    }

    fn seek(&mut self, offset: u64) -> io::Result<()> {
        let distance = i64::try_from(self.offset.abs_diff(offset))
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
        self.input.seek_relative(if offset < self.offset {
            -distance
        } else {
            distance
        })?;
        self.offset = offset;
        Ok(())
    }
}

/// 原始字符的文件字节范围与行内 UTF-16 范围，均采用左闭右开区间。
#[derive(Clone, Copy)]
struct SourcePosition {
    start: u64,
    end: u64,
    column_utf16: usize,
    end_utf16: usize,
}

struct FoundMatch {
    first: SourcePosition,
    last: SourcePosition,
    line: usize,
    segment_start: u64,
    /// 搜索片段结束时补全，供预览读取限定上下文范围。
    segment_end: u64,
}

/// 使用固定读取缓冲扫描全部正文，匹配状态按查询长度保存，预览只保留前三处。
/// 返回完整命中数量及预览；取消搜索时返回 `Interrupted` 错误。
pub(super) fn search_note_reader<R: Read + Seek>(
    input: R,
    pattern: &NoteSearchPattern,
    is_cancelled: &impl Fn() -> bool,
) -> io::Result<(usize, Vec<NoteSearchMatch>)> {
    if pattern.bytes.is_empty() {
        return Ok((0, Vec::new()));
    }
    let mut reader = SearchReader {
        input: BufReader::with_capacity(READ_BUFFER_BYTES, input),
        offset: 0,
        is_cancelled,
    };
    let mut match_count = 0;
    let mut found = Vec::new();
    let mut positions = VecDeque::new();
    let mut matched = 0;
    let mut line = 1;
    let mut column_utf16 = 0;
    let mut segment_start = 0;

    while let Some(character) = reader.read_char()? {
        let start = reader.offset - character.len_utf8() as u64;
        let end = reader.offset;
        let mut newline = character == '\n';
        // CRLF 作为一个换行处理，单独的 CR 参与正文匹配。
        if character == '\r' {
            newline = reader.read_char()? == Some('\n');
            if !newline {
                reader.seek(end)?;
            }
        }
        let marker_length = if character == '<' {
            let length = read_task_marker(&mut reader)?;
            if length.is_none() {
                reader.seek(end)?;
            }
            length
        } else {
            None
        };

        // 换行与有效任务标记划定搜索片段，匹配和预览都限定在同一片段内。
        if newline || marker_length.is_some() {
            finish_segment(&mut found, segment_start, start);
            matched = 0;
            positions.clear();
            segment_start = reader.offset;
            if newline {
                line += 1;
                column_utf16 = 0;
            } else {
                column_utf16 += marker_length.unwrap();
            }
            continue;
        }

        let position = SourcePosition {
            start,
            end,
            column_utf16,
            end_utf16: column_utf16 + character.len_utf16(),
        };
        column_utf16 = position.end_utf16;
        // 小写转换产生的每个 UTF-8 字节映射回原字符，位置队列仅保存一个查询窗口。
        for lowered in character.to_lowercase() {
            let mut bytes = [0; 4];
            for byte in lowered.encode_utf8(&mut bytes).bytes() {
                positions.push_back(position);
                if positions.len() > pattern.bytes.len() {
                    positions.pop_front();
                }
                while matched > 0 && byte != pattern.bytes[matched] {
                    matched = pattern.fallback[matched - 1];
                }
                if byte == pattern.bytes[matched] {
                    matched += 1;
                }
                if matched == pattern.bytes.len() {
                    match_count += 1;
                    if found.len() < PREVIEW_MATCHES {
                        found.push(FoundMatch {
                            first: *positions.front().unwrap(),
                            last: position,
                            line,
                            segment_start,
                            segment_end: 0,
                        });
                    }
                    // 保留匹配后缀的回退状态，继续统计重叠命中。
                    matched = pattern.fallback[matched - 1];
                }
            }
        }
    }
    finish_segment(&mut found, segment_start, reader.offset);

    let matches = found
        .into_iter()
        .map(|found| {
            Ok(NoteSearchMatch {
                line: found.line,
                column_utf16: found.first.column_utf16,
                length_utf16: found.last.end_utf16 - found.first.column_utf16,
                excerpt: read_excerpt(&mut reader, &found)?,
            })
        })
        .collect::<io::Result<Vec<_>>>()?;
    Ok((match_count, matches))
}

fn finish_segment(found: &mut [FoundMatch], start: u64, end: u64) {
    for found in found
        .iter_mut()
        .filter(|found| found.segment_start == start)
    {
        found.segment_end = end;
    }
}

/// 从已消费的 `<` 后解析任务标记，有效时返回包含起始 `<` 的 UTF-16 长度。
/// 无效时返回 `None`，由调用方回退到 `<` 后继续匹配正文。
fn read_task_marker<R: Read + Seek>(
    reader: &mut SearchReader<'_, R, impl Fn() -> bool>,
) -> io::Result<Option<usize>> {
    let mut length = 1;
    let mut next = || -> io::Result<Option<char>> {
        let character = reader.read_char()?;
        if let Some(character) = character {
            length += character.len_utf16();
        }
        Ok(character)
    };
    for expected in "!--".chars() {
        if next()? != Some(expected) {
            return Ok(None);
        }
    }
    let mut character = next()?;
    while character.is_some_and(|character| character != '\n' && character.is_whitespace()) {
        character = next()?;
    }
    if character != Some('p') {
        return Ok(None);
    }
    for expected in "rism-task:".chars() {
        if next()? != Some(expected) {
            return Ok(None);
        }
    }
    let mut has_id = false;
    let mut trailing_whitespace = false;
    let mut hyphens = 0;
    while let Some(character) = next()? {
        // 连续连字符延后判定，用于区分任务标识符中的 `-` 与结束符 `-->`。
        if character == '-' {
            hyphens += 1;
            continue;
        }
        if character == '>' && hyphens >= 2 {
            return Ok(
                if (has_id || hyphens > 2) && (!trailing_whitespace || hyphens == 2) {
                    Some(length)
                } else {
                    None
                },
            );
        }
        if hyphens > 0 {
            if trailing_whitespace {
                return Ok(None);
            }
            has_id = true;
            hyphens = 0;
        }
        if character.is_ascii_alphanumeric() || character == '_' {
            if trailing_whitespace {
                return Ok(None);
            }
            has_id = true;
        } else if character != '\n' && character.is_whitespace() && has_id {
            trailing_whitespace = true;
        } else {
            return Ok(None);
        }
    }
    Ok(None)
}

/// 读取命中附近的有限字节窗口，裁剪为命中前 64 个、命中后 96 个 Unicode 字符。
fn read_excerpt<R: Read + Seek>(
    reader: &mut SearchReader<'_, R, impl Fn() -> bool>,
    found: &FoundMatch,
) -> io::Result<String> {
    // 按每字符最多四个字节取足上下文，窗口限定在当前搜索片段内。
    let start = found
        .first
        .start
        .saturating_sub(64 * 4)
        .max(found.segment_start);
    let end = found.last.end.saturating_add(96 * 4).min(found.segment_end);
    reader.seek(start)?;
    let mut bytes = Vec::new();
    reader
        .input
        .by_ref()
        .take(end - start)
        .read_to_end(&mut bytes)?;
    reader.offset = start + bytes.len() as u64;
    if reader.offset != end {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "读取搜索预览时笔记正文已变化",
        ));
    }
    // 字节窗口两端可能落在字符内部，预览只保留完整的 UTF-8 字符。
    let leading = bytes
        .iter()
        .take_while(|byte| **byte & 0xc0 == 0x80)
        .count();
    let bytes = &bytes[leading..];
    let text = match std::str::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) if error.error_len().is_none() => {
            std::str::from_utf8(&bytes[..error.valid_up_to()])
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?
        }
        Err(error) => return Err(io::Error::new(io::ErrorKind::InvalidData, error)),
    };
    let text_start = start + leading as u64;
    let changed = || io::Error::new(io::ErrorKind::InvalidData, "读取搜索预览时笔记正文已变化");
    let match_start = ((found.first.start - start) as usize)
        .checked_sub(leading)
        .ok_or_else(changed)?;
    let match_end = ((found.last.end - start) as usize)
        .checked_sub(leading)
        .ok_or_else(changed)?;
    let excerpt_start = text
        .get(..match_start)
        .ok_or_else(changed)?
        .char_indices()
        .rev()
        .nth(63)
        .map_or(0, |(offset, _)| offset);
    let excerpt_end = text
        .get(match_end..)
        .ok_or_else(changed)?
        .char_indices()
        .nth(96)
        .map_or(text.len(), |(offset, _)| match_end + offset);
    Ok(format!(
        "{}{}{}",
        if text_start + excerpt_start as u64 > found.segment_start {
            "…"
        } else {
            ""
        },
        &text[excerpt_start..excerpt_end],
        if text_start + (excerpt_end as u64) < found.segment_end {
            "…"
        } else {
            ""
        },
    ))
}

const NOTE_SEARCH_MAX_FILES: usize = 200;

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
    let pattern = NoteSearchPattern::new(&query_lower);
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
            .and_then(|file| search_note_reader(file, &pattern, &is_cancelled));
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
    search_note_reader(
        std::io::Cursor::new(content.as_bytes()),
        &NoteSearchPattern::new(query_lower),
        &|| false,
    )
    .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

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
            "a".repeat(READ_BUFFER_BYTES)
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
        let content = vec![b'x'; READ_BUFFER_BYTES * 4];
        let mut input = std::io::Cursor::new(content);
        let checks = std::cell::Cell::new(0);
        let result = search_note_reader(&mut input, &NoteSearchPattern::new("needle"), &|| {
            checks.set(checks.get() + 1);
            checks.get() >= 2
        });

        assert_eq!(result.unwrap_err().kind(), std::io::ErrorKind::Interrupted);
        assert!(input.position() <= READ_BUFFER_BYTES as u64);
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
