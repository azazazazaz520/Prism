use serde::Deserialize;

/// 新增任务的参数（同时作为 Tauri 命令的请求体）
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTaskInput {
    pub title: String,
    pub due_date: Option<String>,
    pub tags: Option<Vec<String>>,
    pub important: Option<bool>,
    pub pinned: Option<bool>,
    pub is_daily: Option<bool>,
    pub parent_id: Option<String>,
}

/// 更新任务的参数（同时作为 Tauri 命令的请求体）
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Clone)]
pub struct UpdateTaskInput {
    pub id: String,
    pub title: Option<String>,
    #[serde(default, deserialize_with = "present_date")]
    pub due_date: Option<Option<String>>,
    pub tags: Option<Vec<String>>,
    pub important: Option<bool>,
    pub pinned: Option<bool>,
    pub is_daily: Option<bool>,
}

fn present_date<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(deserializer).map(Some)
}

/// 获取所有活跃任务（过滤已软删除）
pub fn list(data: &crate::models::DataStore) -> Vec<crate::models::Task> {
    data.tasks
        .iter()
        .filter(|t| !t.is_deleted)
        .cloned()
        .collect()
}

/// 获取所有任务（包含已软删除，供同步配对）
pub fn list_all(data: &crate::models::DataStore) -> Vec<crate::models::Task> {
    data.tasks.clone()
}

/// 按截止日期筛选任务
pub fn list_by_date(data: &crate::models::DataStore, date: &str) -> Vec<crate::models::Task> {
    data.tasks
        .iter()
        .filter(|t| t.due_date.as_deref() == Some(date))
        .cloned()
        .collect()
}

/// 获取所有标签（去重排序）
pub fn all_tags(data: &crate::models::DataStore) -> Vec<String> {
    let mut tags: Vec<String> = data.tasks.iter().flat_map(|t| t.tags.clone()).collect();
    tags.sort();
    tags.dedup();
    tags
}

/// 获取指定日期已完成的每日任务 ID 列表
pub fn daily_completions(data: &crate::models::DataStore, date: &str) -> Vec<String> {
    data.daily_completions
        .iter()
        .filter(|dc| dc.date == date)
        .map(|dc| dc.task_id.clone())
        .collect()
}

/// 跨天重置每日任务的 completed 状态
/// 返回发生变化的任务快照，供统一提交流程保存并生成同步操作。
/// - 今日有完成记录 → completed = true
/// - 今日无完成记录 → completed = false（昨日完成的自动清零）
pub fn reset_daily_tasks(
    data: &mut crate::models::DataStore,
    today: &str,
) -> Vec<crate::models::Task> {
    let today_ids: Vec<String> = data
        .daily_completions
        .iter()
        .filter(|dc| dc.date == today)
        .map(|dc| dc.task_id.clone())
        .collect();
    let now = chrono::Utc::now().to_rfc3339();
    let mut changed = Vec::new();
    for task in data.tasks.iter_mut() {
        if !task.is_daily || task.is_deleted {
            continue;
        }
        let should_be_completed = today_ids.contains(&task.id);
        if task.completed != should_be_completed {
            task.completed = should_be_completed;
            task.completed_at = if should_be_completed {
                Some(now.clone())
            } else {
                None
            };
            task.updated_at = now.clone();
            changed.push(task.clone());
        }
    }
    changed
}

/// 新增任务
pub fn add(data: &mut crate::models::DataStore, input: AddTaskInput) -> crate::models::Task {
    let now = chrono::Utc::now().to_rfc3339();
    let task = crate::models::Task {
        id: uuid::Uuid::new_v4().to_string(),
        title: input.title,
        completed: false,
        created_at: now.clone(),
        completed_at: None,
        due_date: input.due_date,
        tags: input.tags.unwrap_or_default(),
        important: input.important.unwrap_or(false),
        pinned: input.pinned.unwrap_or(false),
        is_daily: input.is_daily.unwrap_or(false),
        parent_id: input.parent_id,
        updated_at: now,
        is_deleted: false,
        profile_id: None,
    };
    data.tasks.push(task.clone());
    task
}

/// 批量新增任务。全部参数先完成校验和规范化，再统一写入候选 DataStore。
pub fn add_batch(
    data: &mut crate::models::DataStore,
    inputs: Vec<AddTaskInput>,
) -> Result<Vec<crate::models::Task>, String> {
    if inputs.is_empty() {
        return Err("没有可导入的任务".into());
    }

    let normalized = inputs
        .into_iter()
        .enumerate()
        .map(|(index, input)| normalize_batch_input(index, input))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(normalized
        .into_iter()
        .map(|input| add(data, input))
        .collect())
}

