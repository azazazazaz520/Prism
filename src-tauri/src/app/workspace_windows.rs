use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;

use super::{exit, tray};
use crate::logging::LogLevel;
use crate::{notes, notes::watcher::FileWatcher, AppState};

/// 恢复事件：请求对应窗口执行一次恢复后的增量同步。
const APPLICATION_RESTORED: &str = "prism:application-restored";

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

    pub fn is_picker_open(&self) -> bool {
        self.picker_open.load(Ordering::SeqCst)
    }

    /// 完成窗口生命周期注册和托盘初始化，再放行挂起的重复启动请求。
    pub fn finish_startup(&self, app: &AppHandle) {
        if let Some(window) = app.get_webview_window("main") {
            attach_lifecycle(&window);
        }
        tray::initialize(app);
        self.ready.store(true, Ordering::SeqCst);
        if self.pending_open.swap(false, Ordering::SeqCst) {
            handle_second_launch(app);
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

pub fn is_application_window(label: &str) -> bool {
    label == "main" || label.starts_with("workspace-")
}

/// 返回当前全部完整应用窗口的 label，按名称稳定排序。
pub fn application_window_labels(app: &AppHandle) -> Vec<String> {
    let mut labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|label| is_application_window(label))
        .cloned()
        .collect();
    labels.sort();
    labels
}

fn application_windows(app: &AppHandle) -> Vec<WebviewWindow> {
    let mut windows: Vec<WebviewWindow> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| is_application_window(label))
        .map(|(_, window)| window)
        .collect();
    windows.sort_by(|left, right| left.label().cmp(right.label()));
    windows
}

fn attach_lifecycle(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => handle_close_request(&app, &label, api),
        WindowEvent::Destroyed => {
            exit::window_destroyed(&app, &label);
            app.state::<WorkspaceWindows>().remove(&label);
            exit_if_last_window_closed(&app);
        }
        _ => {}
    });
}

/// 按关闭到托盘策略决定放行、隐藏或暂缓本次关闭。
fn handle_close_request(app: &AppHandle, label: &str, api: &tauri::CloseRequestApi) {
    let coordinator = app.state::<exit::ExitCoordinator>();
    if coordinator.is_quitting() {
        return;
    }
    if coordinator.is_preparing() || app.state::<tray::OperationGate>().is_busy() {
        api.prevent_close();
        return;
    }
    if !app.state::<tray::CloseToTrayState>().should_intercept() {
        return;
    }

    if label != "main" {
        match has_other_visible_application_window(app, label) {
            Ok(true) => return,
            Ok(false) => {}
            Err(error) => {
                api.prevent_close();
                log(
                    app,
                    LogLevel::Warn,
                    "window.hide_to_tray_failed",
                    "查询其他完整窗口可见性失败，保留当前窗口",
                    serde_json::json!({ "label": label, "error": error }),
                );
                return;
            }
        }
    }

    api.prevent_close();
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    if let Err(error) = window.hide() {
        log(
            app,
            LogLevel::Error,
            "window.hide_to_tray_failed",
            "隐藏窗口到托盘失败",
            serde_json::json!({ "label": label, "error": error.to_string() }),
        );
        exit::show_message(
            app,
            "无法隐藏窗口",
            "Prism 未能隐藏到系统托盘，窗口保持打开。",
        );
    }
}

fn has_other_visible_application_window(app: &AppHandle, label: &str) -> Result<bool, String> {
    let mut states = Vec::new();
    for (window_label, window) in app.webview_windows() {
        if window_label == label || !is_application_window(&window_label) {
            continue;
        }
        states.push((
            window_label,
            window.is_visible().map_err(|error| error.to_string()),
        ));
    }
    evaluate_visible_application_windows(&states)
}

