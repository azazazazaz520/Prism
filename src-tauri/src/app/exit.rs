use std::collections::{BTreeSet, HashMap};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::watch;

use super::tray;
use super::workspace_windows;
use crate::logging::LogLevel;
use crate::AppState;

/// 请求完整窗口冻结修改并提交本地保存。
pub const PREPARE_EXIT: &str = "prism:prepare-exit";
/// 通知本次参与窗口解除冻结。
pub const EXIT_CANCELLED: &str = "prism:exit-cancelled";

const PREPARE_TIMEOUT: Duration = Duration::from_secs(10);

/// 单个完整窗口提交的保存结果。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitPreparationReport {
    pub success: bool,
    #[serde(default)]
    pub failed_paths: Vec<String>,
    #[serde(default)]
    pub conflict_paths: Vec<String>,
    #[serde(default)]
    pub message: Option<String>,
}

/// 当前窗口看到的退出阶段。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppExitState {
    /// "idle" | "preparing" | "quitting"
    pub phase: String,
    pub request_id: Option<u64>,
    /// 当前窗口是否已经提交本次请求的回执。
    pub completed: bool,
}

#[derive(Default)]
struct ExitInner {
    phase: ExitPhase,
    next_request_id: u64,
    ready_windows: BTreeSet<String>,
}

#[derive(Default)]
enum ExitPhase {
    #[default]
    Idle,
    Preparing(Preparing),
    Quitting {
        request_id: u64,
    },
}

struct Preparing {
    request_id: u64,
    participants: BTreeSet<String>,
    reports: HashMap<String, ExitPreparationReport>,
    cancel_reason: Option<String>,
}

enum WaitOutcome {
    Completed,
    Cancelled(String),
}

/// 一次退出请求的参与窗口、回执与超时状态。
pub struct ExitCoordinator {
    inner: Mutex<ExitInner>,
    revisions: watch::Sender<u64>,
}

impl Default for ExitCoordinator {
    fn default() -> Self {
        let (revisions, _receiver) = watch::channel(0);
        Self {
            inner: Mutex::new(ExitInner::default()),
            revisions,
        }
    }
}

impl ExitCoordinator {
    pub fn is_busy(&self) -> bool {
        !matches!(self.inner.lock().unwrap().phase, ExitPhase::Idle)
    }

    pub fn is_preparing(&self) -> bool {
        matches!(self.inner.lock().unwrap().phase, ExitPhase::Preparing(_))
    }

    pub fn is_quitting(&self) -> bool {
        matches!(self.inner.lock().unwrap().phase, ExitPhase::Quitting { .. })
    }

    /// 登记调用窗口已挂接退出保存处理器。
    pub fn register_ready(&self, label: &str) {
        self.inner
            .lock()
            .unwrap()
            .ready_windows
            .insert(label.to_string());
    }

    pub fn state_for(&self, label: &str) -> AppExitState {
        let inner = self.inner.lock().unwrap();
        match &inner.phase {
            ExitPhase::Idle => AppExitState {
                phase: "idle".into(),
                request_id: None,
                completed: false,
            },
            ExitPhase::Preparing(preparing) => AppExitState {
                phase: "preparing".into(),
                request_id: Some(preparing.request_id),
                completed: preparing.reports.contains_key(label),
            },
            ExitPhase::Quitting { request_id } => AppExitState {
                phase: "quitting".into(),
                request_id: Some(*request_id),
                completed: true,
            },
        }
    }

    fn notify_change(&self) {
        self.revisions.send_modify(|revision| {
            *revision = revision.wrapping_add(1);
        });
    }

    fn begin_preparing(&self, participants: BTreeSet<String>) -> u64 {
        let request_id = {
            let mut inner = self.inner.lock().unwrap();
            inner.next_request_id = inner.next_request_id.wrapping_add(1);
            let request_id = inner.next_request_id;
            inner.phase = ExitPhase::Preparing(Preparing {
                request_id,
                participants,
                reports: HashMap::new(),
                cancel_reason: None,
            });
            request_id
        };
        self.notify_change();
        request_id
    }

