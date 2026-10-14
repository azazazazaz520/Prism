use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;

use crate::{file_watcher::FileWatcher, note_service, AppState};

struct NoteWorkspace {
    directory: PathBuf,
    search_generation: Arc<AtomicU64>,
    _watcher: Option<FileWatcher>,
}

/// 按完整应用窗口管理笔记目录、搜索和监听器。
#[derive(Default)]
pub struct WorkspaceWindows {
    workspaces: Mutex<HashMap<String, NoteWorkspace>>,
    picker_open: AtomicBool,
    pending_open: AtomicBool,
    ready: AtomicBool,
    pub running: Arc<AtomicBool>,
}

impl WorkspaceWindows {
    pub fn directory(&self, label: &str) -> Result<PathBuf, String> {
        self.workspaces
            .lock()
            .unwrap()
            .get(label)
            .map(|workspace| workspace.directory.clone())
            .ok_or_else(|| "当前窗口未绑定笔记工作区".into())
    }

    pub fn search_generation(&self, label: &str) -> Result<Arc<AtomicU64>, String> {
        self.workspaces
            .lock()
            .unwrap()
            .get(label)
            .map(|workspace| workspace.search_generation.clone())
            .ok_or_else(|| "当前窗口未绑定笔记工作区".into())
    }

    pub fn register(&self, app: &AppHandle, label: &str, directory: PathBuf) -> Result<(), String> {
        let watcher = FileWatcher::start(app.clone(), directory.clone(), label.to_string())?;
        self.replace(label, directory, watcher);
        Ok(())
    }

    pub fn replace(&self, label: &str, directory: PathBuf, watcher: FileWatcher) {
        let workspace = NoteWorkspace {
            directory,
            search_generation: Arc::new(AtomicU64::new(0)),
            _watcher: Some(watcher),
        };
        if let Some(previous) = self
            .workspaces
            .lock()
            .unwrap()
            .insert(label.to_string(), workspace)
        {
            previous.search_generation.fetch_add(1, Ordering::SeqCst);
        }
    }

    fn remove(&self, label: &str) {
        if let Some(workspace) = self.workspaces.lock().unwrap().remove(label) {
            workspace.search_generation.fetch_add(1, Ordering::SeqCst);
        }
    }

    pub fn prepare_main(&self, app: &AppHandle, directory: PathBuf) {
        self.running.store(true, Ordering::SeqCst);
        if let Err(error) = self.register(app, "main", directory.clone()) {
            eprintln!("[prism] 文件监听不可用：{error}");
            self.workspaces.lock().unwrap().insert(
                "main".into(),
                NoteWorkspace {
                    directory,
                    search_generation: Arc::new(AtomicU64::new(0)),
                    _watcher: None,
                },
            );
        }
    }

    pub fn finish_startup(&self, app: &AppHandle) {
        if let Some(window) = app.get_webview_window("main") {
            attach_lifecycle(&window);
        }
        self.ready.store(true, Ordering::SeqCst);
        if self.pending_open.swap(false, Ordering::SeqCst) {
            request_new_workspace(app);
        }
    }
}

pub fn application_window(app: &AppHandle) -> Option<WebviewWindow> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|window| {
            is_application_window(window.label()) && window.is_focused().unwrap_or(false)
        })
        .cloned()
        .or_else(|| windows.get("main").cloned())
        .or_else(|| {
            windows
                .values()
                .find(|window| is_application_window(window.label()))
                .cloned()
        })
}

fn is_application_window(label: &str) -> bool {
    label == "main" || label.starts_with("workspace-")
}

fn attach_lifecycle(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            app.state::<WorkspaceWindows>().remove(&label);
            exit_if_last_window_closed(&app);
        }
    });
}

fn exit_if_last_window_closed(app: &AppHandle) {
    let state = app.state::<WorkspaceWindows>();
    if state.workspaces.lock().unwrap().is_empty() && !state.picker_open.load(Ordering::SeqCst) {
        state.running.store(false, Ordering::SeqCst);
        app.exit(0);
    }
}

