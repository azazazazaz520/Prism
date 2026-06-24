// 仅在 Release 模式下隐藏 Windows 控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Deserialize;
use std::collections::HashSet;
use std::sync::Mutex;
use store::TaskStore;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

mod store;
mod ai;

/// 应用全局状态，由 Tauri 托管，可在所有命令中访问
struct AppState {
    /// 任务数据存储（受 Mutex 保护，确保线程安全）
    store: Mutex<TaskStore>,
    /// 当天已通知的任务 ID 集合，避免重复提醒
    notified_today: Mutex<HashSet<String>>,
}

/// 更新任务的请求参数（聚合为 struct 避免参数过多）
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTaskArgs {
    id: String,
    title: String,
    due_date: Option<String>,
    tags: Vec<String>,
    important: bool,
    pinned: bool,
    is_daily: bool,
}

// ── 任务 CRUD 命令 ──────────────────────────────

/// 获取所有任务列表
#[tauri::command]
fn get_tasks(state: tauri::State<AppState>) -> Vec<store::Task> {
    state.store.lock().unwrap().tasks.clone()
}

/// 新增任务
#[tauri::command]
fn add_task(
    state: tauri::State<AppState>,
    title: String,
    due_date: Option<String>,
    tags: Option<Vec<String>>,
    important: Option<bool>,
    pinned: Option<bool>,
    is_daily: Option<bool>,
    parent_id: Option<String>,
) -> Result<store::Task, String> {
    let mut store = state.store.lock().unwrap();
    let task = store::Task {
        id: uuid::Uuid::new_v4().to_string(),
        title,
        completed: false,
        created_at: chrono::Utc::now().to_rfc3339(),
        completed_at: None,
        due_date,
        tags: tags.unwrap_or_default(),
        important: important.unwrap_or(false),
        pinned: pinned.unwrap_or(false),
        is_daily: is_daily.unwrap_or(false),
        parent_id,
    };
    store.tasks.push(task.clone());
    store::save_tasks(&store)?;
    Ok(task)
}

/// 切换任务完成状态（自动记录完成/取消时间）
#[tauri::command]
fn toggle_task(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    if let Some(task) = store.tasks.iter_mut().find(|t| t.id == id) {
        task.completed = !task.completed;
        task.completed_at = if task.completed {
            Some(chrono::Utc::now().to_rfc3339())
        } else {
            None
        };
    }
    store::save_tasks(&store)
}

/// 切换每日任务的完成状态（按日期记录，支持跨天追踪）
#[tauri::command]
fn toggle_daily_task(
    state: tauri::State<AppState>,
    id: String,
    date: String,
) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    if let Some(pos) = store
        .daily_completions
        .iter()
        .position(|dc| dc.task_id == id && dc.date == date)
    {
        store.daily_completions.remove(pos);
    } else {
        store
            .daily_completions
            .push(store::DailyCompletion { task_id: id, date });
    }
    store::save_tasks(&store)
}

/// 更新任务的所有字段
#[tauri::command]
fn update_task(state: tauri::State<AppState>, args: UpdateTaskArgs) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    if let Some(task) = store.tasks.iter_mut().find(|t| t.id == args.id) {
        task.title = args.title;
        task.due_date = args.due_date;
        task.tags = args.tags;
        task.important = args.important;
        task.pinned = args.pinned;
        task.is_daily = args.is_daily;
    }
    store::save_tasks(&store)
}

/// 删除指定任务
#[tauri::command]
fn delete_task(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.tasks.retain(|t| t.id != id);
    store::save_tasks(&store)
}

/// 一键清除所有已完成任务
#[tauri::command]
fn clear_completed(state: tauri::State<AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.tasks.retain(|t| !t.completed);
    store::save_tasks(&store)
}

/// 按截止日期筛选任务
#[tauri::command]
fn get_tasks_by_date(state: tauri::State<AppState>, date: String) -> Vec<store::Task> {
    state
        .store
        .lock()
        .unwrap()
        .tasks
        .iter()
        .filter(|t| t.due_date.as_deref() == Some(&date))
        .cloned()
        .collect()
}

/// 获取所有标签（去重排序）
#[tauri::command]
fn get_all_tags(state: tauri::State<AppState>) -> Vec<String> {
    let store = state.store.lock().unwrap();
    let mut tags: Vec<String> = store.tasks.iter().flat_map(|t| t.tags.clone()).collect();
    tags.sort();
    tags.dedup();
    tags
}

/// 删除指定标签（从所有任务中移除该标签）
#[tauri::command]
fn delete_tag(state: tauri::State<AppState>, tag: String) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    for task in store.tasks.iter_mut() {
        task.tags.retain(|t| t != &tag);
    }
    store::save_tasks(&store)
}

/// 获取指定日期已完成的每日任务 ID 列表
#[tauri::command]
fn get_daily_completions(state: tauri::State<AppState>, date: String) -> Vec<String> {
    state
        .store
        .lock()
        .unwrap()
        .daily_completions
        .iter()
        .filter(|dc| dc.date == date)
        .map(|dc| dc.task_id.clone())
        .collect()
}

// ── 窗口管理命令 ──────────────────────────────

