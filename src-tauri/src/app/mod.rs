mod reminder;
mod shortcuts;
mod startup;
pub(crate) mod state;
pub(crate) mod workspace_windows;

use crate::{commands, logging, plugins::protocol, tasks::outbox, AppState};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::Manager;

fn initialize_app_state(app: &tauri::AppHandle) {
    let logger = match logging::LogWriter::new(crate::storage::paths::get_logs_dir()) {
        Ok(writer) => Arc::new(writer),
        Err(error) => {
            eprintln!("[logging] 无法初始化日志写入器：{error}");
            Arc::new(logging::LogWriter::disabled())
        }
    };

    let panic_logger = logger.clone();
    std::panic::set_hook(Box::new(move |panic_info| {
        let location = panic_info
            .location()
            .map(|value| format!("{}:{}", value.file(), value.line()));
        let payload = panic_info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| {
                panic_info
                    .payload()
                    .downcast_ref::<String>()
                    .map(String::as_str)
            })
            .unwrap_or("未知 panic");
        let _ = panic_logger.append_internal(
            logging::LogLevel::Error,
            "runtime",
            "runtime.panic",
            "Rust 线程发生 panic",
            serde_json::json!({ "location": location, "payload": payload }),
        );
    }));

    let (data, config) = crate::storage::initialize(&logger);
    let sync = crate::storage::load_sync(&logger);
    app.manage(AppState {
        data: Mutex::new(data),
        config: Mutex::new(config),
        sync: Mutex::new(sync),
        logger,
        plugin_modules: Mutex::new(HashMap::new()),
        consumer: Mutex::new(outbox::Consumer::default()),
        app: app.clone(),
    });
}

/// 在单一应用进程中初始化共享状态，并交接新工作区窗口请求。
pub fn run() {
    // 插件一次性 token 注册表（3s TTL）
    let token_registry = std::sync::Arc::new(protocol::TokenRegistry::new());
    let token_registry_clone = token_registry.clone();

    tauri::Builder::default()
        .manage(workspace_windows::WorkspaceWindows::default())
        // 单实例插件必须先注册，Windows/Linux 深链接会通过命令行参数转发到现有实例。
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if !argv.iter().any(|arg| arg.starts_with("prism:")) {
                workspace_windows::request_new_workspace(app);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(token_registry)
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(state) = window.try_state::<AppState>() {
                    state.consumer.lock().unwrap().window_closed(window.label());
                }
            }
        })
        .register_asynchronous_uri_scheme_protocol("prism-api", move |ctx, request, responder| {
            let registry = token_registry_clone.clone();
            let app_handle = ctx.app_handle().clone();
            tauri::async_runtime::spawn(protocol::respond_to_api_request(
                app_handle, request, responder, registry,
            ));
        })
        .invoke_handler(tauri::generate_handler![
            // 日志命令
            commands::logging::append_log_batch,
            // 任务命令 (commands::tasks)
            commands::tasks::get_tasks,
            commands::tasks::get_task_snapshot,
            commands::outbox::import_legacy_queue,
            commands::outbox::claim_outbox,
            commands::outbox::finish_outbox,
            commands::outbox::link_unpaired_tasks,
            commands::tasks::get_all_tasks_including_deleted,
            commands::tasks::add_tasks_batch,
            commands::tasks::add_task,
            commands::tasks::toggle_task,
            commands::tasks::toggle_daily_task,
            commands::tasks::update_task,
            commands::tasks::delete_task,
            commands::tasks::restore_task,
            commands::tasks::clear_completed,
            commands::tasks::get_tasks_by_date,
            commands::tasks::get_all_tags,
            commands::tasks::delete_tag,
            commands::tasks::get_daily_completions,
            commands::tasks::get_all_daily_completions,
            commands::tasks::reset_daily_tasks,
            commands::tasks::sync_remote_daily_completions,
            commands::tasks::delete_daily_completion,
            commands::tasks::sync_local_tasks,
            // 同步命令
            commands::sync::get_sync_config,
            commands::sync::set_sync_config,
            // 窗口与外部链接命令
            commands::windows::open_url,
            commands::windows::show_floating_window,
            commands::windows::show_main_window,
            commands::windows::resize_floating_window,
            commands::windows::show_import_window,
            commands::windows::hide_import_window,
            commands::windows::hide_selector_window,
            // 配置命令
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
            commands::config::get_dashboard_layout,
            commands::config::set_dashboard_layout,
            commands::config::get_pandoc_path,
            commands::config::set_pandoc_path,
            // 笔记命令
            commands::export::export_note_to_docx,
            commands::export::get_pandoc_info,
            // PDF 转 Word 命令
            commands::pdf_to_word::pdf_to_word_get_config,
            commands::pdf_to_word::pdf_to_word_check_health,
            commands::pdf_to_word::pdf_to_word_create_job,
            commands::pdf_to_word::pdf_to_word_get_job,
            commands::pdf_to_word::pdf_to_word_cancel_job,
            commands::pdf_to_word::pdf_to_word_download_result,
            commands::notes::list_note_tree,
            commands::notes::list_note_dir,
            commands::notes::search_notes,
            commands::notes::cancel_note_search,
            commands::notes::read_note,
            commands::notes::read_note_meta,
            commands::notes::get_note_mtime,
            commands::notes::write_note,
            commands::notes::create_note_dir,
            commands::notes::delete_note_entry,
            commands::notes::rename_note_entry,
            commands::notes::get_notes_directory,
            commands::notes::set_notes_directory,
            commands::notes::save_note_recovery,
            commands::notes::list_note_recoveries,
            commands::notes::read_note_recovery,
            commands::notes::delete_note_recovery,
            commands::notes::restore_note_recovery,
            // AI 命令 (commands::ai)
            commands::ai::ai_execute,
            commands::ai::ai_overdue_suggest,
            commands::ai::ai_chat,
            commands::ai::ai_json_explain,
            commands::ai::ai_regex_generate,
            commands::ai::ai_parse_wechat,
            commands::screenshot::crop_screenshot,
            // Prompt 管理命令
            commands::prompt::list_prompts,
            commands::prompt::get_prompt,
            commands::prompt::update_prompt,
            commands::prompt::reset_prompt,
            // 插件管理命令
            commands::plugins::scan_plugins,
            commands::plugins::get_plugin_configs,
            commands::plugins::set_plugin_config,
            commands::plugins::read_plugin_file,
            commands::plugins::plugin_tasks_list,
            commands::plugins::plugin_tasks_list_by_date,
            commands::plugins::plugin_tasks_create,
            commands::plugins::plugin_tasks_update,
            commands::plugins::plugin_tasks_toggle,
            commands::plugins::plugin_tasks_delete,
            commands::plugins::plugin_network_fetch,
            commands::plugins::scan_scripts,
            commands::plugins::read_script_content,
            commands::plugins::register_plugin_module,
            // 版本更新检查
            commands::update::check_update,
        ])
        .setup(|app| {
            startup::create_initial_windows(app, |app| {
                initialize_app_state(app.handle());
                let directory = app
                    .state::<AppState>()
                    .with_config(crate::storage::paths::get_notes_dir);
                app.state::<workspace_windows::WorkspaceWindows>()
                    .prepare_main(app.handle(), directory);
            })?;
            let workspaces = app.state::<workspace_windows::WorkspaceWindows>();
            workspaces.finish_startup(app.handle());

            shortcuts::register_all(app.handle());

            let backend = Arc::new(reminder::TauriBackend::new(app.handle().clone()));
            reminder::start(backend, workspaces.running.clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
