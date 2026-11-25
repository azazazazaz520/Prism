//! 系统凭据库中的敏感数据：AI 供应商 API 密钥与同步码。
//!
//! 配置文件与同步状态文件不保存密钥，密钥由系统凭据库保存。旧版本的明文字段在启动时迁移：
//! 迁移成功的条目从内存与文件中移除；迁移失败的条目保留明文，并在下次启动时重试。

use crate::logging::{LogLevel, LogWriter};
use crate::models::{ConfigStore, SyncStore, Vendor};
use serde_json::json;

const SERVICE: &str = "com.prism.app";
const SYNC_CODE_ACCOUNT: &str = "sync-code";

/// 敏感数据的存取接口。生产环境使用系统凭据库，测试使用内存实现。
pub trait SecretStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}

/// 基于操作系统凭据库（Windows 为凭据管理器）的存储实现。
pub struct SystemSecretStore;

impl SecretStore for SystemSecretStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        entry(account)?.set_password(secret).map_err(describe)
    }

    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(describe(error)),
        }
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(describe(error)),
        }
    }
}

fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, account).map_err(describe)
}

fn describe(error: keyring::Error) -> String {
    format!("凭据管理器操作失败：{error}")
}

fn vendor_account(vendor_id: &str) -> String {
    format!("vendor:{vendor_id}")
}