    /// 记录单个窗口的回执；重复、越界和取消后的回执不推进退出。
    fn record_report(
        &self,
        label: &str,
        request_id: u64,
        report: ExitPreparationReport,
    ) -> Result<(), String> {
        {
            let mut inner = self.inner.lock().unwrap();
            let ExitPhase::Preparing(preparing) = &mut inner.phase else {
                return Err("当前没有进行中的退出准备".into());
            };
            if preparing.request_id != request_id {
                return Err("退出请求编号已失效".into());
            }
            if !preparing.participants.contains(label) {
                return Err("当前窗口不属于本次退出".into());
            }
            if preparing.reports.contains_key(label) {
                return Err("当前窗口已提交保存结果".into());
            }
            if preparing.cancel_reason.is_some() {
                return Err("退出准备已取消".into());
            }
            if !report.success {
                preparing.cancel_reason = Some(cancel_reason(&report));
            }
            preparing.reports.insert(label.to_string(), report);
        }
        self.notify_change();
        Ok(())
    }

    /// 参与窗口销毁时注销就绪登记；准备中的窗口会触发本次退出取消。
    fn mark_window_destroyed(&self, label: &str) -> bool {
        let changed = {
            let mut inner = self.inner.lock().unwrap();
            inner.ready_windows.remove(label);
            match &mut inner.phase {
                ExitPhase::Preparing(preparing)
                    if preparing.participants.contains(label)
                        && preparing.cancel_reason.is_none() =>
                {
                    preparing.cancel_reason = Some(format!("参与退出的窗口 {label} 已关闭"));
                    true
                }
                _ => false,
            }
        };
        if changed {
            self.notify_change();
        }
        changed
    }

    /// 清空当前准备状态并返回本次参与窗口，用于取消退出。
    fn clear_preparing(&self, request_id: u64) -> Vec<String> {
        let participants = {
            let mut inner = self.inner.lock().unwrap();
            let participants = match &inner.phase {
                ExitPhase::Preparing(preparing) if preparing.request_id == request_id => {
                    preparing.participants.iter().cloned().collect::<Vec<_>>()
                }
                _ => Vec::new(),
            };
            inner.phase = ExitPhase::Idle;
            participants
        };
        self.notify_change();
        participants
    }

    /// 等待全部回执、取消或阶段失效；调用方负责总超时。
    async fn wait(&self, request_id: u64) -> WaitOutcome {
        let mut changes = self.revisions.subscribe();
        loop {
            {
                let inner = self.inner.lock().unwrap();
                match &inner.phase {
                    ExitPhase::Preparing(preparing) if preparing.request_id == request_id => {
                        if let Some(reason) = &preparing.cancel_reason {
                            return WaitOutcome::Cancelled(reason.clone());
                        }
                        if preparing.reports.len() == preparing.participants.len() {
                            return WaitOutcome::Completed;
                        }
                    }
                    _ => return WaitOutcome::Cancelled("退出准备已失效".into()),
                }
            }
            if changes.changed().await.is_err() {
                return WaitOutcome::Cancelled("退出准备已失效".into());
            }
        }
    }
}

/// 从托盘菜单或重复点击进入退出准备。
pub fn request_exit(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        begin(&app).await;
    });
}

async fn begin(app: &AppHandle) {
    if app.state::<ExitCoordinator>().is_busy() {
        return;
    }

    {
        let gate = app.state::<tray::OperationGate>();
        let _guard = gate.acquire().await;
        if app.state::<ExitCoordinator>().is_busy() {
            return;
        }
        run_preparation(app).await;
    }

    if !app.state::<ExitCoordinator>().is_quitting() {
        tray::publish_status(app);
    }
    workspace_windows::resolve_pending_open(app);
}

