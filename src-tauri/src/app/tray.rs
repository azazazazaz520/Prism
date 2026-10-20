use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::exit;
use super::workspace_windows;
use crate::logging::LogLevel;
use crate::AppState;

/// 托盘固定标识，重复创建时复用同一图标。
pub const TRAY_ID: &str = "prism-tray";
/// 托盘设置快照广播事件。
pub const CLOSE_TO_TRAY_CHANGED: &str = "prism:close-to-tray-changed";

const MENU_SHOW: &str = "close-to-tray.show";
const MENU_QUIT: &str = "close-to-tray.quit";

/// 托盘设置与运行状态快照。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseToTrayStatus {
    /// 已持久化的用户偏好。
    pub enabled: bool,
    /// 本次运行中托盘句柄是否存在。
    pub available: bool,
    /// 设置变更或退出准备是否正在进行。
    pub updating: bool,
    /// 进程内递增版本，用于合并事件与命令响应。
    pub revision: u64,
    /// 最近一次失败原因。
    pub error: Option<String>,
}

#[derive(Default)]
struct StatusFields {
    enabled: bool,
    available: bool,
    revision: u64,
    error: Option<String>,
}

/// 串行执行托盘设置变更与退出准备，并在进行期间阻止窗口关闭和新工作区创建。
#[derive(Default)]
pub struct OperationGate {
    lock: tokio::sync::Mutex<()>,
    busy: AtomicBool,
}

impl OperationGate {
    /// 取得操作权并标记进行中；释放守卫后恢复空闲。
    pub async fn acquire(&self) -> OperationGuard<'_> {
        let guard = self.lock.lock().await;
        self.busy.store(true, Ordering::SeqCst);
        OperationGuard {
            gate: self,
            _guard: guard,
        }
    }

    pub fn is_busy(&self) -> bool {
        self.busy.load(Ordering::SeqCst)
    }
}

pub struct OperationGuard<'a> {
    gate: &'a OperationGate,
    _guard: tokio::sync::MutexGuard<'a, ()>,
}

impl Drop for OperationGuard<'_> {
    fn drop(&mut self) {
        self.gate.busy.store(false, Ordering::SeqCst);
    }
}

struct TrayMenu {
    quit: tauri::menu::MenuItem<tauri::Wry>,
}

/// 托盘设置、图标句柄与菜单句柄。
#[derive(Default)]
pub struct CloseToTrayState {
    status: Mutex<StatusFields>,
    menu: Mutex<Option<TrayMenu>>,
    handlers_installed: AtomicBool,
}

impl CloseToTrayState {
    pub fn snapshot(&self, app: &AppHandle) -> CloseToTrayStatus {
        let status = self.status.lock().unwrap();
        CloseToTrayStatus {
            enabled: status.enabled,
            available: status.available,
            updating: app.state::<OperationGate>().is_busy(),
            revision: status.revision,
            error: status.error.clone(),
        }
    }

    /// 拦截关闭的条件：已开启偏好且本次运行托盘可用。
    pub fn should_intercept(&self) -> bool {
        let status = self.status.lock().unwrap();
        status.enabled && status.available
    }

    fn update(&self, change: impl FnOnce(&mut StatusFields)) {
        let mut status = self.status.lock().unwrap();
        change(&mut status);
    }

    /// 递增版本并广播最新快照；广播失败时记录日志，由窗口主动查询补偿。
    fn publish(&self, app: &AppHandle) -> CloseToTrayStatus {
        let snapshot = {
            let mut status = self.status.lock().unwrap();
            status.revision = status.revision.wrapping_add(1);
            CloseToTrayStatus {
                enabled: status.enabled,
                available: status.available,
                updating: app.state::<OperationGate>().is_busy(),
                revision: status.revision,
                error: status.error.clone(),
            }
        };
        for label in workspace_windows::application_window_labels(app) {
            if let Err(error) = app.emit_to(label.as_str(), CLOSE_TO_TRAY_CHANGED, &snapshot) {
                log(
                    app,
                    LogLevel::Warn,
                    "tray.broadcast_failed",
                    "托盘设置广播失败",
                    serde_json::json!({ "label": label, "error": error.to_string() }),
                );
            }
        }
        snapshot
    }
}