fn normalize_batch_input(index: usize, mut input: AddTaskInput) -> Result<AddTaskInput, String> {
    input.title = input.title.trim().to_string();
    if input.title.is_empty() {
        return Err(format!("第 {} 项任务标题为空", index + 1));
    }

    input.due_date = match input.due_date.take() {
        Some(value) if value.trim().is_empty() => None,
        Some(value) => {
            let value = value.trim().to_string();
            chrono::NaiveDate::parse_from_str(&value, "%Y-%m-%d")
                .map_err(|_| format!("第 {} 项任务日期格式无效", index + 1))?;
            Some(value)
        }
        None => None,
    };

    input.tags = input.tags.map(|tags| {
        let mut normalized = Vec::new();
        for tag in tags {
            let tag = tag.trim().to_string();
            if !tag.is_empty() && !normalized.contains(&tag) {
                normalized.push(tag);
            }
        }
        normalized
    });

    Ok(input)
}

/// 切换任务完成状态（自动记录完成/取消时间），返回更新后的任务快照
pub fn toggle(data: &mut crate::models::DataStore, id: &str) -> Option<crate::models::Task> {
    let completed = !data.tasks.iter().find(|task| task.id == id)?.completed;
    set_completed(data, id, completed)
}

pub fn set_completed(
    data: &mut crate::models::DataStore,
    id: &str,
    completed: bool,
) -> Option<crate::models::Task> {
    let now = chrono::Utc::now().to_rfc3339();
    let task = data
        .tasks
        .iter_mut()
        .find(|t| t.id == id && !t.is_deleted)?;
    if task.completed == completed {
        return Some(task.clone());
    }
    task.completed = completed;
    task.completed_at = if task.completed {
        Some(now.clone())
    } else {
        None
    };
    task.updated_at = now;
    Some(task.clone())
}

/// 按日期设置每日任务完成状态，并返回最新任务。
pub fn set_daily_completed(
    data: &mut crate::models::DataStore,
    id: &str,
    date: &str,
    completed: bool,
) -> Option<crate::models::Task> {
    let task = data
        .tasks
        .iter()
        .find(|task| task.id == id && !task.is_deleted)?;
    let profile_id = task.profile_id.clone();
    let exists = data
        .daily_completions
        .iter()
        .any(|dc| dc.task_id == id && dc.date == date);
    if completed && !exists {
        data.daily_completions.push(crate::models::DailyCompletion {
            task_id: id.to_string(),
            date: date.to_string(),
            profile_id: profile_id.clone(),
        });
    } else if !completed && exists {
        data.daily_completions
            .retain(|dc| dc.task_id != id || dc.date != date);
    }
    let task = set_completed(data, id, completed);
    if !completed && !exists {
        // 取消操作保留删除意图，即使本地尚未收到对应的远端记录。
        crate::tasks::outbox::append(
            data,
            crate::models::QueueOperation {
                kind: "delete".into(),
                table: "daily_completions".into(),
                data: serde_json::json!({"task_id":id,"date":date,"profile_id":profile_id}),
            },
        );
    }
    task
}

/// 在最新任务上更新请求提供的字段。
pub fn update(
    data: &mut crate::models::DataStore,
    input: UpdateTaskInput,
) -> Option<crate::models::Task> {
    let now = chrono::Utc::now().to_rfc3339();
    let task = data
        .tasks
        .iter_mut()
        .find(|t| t.id == input.id && !t.is_deleted)?;
    if let Some(title) = input.title {
        task.title = title;
    }
    if let Some(date) = input.due_date {
        task.due_date = date;
    }
    if let Some(tags) = input.tags {
        task.tags = tags;
    }
    if let Some(important) = input.important {
        task.important = important;
    }
    if let Some(pinned) = input.pinned {
        task.pinned = pinned;
    }
    if let Some(is_daily) = input.is_daily {
        task.is_daily = is_daily;
    }
    task.updated_at = now;
    Some(task.clone())
}

/// 软删除任务（含级联子任务删除 + 清理孤儿 daily_completions）
pub fn delete(data: &mut crate::models::DataStore, id: &str) -> Option<()> {
    let now = chrono::Utc::now().to_rfc3339();
    // 标记主任务
    let task = data.tasks.iter_mut().find(|t| t.id == id)?;
    task.is_deleted = true;
    task.updated_at = now.clone();
    // 级联软删除子任务
    for child in data
        .tasks
        .iter_mut()
        .filter(|t| t.parent_id.as_deref() == Some(id))
    {
        child.is_deleted = true;
        child.updated_at = now.clone();
    }
    // 清理孤儿 daily_completions
    data.daily_completions.retain(|dc| dc.task_id != id);
    Some(())
}

/// 恢复软删除任务，并更新时间戳以便跨设备同步撤销操作。
pub fn restore(data: &mut crate::models::DataStore, id: &str) -> Option<()> {
    let task = data.tasks.iter_mut().find(|t| t.id == id)?;
    if !task.is_deleted {
        return Some(());
    }
    task.is_deleted = false;
    task.updated_at = chrono::Utc::now().to_rfc3339();
    Some(())
}

/// 一键软删除所有已完成任务（跳过每日任务，每日任务每天自动重置）
pub fn clear_completed(data: &mut crate::models::DataStore) {
    let now = chrono::Utc::now().to_rfc3339();
    let completed_ids: Vec<String> = data
        .tasks
        .iter()
        .filter(|t| t.completed && !t.is_deleted && !t.is_daily)
        .map(|t| t.id.clone())
        .collect();
    for task in data.tasks.iter_mut() {
        if task.completed && !task.is_deleted && !task.is_daily {
            task.is_deleted = true;
            task.updated_at = now.clone();
        }
    }
    for id in &completed_ids {
        data.daily_completions.retain(|dc| &dc.task_id != id);
    }
}