async fn run_preparation(app: &AppHandle) {
    if app
        .state::<workspace_windows::WorkspaceWindows>()
        .is_picker_open()
    {
        log(
            app,
            LogLevel::Error,
            "app.exit_prepare_failed",
            "目录选择尚未完成，暂不进入退出准备",
            serde_json::json!({}),
        );
        show_message(app, "暂时无法退出", "请先完成或取消正在进行的目录选择。");
        return;
    }

    let coordinator = app.state::<ExitCoordinator>();
    let windows = workspace_windows::application_window_labels(app);
    if windows.is_empty() {
        finish_quit(app);
        return;
    }

    let missing = {
        let inner = coordinator.inner.lock().unwrap();
        windows
            .iter()
            .find(|label| !inner.ready_windows.contains(*label))
            .cloned()
    };
    if let Some(label) = missing {
        log(
            app,
            LogLevel::Error,
            "app.exit_prepare_failed",
            "存在尚未就绪的完整窗口，取消退出",
            serde_json::json!({ "label": label }),
        );
        show_message(app, "无法退出 Prism", "窗口正在初始化，请稍后重试。");
        return;
    }

    let participants: BTreeSet<String> = windows.iter().cloned().collect();
    let request_id = coordinator.begin_preparing(participants);
    tray::set_quit_enabled(app, false);
    tray::publish_status(app);

    for label in &windows {
        if let Err(error) = app.emit_to(
            label.as_str(),
            PREPARE_EXIT,
            serde_json::json!({ "requestId": request_id }),
        ) {
            let reason = format!("无法通知窗口 {label} 保存笔记：{error}");
            cancel_request(app, request_id, &reason, "app.exit_prepare_failed").await;
            return;
        }
    }

    match tokio::time::timeout(PREPARE_TIMEOUT, coordinator.wait(request_id)).await {
        Ok(WaitOutcome::Completed) => finish_quit(app),
        Ok(WaitOutcome::Cancelled(reason)) => {
            cancel_request(app, request_id, &reason, "app.exit_prepare_failed").await;
        }
        Err(_) => {
            let reason = "等待窗口保存超时，已取消退出";
            cancel_request(app, request_id, reason, "app.exit_prepare_timeout").await;
        }
    }
}

/// 取消本次退出：先更新状态，再通知参与窗口解除冻结。
async fn cancel_request(app: &AppHandle, request_id: u64, reason: &str, log_code: &str) {
    let coordinator = app.state::<ExitCoordinator>();
    let participants = coordinator.clear_preparing(request_id);
    tray::set_quit_enabled(app, true);

    for label in &participants {
        if let Err(error) = app.emit_to(
            label.as_str(),
            EXIT_CANCELLED,
            serde_json::json!({ "requestId": request_id, "reason": reason }),
        ) {
            log(
                app,
                LogLevel::Warn,
                "app.exit_prepare_failed",
                "发送退出取消事件失败",
                serde_json::json!({ "label": label, "error": error.to_string(), "requestId": request_id }),
            );
        }
    }

    log(
        app,
        LogLevel::Error,
        log_code,
        "退出准备取消",
        serde_json::json!({ "requestId": request_id, "reason": reason, "windows": participants }),
    );

    let report = workspace_windows::restore_application_windows(app).await;
    if report.has_failures() {
        log(
            app,
            LogLevel::Warn,
            "window.restore_failed",
            "取消退出后恢复窗口失败",
            serde_json::json!({ "failure": report.failure_summary() }),
        );
    }
    show_message(app, "已取消退出", reason);
}