/// 判定除当前窗口外是否仍有未隐藏的完整窗口；查询失败不解释为可见或隐藏。
pub fn evaluate_visible_application_windows(
    states: &[(String, Result<bool, String>)],
) -> Result<bool, String> {
    for (label, state) in states {
        match state {
            Ok(true) => return Ok(true),
            Ok(false) => {}
            Err(error) => return Err(format!("{label}: {error}")),
        }
    }
    Ok(false)
}

fn exit_if_last_window_closed(app: &AppHandle) {
    let state = app.state::<WorkspaceWindows>();
    if state.workspaces.lock().unwrap().is_empty() && !state.picker_open.load(Ordering::SeqCst) {
        state.running.store(false, Ordering::SeqCst);
        app.exit(0);
    }
}

// ═══ 窗口恢复 ═══

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreFailure {
    pub label: String,
    pub stage: String,
    pub message: String,
}

/// 一次恢复操作的结构化结果。
#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    /// 检测到处于隐藏状态的完整窗口。
    pub hidden: Vec<String>,
    /// 已完成显示与展开的隐藏窗口。
    pub restored: Vec<String>,
    /// 恢复流程中失败的窗口与阶段。
    pub failed: Vec<RestoreFailure>,
    /// 本次展开的聚焦目标。
    pub focus_target: Option<String>,
    /// 聚焦成功的窗口。
    pub focused: Option<String>,
    /// 聚焦失败信息。
    pub focus_error: Option<String>,
    /// 可见性查询失败，无法判定隐藏状态。
    pub visibility_errors: Vec<RestoreFailure>,
}

impl RestoreReport {
    /// 是否影响窗口显示，不包含单独的聚焦失败。
    pub fn has_restore_failures(&self) -> bool {
        !self.failed.is_empty() || !self.visibility_errors.is_empty()
    }

    pub fn has_failures(&self) -> bool {
        self.has_restore_failures() || self.focus_error.is_some()
    }

    pub fn failure_summary(&self) -> String {
        let mut parts = Vec::new();
        for failure in self.visibility_errors.iter().chain(self.failed.iter()) {
            parts.push(format!("{}（{}）", failure.label, failure.stage));
        }
        if let Some(error) = &self.focus_error {
            parts.push(format!("聚焦失败：{error}"));
        }
        if parts.is_empty() {
            return "部分窗口未能恢复".into();
        }
        format!("部分窗口未能恢复：{}", parts.join("、"))
    }

    /// 需要发送恢复同步事件的窗口。
    fn event_targets(&self) -> Vec<String> {
        let mut targets = self.restored.clone();
        if let Some(target) = &self.focus_target {
            if !targets.contains(target) {
                targets.push(target.clone());
            }
        }
        targets
    }
}

/// 恢复流程依赖的原生窗口操作，测试可用替身实现。
pub trait ApplicationWindowOps {
    fn label(&self) -> &str;
    fn is_visible(&self) -> tauri::Result<bool>;
    fn is_focused(&self) -> tauri::Result<bool>;
    fn show(&self) -> tauri::Result<()>;
    fn unminimize(&self) -> tauri::Result<()>;
    fn set_focus(&self) -> tauri::Result<()>;
}

impl ApplicationWindowOps for WebviewWindow {
    fn label(&self) -> &str {
        WebviewWindow::label(self)
    }

    fn is_visible(&self) -> tauri::Result<bool> {
        WebviewWindow::is_visible(self)
    }

    fn is_focused(&self) -> tauri::Result<bool> {
        WebviewWindow::is_focused(self)
    }

    fn show(&self) -> tauri::Result<()> {
        WebviewWindow::show(self)
    }

    fn unminimize(&self) -> tauri::Result<()> {
        WebviewWindow::unminimize(self)
    }

    fn set_focus(&self) -> tauri::Result<()> {
        WebviewWindow::set_focus(self)
    }
}

fn select_focus_target<'a>(
    windows: &'a [&'a dyn ApplicationWindowOps],
) -> Option<&'a dyn ApplicationWindowOps> {
    if let Some(main) = windows.iter().find(|window| window.label() == "main") {
        return Some(*main);
    }
    if let Some(focused) = windows
        .iter()
        .find(|window| window.is_focused().unwrap_or(false))
    {
        return Some(*focused);
    }
    windows.first().copied()
}

