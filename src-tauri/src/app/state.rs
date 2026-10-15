use crate::{logging, tasks::outbox};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::Emitter;

/// 应用全局状态，由 Tauri 托管，可在所有命令中访问。
///
/// 字段为 `pub(crate)`：同一 crate 内可直接访问，
/// 但推荐使用 `with_config` / `with_sync` / `read_data` / `write_data` 方法，
/// 它们封装了锁获取和持久化逻辑。
pub struct AppState {
    pub(crate) data: Mutex<crate::models::DataStore>,
    pub(crate) config: Mutex<crate::models::ConfigStore>,
    pub(crate) sync: Mutex<crate::models::SyncStore>,
    pub(crate) logger: Arc<logging::LogWriter>,
    /// 插件模块源码临时存储，key = token，激活后立即消费
    pub(crate) plugin_modules: Mutex<HashMap<String, String>>,
    pub(crate) consumer: outbox::SharedConsumer,
    pub(super) app: tauri::AppHandle,
}

impl AppState {
    // ═══ 任务数据提交 ═══

    /// 读锁快捷方式：锁定 DataStore → 执行只读操作 → 返回结果
    pub fn read_data<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&crate::models::DataStore) -> R,
    {
        let data = self.data.lock().unwrap();
        f(&data)
    }

    /// 将业务修改与同步意图共同保存，提交后通知所有窗口。
    pub fn write_data<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&mut crate::models::DataStore) -> R,
    {
        self.write_data_candidate(|data| Ok(f(data)))
    }

    /// 校验并修改候选数据，持久化成功后提交共享状态。
    pub fn write_data_candidate<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&mut crate::models::DataStore) -> Result<R, String>,
    {
        let profile = self.with_sync(|sync| sync.profile_id.clone());
        let consumer = self.consumer.lock().unwrap();
        self.commit_data(true, |candidate| {
            let before = candidate.clone();
            let result = f(candidate)?;
            for item in candidate.outbox.iter_mut().skip(before.outbox.len()) {
                if item.operation.data["profile_id"].is_null() {
                    item.operation.data["profile_id"] =
                        serde_json::to_value(&profile).expect("同步归属序列化");
                }
            }
            outbox::enqueue_changes(
                &before,
                candidate,
                profile.as_deref(),
                consumer.in_flight_id(),
            );
            Ok(result)
        })
    }

    pub(crate) fn write_remote_data<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&mut crate::models::DataStore) -> Result<R, String>,
    {
        self.commit_data(false, f)
    }

    pub(crate) fn saved_task(&self, task: crate::models::Task) -> crate::models::Task {
        self.read_data(|data| {
            data.tasks
                .iter()
                .find(|item| item.id == task.id)
                .cloned()
                .unwrap_or(task)
        })
    }

    fn commit_data<F, R>(&self, local: bool, f: F) -> Result<R, String>
    where
        F: FnOnce(&mut crate::models::DataStore) -> Result<R, String>,
    {
        let (result, revision, changed) = {
            let mut data = self.data.lock().unwrap();
            if local && !data.legacy_queue_imported {
                return Err("旧队列转换尚未完成".into());
            }
            let previous_revision = data.revision;
            let result = commit_data_candidate(
                &mut data,
                |candidate| {
                    let before = candidate.clone();
                    let result = f(candidate)?;
                    if *candidate != before {
                        candidate.revision += 1;
                    }
                    Ok(result)
                },
                crate::storage::save_data,
            )?;
            (result, data.revision, data.revision != previous_revision)
        };
        if changed {
            if let Err(error) = self.app.emit(outbox::DATA_CHANGED, revision) {
                eprintln!("[prism] 任务变更通知失败：{error}");
            }
        }
        Ok(result)
    }

    // ═══ 应用配置 ═══

    /// 读取配置的只读快照
    pub fn with_config<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&crate::models::ConfigStore) -> R,
    {
        let config = self.config.lock().unwrap();
        f(&config)
    }

    /// 通过候选配置修改并自动持久化，持久化成功后才提交内存状态。
    pub fn with_config_mut<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&mut crate::models::ConfigStore) -> R,
    {
        let mut config = self.config.lock().unwrap();
        let mut candidate = config.clone();
        let result = f(&mut candidate);
        crate::storage::save_config(&candidate)?;
        *config = candidate;
        Ok(result)
    }

    // ═══ 同步配置 ═══

    /// 读取同步状态的只读快照
    pub fn with_sync<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&crate::models::SyncStore) -> R,
    {
        let sync = self.sync.lock().unwrap();
        f(&sync)
    }

    /// 修改同步状态并自动持久化
    pub fn with_sync_mut<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&mut crate::models::SyncStore) -> R,
    {
        let mut sync = self.sync.lock().unwrap();
        let result = f(&mut sync);
        crate::storage::save_sync(&sync)?;
        Ok(result)
    }
}

fn commit_data_candidate<F, R, S>(
    data: &mut crate::models::DataStore,
    f: F,
    save: S,
) -> Result<R, String>
where
    F: FnOnce(&mut crate::models::DataStore) -> Result<R, String>,
    S: FnOnce(&crate::models::DataStore) -> Result<(), String>,
{
    let mut candidate = data.clone();
    let result = f(&mut candidate)?;
    if candidate == *data {
        return Ok(result);
    }
    save(&candidate)?;
    *data = candidate;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::commit_data_candidate;
    use crate::{tasks::outbox, tasks::service};

    #[test]
    fn candidate_write_keeps_memory_unchanged_when_save_fails() {
        let mut data = crate::models::default_data_store();
        let original_version = data.version;

        let error = commit_data_candidate(
            &mut data,
            |candidate| {
                candidate.version = 99;
                Ok(())
            },
            |_| Err("模拟保存失败".into()),
        )
        .expect_err("保存失败应阻止候选状态提交");

        assert_eq!(error, "模拟保存失败");
        assert_eq!(data.version, original_version);
    }

    #[test]
    fn candidate_write_commits_memory_after_save_succeeds() {
        let mut data = crate::models::default_data_store();

        commit_data_candidate(
            &mut data,
            |candidate| {
                candidate.version = 2;
                Ok(())
            },
            |_| Ok(()),
        )
        .expect("保存成功后应提交候选状态");

        assert_eq!(data.version, 2);
    }

    #[test]
    fn failed_common_commit_preserves_business_data_outbox_and_migration_marker() {
        let mut data = crate::models::default_data_store();
        let error = commit_data_candidate(
            &mut data,
            |candidate| {
                outbox::import_legacy(candidate, vec![])?;
                let before = candidate.clone();
                service::add(
                    candidate,
                    service::AddTaskInput {
                        title: "待保存任务".into(),
                        due_date: None,
                        tags: None,
                        important: None,
                        pinned: None,
                        is_daily: None,
                        parent_id: None,
                    },
                );
                outbox::enqueue_changes(&before, candidate, None, None);
                Ok(())
            },
            |_| Err("保存失败".into()),
        )
        .unwrap_err();
        assert_eq!(error, "保存失败");
        assert!(data.tasks.is_empty());
        assert!(data.outbox.is_empty());
        assert!(!data.legacy_queue_imported);
    }
}
