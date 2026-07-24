// 仅在 Release 模式下隐藏 Windows 控制台窗口（桌面端）
#![cfg_attr(
    all(not(debug_assertions), not(target_os = "android")),
    windows_subsystem = "windows"
)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub(crate) mod ai;
pub(crate) mod logging;
pub(crate) mod models;
pub(crate) mod note_service;
pub(crate) mod persistence;
pub(crate) mod plugin_protocol;
pub(crate) mod prompt;
pub(crate) mod store;
pub(crate) mod task_service;

mod commands;
mod instance_lock;
mod reminder;
mod shortcuts;

// ═══════════════════════════════════════════════════════════════
//  应用全局状态
// ═══════════════════════════════════════════════════════════════

/// 应用全局状态，由 Tauri 托管，可在所有命令中访问。
///
/// 字段为 `pub(crate)`：同一 crate 内可直接访问，
/// 但推荐使用 `with_config` / `with_sync` / `read_data` / `write_data` 方法，
/// 它们封装了锁获取和持久化逻辑。
pub struct AppState {
    pub(crate) data: Mutex<store::DataStore>,
    pub(crate) config: Mutex<store::ConfigStore>,
    pub(crate) sync: Mutex<store::SyncStore>,
    pub(crate) logger: Arc<logging::LogWriter>,
    /// 插件模块源码临时存储，key = token，激活后立即消费
    pub(crate) plugin_modules: Mutex<HashMap<String, String>>,
}

impl AppState {
    // ── DataStore 读写（已有） ──

    /// 读锁快捷方式：锁定 DataStore → 执行只读操作 → 返回结果
    pub fn read_data<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&store::DataStore) -> R,
    {
        let data = self.data.lock().unwrap();
        f(&data)
    }

    /// 写锁快捷方式：锁定 DataStore → 执行修改 → 保存 → 返回结果
    pub fn write_data<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&mut store::DataStore) -> R,
    {
        let mut data = self.data.lock().unwrap();
        let result = f(&mut data);
        store::save_data(&data)?;
        Ok(result)
    }

    // ── ConfigStore 读写（新增） ──

    /// 读取配置的只读快照
    pub fn with_config<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&store::ConfigStore) -> R,
    {
        let config = self.config.lock().unwrap();
        f(&config)
    }

    /// 修改配置并自动持久化
    pub fn with_config_mut<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&mut store::ConfigStore) -> R,
    {
        let mut config = self.config.lock().unwrap();
        let result = f(&mut config);
        store::save_config(&config)?;
        Ok(result)
    }

    // ── SyncStore 读写（新增） ──

    /// 读取同步状态的只读快照
    pub fn with_sync<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&store::SyncStore) -> R,
    {
        let sync = self.sync.lock().unwrap();
        f(&sync)
    }

    /// 修改同步状态并自动持久化
    pub fn with_sync_mut<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&mut store::SyncStore) -> R,
    {
        let mut sync = self.sync.lock().unwrap();
        let result = f(&mut sync);
        store::save_sync(&sync)?;
        Ok(result)
    }
}

// ═══════════════════════════════════════════════════════════════
//  AI 辅助函数
// ═══════════════════════════════════════════════════════════════

/// 解析当前 AI 配置：优先用选中的供应商，否则用第一个启用的
pub(crate) fn resolve_ai_settings(config: &store::ConfigStore) -> Result<ai::AiSettings, String> {
    if let Some(active_id) = &config.active_vendor_id {
        if let Some(v) = config
            .vendors
            .iter()
            .find(|v| v.id == *active_id && v.enabled)
        {
            return Ok(ai::AiSettings {
                enabled: true,
                api_endpoint: format!("{}{}", v.base_url, v.api_path),
                api_key: v.api_key.clone(),
                model: v.model.clone(),
            });
        }
    }
    if let Some(v) = config.vendors.iter().find(|v| v.enabled) {
        return Ok(ai::AiSettings {
            enabled: true,
            api_endpoint: format!("{}{}", v.base_url, v.api_path),
            api_key: v.api_key.clone(),
            model: v.model.clone(),
        });
    }
    Err("AI 未配置：请在设置中添加并启用供应商".into())
}

/// 统一的 AI 命令前置：resolve 配置 + 安全获取数据快照
pub fn with_ai_context<F, R>(state: &AppState, f: F) -> Result<R, String>
where
    F: FnOnce(&ai::AiSettings, &store::DataStore) -> Result<R, String>,
{
    let settings = state.with_config(resolve_ai_settings)?;
    state.read_data(|data| f(&settings, data))
}

// ═══════════════════════════════════════════════════════════════
//  应用入口
// ═══════════════════════════════════════════════════════════════

