// ═══════════════════════════════════════════════════════════════
//  全局快捷键 — Ctrl+Shift+I 导入 / Ctrl+Alt+I 截图
//
//  错误处理策略（不 panic）：
//  1. 首次注册 → 失败则 unregister 残留 + 重试一次
//  2. 重试仍失败 → 系统通知告知用户，功能降级但不崩溃
// ═══════════════════════════════════════════════════════════════

use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

/// 注册所有全局快捷键。
///
/// 若热键已被占用（如上次进程崩溃未清理注册），
/// 先尝试取消可能残留的注册再重试；仍失败则弹出系统通知，不 panic。
pub fn register_all(app: &tauri::AppHandle) {
    register_one(
        app,
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyI),
        "import",
        "Ctrl+Shift+I（导入）",
    );
    register_one(
        app,
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyI),
        "selector",
        "Ctrl+Alt+I（截图）",
    );
}

/// 注册单个快捷键，含重试和错误通知。
fn register_one(
    app: &tauri::AppHandle,
    shortcut: Shortcut,
    window_label: &'static str,
    display_name: &str,
) {
    let handle = app.clone();
    let app_for_notify = app.clone();
    let label = window_label;

    match handle
        .global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                if let Some(win) = _app.get_webview_window(label) {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        }) {
        Ok(_) => {}
        Err(e) => {
            // 尝试先取消可能残留的注册再重试
            let _ = handle.global_shortcut().unregister(shortcut);
            let label2 = window_label;
            if handle
                .global_shortcut()
                .on_shortcut(shortcut, move |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(win) = _app.get_webview_window(label2) {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .is_err()
            {
                let msg = format!("{display_name} 注册失败: {e}");
                eprintln!("[warn] {msg}");
                let _ = app_for_notify
                    .notification()
                    .builder()
                    .title("Prism")
                    .body(format!("快捷键不可用: {msg}"))
                    .show();
            }
        }
    }
}
