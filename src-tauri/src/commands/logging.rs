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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn log_event_serializes_as_a_tauri_payload() {
        let event = LogEvent {
            timestamp: "2026-07-24T12:00:00+08:00".to_string(),
            level: crate::logging::LogLevel::Info,
            module: "window".to_string(),
            event: "window.bootstrap_completed".to_string(),
            message: "窗口初始化完成".to_string(),
            trace_id: "tr_test".to_string(),
            window: "main".to_string(),
            app_version: "0.3.3".to_string(),
            context: json!({ "duration_ms": 12 }),
            error: None,
        };

        let payload = serde_json::to_value(event).unwrap();

        assert_eq!(payload["level"], "info");
        assert_eq!(payload["event"], "window.bootstrap_completed");
        assert_eq!(payload["context"]["duration_ms"], 12);
    }
}