/// 恢复操作选择聚焦目标的时机。
#[derive(Clone, Copy, PartialEq, Eq)]
enum RestoreFocus {
    /// 始终展开并聚焦目标，用于托盘恢复、关闭功能与取消退出。
    Always,
    /// 仅在检测到隐藏窗口时聚焦，用于普通重复启动。
    WhenHidden,
}

/// 显示全部隐藏完整窗口，并展开、聚焦主窗口或规定的回退目标。
fn restore_with_focus(windows: &[&dyn ApplicationWindowOps], focus: RestoreFocus) -> RestoreReport {
    let mut ordered = windows.to_vec();
    ordered.sort_by(|left, right| left.label().cmp(right.label()));

    let mut report = RestoreReport::default();
    for window in &ordered {
        let label = window.label().to_string();
        match window.is_visible() {
            Err(error) => report.visibility_errors.push(RestoreFailure {
                label,
                stage: "visibility".into(),
                message: error.to_string(),
            }),
            Ok(true) => {}
            Ok(false) => {
                report.hidden.push(label.clone());
                let mut revealed = true;
                if let Err(error) = window.show() {
                    report.failed.push(RestoreFailure {
                        label: label.clone(),
                        stage: "show".into(),
                        message: error.to_string(),
                    });
                    revealed = false;
                }
                if revealed {
                    if let Err(error) = window.unminimize() {
                        report.failed.push(RestoreFailure {
                            label: label.clone(),
                            stage: "unminimize".into(),
                            message: error.to_string(),
                        });
                        revealed = false;
                    }
                }
                if revealed {
                    report.restored.push(label);
                }
            }
        }
    }

    let should_focus = focus == RestoreFocus::Always || !report.hidden.is_empty();
    if !should_focus {
        return report;
    }

    if let Some(window) = select_focus_target(&ordered) {
        let label = window.label().to_string();
        let mut expanded = true;
        if let Err(error) = window.show() {
            report.failed.push(RestoreFailure {
                label: label.clone(),
                stage: "focus-show".into(),
                message: error.to_string(),
            });
            expanded = false;
        }
        if expanded {
            if let Err(error) = window.unminimize() {
                report.failed.push(RestoreFailure {
                    label: label.clone(),
                    stage: "focus-unminimize".into(),
                    message: error.to_string(),
                });
                expanded = false;
            }
        }
        if expanded {
            report.focus_target = Some(label.clone());
            match window.set_focus() {
                Ok(()) => report.focused = Some(label),
                Err(error) => report.focus_error = Some(format!("{label}: {error}")),
            }
        }
    }

    report
}

/// 在主事件线程执行窗口恢复，并等待实际操作完成。
pub async fn restore_application_windows(app: &AppHandle) -> RestoreReport {
    restore_application_windows_with(app, RestoreFocus::Always).await
}

/// 仅在有隐藏窗口时聚焦目标，供普通重复启动判定使用。
pub async fn restore_hidden_application_windows(app: &AppHandle) -> RestoreReport {
    restore_application_windows_with(app, RestoreFocus::WhenHidden).await
}

async fn restore_application_windows_with(app: &AppHandle, focus: RestoreFocus) -> RestoreReport {
    let handle = app.clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let scheduled = app.run_on_main_thread(move || {
        let windows = application_windows(&handle);
        let refs: Vec<&dyn ApplicationWindowOps> = windows
            .iter()
            .map(|window| window as &dyn ApplicationWindowOps)
            .collect();
        let _ = sender.send(restore_with_focus(&refs, focus));
    });
    if scheduled.is_err() {
        return dispatch_failed_report();
    }

    let report = receiver.await.unwrap_or_else(|_| dispatch_failed_report());
    for label in report.event_targets() {
        if let Err(error) = app.emit_to(label.as_str(), APPLICATION_RESTORED, ()) {
            log(
                app,
                LogLevel::Warn,
                "window.restore_failed",
                "发送恢复同步事件失败",
                serde_json::json!({ "label": label, "error": error.to_string() }),
            );
        }
    }
    report
}

