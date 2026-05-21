#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use store::TaskStore;

mod store;

struct AppState {
    store: Mutex<TaskStore>,
}

#[tauri::command]
fn get_tasks(state: tauri::State<AppState>) -> Vec<store::Task> {
    state.store.lock().unwrap().tasks.clone()
}

#[tauri::command]
fn add_task(state: tauri::State<AppState>, title: String, due_date: Option<String>) -> Result<store::Task, String> {
    let mut store = state.store.lock().unwrap();
    let task = store::Task {
        id: uuid::Uuid::new_v4().to_string(),
        title,
        completed: false,
        created_at: chrono::Utc::now().to_rfc3339(),
        completed_at: None,
        due_date,
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
fn update_task(state: tauri::State<AppState>, id: String, title: String, due_date: Option<String>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    if let Some(task) = store.tasks.iter_mut().find(|t| t.id == id) {
        task.title = title;
        task.due_date = due_date;
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

fn main() {
    let store = store::load_tasks();
    tauri::Builder::default()
        .manage(AppState {
            store: Mutex::new(store),
        })
        .invoke_handler(tauri::generate_handler![
            get_tasks,
            add_task,
            toggle_task,
            update_task,
            delete_task,
            clear_completed,
            get_tasks_by_date,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