/// 按已保存偏好初始化托盘；创建失败时保留偏好并标记不可用。
pub fn initialize(app: &AppHandle) {
    install_event_handlers(app);
    let enabled = app
        .state::<AppState>()
        .with_config(|config| config.close_to_tray);
    let state = app.state::<CloseToTrayState>();

    if !enabled {
        state.update(|status| {
            status.enabled = false;
            status.available = false;
            status.error = None;
        });
        state.publish(app);
        return;
    }

    match build_tray(app) {
        Ok(menu) => {
            *state.menu.lock().unwrap() = Some(menu);
            state.update(|status| {
                status.enabled = true;
                status.available = true;
                status.error = None;
            });
        }
        Err(error) => {
            let message = format!("托盘初始化失败：{error}");
            state.update(|status| {
                status.enabled = true;
                status.available = false;
                status.error = Some(message.clone());
            });
            log(
                app,
                LogLevel::Error,
                "tray.create_failed",
                "启动时创建托盘失败",
                serde_json::json!({ "error": message }),
            );
        }
    }
    state.publish(app);
}

/// 提交托盘开关目标值；同一进程内的设置变更串行执行。
pub async fn set_enabled(app: AppHandle, enabled: bool) -> Result<CloseToTrayStatus, String> {
    if app.state::<exit::ExitCoordinator>().is_busy() {
        return Err("应用正在退出，无法修改托盘设置".into());
    }

    let result = apply_setting(&app, enabled).await;
    // 操作权已释放，广播 updating 已结束的最终快照。
    let snapshot = publish_status(&app);
    workspace_windows::resolve_pending_open(&app);
    result.map(|_| snapshot)
}

/// 广播当前快照；串行操作释放后调用，使其他窗口结束更新状态。
pub fn publish_status(app: &AppHandle) -> CloseToTrayStatus {
    app.state::<CloseToTrayState>().publish(app)
}

async fn apply_setting(app: &AppHandle, enabled: bool) -> Result<CloseToTrayStatus, String> {
    let gate = app.state::<OperationGate>();
    let _guard = gate.acquire().await;
    let state = app.state::<CloseToTrayState>();
    state.update(|status| status.error = None);
    state.publish(app);

    if enabled {
        enable(app).await
    } else {
        disable(app).await
    }
}

async fn enable(app: &AppHandle) -> Result<CloseToTrayStatus, String> {
    let state = app.state::<CloseToTrayState>();
    let existed = tray_exists(app);
    if !existed {
        match build_tray(app) {
            Ok(menu) => {
                *state.menu.lock().unwrap() = Some(menu);
                state.update(|status| status.available = true);
            }
            Err(error) => {
                let message = format!("托盘初始化失败：{error}");
                state.update(|status| {
                    status.available = false;
                    status.error = Some(message.clone());
                });
                log(
                    app,
                    LogLevel::Error,
                    "tray.create_failed",
                    "开启关闭到托盘时创建托盘失败",
                    serde_json::json!({ "error": message }),
                );
                state.publish(app);
                return Err(message);
            }
        }
    }

    let saved = app
        .state::<AppState>()
        .with_config_mut(|config| config.close_to_tray = true);
    if let Err(error) = saved {
        if !existed {
            remove_tray(app);
            state.update(|status| status.available = false);
        }
        let message = format!("保存托盘设置失败：{error}");
        state.update(|status| status.error = Some(message.clone()));
        log(
            app,
            LogLevel::Error,
            "tray.setting_update_failed",
            "保存托盘设置失败",
            serde_json::json!({ "error": message, "target": true }),
        );
        state.publish(app);
        return Err(message);
    }

    state.update(|status| {
        status.enabled = true;
        status.available = true;
        status.error = None;
    });
    Ok(state.publish(app))
}

