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
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const FILE_CHANGE_EVENT: &str = "notes://file-changed";
const EVENT_POLL_INTERVAL: Duration = Duration::from_millis(500);

/// 文件变更事件，发送到前端。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    /// "create" | "modify" | "remove"
    pub kind: String,
    /// 相对于笔记目录的文件路径。
    pub path: String,
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
    loop {
        match event_rx.recv_timeout(EVENT_POLL_INTERVAL) {
            Ok(Ok(event)) => handle_file_event(&app_handle, &notes_dir, &event),
            Ok(Err(error)) => eprintln!("[prism] 文件监听事件错误: {error}"),
            Err(mpsc::RecvTimeoutError::Timeout) if shutdown_rx.try_recv().is_ok() => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn handle_file_event(app_handle: &AppHandle, notes_dir: &Path, event: &Event) {
    let Some(kind) = classify_event(event) else {
        return;
    };

    for path in &event.paths {
        let Some(relative_path) = relative_markdown_path(path, notes_dir) else {
            continue;
        };

        let change = FileChangeEvent {
            kind: kind.to_string(),
            path: relative_path,
        };
        if let Err(error) = app_handle.emit(FILE_CHANGE_EVENT, change) {
            eprintln!("[prism] 文件监听事件发送失败: {error}");
        }
    }
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

        assert_eq!(classify_event(&create), Some("create"));
        assert_eq!(classify_event(&metadata), None);
        assert_eq!(classify_event(&content), Some("modify"));
    }

    #[test]
    fn relative_markdown_path_filters_extensions_and_normalizes_separators() {
        let base = Path::new("C:\\notes");
        assert_eq!(
            relative_markdown_path(Path::new("C:\\notes\\daily\\today.md"), base),
            Some("daily/today.md".to_string())
        );
        assert_eq!(
            relative_markdown_path(Path::new("C:\\notes\\daily\\today.txt"), base),
            None
        );
        assert_eq!(
            relative_markdown_path(Path::new("C:\\other\\today.md"), base),
            None
        );
    }
}
