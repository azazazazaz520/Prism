use crate::logging::LogEvent;
use crate::AppState;

/// 批量追加前端上报的结构化日志。
#[tauri::command]
pub fn append_log_batch(
    state: tauri::State<AppState>,
    events: Vec<LogEvent>,
) -> Result<(), String> {
    state.logger.append_batch(&events)
}
