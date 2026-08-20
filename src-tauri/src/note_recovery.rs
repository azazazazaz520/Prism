use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::note_service;
use crate::persistence;

pub(crate) const RECOVERY_CONFLICT: &str = "NOTE_RECOVERY_CONFLICT";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRecoverySnapshot {
    pub id: String,
    pub workspace_path: String,
    pub note_path: String,
    pub content: String,
    pub generation: u64,
    pub document_mtime: Option<String>,
    pub created_at: String,
    pub reason: String,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRecoverySummary {
    pub id: String,
    pub workspace_path: String,
    pub note_path: String,
    pub generation: u64,
    pub document_mtime: Option<String>,
    pub created_at: String,
    pub reason: String,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRecoveryRestoreResult {
    pub mtime: String,
    pub snapshot_deleted: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct RecoveryIndex {
    snapshot_ids: Vec<String>,
}

struct RecoveryStore {
    root: PathBuf,
}

impl RecoveryStore {
    fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn snapshots_dir(&self) -> PathBuf {
        self.root.join("snapshots")
    }

    fn index_path(&self) -> PathBuf {
        self.root.join("index.json")
    }

    fn ensure_dirs(&self) -> Result<(), String> {
        fs::create_dir_all(self.snapshots_dir()).map_err(|e| format!("创建恢复目录失败: {e}"))
    }

    fn snapshot_path(&self, id: &str) -> Result<PathBuf, String> {
        if id.is_empty()
            || !id
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-')
        {
            return Err("恢复快照 ID 无效".into());
        }
        Ok(self.snapshots_dir().join(format!("{id}.json")))
    }

    fn save_snapshot(&self, snapshot: &NoteRecoverySnapshot) -> Result<(), String> {
        self.ensure_dirs()?;
        let path = self.snapshot_path(&snapshot.id)?;
        let content = serde_json::to_string_pretty(snapshot).map_err(|e| e.to_string())?;
        atomic_write(&path, content.as_bytes())?;
        self.rebuild_index()
    }

    fn read_snapshot(&self, id: &str) -> Result<NoteRecoverySnapshot, String> {
        let path = self.snapshot_path(id)?;
        let content = fs::read_to_string(&path).map_err(|e| format!("读取恢复快照失败: {e}"))?;
        serde_json::from_str(&content).map_err(|e| format!("解析恢复快照失败: {e}"))
    }

    fn list_snapshots(&self) -> Result<Vec<NoteRecoverySnapshot>, String> {
        self.ensure_dirs()?;
        let mut snapshots = Vec::new();
        let entries =
            fs::read_dir(self.snapshots_dir()).map_err(|e| format!("读取恢复目录失败: {e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("读取恢复目录项失败: {e}"))?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let content = match fs::read_to_string(&path) {
                Ok(content) => content,
                Err(_) => continue,
            };
            if let Ok(snapshot) = serde_json::from_str::<NoteRecoverySnapshot>(&content) {
                snapshots.push(snapshot);
            }
        }
        snapshots.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        Ok(snapshots)
    }

    fn rebuild_index(&self) -> Result<(), String> {
        self.ensure_dirs()?;
        let mut ids = self
            .list_snapshots()?
            .into_iter()
            .map(|snapshot| snapshot.id)
            .collect::<Vec<_>>();
        ids.sort();
        let content = serde_json::to_string_pretty(&RecoveryIndex { snapshot_ids: ids })
            .map_err(|e| e.to_string())?;
        atomic_write(&self.index_path(), content.as_bytes())
    }

    fn delete_snapshot(&self, id: &str) -> Result<(), String> {
        let path = self.snapshot_path(id)?;
        match fs::remove_file(path) {
            Ok(()) => self.rebuild_index(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => self.rebuild_index(),
            Err(error) => Err(format!("删除恢复快照失败: {error}")),
        }
    }

    fn restore_snapshot(
        &self,
        id: &str,
        current_workspace: &Path,
    ) -> Result<NoteRecoveryRestoreResult, String> {
        let snapshot = self.read_snapshot(id)?;
        let current_workspace = current_workspace
            .canonicalize()
            .map_err(|e| format!("当前笔记目录解析失败: {e}"))?;
        let snapshot_workspace = PathBuf::from(&snapshot.workspace_path)
            .canonicalize()
            .map_err(|e| format!("恢复快照工作区不存在: {e}"))?;
        if current_workspace != snapshot_workspace {
            return Err("恢复快照不属于当前笔记工作区".into());
        }

        let target = note_service::resolve_note_path(&current_workspace, &snapshot.note_path)?;
        let current_mtime = file_mtime(&target)?;
        match (&snapshot.document_mtime, &current_mtime) {
            (Some(expected), Some(current)) if expected != current => {
                return Err(RECOVERY_CONFLICT.into())
            }
            (None, Some(_)) => return Err(RECOVERY_CONFLICT.into()),
            _ => {}
        }

        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建恢复目标目录失败: {e}"))?;
        }
        // 文件已被删除时，用户明确点击恢复即表示允许按快照重新创建，不能再把
        // 原文件的 mtime 作为写入前提；文件仍存在时继续执行版本保护。
        let expected_mtime_for_write = current_mtime
            .as_ref()
            .and(snapshot.document_mtime.as_ref())
            .cloned();
        let restored_mtime = note_service::write_note_content(
            &current_workspace,
            &snapshot.note_path,
            &snapshot.content,
            expected_mtime_for_write,
        )?;
        let actual_content =
            note_service::read_note_content(&current_workspace, &snapshot.note_path)?;
        if actual_content != snapshot.content {
            return Err("恢复后内容校验失败".into());
        }

        let snapshot_deleted = self
            .snapshot_path(id)
            .map(|path| match fs::remove_file(path) {
                Ok(()) => true,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
                Err(_) => false,
            })
            .unwrap_or(false);
        let _ = self.rebuild_index();

        Ok(NoteRecoveryRestoreResult {
            mtime: restored_mtime,
            snapshot_deleted,
        })
    }
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建恢复父目录失败: {e}"))?;
    }
    let temporary = path.with_file_name(format!(
        ".{}.prism-{}.tmp",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("recovery"),
        uuid::Uuid::new_v4().simple()
    ));
    let result = (|| -> Result<(), String> {
        let mut file =
            fs::File::create_new(&temporary).map_err(|e| format!("创建恢复临时文件失败: {e}"))?;
        file.write_all(content)
            .map_err(|e| format!("写入恢复临时文件失败: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("刷新恢复临时文件失败: {e}"))?;
        replace_file(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn replace_file(temporary: &Path, target: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_COPY_ALLOWED, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };

        let temporary: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
        let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            MoveFileExW(
                PCWSTR(temporary.as_ptr()),
                PCWSTR(target.as_ptr()),
                MOVEFILE_COPY_ALLOWED | MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        }
        .map_err(|error| format!("替换恢复文件失败: {error}"))?;
        Ok(())
    }

    #[cfg(not(windows))]
    {
        fs::rename(temporary, target).map_err(|error| format!("替换恢复文件失败: {error}"))
    }
}

fn file_mtime(path: &Path) -> Result<Option<String>, String> {
    match fs::metadata(path) {
        Ok(metadata) => {
            let modified = metadata
                .modified()
                .map_err(|e| format!("读取恢复目标修改时间失败: {e}"))?;
            let nanos = modified
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            Ok(Some(nanos.to_string()))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("读取恢复目标元信息失败: {error}")),
    }
}

fn store() -> RecoveryStore {
    RecoveryStore::new(persistence::get_workspace_dir().join("recovery"))
}

pub fn save(
    workspace_path: &Path,
    note_path: String,
    content: String,
    generation: u64,
    document_mtime: Option<String>,
    reason: String,
    error_message: Option<String>,
) -> Result<NoteRecoverySummary, String> {
    let workspace_path = workspace_path
        .canonicalize()
        .map_err(|e| format!("笔记目录解析失败: {e}"))?;
    note_service::resolve_note_path(&workspace_path, &note_path)?;
    let snapshot = NoteRecoverySnapshot {
        id: uuid::Uuid::new_v4().simple().to_string(),
        workspace_path: workspace_path.to_string_lossy().to_string(),
        note_path,
        content,
        generation,
        document_mtime,
        created_at: Utc::now().to_rfc3339(),
        reason,
        error_message,
    };
    let summary = summary(&snapshot);
    store().save_snapshot(&snapshot)?;
    Ok(summary)
}

pub fn list() -> Result<Vec<NoteRecoverySummary>, String> {
    let snapshots = store().list_snapshots()?;
    Ok(snapshots.iter().map(summary).collect())
}

pub fn read(id: &str) -> Result<NoteRecoverySnapshot, String> {
    store().read_snapshot(id)
}

pub fn delete(id: &str) -> Result<(), String> {
    store().delete_snapshot(id)
}

pub fn restore(id: &str, current_workspace: &Path) -> Result<NoteRecoveryRestoreResult, String> {
    store().restore_snapshot(id, current_workspace)
}

fn summary(snapshot: &NoteRecoverySnapshot) -> NoteRecoverySummary {
    NoteRecoverySummary {
        id: snapshot.id.clone(),
        workspace_path: snapshot.workspace_path.clone(),
        note_path: snapshot.note_path.clone(),
        generation: snapshot.generation,
        document_mtime: snapshot.document_mtime.clone(),
        created_at: snapshot.created_at.clone(),
        reason: snapshot.reason.clone(),
        error_message: snapshot.error_message.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_store() -> (RecoveryStore, PathBuf) {
        let root = std::env::temp_dir().join(format!("prism-recovery-{}", uuid::Uuid::new_v4()));
        let store = RecoveryStore::new(root.join("recovery"));
        (store, root)
    }

    fn snapshot(id: &str) -> NoteRecoverySnapshot {
        NoteRecoverySnapshot {
            id: id.to_string(),
            workspace_path: "C:\\notes".to_string(),
            note_path: "draft.md".to_string(),
            content: "本地内容".to_string(),
            generation: 2,
            document_mtime: None,
            created_at: "2026-08-20T00:00:00Z".to_string(),
            reason: "save-failed".to_string(),
            error_message: Some("写入失败".to_string()),
        }
    }

    fn workspace_snapshot(id: &str, workspace: &Path, note_path: &str) -> NoteRecoverySnapshot {
        NoteRecoverySnapshot {
            id: id.to_string(),
            workspace_path: workspace
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            note_path: note_path.to_string(),
            content: "恢复后的正文".to_string(),
            generation: 9,
            document_mtime: None,
            created_at: "2026-08-20T00:00:00Z".to_string(),
            reason: "save-failed".to_string(),
            error_message: None,
        }
    }

    #[test]
    fn atomic_write_leaves_no_temporary_file_and_rebuilds_index() {
        let (store, root) = temp_store();
        store.save_snapshot(&snapshot("snap-1")).unwrap();

        assert_eq!(store.list_snapshots().unwrap().len(), 1);
        assert!(store.index_path().exists());
        let temporary_count = fs::read_dir(store.snapshots_dir())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".prism-"))
            .count();
        assert_eq!(temporary_count, 0);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_snapshot_id_cannot_escape_snapshot_directory() {
        let (store, root) = temp_store();
        fs::create_dir_all(store.snapshots_dir()).unwrap();
        assert!(store.snapshot_path("../escape").is_err());
        assert!(store.snapshot_path("snapshot/other").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_read_delete_and_repeated_delete_are_safe() {
        let (store, root) = temp_store();
        store.save_snapshot(&snapshot("snap-2")).unwrap();

        assert_eq!(store.list_snapshots().unwrap()[0].id, "snap-2");
        assert_eq!(store.read_snapshot("snap-2").unwrap().content, "本地内容");
        store.delete_snapshot("snap-2").unwrap();
        store.delete_snapshot("snap-2").unwrap();
        assert!(store.list_snapshots().unwrap().is_empty());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restore_recreates_deleted_note_and_removes_snapshot_after_verification() {
        let (store, root) = temp_store();
        let workspace = root.join("notes");
        fs::create_dir_all(&workspace).unwrap();
        let mut snapshot = workspace_snapshot("snap-restore", &workspace, "draft.md");
        snapshot.document_mtime = Some("mtime-before-delete".to_string());
        store.save_snapshot(&snapshot).unwrap();

        let result = store.restore_snapshot("snap-restore", &workspace).unwrap();
        assert!(result.snapshot_deleted);
        assert_eq!(
            fs::read_to_string(workspace.join("draft.md")).unwrap(),
            "恢复后的正文"
        );
        assert!(store.read_snapshot("snap-restore").is_err());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restore_rejects_mtime_conflict_without_overwriting_current_note() {
        let (store, root) = temp_store();
        let workspace = root.join("notes");
        fs::create_dir_all(&workspace).unwrap();
        let note = workspace.join("draft.md");
        fs::write(&note, "外部版本").unwrap();
        let mut snapshot = workspace_snapshot("snap-conflict", &workspace, "draft.md");
        snapshot.document_mtime = Some("mtime-before-external-change".to_string());
        store.save_snapshot(&snapshot).unwrap();

        assert!(matches!(
            store.restore_snapshot("snap-conflict", &workspace),
            Err(error) if error == RECOVERY_CONFLICT
        ));
        assert_eq!(fs::read_to_string(note).unwrap(), "外部版本");

        fs::remove_dir_all(root).unwrap();
    }
}
