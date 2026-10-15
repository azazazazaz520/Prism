use crate::{tasks::outbox, AppState};
use tauri::{State, WebviewWindow};

#[tauri::command]
pub fn import_legacy_queue(
    operations: Vec<crate::models::QueueOperation>,
    state: State<AppState>,
) -> Result<(), String> {
    state.write_remote_data(|data| {
        if !data.legacy_queue_imported {
            crate::storage::backup_data_for_queue_migration()?;
            crate::storage::backup_legacy_queue(&operations)?;
        }
        outbox::import_legacy(data, operations)
    })
}

#[tauri::command]
pub fn claim_outbox(
    window: WebviewWindow,
    state: State<AppState>,
) -> Result<Option<outbox::Delivery>, String> {
    let mut consumer = state.consumer.lock().unwrap();
    consumer.expire();
    state.write_remote_data(|data| {
        if !data.legacy_queue_imported {
            return Err("旧队列转换尚未完成".into());
        }
        outbox::compact(data, consumer.in_flight_id());
        Ok(())
    })?;
    Ok(state.read_data(|data| consumer.claim(window.label(), data.outbox.first())))
}

#[tauri::command]
pub fn finish_outbox(
    token: String,
    id: String,
    success: bool,
    window: WebviewWindow,
    state: State<AppState>,
) -> Result<(), String> {
    let mut consumer = state.consumer.lock().unwrap();
    if !consumer.matches(window.label(), &token, &id) {
        return Err("发送凭据已失效".into());
    }
    let result = state.write_remote_data(|data| {
        if success {
            data.outbox.retain(|item| item.id != id);
        }
        outbox::compact(data, None);
        Ok(())
    });
    if success && result.is_ok() {
        consumer.release();
    } else {
        consumer.retry_later();
    }
    result
}

#[tauri::command]
pub fn link_unpaired_tasks(profile_id: String, state: State<AppState>) -> Result<(), String> {
    if state.with_sync(|sync| sync.profile_id.as_deref() != Some(profile_id.as_str())) {
        return Err("同步 Profile 已变化".into());
    }
    state.write_data(|data| {
        for task in &mut data.tasks {
            if task.profile_id.is_none() {
                task.profile_id = Some(profile_id.clone());
            }
        }
        for completion in &mut data.daily_completions {
            if completion.profile_id.is_none() {
                completion.profile_id = Some(profile_id.clone());
            }
        }
    })
}
