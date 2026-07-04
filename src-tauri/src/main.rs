// 仅在 Release 模式下隐藏 Windows 控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashSet;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

pub(crate) mod ai;
pub(crate) mod notes;
pub(crate) mod prompt;
pub(crate) mod store;

mod commands;

use commands::AppState;

/// 应用入口：编排初始化、注册命令、设置回调
fn main() {
    let (data, config) = store::initialize();
    let sync = store::load_sync();
    prompt::create_defaults();
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            data: Mutex::new(data),
            config: Mutex::new(config),
            sync: Mutex::new(sync),
            notified_today: Mutex::new(HashSet::new()),
        })
        // 注册所有前端可调用的命令
        .invoke_handler(tauri::generate_handler![
            // 任务命令 (commands::tasks)
            commands::tasks::get_tasks,
            commands::tasks::add_task,
            commands::tasks::toggle_task,
            commands::tasks::toggle_daily_task,
            commands::tasks::update_task,
            commands::tasks::delete_task,
            commands::tasks::clear_completed,
            commands::tasks::get_tasks_by_date,
            commands::tasks::get_all_tags,
            commands::tasks::delete_tag,
            commands::tasks::get_daily_completions,
            // 同步命令 (commands::sync)
            commands::sync::get_sync_config,
            commands::sync::set_sync_config,
            // 配置命令 (commands::config)
            commands::config::show_floating_window,
            commands::config::show_main_window,
            commands::config::resize_floating_window,
            commands::config::show_import_window,
            commands::config::hide_import_window,
            commands::config::hide_selector_window,
            commands::config::set_reminder_minutes,
            commands::config::get_reminder_minutes,
            commands::config::get_ai_settings_all,
            commands::config::get_vendors,
            commands::config::add_vendor,
            commands::config::update_vendor,
            commands::config::delete_vendor,
            commands::config::set_active_vendor,
            commands::config::get_theme,
            commands::config::set_theme,
            commands::config::get_module_enabled,
            commands::config::set_module_enabled,
            // 笔记命令 (notes)
            notes::list_note_tree,
            notes::read_note,
            notes::write_note,
            notes::create_note_dir,
            notes::delete_note_entry,
            notes::rename_note_entry,
            notes::get_notes_directory,
            notes::set_notes_directory,
            // AI 命令 (commands::ai)
            commands::ai::ai_parse_input,
            commands::ai::ai_daily_focus,
            commands::ai::ai_decompose,
            commands::ai::ai_overdue_suggest,
            commands::ai::ai_chat,
            commands::ai::ai_json_explain,
            commands::ai::ai_regex_generate,
            commands::ai::ai_parse_wechat,
            commands::screenshot::crop_screenshot,
        ])
        .setup(|app| {
            register_shortcuts(app.handle());
            spawn_reminder_thread(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 注册全局快捷键：Ctrl+Shift+I（导入）和 Ctrl+Alt+I（截图）
fn register_shortcuts(app: &tauri::AppHandle) {
    // Ctrl+Shift+I → 文本导入
    let handle = app.clone();
    handle
        .global_shortcut()
        .on_shortcut(
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyI),
            |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    if let Some(win) = _app.get_webview_window("import") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            },
        )
        .expect("failed to register Ctrl+Shift+I");

    // Ctrl+Alt+I → 区域截图
    let handle2 = app.clone();
    handle2
        .global_shortcut()
        .on_shortcut(
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyI),
            |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    if let Some(win) = _app.get_webview_window("selector") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            },
        )
        .expect("failed to register Ctrl+Alt+I");
}

/// 后台线程：每分钟检查到期任务并推送系统通知
fn spawn_reminder_thread(handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(60));

            let reminder;
            let tasks_snapshot: Vec<(String, String, Option<String>)>;
            {
                let state = handle.state::<AppState>();
                let config = state.config.lock().unwrap();
                reminder = config.reminder_minutes;
                // 提醒已关闭，跳过本轮检查
                if reminder == 0 {
                    continue;
                }
                let data = state.data.lock().unwrap();
                // 快照当前未完成且有截止日期的任务（避免长时间持有锁）
                tasks_snapshot = data
                    .tasks
                    .iter()
                    .filter(|t| !t.completed && t.due_date.is_some())
                    .map(|t| (t.id.clone(), t.title.clone(), t.due_date.clone()))
                    .collect();
            }

            let local_now = chrono::Local::now();
            let today = local_now.format("%Y-%m-%d").to_string();

            // 日期变更时重置已通知集合
            {
                let state = handle.state::<AppState>();
                let mut notified = state.notified_today.lock().unwrap();
                if !notified.contains(&today) {
                    notified.clear();
                    notified.insert(today.clone());
                }
            }

            let local_offset = local_now.offset();

            for (task_id, title, due_date_opt) in &tasks_snapshot {
                let due_date = match due_date_opt {
                    Some(d) => d,
                    None => continue,
                };
                // 使用本地时区构建截止日 23:59:59，而非硬编码 UTC
                let due_str = format!("{}T23:59:59{}", due_date, local_offset);
                let due_time = match chrono::DateTime::parse_from_rfc3339(&due_str) {
                    Ok(t) => t,
                    Err(_) => continue,
                };
                let diff_secs = due_time.timestamp() - local_now.timestamp();
                let diff_min = diff_secs / 60;
                // 仅在距离截止时间还有剩余分钟数且小于等于提醒阈值时通知
                if diff_min > 0 && diff_min <= reminder as i64 {
                    let state = handle.state::<AppState>();
                    let mut notified = state.notified_today.lock().unwrap();
                    // 当天已通知过的任务不再重复提醒
                    if !notified.contains(task_id) {
                        notified.insert(task_id.clone());
                        drop(notified);
                        let minutes_left = diff_min;
                        let _ = handle
                            .notification()
                            .builder()
                            .title("⏰ 任务即将到期")
                            .body(format!("\"{}\" 将在 {} 分钟后到期", title, minutes_left))
                            .show();
                    }
                }
            }
        }
    });
}