/// 删除指定标签（从所有任务中移除该标签）
pub fn delete_tag(data: &mut crate::models::DataStore, tag: &str) {
    for task in data.tasks.iter_mut() {
        let count = task.tags.len();
        task.tags.retain(|t| t != tag);
        if count != task.tags.len() {
            task.updated_at = chrono::Utc::now().to_rfc3339();
        }
    }
}

/// 校正远端完成记录快照，保留待同步操作并丢弃跨越本地提交的旧快照。
pub fn merge_daily_snapshot(
    data: &mut crate::models::DataStore,
    remote: Vec<crate::models::DailyCompletion>,
    replace: bool,
    profile: Option<&str>,
    revision: Option<u64>,
) -> bool {
    if replace && revision.is_some_and(|revision| revision != data.revision) {
        return false;
    }
    if replace {
        if let Some(profile) = profile {
            let outbox = &data.outbox;
            data.daily_completions.retain(|dc| {
                dc.profile_id.as_deref() != Some(profile)
                    || outbox.iter().any(|item| {
                        item.operation.table == "daily_completions"
                            && item.operation.data["task_id"] == dc.task_id
                            && item.operation.data["date"] == dc.date
                    })
                    || remote
                        .iter()
                        .any(|item| item.task_id == dc.task_id && item.date == dc.date)
            });
        }
    }
    for completion in remote {
        if crate::tasks::outbox::pending_daily(data, &completion.task_id, &completion.date) {
            continue;
        }
        if let Some(local) = data
            .daily_completions
            .iter_mut()
            .find(|dc| dc.task_id == completion.task_id && dc.date == completion.date)
        {
            if local.profile_id.is_none() {
                local.profile_id = completion.profile_id;
            }
        } else {
            data.daily_completions.push(completion);
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::{add_batch, AddTaskInput};

    #[test]
    fn remote_snapshot_preserves_pending_daily_insert_and_delete() {
        let mut data = crate::models::default_data_store();
        let completion = |id: &str| crate::models::DailyCompletion {
            task_id: id.into(),
            date: "2026-10-13".into(),
            profile_id: Some("profile".into()),
        };
        data.daily_completions = vec![completion("insert"), completion("stale")];
        for (kind, id) in [("upsert", "insert"), ("delete", "delete")] {
            crate::tasks::outbox::append(
                &mut data,
                crate::models::QueueOperation {
                    kind: kind.into(),
                    table: "daily_completions".into(),
                    data: serde_json::to_value(completion(id)).unwrap(),
                },
            );
        }
        assert!(super::merge_daily_snapshot(
            &mut data,
            vec![completion("delete")],
            true,
            Some("profile"),
            Some(0)
        ));
        assert_eq!(data.daily_completions, vec![completion("insert")]);
        data.outbox.clear();
        data.revision = 1;
        assert!(!super::merge_daily_snapshot(
            &mut data,
            vec![completion("delete")],
            true,
            Some("profile"),
            Some(0)
        ));
        assert_eq!(data.daily_completions, vec![completion("insert")]);
    }

    fn input(title: &str, due_date: Option<&str>) -> AddTaskInput {
        AddTaskInput {
            title: title.to_string(),
            due_date: due_date.map(str::to_string),
            tags: Some(vec![" 工作 ".into(), "工作".into(), " ".into()]),
            important: Some(false),
            pinned: Some(false),
            is_daily: Some(false),
            parent_id: None,
        }
    }

    #[test]
    fn add_batch_validates_all_items_before_mutating_store() {
        let mut data = crate::models::default_data_store();
        let error = add_batch(
            &mut data,
            vec![input("第一项", None), input("  ", Some("2026-08-20"))],
        )
        .expect_err("空标题应阻止整批写入");

        assert_eq!(error, "第 2 项任务标题为空");
        assert!(data.tasks.is_empty());
    }

    #[test]
    fn add_batch_normalizes_fields_and_returns_created_tasks() {
        let mut data = crate::models::default_data_store();
        let created = add_batch(
            &mut data,
            vec![
                input("  提交报告  ", Some("2026-08-20")),
                input("复盘", None),
            ],
        )
        .expect("有效任务应成功写入");

        assert_eq!(created.len(), 2);
        assert_eq!(data.tasks.len(), 2);
        assert_eq!(created[0].title, "提交报告");
        assert_eq!(created[0].tags, vec!["工作"]);
    }

    #[test]
    fn add_batch_rejects_invalid_date_without_mutating_store() {
        let mut data = crate::models::default_data_store();
        let error = add_batch(&mut data, vec![input("提交报告", Some("明天"))])
            .expect_err("无效日期应被拒绝");

        assert_eq!(error, "第 1 项任务日期格式无效");
        assert!(data.tasks.is_empty());
    }
}
