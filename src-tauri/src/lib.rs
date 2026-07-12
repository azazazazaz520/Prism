// 仅在 Release 模式下隐藏 Windows 控制台窗口（桌面端）
#![cfg_attr(
    all(not(debug_assertions), not(target_os = "android")),
    windows_subsystem = "windows"
)]

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

pub(crate) mod ai;
pub(crate) mod models;
pub(crate) mod note_service;
pub(crate) mod persistence;
pub(crate) mod prompt;
pub(crate) mod store;
pub(crate) mod task_service;

mod commands;

// ═══════════════════════════════════════════════════════════════
//  应用全局状态
// ═══════════════════════════════════════════════════════════════

/// 应用全局状态，由 Tauri 托管，可在所有命令中访问
pub struct AppState {
    /// 任务数据存储（受 Mutex 保护，确保线程安全）
    pub data: Mutex<store::DataStore>,
    /// 应用配置（供应商、主题、提醒等）
    pub config: Mutex<store::ConfigStore>,
    /// 同步状态（配对码、profile、上次同步时间）
    pub sync: Mutex<store::SyncStore>,
    /// 当天已通知的任务 ID 集合，避免重复提醒
    pub notified_today: Mutex<HashSet<String>>,
}

impl AppState {
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
}

/// 解析当前 AI 配置：优先用选中的供应商，否则用第一个启用的
pub(crate) fn resolve_ai_settings(config: &store::ConfigStore) -> Result<ai::AiSettings, String> {
    // 1. 有 active_vendor_id 且供应商存在且启用
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
    // 2. 找第一个启用的供应商
    if let Some(v) = config.vendors.iter().find(|v| v.enabled) {
        return Ok(ai::AiSettings {
            enabled: true,
            api_endpoint: format!("{}{}", v.base_url, v.api_path),
            api_key: v.api_key.clone(),
            model: v.model.clone(),
        });
    }
    // 3. 无可用供应商
    Err("AI 未配置：请在设置中添加并启用供应商".into())
}

/// 统一的 AI 命令前置：resolve 配置 + 安全获取数据快照。
/// 内部处理锁的获取和 AI 设置解析，调用方只需关注数据提取逻辑。
pub fn with_ai_context<F, R>(state: &AppState, f: F) -> Result<R, String>
where
    F: FnOnce(&ai::AiSettings, &store::DataStore) -> Result<R, String>,
{
    let config = state.config.lock().unwrap();
    let settings = resolve_ai_settings(&config)?;
    let data = state.data.lock().unwrap();
    f(&settings, &data)
}

// ═══════════════════════════════════════════════════════════════
//  单实例锁 — 防止多开导致热键/数据冲突
//
//  机制：启动时将当前 PID 写入 ~/.prism/.instance.lock，
//  再次启动时检查锁文件中 PID 是否仍在运行。
//  活跃 → 拒绝启动；已死/损坏 → 覆盖旧锁；无锁 → 新建。
//  主窗口关闭时自动清理锁文件。
// ═══════════════════════════════════════════════════════════════

/// 检查指定 PID 的进程是否仍在运行。
///
/// Windows: 调用 `tasklist /FI "PID eq N"`，解析输出判断进程是否存在。
/// 匹配策略：输出中不含 "No tasks" 信息且含目标 PID 字符串时认为存活。
/// Unix: 发送信号 0（不中断进程），根据返回值判断。
///
/// PID 0 在所有平台上都是系统保留值（Idle/swapper），直接返回 false。
fn is_pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid)])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW，避免闪现控制台窗口
            .output()
            .is_ok_and(|o| {
                let stdout = String::from_utf8_lossy(&o.stdout);
                // 找到进程 → 输出含 PID 的进程列表行
                // 未找到 → 输出 "INFO: No tasks are running which match ..."
                !stdout.contains("No tasks") && stdout.contains(&pid.to_string())
            })
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok()
    }
}

