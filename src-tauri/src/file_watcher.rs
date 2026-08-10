// ═══════════════════════════════════════════════════════════════
//  文件系统监听：实时监测笔记目录的增删改
//
//  使用 notify crate 监听笔记目录的文件变更，
//  通过 Tauri 事件 "notes://file-changed" 通知前端。
// ═══════════════════════════════════════════════════════════════

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const FILE_CHANGE_EVENT: &str = "notes://file-changed";
const EVENT_POLL_INTERVAL: Duration = Duration::from_millis(500);
const RENAME_PAIR_TIMEOUT: Duration = Duration::from_secs(2);

/// 文件变更事件，发送到前端。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    /// "create" | "modify" | "remove" | "rename"
    pub kind: String,
    /// 相对于笔记目录的文件路径。
    pub path: String,
    /// 重命名前的相对路径，仅在 `rename` 事件中存在。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    /// 重命名后的相对路径，仅在 `rename` 事件中存在。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_path: Option<String>,
}

struct PendingRename {
    path: PathBuf,
    observed_at: Instant,
}

/// 文件监听器句柄，drop 时自动停止监听。
pub struct FileWatcher {
    shutdown_tx: Option<mpsc::Sender<()>>,
}

impl FileWatcher {
    /// 启动文件系统监听。
    ///
    /// 监听器在独立线程中运行，负责监测 `notes_dir` 下所有 `.md` 文件的
    /// 创建、内容修改和删除事件，并通过 Tauri 事件发送到前端。
    pub fn start(app_handle: AppHandle, notes_dir: PathBuf) -> Self {
        let (shutdown_tx, shutdown_rx) = mpsc::channel();
        let (event_tx, event_rx) = mpsc::channel::<Result<Event, notify::Error>>();

        let mut watcher = match create_watcher(event_tx) {
            Ok(watcher) => watcher,
            Err(error) => {
                eprintln!("[prism] 文件监听器创建失败: {error}");
                return Self { shutdown_tx: None };
            }
        };

        if let Err(error) = watcher.watch(&notes_dir, RecursiveMode::Recursive) {
            eprintln!("[prism] 文件监听启动失败: {error}");
            return Self { shutdown_tx: None };
        }

        std::thread::spawn(move || {
            run_event_loop(app_handle, notes_dir, watcher, event_rx, shutdown_rx);
        });

        Self {
            shutdown_tx: Some(shutdown_tx),
        }
    }
}

impl Drop for FileWatcher {
    fn drop(&mut self) {
        if let Some(sender) = self.shutdown_tx.take() {
            let _ = sender.send(());
        }
    }
}

fn create_watcher(
    event_tx: mpsc::Sender<Result<Event, notify::Error>>,
) -> notify::Result<RecommendedWatcher> {
    notify::recommended_watcher(move |result| {
        if event_tx.send(result).is_err() {
            eprintln!("[prism] 文件监听事件接收线程已关闭");
        }
    })
}