async fn disable(app: &AppHandle) -> Result<CloseToTrayStatus, String> {
    let state = app.state::<CloseToTrayState>();
    let restore = workspace_windows::restore_application_windows(app).await;
    if restore.has_restore_failures() {
        let message = restore.failure_summary();
        state.update(|status| status.error = Some(message.clone()));
        log(
            app,
            LogLevel::Error,
            "window.restore_failed",
            "关闭到托盘时恢复窗口失败",
            serde_json::json!({ "failure": message }),
        );
        state.publish(app);
        return Err(message);
    }
    if let Some(error) = &restore.focus_error {
        log(
            app,
            LogLevel::Warn,
            "window.restore_failed",
            "关闭到托盘时窗口已显示但聚焦失败",
            serde_json::json!({ "error": error }),
        );
        exit::show_message(
            app,
            "窗口已恢复",
            &format!("窗口已显示，但未能聚焦：{error}"),
        );
    }

    let saved = app
        .state::<AppState>()
        .with_config_mut(|config| config.close_to_tray = false);
    if let Err(error) = saved {
        let message = format!("保存托盘设置失败：{error}");
        state.update(|status| status.error = Some(message.clone()));
        log(
            app,
            LogLevel::Error,
            "tray.setting_update_failed",
            "保存托盘设置失败",
            serde_json::json!({ "error": message, "target": false }),
        );
        state.publish(app);
        return Err(message);
    }

    state.update(|status| {
        status.enabled = false;
        status.error = None;
    });
    remove_tray(app);
    let removed = !tray_exists(app);
    state.update(|status| {
        status.available = !removed;
        if !removed {
            status.error = Some("托盘移除未完成，可以再次关闭开关重试".into());
        }
    });
    if !removed {
        log(
            app,
            LogLevel::Warn,
            "tray.remove_failed",
            "托盘移除未完成，关闭策略仍按已保存的关闭配置执行",
            serde_json::json!({}),
        );
    }
    Ok(state.publish(app))
}

/// 返回是否已存在托盘句柄。
pub fn tray_exists(app: &AppHandle) -> bool {
    #[cfg(desktop)]
    {
        app.tray_by_id(TRAY_ID).is_some()
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        false
    }
}

// ═══ 托盘图标与菜单 ═══

/// 按进程注册菜单与托盘事件处理器；创建、移除图标不重复注册。
#[cfg(desktop)]
fn install_event_handlers(app: &AppHandle) {
    use tauri::tray::{MouseButton, TrayIconEvent};

    let state = app.state::<CloseToTrayState>();
    if state.handlers_installed.swap(true, Ordering::SeqCst) {
        return;
    }

    app.on_menu_event(|app, event| match event.id().as_ref() {
        MENU_SHOW => workspace_windows::restore_from_tray(app),
        MENU_QUIT => exit::request_exit(app),
        _ => {}
    });
    app.on_tray_icon_event(|app, event| {
        if event.id().as_ref() != TRAY_ID {
            return;
        }
        if let TrayIconEvent::DoubleClick {
            button: MouseButton::Left,
            ..
        } = event
        {
            workspace_windows::restore_from_tray(app);
        }
    });
}

#[cfg(not(desktop))]
fn install_event_handlers(_app: &AppHandle) {}

#[cfg(desktop)]
fn build_tray(app: &AppHandle) -> Result<TrayMenu, String> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    install_event_handlers(app);
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "缺少应用图标".to_string())?;
    let show = MenuItem::with_id(app, MENU_SHOW, "显示 Prism", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "退出 Prism", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let menu = Menu::with_items(app, &[&show, &quit]).map_err(|error| error.to_string())?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Prism")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .build(app)
        .map_err(|error| error.to_string())?;

    Ok(TrayMenu { quit })
}

#[cfg(not(desktop))]
fn build_tray(_app: &AppHandle) -> Result<TrayMenu, String> {
    Err("当前平台不支持系统托盘".into())
}

fn remove_tray(app: &AppHandle) {
    let state = app.state::<CloseToTrayState>();
    let menu = state.menu.lock().unwrap().take();
    drop(menu);
    #[cfg(desktop)]
    {
        if tray_exists(app) && app.remove_tray_by_id(TRAY_ID).is_none() {
            log(
                app,
                LogLevel::Warn,
                "tray.remove_failed",
                "未找到可移除的托盘句柄",
                serde_json::json!({}),
            );
        }
    }
}

/// 退出准备期间禁用菜单项，避免重复提交。
pub fn set_quit_enabled(app: &AppHandle, enabled: bool) {
    let state = app.state::<CloseToTrayState>();
    let quit = state
        .menu
        .lock()
        .unwrap()
        .as_ref()
        .map(|menu| menu.quit.clone());
    if let Some(quit) = quit {
        if let Err(error) = quit.set_enabled(enabled) {
            log(
                app,
                LogLevel::Warn,
                "tray.menu_update_failed",
                "更新退出菜单项失败",
                serde_json::json!({ "error": error.to_string(), "enabled": enabled }),
            );
        }
    }
}

fn log(app: &AppHandle, level: LogLevel, code: &str, message: &str, details: serde_json::Value) {
    if let Some(state) = app.try_state::<AppState>() {
        let _ = state
            .logger
            .append_internal(level, "tray", code, message, details);
    }
}