fn dispatch_failed_report() -> RestoreReport {
    RestoreReport {
        failed: vec![RestoreFailure {
            label: "*".into(),
            stage: "dispatch".into(),
            message: "无法在主事件线程执行窗口操作".into(),
        }],
        ..RestoreReport::default()
    }
}

/// 托盘双击或“显示 Prism”触发的恢复流程。
pub fn restore_from_tray(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let report = restore_application_windows(&app).await;
        if report.has_failures() {
            log(
                &app,
                LogLevel::Error,
                "window.restore_failed",
                "托盘恢复窗口失败",
                serde_json::json!({ "failure": report.failure_summary() }),
            );
            let title = if report.has_restore_failures() {
                "无法恢复窗口"
            } else {
                "窗口已显示但未能聚焦"
            };
            exit::show_message(&app, title, &report.failure_summary());
        }
    });
}

// ═══ 重复启动 ═══

/// 处理普通重复启动：存在隐藏窗口时恢复，否则沿用新建工作区流程。
pub fn handle_second_launch(app: &AppHandle) {
    let state = app.state::<WorkspaceWindows>();
    if !state.ready.load(Ordering::SeqCst) {
        state.pending_open.store(true, Ordering::SeqCst);
        return;
    }
    if app.state::<tray::OperationGate>().is_busy()
        || app.state::<exit::ExitCoordinator>().is_busy()
    {
        state.pending_open.store(true, Ordering::SeqCst);
        return;
    }
    state.pending_open.store(false, Ordering::SeqCst);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let report = restore_hidden_application_windows(&app).await;
        if !report.visibility_errors.is_empty() {
            log(
                &app,
                LogLevel::Error,
                "window.restore_failed",
                "重复启动时无法查询窗口隐藏状态",
                serde_json::json!({ "failure": report.failure_summary() }),
            );
            exit::show_message(&app, "无法检查窗口状态", &report.failure_summary());
            return;
        }
        if !report.hidden.is_empty() {
            if report.has_failures() {
                log(
                    &app,
                    LogLevel::Error,
                    "window.restore_failed",
                    "重复启动时恢复隐藏窗口失败",
                    serde_json::json!({ "failure": report.failure_summary() }),
                );
                let title = if report.has_restore_failures() {
                    "无法恢复窗口"
                } else {
                    "窗口已显示但未能聚焦"
                };
                exit::show_message(&app, title, &report.failure_summary());
            }
            return;
        }
        request_new_workspace(&app);
    });
}

/// 设置更新或退出准备结束后，重新处理暂缓的重复启动请求。
pub fn resolve_pending_open(app: &AppHandle) {
    let state = app.state::<WorkspaceWindows>();
    if !state.ready.load(Ordering::SeqCst) || !state.pending_open.load(Ordering::SeqCst) {
        return;
    }
    if app.state::<tray::OperationGate>().is_busy()
        || app.state::<exit::ExitCoordinator>().is_busy()
    {
        return;
    }
    handle_second_launch(app);
}