/// 切换到悬浮小窗模式（隐藏主窗口）
#[tauri::command]
fn show_floating_window(app: tauri::AppHandle) -> Result<(), String> {
    let float_win = app
        .get_webview_window("floating")
        .ok_or("floating window not found")?;
    if let Some(main_win) = app.get_webview_window("main") {
        main_win.hide().map_err(|e| e.to_string())?;
    }
    float_win.show().map_err(|e| e.to_string())?;
    float_win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// 切换回主窗口模式（隐藏悬浮窗）
#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let main_win = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    if let Some(float_win) = app.get_webview_window("floating") {
        float_win.hide().map_err(|e| e.to_string())?;
    }
    main_win.show().map_err(|e| e.to_string())?;
    main_win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

// ── 提醒设置命令 ──────────────────────────────

/// 设置任务到期提醒的提前分钟数（0 表示关闭提醒）
#[tauri::command]
fn set_reminder_minutes(state: tauri::State<AppState>, minutes: u32) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.reminder_minutes = minutes;
    store::save_tasks(&store)
}

/// 获取当前提醒设置（分钟数）
#[tauri::command]
fn get_reminder_minutes(state: tauri::State<AppState>) -> u32 {
    state.store.lock().unwrap().reminder_minutes
}

// ── AI 设置命令 ──────────────────────────────

/// 获取 AI 服务配置
#[tauri::command]
fn get_ai_settings(state: tauri::State<AppState>) -> store::AiSettings {
    state.store.lock().unwrap().ai_settings.clone()
}

/// 更新 AI 服务配置（持久化到 tasks.json）
#[tauri::command]
fn set_ai_settings(
    state: tauri::State<AppState>,
    settings: store::AiSettings,
) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.ai_settings = settings;
    store::save_tasks(&store)
}

// ── AI 功能命令 ──────────────────────────────

/// 自然语言解析输入（AI 功能 1）
#[tauri::command]
fn ai_parse_input(
    state: tauri::State<AppState>,
    text: String,
) -> Result<ai::ParsedTask, String> {
    let store = state.store.lock().unwrap();
    let existing_tags: Vec<String> = store.tasks.iter().flat_map(|t| t.tags.clone()).collect();
    let settings = store.ai_settings.clone();
    drop(store);
    ai::parse_input(&settings, &text, &existing_tags)
}

/// 今日聚焦建议（AI 功能 2）
#[tauri::command]
fn ai_daily_focus(state: tauri::State<AppState>) -> Result<ai::FocusSuggestion, String> {
    let store = state.store.lock().unwrap();
    let settings = store.ai_settings.clone();
    let tasks = store.tasks.clone();
    drop(store);
    ai::daily_focus(&settings, &tasks)
}

/// 任务智能拆解（AI 功能 3）
#[tauri::command]
fn ai_decompose(
    state: tauri::State<AppState>,
    task_id: String,
) -> Result<Vec<ai::SubTask>, String> {
    let store = state.store.lock().unwrap();
    let settings = store.ai_settings.clone();
    // 获取任务标题和已有子任务标题
    let task_title = store
        .tasks
        .iter()
        .find(|t| t.id == task_id)
        .map(|t| t.title.clone())
        .ok_or("任务不存在")?;
    let existing_subtasks: Vec<String> = store
        .tasks
        .iter()
        .filter(|t| t.parent_id.as_deref() == Some(&task_id))
        .map(|t| t.title.clone())
        .collect();
    drop(store);
    ai::decompose(&settings, &task_title, &existing_subtasks)
}

/// 过期任务处理建议（AI 功能 4）
#[tauri::command]
fn ai_overdue_suggest(
    state: tauri::State<AppState>,
) -> Result<Vec<ai::OverdueSuggestion>, String> {
    let store = state.store.lock().unwrap();
    let settings = store.ai_settings.clone();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let overdue: Vec<store::Task> = store
        .tasks
        .iter()
        .filter(|t| !t.completed && t.due_date.as_deref().map_or(false, |d| d < today.as_str()))
        .cloned()
        .collect();
    drop(store);
    ai::overdue_suggest(&settings, &overdue)
}

/// AI 助手自由对话（AI 功能 5）
#[tauri::command]
fn ai_chat(
    state: tauri::State<AppState>,
    message: String,
) -> Result<String, String> {
    let store = state.store.lock().unwrap();
    let settings = store.ai_settings.clone();
    let tasks = store.tasks.clone();
    drop(store);
    ai::chat(&settings, &message, &tasks)
}

/// 应用入口：初始化存储、注册命令、启动后台提醒线程
fn main() {
    let store = store::load_tasks();
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            store: Mutex::new(store),
            notified_today: Mutex::new(HashSet::new()),
        })
        // 注册所有前端可调用的命令
        .invoke_handler(tauri::generate_handler![
            get_tasks,
            add_task,
            toggle_task,
            toggle_daily_task,
            update_task,
            delete_task,
            clear_completed,
            get_tasks_by_date,
            get_all_tags,
            delete_tag,
            get_daily_completions,
            set_reminder_minutes,
            get_reminder_minutes,
            get_ai_settings,
            set_ai_settings,
            show_floating_window,
            show_main_window,
            ai_parse_input,
            ai_daily_focus,
            ai_decompose,
            ai_overdue_suggest,
            ai_chat,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // 后台线程：每分钟检查一次到期任务并推送系统通知
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(60));

                    let reminder;
                    let tasks_snapshot: Vec<(String, String, Option<String>)>;
                    {
                        let state = handle.state::<AppState>();
                        let store = state.store.lock().unwrap();
                        reminder = store.reminder_minutes;
                        // 提醒已关闭，跳过本轮检查
                        if reminder == 0 {
                            continue;
                        }
                        // 快照当前未完成且有截止日期的任务（避免长时间持有锁）
                        tasks_snapshot = store
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
