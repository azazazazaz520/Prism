// ═══════════════════════════════════════════════════════════════
//  单实例锁 — 防止多开导致热键/数据冲突
//
//  机制：启动时将当前 PID 写入 ~/.prism/.instance.lock，
//  再次启动时检查锁文件中 PID 是否仍在运行。
//  活跃 → 拒绝启动；已死/损坏 → 覆盖旧锁；无锁 → 新建。
//  主窗口关闭时自动清理锁文件。
// ═══════════════════════════════════════════════════════════════

use std::path::{Path, PathBuf};

/// 在工作区目录下获取单实例锁。
///
/// 返回 Some(lock_path) 表示获取锁成功（可以安全启动），
/// 返回 None 表示已有活跃实例在运行。
pub fn acquire() -> Option<PathBuf> {
    try_acquire_lock(&crate::persistence::get_workspace_dir())
}

/// 退出时清理实例锁文件，允许下次正常启动。
pub fn release(lock_path: &Path) {
    let _ = std::fs::remove_file(lock_path);
}

// ═══════════════════════════════════════════════════════════════
//  内部实现
// ═══════════════════════════════════════════════════════════════

/// 检查指定 PID 的进程是否仍在运行。
///
/// Windows: 调用 `tasklist /FI "PID eq N"`，解析输出判断进程是否存在。
/// Unix: 发送信号 0（不中断进程），根据返回值判断。
/// PID 0 在所有平台上都是系统保留值，直接返回 false。
fn is_pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid)])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
            .is_ok_and(|o| {
                let stdout = String::from_utf8_lossy(&o.stdout);
                !stdout.contains("No tasks") && stdout.contains(&pid.to_string())
            })
    }
    #[cfg(unix)]
    {
        // 将 u32 PID 转为 libc::pid_t（i32），无效值保守返回 false
        let pid_i32 = match i32::try_from(pid) {
            Ok(v) if v > 0 => v,
            _ => return false,
        };
        // 发送信号 0 探测进程是否存在
        let res = unsafe { libc::kill(pid_i32, 0) };
        if res == 0 {
            return true; // 进程存在且有权访问
        }
        // errno 区分：ESRCH=进程不存在，EPERM=存在但无权限，其他保守返回 false
        match std::io::Error::last_os_error().raw_os_error() {
            Some(libc::ESRCH) => false,
            Some(libc::EPERM) => true,
            _ => false,
        }
    }
    #[cfg(all(not(windows), not(unix)))]
    {
        // 非 Windows 非 Unix 平台：回退到默认 false
        false
    }
}

/// 在指定目录下尝试创建/验证单实例锁。
fn try_acquire_lock(lock_dir: &Path) -> Option<PathBuf> {
    let lock_path = lock_dir.join(".instance.lock");
    let current_pid = std::process::id();

    if lock_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&lock_path) {
            let pid: u32 = content.trim().parse().unwrap_or(0);
            if pid != 0 && is_pid_alive(pid) {
                show_instance_already_running();
                return None;
            }
        }
    }

    match std::fs::write(&lock_path, current_pid.to_string()) {
        Ok(_) => Some(lock_path),
        Err(e) => {
            eprintln!("[warn] 无法写入实例锁文件 {}: {e}", lock_path.display());
            None
        }
    }
}

/// 弹窗告知用户已有实例在运行。
fn show_instance_already_running() {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("msg")
            .args(["*", "Prism 已在运行中，请检查系统托盘或任务栏。"])
            .creation_flags(0x08000000)
            .spawn();
    }
    #[cfg(not(windows))]
    {
        eprintln!("Prism 已在运行中");
    }
}

// ═══════════════════════════════════════════════════════════════
//  测试
// ═══════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU32, Ordering};

    static TEST_COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_lock_dir() -> PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let unique = format!("test_{}_{:?}", id, std::thread::current().id());
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test_lock")
            .join(unique);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("创建测试临时目录失败");
        dir
    }

    /// 找到一个确定不存在的 PID，用于测试死进程检测。
    /// 从当前 PID + 10000 开始探测，最多尝试 100000 个 PID。
    fn find_dead_pid() -> u32 {
        let start = std::process::id().saturating_add(10_000);
        for pid in start..start.saturating_add(100_000) {
            if !is_pid_alive(pid) {
                return pid;
            }
        }
        // 极度不可能走到这里，但仍是比 u32::MAX 更安全的回退
        1
    }

    // ── acquire / release 流程测试 ──

    #[test]
    fn first_lock_succeeds() {
        let dir = temp_lock_dir();
        let lock = try_acquire_lock(&dir);
        assert!(lock.is_some(), "首次获取锁应成功");
        let path = lock.unwrap();
        assert!(path.exists(), "锁文件应被创建");
        assert_eq!(path, dir.join(".instance.lock"));
        release(&path);
    }

    #[test]
    fn active_lock_rejected() {
        let dir = temp_lock_dir();
        let my_pid = std::process::id();
        fs::write(dir.join(".instance.lock"), my_pid.to_string()).unwrap();
        let lock = try_acquire_lock(&dir);
        assert!(lock.is_none(), "检测到活跃实例时应返回 None");
    }

    #[test]
    fn stale_lock_overwritten() {
        let dir = temp_lock_dir();
        let dead_pid = find_dead_pid();
        fs::write(dir.join(".instance.lock"), dead_pid.to_string()).unwrap();
        let lock = try_acquire_lock(&dir);
        assert!(lock.is_some(), "过期锁应被覆盖");
        let content = fs::read_to_string(dir.join(".instance.lock")).unwrap();
        assert_eq!(content.trim(), std::process::id().to_string());
        release(&dir.join(".instance.lock"));
    }

    #[test]
    fn nonexistent_pid_treated_as_stale() {
        let dir = temp_lock_dir();
        let dead_pid = find_dead_pid();
        fs::write(dir.join(".instance.lock"), dead_pid.to_string()).unwrap();
        let lock = try_acquire_lock(&dir);
        assert!(lock.is_some(), "不存在进程的锁应被视为过期");
    }

    #[test]
    fn corrupted_lock_file_treated_as_stale() {
        let dir = temp_lock_dir();
        fs::write(dir.join(".instance.lock"), "not-a-pid").unwrap();
        let lock = try_acquire_lock(&dir);
        assert!(lock.is_some(), "损坏的锁文件应被覆盖");
    }

    #[test]
    fn release_lock_removes_file() {
        let dir = temp_lock_dir();
        let lock_path = dir.join(".instance.lock");
        fs::write(&lock_path, "12345").unwrap();
        assert!(lock_path.exists());
        release(&lock_path);
        assert!(!lock_path.exists());
    }

    #[test]
    fn is_pid_alive_detects_self() {
        assert!(is_pid_alive(std::process::id()));
    }

    #[test]
    fn is_pid_alive_detects_dead() {
        // PID 0 在所有平台都是系统保留值
        assert!(!is_pid_alive(0));
        // 探测一个确定不存在的 PID，避免 u32::MAX 在 Linux 上的可移植性问题
        let dead = find_dead_pid();
        assert!(!is_pid_alive(dead));
    }
}
