#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Local;
    use serde_json::json;
    use std::fs::{self, File};
    use std::path::{Path, PathBuf};

    fn temp_dir() -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("prism-logging-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn test_event(event: &str) -> LogEvent {
        LogEvent {
            timestamp: "2026-07-24T12:00:00+08:00".to_string(),
            level: LogLevel::Error,
            module: "sync".to_string(),
            event: event.to_string(),
            message: "同步失败".to_string(),
            trace_id: "trace-test".to_string(),
            window: "main".to_string(),
            app_version: "0.1.0".to_string(),
            context: json!({ "retry_count": 2 }),
            error: None,
        }
    }

    fn write_oversized_log_files(dir: &Path) {
        let date = Local::now().date_naive();
        for index in 0..3 {
            let file_name = log_file_name(date, index);
            let path = dir.join(file_name);
            File::create(path)
                .unwrap()
                .set_len(20 * 1024 * 1024)
                .unwrap();
        }
    }

    fn directory_size(dir: &Path) -> u64 {
        fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().metadata().unwrap().len())
            .sum()
    }

    #[test]
    fn append_batch_writes_one_json_object_per_line() {
        let dir = temp_dir();
        let writer = LogWriter::new(dir.clone()).unwrap();
        writer
            .append_batch(&[test_event("sync.pull_failed")])
            .unwrap();

        let date = Local::now().date_naive();
        let content = fs::read_to_string(dir.join(log_file_name(date, 0))).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 1);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(lines[0]).unwrap()["event"],
            "sync.pull_failed"
        );

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn cleanup_keeps_total_log_size_within_limit() {
        let dir = temp_dir();
        write_oversized_log_files(&dir);
        let writer = LogWriter::new(dir.clone()).unwrap();
        writer.cleanup().unwrap();

        assert!(directory_size(&dir) <= 50 * 1024 * 1024);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn append_batch_rotates_after_file_reaches_ten_megabytes() {
        let dir = temp_dir();
        let date = Local::now().date_naive();
        File::create(dir.join(log_file_name(date, 0)))
            .unwrap()
            .set_len(10 * 1024 * 1024)
            .unwrap();
        let writer = LogWriter::new(dir.clone()).unwrap();

        writer
            .append_batch(&[test_event("sync.pull_failed")])
            .unwrap();

        assert!(dir.join(log_file_name(date, 1)).is_file());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn cleanup_removes_logs_older_than_fourteen_days() {
        let dir = temp_dir();
        let expired_date =
            (chrono::Local::now().date_naive() - chrono::Duration::days(15)).format("%Y-%m-%d");
        let expired_file = dir.join(format!("prism-{expired_date}.jsonl"));
        File::create(&expired_file).unwrap();
        let writer = LogWriter::new(dir.clone()).unwrap();

        writer.cleanup().unwrap();

        assert!(!expired_file.exists());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn append_internal_writes_a_complete_internal_event() {
        let dir = temp_dir();
        let writer = LogWriter::new(dir.clone()).unwrap();

        writer
            .append_internal(
                LogLevel::Warn,
                "persistence",
                "persistence.save_retried",
                "保存失败后重试",
                json!({ "retry_count": 1 }),
            )
            .unwrap();

        let date = Local::now().date_naive();
        let content = fs::read_to_string(dir.join(log_file_name(date, 0))).unwrap();
        let log: serde_json::Value = serde_json::from_str(content.trim()).unwrap();
        assert_eq!(log["level"], "warn");
        assert_eq!(log["module"], "persistence");
        assert_eq!(log["trace_id"], "");
        assert_eq!(log["window"], "");
        assert_eq!(log["app_version"], "");
        assert_eq!(log["context"]["retry_count"], 1);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn append_batch_rejects_an_event_larger_than_file_limit() {
        let dir = temp_dir();
        let writer = LogWriter::new(dir.clone()).unwrap();
        let mut event = test_event("oversized");
        event.message = "x".repeat(MAX_FILE_SIZE as usize);

        let result = writer.append_batch(&[event]);

        assert!(result.is_err());
        assert_eq!(directory_size(&dir), 0);
        fs::remove_dir_all(dir).unwrap();
    }
}
use chrono::{Duration, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;
const MAX_TOTAL_SIZE: u64 = 50 * 1024 * 1024;
const RETENTION_DAYS: i64 = 14;

// ═══════════════════════════════════════════════════════════════════════════
// 日志事件模型
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum LogLevel {
    Info,
    Warn,
    Error,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct LogEvent {
    pub(crate) timestamp: String,
    pub(crate) level: LogLevel,
    pub(crate) module: String,
    pub(crate) event: String,
    pub(crate) message: String,
    pub(crate) trace_id: String,
    pub(crate) window: String,
    pub(crate) app_version: String,
    pub(crate) context: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<Value>,
}

// ═══════════════════════════════════════════════════════════════════════════
// 日志文件写入与生命周期管理
// ═══════════════════════════════════════════════════════════════════════════

struct WriterState {
    current_file_name: Option<String>,
}

struct LogFile {
    path: PathBuf,
    date: NaiveDate,
    size: u64,
    modified: SystemTime,
}

pub(crate) struct LogWriter {
    log_dir: PathBuf,
    state: Mutex<WriterState>,
    disabled: bool,
}

impl LogWriter {
    pub(crate) fn new(log_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&log_dir).map_err(|error| format!("创建日志目录失败：{error}"))?;

        let writer = Self {
            log_dir,
            state: Mutex::new(WriterState {
                current_file_name: None,
            }),
            disabled: false,
        };
        writer.cleanup()?;
        Ok(writer)
    }

    pub(crate) fn disabled() -> Self {
        Self {
            log_dir: PathBuf::new(),
            state: Mutex::new(WriterState {
                current_file_name: None,
            }),
            disabled: true,
        }
    }

    pub(crate) fn append_batch(&self, events: &[LogEvent]) -> Result<(), String> {
        if self.disabled {
            return Err("日志写入器不可用".to_string());
        }
        if events.is_empty() {
            return Ok(());
        }

        let mut state = self
            .state
            .lock()
            .map_err(|_| "日志写入器状态锁已中毒".to_string())?;
        fs::create_dir_all(&self.log_dir).map_err(|error| format!("创建日志目录失败：{error}"))?;

        let lines: Vec<Vec<u8>> = events
            .iter()
            .map(|event| {
                let mut line = serde_json::to_vec(event)
                    .map_err(|error| format!("序列化日志事件失败：{error}"))?;
                line.push(b'\n');
                if line.len() as u64 > MAX_FILE_SIZE {
                    return Err(format!(
                        "单条日志超过文件大小上限（{} 字节）",
                        MAX_FILE_SIZE
                    ));
                }
                Ok(line)
            })
            .collect::<Result<_, String>>()?;

        for line in lines {
            let date = Local::now().date_naive();
            let path = self.current_log_path(&mut state, date, line.len() as u64)?;
            let mut file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .map_err(|error| format!("打开日志文件失败（{}）：{error}", path.display()))?;
            file.write_all(&line)
                .map_err(|error| format!("写入日志文件失败（{}）：{error}", path.display()))?;
            file.flush()
                .map_err(|error| format!("刷新日志文件失败（{}）：{error}", path.display()))?;
        }

        self.cleanup_logs()
    }

    pub(crate) fn append_internal(
        &self,
        level: LogLevel,
        module: &str,
        event: &str,
        message: &str,
        context: Value,
    ) -> Result<(), String> {
        self.append_batch(&[LogEvent {
            timestamp: Local::now().to_rfc3339(),
            level,
            module: module.to_string(),
            event: event.to_string(),
            message: message.to_string(),
            trace_id: String::new(),
            window: String::new(),
            app_version: String::new(),
            context,
            error: None,
        }])
    }

    pub(crate) fn cleanup(&self) -> Result<(), String> {
        if self.disabled {
            return Ok(());
        }
        let _state = self
            .state
            .lock()
            .map_err(|_| "日志写入器状态锁已中毒".to_string())?;
        self.cleanup_logs()
    }

    fn current_log_path(
        &self,
        state: &mut WriterState,
        date: NaiveDate,
        incoming_size: u64,
    ) -> Result<PathBuf, String> {
        if let Some(file_name) = &state.current_file_name {
            if parse_log_file_name(file_name).is_some_and(|(file_date, _)| file_date == date) {
                let path = self.log_dir.join(file_name);
                if file_size(&path)? == 0
                    || file_size(&path)?.saturating_add(incoming_size) <= MAX_FILE_SIZE
                {
                    return Ok(path);
                }
            }
        }

        let (sequence, path) = self.latest_log_file(date)?;
        let selected = if file_size(&path)? == 0
            || file_size(&path)?.saturating_add(incoming_size) <= MAX_FILE_SIZE
        {
            (sequence, path)
        } else {
            let next_sequence = sequence.saturating_add(1);
            (
                next_sequence,
                self.log_dir.join(log_file_name(date, next_sequence)),
            )
        };

        state.current_file_name = Some(log_file_name(date, selected.0));
        Ok(selected.1)
    }

    fn latest_log_file(&self, date: NaiveDate) -> Result<(u32, PathBuf), String> {
        let mut latest_sequence = 0;
        let mut found = false;

        for file in self.log_files()? {
            if file.date == date && (!found || file_sequence(&file.path) > latest_sequence) {
                latest_sequence = file_sequence(&file.path);
                found = true;
            }
        }

        Ok((
            latest_sequence,
            self.log_dir.join(log_file_name(date, latest_sequence)),
        ))
    }

    fn cleanup_logs(&self) -> Result<(), String> {
        fs::create_dir_all(&self.log_dir).map_err(|error| format!("创建日志目录失败：{error}"))?;

        let cutoff_date = Local::now().date_naive() - Duration::days(RETENTION_DAYS);
        for file in self.log_files()? {
            if file.date < cutoff_date {
                fs::remove_file(&file.path).map_err(|error| {
                    format!("清理过期日志失败（{}）：{error}", file.path.display())
                })?;
            }
        }

        let mut files = self.log_files()?;
        let mut total_size = files
            .iter()
            .fold(0_u64, |total, file| total.saturating_add(file.size));
        files.sort_by_key(|file| file.modified);

        for file in files {
            if total_size <= MAX_TOTAL_SIZE {
                break;
            }
            fs::remove_file(&file.path)
                .map_err(|error| format!("清理超额日志失败（{}）：{error}", file.path.display()))?;
            total_size = total_size.saturating_sub(file.size);
        }

        Ok(())
    }

    fn log_files(&self) -> Result<Vec<LogFile>, String> {
        let entries = fs::read_dir(&self.log_dir)
            .map_err(|error| format!("读取日志目录失败（{}）：{error}", self.log_dir.display()))?;
        let mut files = Vec::new();

        for entry in entries {
            let entry = entry.map_err(|error| format!("读取日志目录项失败：{error}"))?;
            let file_name = entry.file_name();
            let Some((date, _)) = parse_log_file_name(&file_name.to_string_lossy()) else {
                continue;
            };
            let metadata = entry.metadata().map_err(|error| {
                format!(
                    "读取日志文件元数据失败（{}）：{error}",
                    entry.path().display()
                )
            })?;
            if !metadata.is_file() {
                continue;
            }
            files.push(LogFile {
                path: entry.path(),
                date,
                size: metadata.len(),
                modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            });
        }

        Ok(files)
    }
}

fn log_file_name(date: NaiveDate, sequence: u32) -> String {
    if sequence == 0 {
        format!("prism-{}.jsonl", date.format("%Y-%m-%d"))
    } else {
        format!("prism-{}-{sequence}.jsonl", date.format("%Y-%m-%d"))
    }
}

fn parse_log_file_name(file_name: &str) -> Option<(NaiveDate, u32)> {
    let stem = file_name.strip_prefix("prism-")?.strip_suffix(".jsonl")?;
    let (date_text, suffix) = stem.split_at_checked(10)?;
    let date = NaiveDate::parse_from_str(date_text, "%Y-%m-%d").ok()?;
    if suffix.is_empty() {
        return Some((date, 0));
    }
    let sequence = suffix.strip_prefix('-')?.parse().ok()?;
    (sequence > 0).then_some((date, sequence))
}

fn file_sequence(path: &Path) -> u32 {
    path.file_name()
        .and_then(|name| parse_log_file_name(&name.to_string_lossy()))
        .map_or(0, |(_, sequence)| sequence)
}

fn file_size(path: &Path) -> Result<u64, String> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(metadata.len()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(format!(
            "读取日志文件大小失败（{}）：{error}",
            path.display()
        )),
    }
}