fn finish_quit(app: &AppHandle) {
    let coordinator = app.state::<ExitCoordinator>();
    let request_id = {
        let mut inner = coordinator.inner.lock().unwrap();
        let request_id = match &inner.phase {
            ExitPhase::Preparing(preparing) => preparing.request_id,
            ExitPhase::Quitting { request_id } => *request_id,
            ExitPhase::Idle => 0,
        };
        inner.phase = ExitPhase::Quitting { request_id };
        request_id
    };
    coordinator.notify_change();

    app.state::<workspace_windows::WorkspaceWindows>()
        .running
        .store(false, std::sync::atomic::Ordering::SeqCst);
    log(
        app,
        LogLevel::Info,
        "app.exit",
        "本地笔记保存完成，结束进程",
        serde_json::json!({ "requestId": request_id }),
    );
    app.exit(0);
}

/// 接收参与窗口的保存回执；重复、失效和迟到的回执不推进退出。
pub fn complete(
    app: &AppHandle,
    label: &str,
    request_id: u64,
    report: ExitPreparationReport,
) -> Result<(), String> {
    app.state::<ExitCoordinator>()
        .record_report(label, request_id, report)
}

/// 完整窗口销毁时注销参与者和就绪登记。
pub fn window_destroyed(app: &AppHandle, label: &str) {
    app.state::<ExitCoordinator>().mark_window_destroyed(label);
}

fn cancel_reason(report: &ExitPreparationReport) -> String {
    if let Some(message) = report.message.as_ref().filter(|value| !value.is_empty()) {
        return message.clone();
    }
    if !report.conflict_paths.is_empty() {
        return format!(
            "存在 {} 个未处理的笔记冲突，已取消退出",
            report.conflict_paths.len()
        );
    }
    if !report.failed_paths.is_empty() {
        return format!(
            "有 {} 个笔记保存失败，已取消退出",
            report.failed_paths.len()
        );
    }
    "本地笔记保存未完成，已取消退出".into()
}

/// 以非阻塞原生对话框展示退出结果。
pub fn show_message(app: &AppHandle, title: &str, message: &str) {
    use tauri_plugin_dialog::DialogExt;
    app.dialog().message(message).title(title).show(|_| {});
}

fn log(app: &AppHandle, level: LogLevel, code: &str, message: &str, details: serde_json::Value) {
    if let Some(state) = app.try_state::<AppState>() {
        let _ = state
            .logger
            .append_internal(level, "app", code, message, details);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn success() -> ExitPreparationReport {
        ExitPreparationReport {
            success: true,
            failed_paths: Vec::new(),
            conflict_paths: Vec::new(),
            message: None,
        }
    }

    fn failure(message: &str) -> ExitPreparationReport {
        ExitPreparationReport {
            success: false,
            failed_paths: vec!["notes/a.md".into()],
            conflict_paths: Vec::new(),
            message: Some(message.into()),
        }
    }

    fn participants(labels: &[&str]) -> BTreeSet<String> {
        labels.iter().map(|label| (*label).to_string()).collect()
    }

    #[tokio::test]
    async fn wait_completes_after_all_participants_report() {
        let coordinator = ExitCoordinator::default();
        let request_id = coordinator.begin_preparing(participants(&["main", "workspace-a"]));
        coordinator
            .record_report("main", request_id, success())
            .unwrap();
        coordinator
            .record_report("workspace-a", request_id, success())
            .unwrap();

        match coordinator.wait(request_id).await {
            WaitOutcome::Completed => {}
            WaitOutcome::Cancelled(reason) => panic!("不应取消：{reason}"),
        }
    }

    #[tokio::test]
    async fn failed_report_cancels_wait_with_reason() {
        let coordinator = ExitCoordinator::default();
        let request_id = coordinator.begin_preparing(participants(&["main"]));
        coordinator
            .record_report("main", request_id, failure("笔记保存失败，已取消退出"))
            .unwrap();

        match coordinator.wait(request_id).await {
            WaitOutcome::Cancelled(reason) => {
                assert_eq!(reason, "笔记保存失败，已取消退出");
            }
            WaitOutcome::Completed => panic!("保存失败不应完成退出"),
        }
    }
}
