use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::store::{DailyCompletion, DataStore};

pub const DATA_CHANGED: &str = "tasks://data-changed";
pub const REQUEST_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QueueOperation {
    #[serde(rename = "type")]
    pub kind: String,
    pub table: String,
    pub data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OutboxItem {
    pub id: String,
    pub sequence: u64,
    #[serde(flatten)]
    pub operation: QueueOperation,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Delivery {
    pub token: String,
    pub item: OutboxItem,
}

struct InFlight {
    label: String,
    delivery: Delivery,
    claimed_at: Instant,
}

#[derive(Default)]
pub struct Consumer {
    current: Option<InFlight>,
    resume_after: Option<Instant>,
}

impl Consumer {
    pub fn expire(&mut self) {
        if self.current.as_ref().is_some_and(|current| {
            current.claimed_at.elapsed() >= Duration::from_secs(REQUEST_TIMEOUT_SECS * 2)
        }) {
            self.release();
        }
    }

    pub fn in_flight_id(&self) -> Option<&str> {
        self.current
            .as_ref()
            .map(|current| current.delivery.item.id.as_str())
    }

    pub fn claim(&mut self, label: &str, item: Option<&OutboxItem>) -> Option<Delivery> {
        self.expire();
        if self.current.is_some()
            || self
                .resume_after
                .is_some_and(|until| Instant::now() < until)
        {
            return None;
        }
        let delivery = Delivery {
            token: uuid::Uuid::new_v4().to_string(),
            item: item?.clone(),
        };
        self.current = Some(InFlight {
            label: label.into(),
            delivery: delivery.clone(),
            claimed_at: Instant::now(),
        });
        Some(delivery)
    }

    pub fn matches(&self, label: &str, token: &str, id: &str) -> bool {
        self.current.as_ref().is_some_and(|current| {
            current.label == label
                && current.delivery.token == token
                && current.delivery.item.id == id
        })
    }

    pub fn release(&mut self) {
        self.current = None;
    }

    pub fn retry_later(&mut self) {
        self.release();
        self.resume_after = Some(Instant::now() + Duration::from_secs(10));
    }

    pub fn window_closed(&mut self, label: &str) {
        if self
            .current
            .as_ref()
            .is_some_and(|current| current.label == label)
        {
            self.release();
            // 交接期间保留请求超时窗口，待发送项仍保存在磁盘。
            self.resume_after = Some(Instant::now() + Duration::from_secs(REQUEST_TIMEOUT_SECS));
        }
    }
}

pub type SharedConsumer = Mutex<Consumer>;

pub fn append(data: &mut DataStore, operation: QueueOperation) {
    data.outbox_sequence += 1;
    data.outbox.push(OutboxItem {
        id: uuid::Uuid::new_v4().to_string(),
        sequence: data.outbox_sequence,
        operation,
    });
}

/// 每个实体保留最新待发送版本，沿用首次入队位置，并单独保留在途版本。
pub fn compact(data: &mut DataStore, in_flight_id: Option<&str>) {
    let mut positions: HashMap<_, usize> = HashMap::new();
    let mut pending: Vec<OutboxItem> = Vec::new();
    for mut item in std::mem::take(&mut data.outbox) {
        let key = match item.operation.table.as_str() {
            "tasks" => item.operation.data["id"]
                .as_str()
                .map(|id| ("tasks", id.to_string(), String::new())),
            "daily_completions" => item.operation.data["task_id"]
                .as_str()
                .zip(item.operation.data["date"].as_str())
                .map(|(id, date)| ("daily_completions", id.to_string(), date.to_string())),
            _ => None,
        };
        if Some(item.id.as_str()) != in_flight_id {
            if let Some(key) = key {
                if let Some(&index) = positions.get(&key) {
                    item.sequence = pending[index].sequence;
                    pending[index] = item;
                    continue;
                }
                positions.insert(key, pending.len());
            }
        }
        pending.push(item);
    }
    data.outbox = pending;
}

pub fn enqueue_changes(
    before: &DataStore,
    after: &mut DataStore,
    profile: Option<&str>,
    in_flight_id: Option<&str>,
) {
    let mut operations = Vec::new();
    for task in &mut after.tasks {
        let previous = before.tasks.iter().find(|old| old.id == task.id);
        if previous == Some(task) {
            continue;
        }
        if task.profile_id.is_none() {
            task.profile_id = profile.map(str::to_string);
        }
        operations.push(QueueOperation {
            kind: "upsert".into(),
            table: "tasks".into(),
            data: serde_json::to_value(&*task).expect("任务序列化"),
        });
    }
    for completion in &mut after.daily_completions {
        if before.daily_completions.contains(completion) {
            continue;
        }
        if completion.profile_id.is_none() {
            completion.profile_id = profile.map(str::to_string);
        }
        operations.push(QueueOperation {
            kind: "upsert".into(),
            table: "daily_completions".into(),
            data: serde_json::to_value(&*completion).expect("完成记录序列化"),
        });
    }
    for old in &before.daily_completions {
        if !after
            .daily_completions
            .iter()
            .any(|new| new.task_id == old.task_id && new.date == old.date)
        {
            operations.push(QueueOperation { kind: "delete".into(), table: "daily_completions".into(), data: json!({"task_id":old.task_id,"date":old.date,"profile_id":old.profile_id.as_deref().or(profile)}) });
        }
    }
    for operation in operations {
        append(after, operation);
    }
    compact(after, in_flight_id);
}

pub fn pending_daily(data: &DataStore, task_id: &str, date: &str) -> bool {
    data.outbox.iter().any(|item| {
        item.operation.table == "daily_completions"
            && item.operation.data["task_id"] == task_id
            && item.operation.data["date"] == date
    })
}

pub fn import_legacy(data: &mut DataStore, operations: Vec<QueueOperation>) -> Result<(), String> {
    if data.legacy_queue_imported {
        return Ok(());
    }
    for operation in &operations {
        match (operation.table.as_str(), operation.kind.as_str()) {
            ("tasks", "upsert") => {
                serde_json::from_value::<crate::store::Task>(operation.data.clone())
                    .map_err(|e| format!("旧任务记录无效：{e}"))?;
            }
            ("daily_completions", "upsert" | "delete") => {
                serde_json::from_value::<DailyCompletion>(operation.data.clone())
                    .map_err(|e| format!("旧完成记录无效：{e}"))?;
            }
            _ => return Err("旧队列包含未知操作".into()),
        }
    }
    for operation in operations {
        append(data, operation);
    }
    compact(data, None);
    data.legacy_queue_imported = true;
    data.version = 2;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task_service::{self, AddTaskInput, UpdateTaskInput};

    fn data_with_task() -> DataStore {
        let mut data = crate::store::default_data_store();
        data.legacy_queue_imported = true;
        task_service::add(
            &mut data,
            AddTaskInput {
                title: "原标题".into(),
                due_date: None,
                tags: None,
                important: None,
                pinned: None,
                is_daily: Some(true),
                parent_id: None,
            },
        );
        data
    }

    #[test]
    fn separate_window_patches_keep_latest_complete_state_and_queue_position() {
        let mut data = data_with_task();
        let id = data.tasks[0].id.clone();
        let first = data.clone();
        let title: UpdateTaskInput =
            serde_json::from_value(json!({"id":id,"title":"新标题"})).unwrap();
        task_service::update(&mut data, title).unwrap();
        enqueue_changes(&first, &mut data, Some("profile"), None);
        let first_id = data.outbox[0].id.clone();
        let first_sequence = data.outbox[0].sequence;
        let second = data.clone();
        let tags = serde_json::from_value(json!({"id":id,"tags":["标签"]})).unwrap();
        task_service::update(&mut data, tags).unwrap();
        enqueue_changes(&second, &mut data, Some("profile"), None);
        assert_eq!(data.tasks[0].title, "新标题");
        assert_eq!(data.tasks[0].tags, vec!["标签"]);
        assert_eq!(data.outbox.len(), 1);
        assert_eq!(data.outbox[0].operation.data["title"], "新标题");
        assert_eq!(data.outbox[0].operation.data["tags"], json!(["标签"]));
        assert_ne!(data.outbox[0].id, first_id);
        assert_eq!(data.outbox[0].sequence, first_sequence);
    }

    #[test]
    fn explicit_completed_target_is_idempotent_and_date_patch_distinguishes_null() {
        let mut data = data_with_task();
        let id = data.tasks[0].id.clone();
        task_service::set_daily_completed(&mut data, &id, "2026-10-13", true).unwrap();
        let before = data.clone();
        task_service::set_daily_completed(&mut data, &id, "2026-10-13", true).unwrap();
        enqueue_changes(&before, &mut data, None, None);
        assert!(data.tasks[0].completed);
        assert_eq!(data.daily_completions.len(), 1);
        assert!(data.outbox.is_empty());
        data.tasks[0].due_date = Some("2026-10-14".into());
        let title = serde_json::from_value(json!({"id":id,"title":"标题"})).unwrap();
        task_service::update(&mut data, title).unwrap();
        assert_eq!(data.tasks[0].due_date.as_deref(), Some("2026-10-14"));
        let clear = serde_json::from_value(json!({"id":id,"dueDate":null})).unwrap();
        task_service::update(&mut data, clear).unwrap();
        assert!(data.tasks[0].due_date.is_none());
    }

    #[test]
    fn cancel_daily_completion_persists_task_and_delete_intent() {
        let mut data = data_with_task();
        let id = data.tasks[0].id.clone();
        task_service::set_daily_completed(&mut data, &id, "2026-10-13", true).unwrap();
        let before = data.clone();
        task_service::set_daily_completed(&mut data, &id, "2026-10-13", false).unwrap();
        enqueue_changes(&before, &mut data, Some("profile"), None);
        assert!(data.daily_completions.is_empty());
        assert_eq!(data.outbox.len(), 2);
        assert_eq!(data.outbox[1].operation.kind, "delete");
        assert!(pending_daily(&data, &id, "2026-10-13"));
        let saved = serde_json::to_string(&data).unwrap();
        let restored: DataStore = serde_json::from_str(&saved).unwrap();
        assert!(pending_daily(&restored, &id, "2026-10-13"));
        assert!(!restored.tasks[0].completed);
    }

    #[test]
    fn cancelling_before_completion_record_arrives_keeps_delete_intent() {
        let mut data = data_with_task();
        let id = data.tasks[0].id.clone();
        data.tasks[0].completed = true;
        let before = data.clone();
        task_service::set_daily_completed(&mut data, &id, "2026-10-13", false).unwrap();
        enqueue_changes(&before, &mut data, None, None);
        assert!(!data.tasks[0].completed);
        assert!(data.daily_completions.is_empty());
        assert!(pending_daily(&data, &id, "2026-10-13"));
        assert_eq!(data.outbox.len(), 2);
        assert_eq!(data.outbox[0].operation.kind, "delete");
    }

    #[test]
    fn legacy_conversion_is_once_and_compacts_pending_operations() {
        let mut data = crate::store::default_data_store();
        let operation = QueueOperation {
            kind: "delete".into(),
            table: "daily_completions".into(),
            data: json!({"task_id":"task","date":"2026-10-13","profile_id":"old"}),
        };
        let tomorrow = QueueOperation {
            data: json!({"task_id":"task","date":"2026-10-14","profile_id":"old"}),
            ..operation.clone()
        };
        import_legacy(&mut data, vec![operation.clone(), tomorrow, operation]).unwrap();
        let ids: Vec<_> = data.outbox.iter().map(|item| item.id.clone()).collect();
        import_legacy(&mut data, vec![]).unwrap();
        assert!(data.legacy_queue_imported);
        assert_eq!(data.outbox.len(), 2);
        assert_ne!(ids[0], ids[1]);
        assert_eq!(data.outbox[0].operation.data["profile_id"], "old");
        assert!(data.outbox[0].sequence < data.outbox[1].sequence);
    }

    #[test]
    fn in_flight_confirmation_removes_only_sent_version_and_retry_uses_latest() {
        let mut data = data_with_task();
        let task_id = data.tasks[0].id.clone();
        let operation = QueueOperation {
            kind: "upsert".into(),
            table: "tasks".into(),
            data: serde_json::to_value(&data.tasks[0]).unwrap(),
        };
        append(&mut data, operation);
        let mut consumer = Consumer::default();
        let first = consumer.claim("main", data.outbox.first()).unwrap();
        for title in ["中间标题", "最新标题"] {
            let before = data.clone();
            let patch = serde_json::from_value(json!({"id":task_id,"title":title})).unwrap();
            task_service::update(&mut data, patch).unwrap();
            enqueue_changes(&before, &mut data, None, consumer.in_flight_id());
        }
        assert_eq!(data.outbox.len(), 2);
        assert_eq!(data.outbox[0].id, first.item.id);
        assert_eq!(data.outbox[1].operation.data["title"], "最新标题");
        assert!(consumer.matches("main", &first.token, &first.item.id));

        let mut retry = data.clone();
        consumer.retry_later();
        compact(&mut retry, consumer.in_flight_id());
        assert_eq!(retry.outbox.len(), 1);
        assert_eq!(retry.outbox[0].operation.data["title"], "最新标题");

        data.outbox.retain(|item| item.id != first.item.id);
        compact(&mut data, None);
        assert_eq!(data.outbox.len(), 1);
        assert_eq!(data.outbox[0].operation.data["title"], "最新标题");
        let restored: DataStore =
            serde_json::from_str(&serde_json::to_string(&data).unwrap()).unwrap();
        assert_eq!(restored.outbox, data.outbox);
    }

    #[test]
    fn compaction_preserves_task_before_daily_records_and_latest_delete_per_date() {
        let mut data = data_with_task();
        let task_id = data.tasks[0].id.clone();
        let before = crate::store::default_data_store();
        enqueue_changes(&before, &mut data, Some("profile"), None);
        for date in ["2026-10-13", "2026-10-14"] {
            let before = data.clone();
            task_service::set_daily_completed(&mut data, &task_id, date, true).unwrap();
            enqueue_changes(&before, &mut data, Some("profile"), None);
        }
        let before = data.clone();
        task_service::set_daily_completed(&mut data, &task_id, "2026-10-13", false).unwrap();
        enqueue_changes(&before, &mut data, Some("profile"), None);
        let before = data.clone();
        let patch = serde_json::from_value(json!({"id":task_id,"title":"最终标题"})).unwrap();
        task_service::update(&mut data, patch).unwrap();
        enqueue_changes(&before, &mut data, Some("profile"), None);
        assert_eq!(data.outbox.len(), 3);
        assert_eq!(data.outbox[0].operation.table, "tasks");
        assert_eq!(data.outbox[0].operation.data["title"], "最终标题");
        assert_eq!(data.outbox[1].operation.kind, "delete");
        assert_eq!(data.outbox[1].operation.data["date"], "2026-10-13");
        assert_eq!(data.outbox[2].operation.kind, "upsert");
        assert_eq!(data.outbox[2].operation.data["date"], "2026-10-14");
        assert!(data
            .outbox
            .windows(2)
            .all(|pair| pair[0].sequence < pair[1].sequence));
    }

    #[test]
    fn invalid_legacy_record_keeps_marker_and_queue_unmodified() {
        let mut data = crate::store::default_data_store();
        assert!(import_legacy(
            &mut data,
            vec![QueueOperation {
                kind: "delete".into(),
                table: "tasks".into(),
                data: json!({})
            }]
        )
        .is_err());
        assert!(!data.legacy_queue_imported);
        assert!(data.outbox.is_empty());
    }

    #[test]
    fn consumer_is_exclusive_and_closing_owner_invalidates_confirmation() {
        let mut data = data_with_task();
        append(
            &mut data,
            QueueOperation {
                kind: "upsert".into(),
                table: "tasks".into(),
                data: json!({"id":"task"}),
            },
        );
        let mut consumer = Consumer::default();
        let first = consumer.claim("main", data.outbox.first()).unwrap();
        assert!(consumer
            .claim("workspace-second", data.outbox.first())
            .is_none());
        assert!(!consumer.matches("workspace-second", &first.token, &first.item.id));
        consumer.window_closed("workspace-second");
        assert!(consumer.matches("main", &first.token, &first.item.id));
        consumer.window_closed("main");
        assert!(!consumer.matches("main", &first.token, &first.item.id));
        assert!(consumer
            .claim("workspace-second", data.outbox.first())
            .is_none());
        consumer.resume_after = None;
        let next = consumer
            .claim("workspace-second", data.outbox.first())
            .unwrap();
        assert_ne!(first.token, next.token);
        assert_eq!(first.item.id, next.item.id);
        assert_eq!(data.outbox.len(), 1);
    }

    #[test]
    fn renderer_restart_without_confirmation_eventually_releases_claim() {
        let mut data = data_with_task();
        append(
            &mut data,
            QueueOperation {
                kind: "upsert".into(),
                table: "tasks".into(),
                data: json!({"id":"task"}),
            },
        );
        let mut consumer = Consumer::default();
        let old = consumer.claim("main", data.outbox.first()).unwrap();
        consumer.current.as_mut().unwrap().claimed_at =
            Instant::now() - Duration::from_secs(REQUEST_TIMEOUT_SECS * 2);
        let new = consumer.claim("main", data.outbox.first()).unwrap();
        assert_ne!(old.token, new.token);
        assert!(!consumer.matches("main", &old.token, &old.item.id));
        assert_eq!(new.item.id, old.item.id);
    }
}