/// 在指定目录下尝试创建/验证单实例锁。
///
/// 返回 Some(lock_path) 表示获取锁成功（可以安全启动），
/// 返回 None 表示已有活跃实例在运行。
///
/// 三种场景：
/// 1. 无锁文件 → 新建并写入当前 PID，返回 Some
/// 2. 有锁文件且 PID 仍存活 → 弹窗提示，返回 None
/// 3. 有锁文件但 PID 已死/损坏 → 覆盖写入当前 PID，返回 Some
fn try_acquire_lock(lock_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let lock_path = lock_dir.join(".instance.lock");
    let current_pid = std::process::id();

    // ── 检查已有锁 ──
    if lock_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&lock_path) {
            let pid: u32 = content.trim().parse().unwrap_or(0);
            // 非零 PID 且进程仍在运行 → 拒绝启动
            if pid != 0 && is_pid_alive(pid) {
                show_instance_already_running();
                return None;
            }
            // 锁已过期 / 损坏 / PID 为 0 → 覆盖旧锁，继续启动
        }
    }

    // ── 写入新锁 ──
    match std::fs::write(&lock_path, current_pid.to_string()) {
        Ok(_) => Some(lock_path),
        Err(e) => {
            eprintln!("[warn] 无法写入实例锁文件 {}: {e}", lock_path.display());
            // 写入失败不阻止启动（可能是权限问题），但不返回路径则无法在退出时清理
            None
        }
    }
}

/// 生产入口：在工作区目录下获取单实例锁。
fn acquire_single_instance_lock() -> Option<std::path::PathBuf> {
    try_acquire_lock(&persistence::get_workspace_dir())
}

/// 弹窗告知用户已有实例在运行。
///
/// Windows: 通过 `msg *` 向当前会话广播系统消息。
/// 注意：在无窗口站的测试/CI 环境中此调用静默失败，不影响流程。
/// Unix: 降级为 stderr 输出。
fn show_instance_already_running() {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("msg")
            .args(["*", "Prism 已在运行中，请检查系统托盘或任务栏。"])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn(); // fire-and-forget
    }
    #[cfg(not(windows))]
    {
        eprintln!("Prism 已在运行中");
    }
}

/// 退出时清理实例锁文件，允许下次正常启动。
fn release_single_instance_lock(lock_path: &std::path::Path) {
    let _ = std::fs::remove_file(lock_path);
}

// ═══════════════════════════════════════════════════════════════
//  全局快捷键 — Ctrl+Shift+I 导入 / Ctrl+Alt+I 截图
//
//  错误处理策略（不 panic）：
//  1. 首次注册 → 失败则 unregister 残留 + 重试一次
//  2. 重试仍失败 → 系统通知告知用户，功能降级但不崩溃
// ═══════════════════════════════════════════════════════════════