/// 统一入口：单实例检查 → 初始化存储 → 注册命令 → 启动事件循环
pub fn run() {
    let logger = match logging::LogWriter::new(persistence::get_logs_dir()) {
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

    let lock_path = instance_lock::acquire();
    if lock_path.is_none() {
        std::process::exit(0);
    }
    let lock_path = lock_path.unwrap();

    let (data, config) = store::initialize(&logger);
    let sync = store::load_sync(&logger);
    let running = Arc::new(std::sync::atomic::AtomicBool::new(true));

    // 插件一次性 token 注册表（3s TTL）
    let token_registry = std::sync::Arc::new(plugin_protocol::TokenRegistry::new());
    let token_registry_clone = token_registry.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            data: Mutex::new(data),
            config: Mutex::new(config),
            sync: Mutex::new(sync),
            logger: logger.clone(),
            plugin_modules: Mutex::new(HashMap::new()),
        })
        .manage(token_registry)
        .register_asynchronous_uri_scheme_protocol("prism-api", move |ctx, request, responder| {
            let registry = token_registry_clone.clone();
            let app_handle = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<AppState>();
                let uri = request.uri().to_string();
                // 解析 prism-api://localhost/api.js?pluginId=X&token=Y
                // 提取模块名（路径部分）和查询参数
                let path = request.uri().path().trim_start_matches('/');
                let module_name = path.trim_end_matches(".js");

                // 解析查询参数
                let query = uri.split('?').nth(1).unwrap_or("");
                let params: std::collections::HashMap<String, String> = query
                    .split('&')
                    .filter_map(|p| {
                        let mut parts = p.splitn(2, '=');
                        Some((parts.next()?.to_string(), parts.next()?.to_string()))
                    })
                    .collect();

                let plugin_id = params.get("pluginId").cloned().unwrap_or_default();
                let token = params.get("token").cloned().unwrap_or_default();

                // 插件主模块端点：从内存中取出存储的源码并返回
                if module_name == "module" {
                    let modules = state.plugin_modules.lock().unwrap();
                    let source = modules.get(&token).cloned();
                    drop(modules);
                    match source {
                        Some(body) => {
                            // 一次性消费：取出后立即删除
                            state.plugin_modules.lock().unwrap().remove(&token);
                            let response = tauri::http::Response::builder()
                                .header("Content-Type", "application/javascript")
                                .body(body.as_bytes().to_vec())
                                .unwrap();
                            responder.respond(response);
                        }
                        None => {
                            let response = tauri::http::Response::builder()
                                .status(404)
                                .body(b"// Error: module not found or token expired".to_vec())
                                .unwrap();
                            responder.respond(response);
                        }
                    }
                    return;
                }

                let result =
                    plugin_protocol::handle_api_request(&registry, module_name, &plugin_id, &token);

                match result {
                    Ok(body) => {
                        let response = tauri::http::Response::builder()
                            .header("Content-Type", "application/javascript")
                            .body(body.as_bytes().to_vec())
                            .unwrap();
                        responder.respond(response);
                    }
                    Err(e) => {
                        let response = tauri::http::Response::builder()
                            .status(403)
                            .body(format!("// Error: {}", e).as_bytes().to_vec())
                            .unwrap();
                        responder.respond(response);
                    }
                }
            });
        })
        .invoke_handler(tauri::generate_handler![
            // 日志命令
            commands::logging::append_log_batch,
            // 任务命令 (commands::tasks)
            commands::tasks::get_tasks,
            commands::tasks::get_all_tasks_including_deleted,
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
            commands::tasks::reset_daily_tasks,
            commands::tasks::sync_remote_daily_completions,
            commands::tasks::delete_daily_completion,
            commands::tasks::sync_local_tasks,
            // 同步命令
            commands::get_sync_config,
            commands::set_sync_config,
            commands::open_url,
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
            commands::config::get_dashboard_layout,
            commands::config::set_dashboard_layout,
            // 笔记命令
            commands::notes::list_note_tree,
            commands::notes::read_note,
            commands::notes::write_note,
            commands::notes::create_note_dir,
            commands::notes::delete_note_entry,
            commands::notes::rename_note_entry,
            commands::notes::get_notes_directory,
            commands::notes::set_notes_directory,
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
        .setup(move |app| {
            let handle = app.handle().clone();
            let running_flag = running.clone();
            let lock = lock_path.clone();

            // 主窗口关闭 → 停止提醒线程 → 清理实例锁 → 退出进程
            if let Some(main_window) = app.get_webview_window("main") {
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        running_flag.store(false, std::sync::atomic::Ordering::SeqCst);
                        instance_lock::release(&lock);
                        handle.exit(0);
                    }
                });
            }

            shortcuts::register_all(app.handle());

            let backend = Arc::new(reminder::TauriBackend::new(app.handle().clone()));
            reminder::start(backend, running);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