/// 再次启动应用时选择目录，并创建使用完整应用界面的独立窗口。
pub fn request_new_workspace(app: &AppHandle) {
    let state = app.state::<WorkspaceWindows>();
    if !state.ready.load(Ordering::SeqCst) {
        state.pending_open.store(true, Ordering::SeqCst);
        if !state.ready.load(Ordering::SeqCst) || !state.pending_open.swap(false, Ordering::SeqCst)
        {
            return;
        }
    }
    if state.picker_open.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file().set_title("在新窗口中打开笔记工作区");
        if let Some(parent) = application_window(&app) {
            dialog = dialog.set_parent(&parent);
        }
        let result = dialog.blocking_pick_folder().map(|folder| {
            let directory = folder.into_path().map_err(|error| error.to_string())?;
            open_workspace_window(&app, directory)
        });
        if let Some(Err(error)) = result {
            if let Some(state) = app.try_state::<AppState>() {
                let _ = state.logger.append_internal(
                    crate::logging::LogLevel::Error,
                    "window",
                    "window.workspace_open_failed",
                    "新建工作区窗口失败",
                    serde_json::json!({ "error": error }),
                );
            }
            app.dialog()
                .message(error)
                .title("无法打开工作区")
                .blocking_show();
        }
        app.state::<WorkspaceWindows>()
            .picker_open
            .store(false, Ordering::SeqCst);
        exit_if_last_window_closed(&app);
    });
}

fn open_workspace_window(app: &AppHandle, directory: PathBuf) -> Result<(), String> {
    note_service::is_safe_notes_dir(&directory)?;
    std::fs::read_dir(&directory).map_err(|error| format!("无法读取所选文件夹：{error}"))?;
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .ok_or("缺少主窗口配置")?;
    let label = format!("workspace-{}", uuid::Uuid::new_v4());
    config.label = label.clone();
    config.title = format!(
        "Prism — {}",
        directory.file_name().unwrap_or_default().to_string_lossy()
    );
    let state = app.state::<WorkspaceWindows>();
    state.register(app, &label, directory)?;
    match WebviewWindowBuilder::from_config(app, &config).and_then(|builder| builder.build()) {
        Ok(window) => {
            attach_lifecycle(&window);
            Ok(())
        }
        Err(error) => {
            state.remove(&label);
            Err(format!("窗口创建失败：{error}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bind(state: &WorkspaceWindows, label: &str, directory: PathBuf) {
        state.workspaces.lock().unwrap().insert(
            label.into(),
            NoteWorkspace {
                directory,
                search_generation: Arc::new(AtomicU64::new(0)),
                _watcher: None,
            },
        );
    }

    #[test]
    fn same_relative_note_is_read_and_written_in_its_window_directory() {
        let root = std::env::temp_dir().join(format!("prism-windows-{}", uuid::Uuid::new_v4()));
        let first = root.join("first");
        let second = root.join("second");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        std::fs::write(first.join("note.md"), "原窗口内容").unwrap();
        std::fs::write(second.join("note.md"), "新窗口内容").unwrap();
        let state = WorkspaceWindows::default();
        bind(&state, "main", first.clone());
        bind(&state, "workspace-second", second.clone());
        assert_eq!(
            note_service::read_note_content(&state.directory("main").unwrap(), "note.md").unwrap(),
            "原窗口内容"
        );
        note_service::write_note_content(
            &state.directory("workspace-second").unwrap(),
            "note.md",
            "修改新窗口",
            None,
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(first.join("note.md")).unwrap(),
            "原窗口内容"
        );
        assert_eq!(
            std::fs::read_to_string(second.join("note.md")).unwrap(),
            "修改新窗口"
        );
        assert!(state.directory("unknown").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn closing_one_workspace_preserves_other_window_and_search() {
        let state = WorkspaceWindows::default();
        bind(&state, "main", PathBuf::from("first"));
        bind(&state, "workspace-second", PathBuf::from("second"));
        let first_search = state.search_generation("main").unwrap();
        let second_search = state.search_generation("workspace-second").unwrap();
        first_search.fetch_add(1, Ordering::SeqCst);
        assert_eq!(second_search.load(Ordering::SeqCst), 0);
        state.remove("main");
        assert!(state.directory("main").is_err());
        assert_eq!(
            state.directory("workspace-second").unwrap(),
            PathBuf::from("second")
        );
        assert_eq!(first_search.load(Ordering::SeqCst), 2);
        assert_eq!(second_search.load(Ordering::SeqCst), 0);
    }
}