/// 注册全局快捷键：Ctrl+Shift+I（导入）和 Ctrl+Alt+I（截图）。
///
/// 若热键已被占用（如上次进程崩溃未清理注册），
/// 先尝试取消可能残留的注册再重试；仍失败则弹出系统通知，不 panic。
fn register_shortcuts(app: &tauri::AppHandle) {
    let shortcut_import = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyI);
    let shortcut_crop = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyI);

    // Ctrl+Shift+I → 文本导入
    let handle = app.clone();
    let app_for_notify = app.clone();
    match handle
        .global_shortcut()
        .on_shortcut(shortcut_import, |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                if let Some(win) = _app.get_webview_window("import") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        }) {
        Ok(_) => {}
        Err(e) => {
            // 尝试先取消可能残留的注册再重试
            let _ = handle.global_shortcut().unregister(shortcut_import);
            if handle
                .global_shortcut()
                .on_shortcut(shortcut_import, |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(win) = _app.get_webview_window("import") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .is_err()
            {
                let msg = format!("Ctrl+Shift+I（导入）注册失败: {e}");
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

    // Ctrl+Alt+I → 区域截图
    let handle2 = app.clone();
    let app_for_notify2 = app.clone();
    match handle2
        .global_shortcut()
        .on_shortcut(shortcut_crop, |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                if let Some(win) = _app.get_webview_window("selector") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        }) {
        Ok(_) => {}
        Err(e) => {
            let _ = handle2.global_shortcut().unregister(shortcut_crop);
            if handle2
                .global_shortcut()
                .on_shortcut(shortcut_crop, |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(win) = _app.get_webview_window("selector") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .is_err()
            {
                let msg = format!("Ctrl+Alt+I（截图）注册失败: {e}");
                eprintln!("[warn] {msg}");
                let _ = app_for_notify2
                    .notification()
                    .builder()
                    .title("Prism")
                    .body(format!("快捷键不可用: {msg}"))
                    .show();
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
//  提醒线程
// ═══════════════════════════════════════════════════════════════

/// 后台线程：每分钟检查到期任务并推送系统通知
fn spawn_reminder_thread(handle: tauri::AppHandle, running: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        while running.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_secs(60));
            if !running.load(Ordering::SeqCst) {
                break;
            }

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

// ═══════════════════════════════════════════════════════════════
//  应用入口
// ═══════════════════════════════════════════════════════════════

/// 统一入口：单实例检查 → 初始化存储 → 注册命令 → 启动事件循环
///
/// 启动流程：
/// 1. 获取单实例锁（已有实例运行则弹窗退出）
/// 2. 加载 data.json / config.json / sync.json
/// 3. 注册全部 Tauri 插件和 IPC 命令
/// 4. setup 阶段：注册快捷键、绑定窗口关闭清理、启动提醒线程
pub fn run() {
    // 单实例检查：若已有实例运行则直接退出
    let lock_path = acquire_single_instance_lock();
    if lock_path.is_none() {
        std::process::exit(0);
    }
    let lock_path = lock_path.unwrap();

    let (data, config) = store::initialize();
    let sync = store::load_sync();
    let running = Arc::new(AtomicBool::new(true));
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
            commands::tasks::sync_remote_daily_completions,
            commands::tasks::delete_daily_completion,
            commands::tasks::sync_local_tasks,
            // 同步命令
            commands::get_sync_config,
            commands::set_sync_config,
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
            commands::ai::ai_parse_input,
            commands::ai::ai_daily_focus,
            commands::ai::ai_decompose,
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
        ])
        .setup(move |app| {
            // 主窗口关闭 → 停止提醒线程 → 清理实例锁 → 退出进程
            // lock_path 通过 move 闭包捕获，在窗口关闭回调中释放
            let handle = app.handle().clone();
            let running_flag = running.clone();
            let lock = lock_path.clone();
            if let Some(main_window) = app.get_webview_window("main") {
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        running_flag.store(false, Ordering::SeqCst);
                        release_single_instance_lock(&lock);
                        handle.exit(0);
                    }
                });
            }
            register_shortcuts(app.handle());
            spawn_reminder_thread(app.handle().clone(), running);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ═══════════════════════════════════════════════════════════════
//  测试 — 单实例锁 & PID 存活检测
//
//  测试组织：
//  - try_acquire_lock 完整流程（正常、拒绝、过期、损坏）
//  - release 清理行为
//  - is_pid_alive 底层检测（自身、无效 PID）
//
//  隔离策略：每个测试使用独立临时子目录，
//  以原子计数器 + 线程 ID 组合命名，支持并行执行。
// ═══════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// 原子递增计数器，确保每个测试获得唯一的临时目录编号
    static TEST_COUNTER: AtomicU32 = AtomicU32::new(0);

    /// 创建测试专用临时目录。
    ///
    /// 目录位于 `src-tauri/target/test_lock/<test_N_ThreadId>/`，
    /// 以原子计数器 + 线程 ID 组合命名，保证并行测试互不干扰。
    /// 若目标已存在则先清空再重建。
    fn temp_lock_dir() -> std::path::PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let unique = format!("test_{}_{:?}", id, std::thread::current().id());
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test_lock")
            .join(unique);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("创建测试临时目录失败");
        dir
    }

    // ── try_acquire_lock 流程测试 ──

    /// 场景：无锁文件 → 首次获取 → 成功并创建锁文件
    #[test]
    fn first_lock_succeeds() {
        let dir = temp_lock_dir();
        let lock = try_acquire_lock(&dir);
        assert!(lock.is_some(), "首次获取锁应成功");
        let path = lock.unwrap();
        assert!(path.exists(), "锁文件应被创建");
        assert_eq!(path, dir.join(".instance.lock"));
        release_single_instance_lock(&path);
    }

    /// 场景：锁文件中是当前进程 PID → 检测到活跃实例 → 拒绝
    #[test]
    fn active_lock_rejected() {
        let dir = temp_lock_dir();
        let my_pid = std::process::id();
        fs::write(dir.join(".instance.lock"), my_pid.to_string()).unwrap();

        let lock = try_acquire_lock(&dir);
        assert!(lock.is_none(), "检测到活跃实例时应返回 None");
    }

    /// 场景：锁文件中是已死进程 PID（1）→ 覆盖旧锁，写入当前 PID
    #[test]
    fn stale_lock_overwritten() {
        let dir = temp_lock_dir();
        // PID 1 在 Windows 上不存在（System Idle=0，System=4，普通进程从大数开始）
        fs::write(dir.join(".instance.lock"), "1").unwrap();

        let lock = try_acquire_lock(&dir);
        assert!(lock.is_some(), "过期锁应被覆盖，成功获取新锁");

        // 锁文件内容已更新为当前进程 PID
        let content = fs::read_to_string(dir.join(".instance.lock")).unwrap();
        assert_eq!(content.trim(), std::process::id().to_string());
        release_single_instance_lock(&dir.join(".instance.lock"));
    }

    /// 场景：锁文件中是大数值 PID（99999）→ is_pid_alive 返回 false → 覆盖
    #[test]
    fn nonexistent_pid_treated_as_stale() {
        let dir = temp_lock_dir();
        fs::write(dir.join(".instance.lock"), "99999").unwrap();

        let lock = try_acquire_lock(&dir);
        assert!(lock.is_some(), "不存在进程的锁应被视为过期");
    }

    /// 场景：锁文件内容损坏（非数字）→ parse 失败 → pid=0 → 视为过期覆盖
    #[test]
    fn corrupted_lock_file_treated_as_stale() {
        let dir = temp_lock_dir();
        fs::write(dir.join(".instance.lock"), "not-a-pid").unwrap();

        let lock = try_acquire_lock(&dir);
        assert!(lock.is_some(), "损坏的锁文件应被覆盖");
    }

    // ── release 清理测试 ──

    /// 验证 release 确实删除了锁文件
    #[test]
    fn release_lock_removes_file() {
        let dir = temp_lock_dir();
        let lock_path = dir.join(".instance.lock");
        fs::write(&lock_path, "12345").unwrap();
        assert!(lock_path.exists(), "写入后锁文件应存在");

        release_single_instance_lock(&lock_path);
        assert!(!lock_path.exists(), "释放后锁文件应被删除");
    }

    // ── is_pid_alive 底层检测 ──

    /// 确认 is_pid_alive 能正确识别当前测试进程
    #[test]
    fn is_pid_alive_detects_self() {
        let my_pid = std::process::id();
        assert!(is_pid_alive(my_pid), "当前测试进程应被检测为活跃");
    }

    /// 确认特殊 PID 值被正确判定为不活跃
    #[test]
    fn is_pid_alive_detects_dead() {
        // PID 0 — 系统 Idle 进程，所有平台上都不属于用户进程
        assert!(!is_pid_alive(0), "PID 0 不应被检测为活跃");
        // PID 1 — Windows 上不存在（Unix 上是 init），可用于测试无效 PID
        assert!(!is_pid_alive(1), "PID 1 不应被检测为活跃");
    }
}
