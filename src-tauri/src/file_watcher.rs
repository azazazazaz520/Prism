// ═══════════════════════════════════════════════════════════════
//  文件系统监听 — 实时监测笔记目录的增删改
//
//  使用 notify crate 监听笔记目录的文件变更，
//  通过 Tauri 事件 "notes://file-changed" 通知前端。
// ═══════════════════════════════════════════════════════════════

use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::mpsc;
use tauri::{AppHandle, Emitter};

/// 文件变更事件，发送到前端
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    /// "create" | "modify" | "remove"
    pub kind: String,
    /// 相对于笔记目录的文件路径
    pub path: String,
}

/// 文件监听器句柄，drop 时自动停止监听
pub struct FileWatcher {
    shutdown_tx: Option<mpsc::Sender<()>>,
}

impl FileWatcher {
    /// 启动文件系统监听。
    ///
    /// 在独立线程中运行，监测 `notes_dir` 下所有 .md 文件的
    /// 创建、修改（仅内容变更）和删除事件，通过 Tauri 事件发送到前端。
    pub fn start(app_handle: AppHandle, notes_dir: PathBuf) -> Self {
        let (shutdown_tx, shutdown_rx) = mpsc::channel();
        let (event_tx, event_rx) = mpsc::channel::<Result<Event, notify::Error>>();

        let watcher_result = notify::recommended_watcher(move |res| {
            let _ = event_tx.send(res);
        });

        let mut watcher = match watcher_result {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[prism] 文件监听器创建失败: {}", e);
                return Self { shutdown_tx: None };
            }
        };

        if let Err(e) = watcher.watch(&notes_dir, RecursiveMode::Recursive) {
            eprintln!("[prism] 文件监听启动失败: {}", e);
            return Self { shutdown_tx: None };
        }

        std::thread::spawn(move || {
            // watcher 必须在此线程内保持存活
            let _watcher = watcher;
            let dir_prefix = notes_dir.to_string_lossy().replace('\\', "/");

            loop {
                match event_rx.recv_timeout(std::time::Duration::from_millis(500)) {
                    Ok(Ok(event)) => {
                        for path in &event.paths {
                            let abs = path.to_string_lossy().replace('\\', "/");

                            // 只处理 .md 文件
                            if !abs.ends_with(".md") {
                                continue;
                            }

                            // 只关心内容修改，忽略元数据修改
                            let kind = match &event.kind {
                                EventKind::Create(_) => "create",
                                EventKind::Modify(k) => {
                                    use notify::event::ModifyKind;
                                    match k {
                                        ModifyKind::Data(_) => "modify",
                                        _ => continue,
                                    }
                                }
                                EventKind::Remove(_) => "remove",
                                _ => continue,
                            };

                            // 计算相对路径
                            let rel = abs
                                .strip_prefix(&dir_prefix)
                                .and_then(|s| s.strip_prefix('/'))
                                .unwrap_or(&abs);

                            let _ = app_handle.emit(
                                "notes://file-changed",
                                FileChangeEvent {
                                    kind: kind.to_string(),
                                    path: rel.to_string(),
                                },
                            );
                        }
                    }
                    Ok(Err(_)) => {}
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        // 检查关闭信号
                        if shutdown_rx.try_recv().is_ok() {
                            break;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        Self {
            shutdown_tx: Some(shutdown_tx),
        }
    }
}

impl Drop for FileWatcher {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}