fn normalized(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

/// 读取供应商密钥；凭据库没有记录时回退到尚未迁移的旧明文。
pub fn vendor_api_key(store: &dyn SecretStore, vendor: &Vendor) -> Result<Option<String>, String> {
    Ok(store
        .get(&vendor_account(&vendor.fields.id))?
        .or_else(|| vendor.legacy_api_key.clone()))
}

/// 保存供应商密钥。空值表示保持原有密钥不变；返回是否写入了新密钥。
pub fn save_vendor_api_key(
    store: &dyn SecretStore,
    vendor_id: &str,
    api_key: Option<&str>,
) -> Result<bool, String> {
    match normalized(api_key) {
        Some(key) => {
            store.set(&vendor_account(vendor_id), key)?;
            Ok(true)
        }
        None => Ok(false),
    }
}

/// 删除供应商密钥；凭据不存在时视为成功。
pub fn delete_vendor_api_key(store: &dyn SecretStore, vendor_id: &str) -> Result<(), String> {
    store.delete(&vendor_account(vendor_id))
}

/// 读取同步码；凭据库没有记录时回退到尚未迁移的旧明文。
pub fn sync_code(store: &dyn SecretStore, sync: &SyncStore) -> Result<Option<String>, String> {
    Ok(store
        .get(SYNC_CODE_ACCOUNT)?
        .or_else(|| sync.legacy_sync_code.clone()))
}

/// 保存同步码。空值表示保持原有同步码不变；返回是否写入了新同步码。
pub fn save_sync_code(store: &dyn SecretStore, sync_code: Option<&str>) -> Result<bool, String> {
    match normalized(sync_code) {
        Some(code) => {
            store.set(SYNC_CODE_ACCOUNT, code)?;
            Ok(true)
        }
        None => Ok(false),
    }
}

/// 迁移结果，标记内存中的配置或同步状态是否已清除明文字段。
#[derive(Debug, Default, PartialEq)]
pub struct MigrationOutcome {
    pub config_changed: bool,
    pub sync_changed: bool,
}

/// 启动时执行迁移，并保存发生变化的配置或同步状态。
pub fn migrate_startup_secrets(config: &mut ConfigStore, sync: &mut SyncStore, logger: &LogWriter) {
    let outcome = migrate_plaintext(config, sync, &SystemSecretStore, logger);
    if outcome.config_changed {
        if let Err(error) = crate::storage::save_config(config) {
            record_failure(logger, "config", &error);
        }
    }
    if outcome.sync_changed {
        if let Err(error) = crate::storage::save_sync(sync) {
            record_failure(logger, "sync", &error);
        }
    }
}

fn migrate_plaintext(
    config: &mut ConfigStore,
    sync: &mut SyncStore,
    store: &dyn SecretStore,
    logger: &LogWriter,
) -> MigrationOutcome {
    let mut outcome = MigrationOutcome::default();

    for vendor in config.vendors.iter_mut() {
        let Some(legacy) = vendor.legacy_api_key.clone() else {
            continue;
        };
        let target = format!("vendor:{}", vendor.fields.id);
        match migrate_secret(store, &vendor_account(&vendor.fields.id), &legacy) {
            Ok(()) => {
                vendor.legacy_api_key = None;
                outcome.config_changed = true;
                record_success(logger, &target);
            }
            Err(error) => record_failure(logger, &target, &error),
        }
    }

    if let Some(legacy) = sync.legacy_sync_code.clone() {
        match migrate_secret(store, SYNC_CODE_ACCOUNT, &legacy) {
            Ok(()) => {
                sync.legacy_sync_code = None;
                outcome.sync_changed = true;
                record_success(logger, "sync_code");
            }
            Err(error) => record_failure(logger, "sync_code", &error),
        }
    }

    outcome
}

/// 写入并回读校验一条旧明文；空白明文直接视为已迁移，不写入凭据库。
fn migrate_secret(store: &dyn SecretStore, account: &str, legacy: &str) -> Result<(), String> {
    let Some(secret) = normalized(Some(legacy)) else {
        return Ok(());
    };
    store.set(account, secret)?;
    if store.get(account)?.as_deref() != Some(secret) {
        return Err("凭据写入后校验失败".into());
    }
    Ok(())
}

fn record_success(logger: &LogWriter, target: &str) {
    let _ = logger.append_internal(
        LogLevel::Info,
        "secrets",
        "secrets.migrated",
        "旧版敏感数据已迁移到系统凭据库",
        json!({ "target": target }),
    );
}

fn record_failure(logger: &LogWriter, target: &str, error: &str) {
    let _ = logger.append_internal(
        LogLevel::Error,
        "secrets",
        "secrets.migration_failed",
        "旧版敏感数据迁移失败，已保留原数据并将在下次启动时重试",
        json!({ "target": target, "error": error }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{default_config_store, default_sync_store, VendorFields};
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryStore {
        items: Mutex<HashMap<String, String>>,
        fail_set: bool,
    }

    impl SecretStore for MemoryStore {
        fn set(&self, account: &str, secret: &str) -> Result<(), String> {
            if self.fail_set {
                return Err("写入失败".into());
            }
            self.items
                .lock()
                .unwrap()
                .insert(account.to_string(), secret.to_string());
            Ok(())
        }

        fn get(&self, account: &str) -> Result<Option<String>, String> {
            Ok(self.items.lock().unwrap().get(account).cloned())
        }

        fn delete(&self, account: &str) -> Result<(), String> {
            self.items.lock().unwrap().remove(account);
            Ok(())
        }
    }

    fn legacy_vendor(id: &str, key: &str) -> Vendor {
        Vendor {
            fields: VendorFields {
                id: id.into(),
                name: "测试".into(),
                provider: "openai".into(),
                base_url: "https://example.com".into(),
                api_path: "/chat/completions".into(),
                model: "model".into(),
                enabled: true,
                is_default: false,
            },
            legacy_api_key: Some(key.into()),
        }
    }

    #[test]
    fn migration_moves_plaintext_into_store_and_removes_it_from_serialized_state() {
        let mut config = default_config_store();
        config.vendors.push(legacy_vendor("v1", "sk-old"));
        let mut sync = default_sync_store();
        sync.legacy_sync_code = Some("ABC123".into());
        let store = MemoryStore::default();

        let outcome = migrate_plaintext(&mut config, &mut sync, &store, &LogWriter::disabled());

        assert_eq!(
            outcome,
            MigrationOutcome {
                config_changed: true,
                sync_changed: true
            }
        );
        assert_eq!(store.get("vendor:v1").unwrap().as_deref(), Some("sk-old"));
        assert_eq!(
            store.get(SYNC_CODE_ACCOUNT).unwrap().as_deref(),
            Some("ABC123")
        );
        assert!(!serde_json::to_string(&config).unwrap().contains("sk-old"));
        assert!(!serde_json::to_string(&sync).unwrap().contains("ABC123"));
    }

    #[test]
    fn failed_migration_keeps_plaintext_for_next_attempt() {
        let mut config = default_config_store();
        config.vendors.push(legacy_vendor("v1", "sk-old"));
        let mut sync = default_sync_store();
        let store = MemoryStore {
            fail_set: true,
            ..Default::default()
        };

        let outcome = migrate_plaintext(&mut config, &mut sync, &store, &LogWriter::disabled());

        assert_eq!(outcome, MigrationOutcome::default());
        assert!(serde_json::to_string(&config).unwrap().contains("sk-old"));
    }

    #[test]
    fn migration_without_plaintext_changes_nothing() {
        let mut config = default_config_store();
        let mut sync = default_sync_store();
        let store = MemoryStore::default();

        let outcome = migrate_plaintext(&mut config, &mut sync, &store, &LogWriter::disabled());

        assert_eq!(outcome, MigrationOutcome::default());
        assert!(store.items.lock().unwrap().is_empty());
    }

    #[test]
    fn empty_vendor_key_keeps_stored_secret() {
        let store = MemoryStore::default();
        store.set("vendor:v1", "sk-1").unwrap();

        assert!(!save_vendor_api_key(&store, "v1", None).unwrap());
        assert!(!save_vendor_api_key(&store, "v1", Some("  ")).unwrap());
        assert_eq!(store.get("vendor:v1").unwrap().as_deref(), Some("sk-1"));

        assert!(save_vendor_api_key(&store, "v1", Some(" sk-2 ")).unwrap());
        assert_eq!(store.get("vendor:v1").unwrap().as_deref(), Some("sk-2"));
    }

    #[test]
    fn vendor_key_falls_back_to_unmigrated_plaintext() {
        let store = MemoryStore::default();
        let vendor = legacy_vendor("v1", "sk-old");

        assert_eq!(
            vendor_api_key(&store, &vendor).unwrap().as_deref(),
            Some("sk-old")
        );
    }
}