/// 再次启动应用时选择目录，并创建使用完整应用界面的独立窗口。
pub fn request_new_workspace(app: &AppHandle) {
    let state = app.state::<WorkspaceWindows>();
    if !state.ready.load(Ordering::SeqCst) {
        state.pending_open.store(true, Ordering::SeqCst);
        return;
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
    notes::is_safe_notes_dir(&directory)?;
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

fn log(app: &AppHandle, level: LogLevel, code: &str, message: &str, details: serde_json::Value) {
    if let Some(state) = app.try_state::<AppState>() {
        let _ = state
            .logger
            .append_internal(level, "window", code, message, details);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    fn fake_error() -> tauri::Error {
        tauri::Error::Io(std::io::Error::other("模拟窗口操作失败"))
    }

    fn restore_with(windows: &[&dyn ApplicationWindowOps]) -> RestoreReport {
        restore_with_focus(windows, RestoreFocus::Always)
    }

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
            notes::read_note_content(&state.directory("main").unwrap(), "note.md").unwrap(),
            "原窗口内容"
        );
        notes::write_note_content(
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

    struct FakeWindow {
        label: String,
        visible: Cell<bool>,
        focused: Cell<bool>,
        visible_error: bool,
        show_error: bool,
        unminimize_error: bool,
        focus_error: bool,
        calls: RefCell<Vec<String>>,
    }

    impl FakeWindow {
        fn new(label: &str, visible: bool) -> Self {
            Self {
                label: label.into(),
                visible: Cell::new(visible),
                focused: Cell::new(false),
                visible_error: false,
                show_error: false,
                unminimize_error: false,
                focus_error: false,
                calls: RefCell::new(Vec::new()),
            }
        }

        fn focused(mut self, value: bool) -> Self {
            self.focused = Cell::new(value);
            self
        }

        fn with_visible_error(mut self) -> Self {
            self.visible_error = true;
            self
        }

        fn with_show_error(mut self) -> Self {
            self.show_error = true;
            self
        }

        fn recorded(&self) -> Vec<String> {
            self.calls.borrow().clone()
        }
    }

    impl ApplicationWindowOps for FakeWindow {
        fn label(&self) -> &str {
            &self.label
        }

        fn is_visible(&self) -> tauri::Result<bool> {
            if self.visible_error {
                return Err(fake_error());
            }
            Ok(self.visible.get())
        }

        fn is_focused(&self) -> tauri::Result<bool> {
            Ok(self.focused.get())
        }

        fn show(&self) -> tauri::Result<()> {
            self.calls.borrow_mut().push("show".into());
            if self.show_error {
                return Err(fake_error());
            }
            self.visible.set(true);
            Ok(())
        }

        fn unminimize(&self) -> tauri::Result<()> {
            self.calls.borrow_mut().push("unminimize".into());
            if self.unminimize_error {
                return Err(fake_error());
            }
            Ok(())
        }

        fn set_focus(&self) -> tauri::Result<()> {
            self.calls.borrow_mut().push("focus".into());
            if self.focus_error {
                return Err(fake_error());
            }
            self.focused.set(true);
            Ok(())
        }
    }

    #[test]
    fn hidden_windows_are_shown_and_unminimized_before_focus() {
        let main = FakeWindow::new("main", false);
        let workspace = FakeWindow::new("workspace-a", false);
        let report = restore_with(&[&workspace, &main]);
        assert_eq!(report.hidden, vec!["main", "workspace-a"]);
        assert_eq!(report.restored, vec!["main", "workspace-a"]);
        assert_eq!(report.focus_target.as_deref(), Some("main"));
        assert_eq!(report.focused.as_deref(), Some("main"));
        assert!(!report.has_failures());
        assert_eq!(
            main.recorded(),
            vec!["show", "unminimize", "show", "unminimize", "focus"]
        );
        assert_eq!(workspace.recorded(), vec!["show", "unminimize"]);
    }

    #[test]
    fn visible_minimized_workspace_is_left_untouched() {
        let main = FakeWindow::new("main", true);
        let workspace = FakeWindow::new("workspace-a", true);
        let report = restore_with(&[&main, &workspace]);
        assert!(report.hidden.is_empty());
        assert_eq!(workspace.recorded(), Vec::<String>::new());
        assert_eq!(main.recorded(), vec!["show", "unminimize", "focus"]);
    }

    #[test]
    fn second_launch_without_hidden_windows_does_not_expand_target() {
        let main = FakeWindow::new("main", true);
        let report = restore_with_focus(&[&main], RestoreFocus::WhenHidden);
        assert!(report.hidden.is_empty());
        assert!(report.focus_target.is_none());
        assert!(main.recorded().is_empty());
    }

    #[test]
    fn second_launch_with_hidden_window_expands_and_focuses_target() {
        let main = FakeWindow::new("main", false);
        let report = restore_with_focus(&[&main], RestoreFocus::WhenHidden);
        assert_eq!(report.hidden, vec!["main"]);
        assert_eq!(report.focused.as_deref(), Some("main"));
    }

    #[test]
    fn minimized_main_without_hidden_windows_is_expanded_and_focused() {
        let main = FakeWindow::new("main", true);
        let report = restore_with(&[&main]);
        assert!(report.hidden.is_empty());
        assert_eq!(report.focus_target.as_deref(), Some("main"));
        assert_eq!(report.focused.as_deref(), Some("main"));
        assert!(main.recorded().contains(&"unminimize".to_string()));
    }

    #[test]
    fn visibility_query_failure_is_reported_without_touching_window() {
        let main = FakeWindow::new("main", false);
        let broken = FakeWindow::new("workspace-broken", false).with_visible_error();
        let report = restore_with(&[&main, &broken]);
        assert_eq!(report.visibility_errors.len(), 1);
        assert_eq!(report.visibility_errors[0].label, "workspace-broken");
        assert!(report.has_failures());
        assert!(broken.recorded().is_empty());
        assert_eq!(report.restored, vec!["main"]);
    }

    #[test]
    fn failed_show_is_reported_and_not_counted_as_restored() {
        let main = FakeWindow::new("main", false).with_show_error();
        let report = restore_with(&[&main]);
        assert_eq!(report.hidden, vec!["main"]);
        assert!(report.restored.is_empty());
        assert_eq!(report.failed[0].stage, "show");
        assert_eq!(report.failed[0].label, "main");
        assert!(report.has_failures());
    }

    #[test]
    fn focus_falls_back_to_focused_window_then_smallest_label() {
        let workspace = FakeWindow::new("workspace-b", true).focused(true);
        let other = FakeWindow::new("workspace-a", true);
        let report = restore_with(&[&workspace, &other]);
        assert_eq!(report.focus_target.as_deref(), Some("workspace-b"));

        let workspace = FakeWindow::new("workspace-b", true);
        let other = FakeWindow::new("workspace-a", true);
        let report = restore_with(&[&workspace, &other]);
        assert_eq!(report.focus_target.as_deref(), Some("workspace-a"));
    }

    #[test]
    fn focus_failure_keeps_shown_windows_and_reports_error() {
        let mut main = FakeWindow::new("main", false);
        main.focus_error = true;
        let report = restore_with(&[&main]);
        assert_eq!(report.restored, vec!["main"]);
        assert_eq!(report.focus_target.as_deref(), Some("main"));
        assert!(report.focused.is_none());
        assert!(report.focus_error.is_some());
        assert!(!report.has_restore_failures());
        assert!(report.has_failures());
    }

    #[test]
    fn other_visible_window_keeps_workspace_close_normal() {
        let states = vec![
            ("main".to_string(), Ok(true)),
            ("workspace-b".to_string(), Ok(false)),
        ];
        assert!(evaluate_visible_application_windows(&states).unwrap());
    }

    #[test]
    fn only_hidden_windows_hide_the_last_workspace() {
        let states = vec![("main".to_string(), Ok(false))];
        assert!(!evaluate_visible_application_windows(&states).unwrap());
    }

    #[test]
    fn visibility_query_error_keeps_current_window() {
        let states = vec![
            ("main".to_string(), Ok(false)),
            ("workspace-b".to_string(), Err("查询失败".into())),
        ];
        assert!(evaluate_visible_application_windows(&states).is_err());
    }

    #[test]
    fn application_window_filter_excludes_auxiliary_windows() {
        assert!(is_application_window("main"));
        assert!(is_application_window("workspace-123"));
        assert!(!is_application_window("floating"));
        assert!(!is_application_window("import"));
        assert!(!is_application_window("selector"));
    }
}
