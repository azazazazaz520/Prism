#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use store::TaskStore;
use tauri::Manager;

mod store;

struct AppState {
    store: Mutex<TaskStore>,
}

#[tauri::command]
fn get_tasks(state: tauri::State<AppState>) -> Vec<store::Task> {
    state.store.lock().unwrap().tasks.clone()
}

#[tauri::command]
fn add_task(
    state: tauri::State<AppState>,
    title: String,
    due_date: Option<String>,
    tags: Option<Vec<String>>,
    important: Option<bool>,
    pinned: Option<bool>,
    is_daily: Option<bool>,
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
    };
    store.tasks.push(task.clone());
    store::save_tasks(&store)?;
    Ok(task)
}

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

#[tauri::command]
fn toggle_daily_task(state: tauri::State<AppState>, id: String, date: String) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    if let Some(pos) = store.daily_completions.iter().position(|dc| dc.task_id == id && dc.date == date) {
        store.daily_completions.remove(pos);
    } else {
        store.daily_completions.push(store::DailyCompletion {
            task_id: id,
            date,
        });
    }
    store::save_tasks(&store)
}

#[tauri::command]
fn update_task(
    state: tauri::State<AppState>,
    id: String,
    title: String,
    due_date: Option<String>,
    tags: Vec<String>,
    important: bool,
    pinned: bool,
    is_daily: bool,
) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    if let Some(task) = store.tasks.iter_mut().find(|t| t.id == id) {
        task.title = title;
        task.due_date = due_date;
        task.tags = tags;
        task.important = important;
        task.pinned = pinned;
        task.is_daily = is_daily;
    }
    store::save_tasks(&store)
}

#[tauri::command]
fn delete_task(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.tasks.retain(|t| t.id != id);
    store::save_tasks(&store)
}

#[tauri::command]
fn clear_completed(state: tauri::State<AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.tasks.retain(|t| !t.completed);
    store::save_tasks(&store)
}

#[tauri::command]
fn get_tasks_by_date(state: tauri::State<AppState>, date: String) -> Vec<store::Task> {
    state.store.lock().unwrap()
        .tasks
        .iter()
        .filter(|t| t.due_date.as_deref() == Some(&date))
        .cloned()
        .collect()
}

#[tauri::command]
fn get_all_tags(state: tauri::State<AppState>) -> Vec<String> {
    let store = state.store.lock().unwrap();
    let mut tags: Vec<String> = store.tasks.iter()
        .flat_map(|t| t.tags.clone())
        .collect();
    tags.sort();
    tags.dedup();
    tags
}

#[tauri::command]
fn delete_tag(state: tauri::State<AppState>, tag: String) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    for task in store.tasks.iter_mut() {
        task.tags.retain(|t| t != &tag);
    }
    store::save_tasks(&store)
}

#[tauri::command]
fn get_daily_completions(state: tauri::State<AppState>, date: String) -> Vec<String> {
    state.store.lock().unwrap()
        .daily_completions
        .iter()
        .filter(|dc| dc.date == date)
        .map(|dc| dc.task_id.clone())
        .collect()
}

#[tauri::command]
fn show_floating_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main_win) = app.get_webview_window("main") {
        main_win.hide().map_err(|e| e.to_string())?;
    }
    if let Some(float_win) = app.get_webview_window("floating") {
        float_win.show().map_err(|e| e.to_string())?;
        float_win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(float_win) = app.get_webview_window("floating") {
        float_win.hide().map_err(|e| e.to_string())?;
    }
    if let Some(main_win) = app.get_webview_window("main") {
        main_win.show().map_err(|e| e.to_string())?;
        main_win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    let store = store::load_tasks();
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            store: Mutex::new(store),
        })
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
            show_floating_window,
            show_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