fn run_event_loop(
    app_handle: AppHandle,
    notes_dir: PathBuf,
    watcher: RecommendedWatcher,
    event_rx: mpsc::Receiver<Result<Event, notify::Error>>,
    shutdown_rx: mpsc::Receiver<()>,
) {
    // watcher 必须在线程内保持存活，否则 notify 会停止监听。
    let _watcher = watcher;
    let mut pending_rename: Option<PendingRename> = None;
    loop {
        match event_rx.recv_timeout(EVENT_POLL_INTERVAL) {
            Ok(Ok(event)) => {
                handle_file_event(&app_handle, &notes_dir, &event, &mut pending_rename)
            }
            Ok(Err(error)) => eprintln!("[prism] 文件监听事件错误: {error}"),
            Err(mpsc::RecvTimeoutError::Timeout) if shutdown_rx.try_recv().is_ok() => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn handle_file_event(
    app_handle: &AppHandle,
    notes_dir: &Path,
    event: &Event,
    pending_rename: &mut Option<PendingRename>,
) {
    if let EventKind::Modify(notify::event::ModifyKind::Name(mode)) = event.kind {
        match mode {
            notify::event::RenameMode::Both => {
                if let Some((old_path, new_path)) = rename_paths(&event.paths, notes_dir) {
                    emit_rename(app_handle, old_path, new_path);
                }
            }
            notify::event::RenameMode::From => {
                if let Some(path) = event.paths.first() {
                    if relative_markdown_path(path, notes_dir).is_some() {
                        *pending_rename = Some(PendingRename {
                            path: path.clone(),
                            observed_at: Instant::now(),
                        });
                    }
                }
            }
            notify::event::RenameMode::To => {
                let candidate = pending_rename.take();
                let is_recent = candidate
                    .as_ref()
                    .is_some_and(|rename| rename.observed_at.elapsed() <= RENAME_PAIR_TIMEOUT);
                if is_recent {
                    if let (Some(rename), Some(new_path)) = (candidate, event.paths.first()) {
                        if let (Some(old_path), Some(new_path)) = (
                            relative_markdown_path(&rename.path, notes_dir),
                            relative_markdown_path(new_path, notes_dir),
                        ) {
                            emit_rename(app_handle, old_path, new_path);
                        }
                    }
                } else if let Some(new_path) = event
                    .paths
                    .first()
                    .and_then(|path| relative_markdown_path(path, notes_dir))
                {
                    emit_change(app_handle, "create", new_path);
                }
            }
            notify::event::RenameMode::Any | notify::event::RenameMode::Other => {}
        }
        return;
    }

    let Some(kind) = classify_event(event) else {
        return;
    };

    for path in &event.paths {
        let Some(relative_path) = relative_markdown_path(path, notes_dir) else {
            continue;
        };

        emit_change(app_handle, kind, relative_path);
    }
}

fn emit_change(app_handle: &AppHandle, kind: &str, path: String) {
    let change = FileChangeEvent {
        kind: kind.to_string(),
        path,
        old_path: None,
        new_path: None,
    };
    if let Err(error) = app_handle.emit(FILE_CHANGE_EVENT, change) {
        eprintln!("[prism] 文件监听事件发送失败: {error}");
    }
}

fn emit_rename(app_handle: &AppHandle, old_path: String, new_path: String) {
    let change = FileChangeEvent {
        kind: "rename".to_string(),
        path: new_path.clone(),
        old_path: Some(old_path),
        new_path: Some(new_path),
    };
    if let Err(error) = app_handle.emit(FILE_CHANGE_EVENT, change) {
        eprintln!("[prism] 文件重命名事件发送失败: {error}");
    }
}

fn rename_paths(paths: &[PathBuf], notes_dir: &Path) -> Option<(String, String)> {
    let old_path = relative_markdown_path(paths.first()?, notes_dir)?;
    let new_path = relative_markdown_path(paths.get(1)?, notes_dir)?;
    Some((old_path, new_path))
}

fn classify_event(event: &Event) -> Option<&'static str> {
    match &event.kind {
        EventKind::Create(_) => Some("create"),
        EventKind::Modify(notify::event::ModifyKind::Data(_)) => Some("modify"),
        EventKind::Remove(_) => Some("remove"),
        _ => None,
    }
}

fn relative_markdown_path(path: &Path, notes_dir: &Path) -> Option<String> {
    if path.extension().and_then(|extension| extension.to_str()) != Some("md") {
        return None;
    }

    let relative_path = path.strip_prefix(notes_dir).ok()?;
    Some(relative_path.to_string_lossy().replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_event_only_accepts_content_relevant_events() {
        let create = Event::new(EventKind::Create(notify::event::CreateKind::File));
        let metadata = Event::new(EventKind::Modify(notify::event::ModifyKind::Metadata(
            notify::event::MetadataKind::Any,
        )));
        let content = Event::new(EventKind::Modify(notify::event::ModifyKind::Data(
            notify::event::DataChange::Any,
        )));
        let rename = Event::new(EventKind::Modify(notify::event::ModifyKind::Name(
            notify::event::RenameMode::Both,
        )));

        assert_eq!(classify_event(&create), Some("create"));
        assert_eq!(classify_event(&metadata), None);
        assert_eq!(classify_event(&content), Some("modify"));
        assert_eq!(classify_event(&rename), None);
    }

    #[test]
    fn relative_markdown_path_filters_extensions_and_normalizes_separators() {
        let base = Path::new("notes");
        let markdown_path = base.join("daily").join("today.md");
        let text_path = base.join("daily").join("today.txt");
        let outside_path = Path::new("other").join("today.md");
        assert_eq!(
            relative_markdown_path(&markdown_path, base),
            Some("daily/today.md".to_string())
        );
        assert_eq!(relative_markdown_path(&text_path, base), None);
        assert_eq!(relative_markdown_path(&outside_path, base), None);
    }

    #[test]
    fn rename_paths_requires_two_markdown_paths_in_from_to_order() {
        let base = Path::new("notes");
        assert_eq!(
            rename_paths(&[base.join("old.md"), base.join("new.md"),], base,),
            Some(("old.md".to_string(), "new.md".to_string()))
        );
        assert_eq!(rename_paths(&[base.join("old.md")], base), None);
    }
}
