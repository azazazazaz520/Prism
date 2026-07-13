// ═══════════════════════════════════════════════════════════════
//  单实例锁 — 防止多开导致热键/数据冲突
//
//  机制：启动时将 PID + 进程名写入 ~/.prism/.instance.lock，
//  再次启动时同时校验 PID 存活 且 进程名匹配。
//  任一条件不满足 → 判定为过期锁 → 覆盖。
//  主窗口关闭时自动清理锁文件。
//
//  锁文件格式：`<PID> <进程名>`  例: `29548 prism.exe`
//  旧格式兼容：仅 PID 时，用当前 exe 名去匹配运行中进程。
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

/// 获取当前可执行文件名（用于锁文件校验）。
/// 失败时回退到 "prism"，不阻塞启动。
fn current_exe_name() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
        .unwrap_or_else(|| "prism".to_string())
}

/// 检查指定 PID 的进程是否仍在运行（仅检查存活，不校验名称）。
///
/// 用于测试中的死进程探测。锁逻辑请用 `is_same_process`。
///
/// Windows: 调用 `tasklist /FI "PID eq N"`，解析输出判断进程是否存在。
/// Unix: 发送信号 0（不中断进程），根据返回值判断。
/// PID 0 在所有平台上都是系统保留值，直接返回 false。
#[allow(dead_code)]
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
        let pid_i32 = match i32::try_from(pid) {
            Ok(v) if v > 0 => v,
            _ => return false,
        };
        let res = unsafe { libc::kill(pid_i32, 0) };
        if res == 0 {
            return true;
        }
        match std::io::Error::last_os_error().raw_os_error() {
            Some(libc::ESRCH) => false,
            Some(libc::EPERM) => true,
            _ => false,
        }
    }
    #[cfg(all(not(windows), not(unix)))]
    {
        false
    }
}

/// 检查指定 PID 的进程是否存活 **且** 进程名匹配。
///
/// Windows: `tasklist /FI "PID eq N" /FO CSV /NH` 解析 CSV 第一列。
/// Unix: 读取 `/proc/PID/comm` 比对。
fn is_same_process(pid: u32, expected_name: &str) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
            .is_ok_and(|o| {
                let stdout = String::from_utf8_lossy(&o.stdout);
                // CSV 格式: "name.exe","PID","Session","Session#","Mem Usage"
                let name = stdout.split(',').next().unwrap_or("").trim_matches('"');
                name.eq_ignore_ascii_case(expected_name)
            })
    }
    #[cfg(unix)]
    {
        // /proc/PID/comm 仅包含进程名（不含路径），最多 15 字符
        if let Ok(name) = std::fs::read_to_string(format!("/proc/{}/comm", pid)) {
            return name.trim().eq_ignore_ascii_case(expected_name);
        }
        false
    }
    #[cfg(all(not(windows), not(unix)))]
    {
        false
    }
}

/// 在指定目录下尝试创建/验证单实例锁。
fn try_acquire_lock(lock_dir: &Path) -> Option<PathBuf> {
    let lock_path = lock_dir.join(".instance.lock");
    let current_pid = std::process::id();
    let exe_name = current_exe_name();

    if lock_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&lock_path) {
            // 新格式 "PID 进程名"，旧格式仅 "PID"
            let parts: Vec<&str> = content.trim().splitn(2, ' ').collect();
            let pid: u32 = parts.first().unwrap_or(&"0").parse().unwrap_or(0);
            let stored_name = parts.get(1).unwrap_or(&"");

            // 旧格式锁文件没有进程名 → 用当前 exe 名去匹配运行中进程
            let check_name = if stored_name.is_empty() {
                exe_name.as_str()
            } else {
                stored_name
            };

            if pid != 0 && is_same_process(pid, check_name) {
                show_instance_already_running();
                return None;
            }
        }
    }

    let lock_content = format!("{} {}", current_pid, exe_name);
    match std::fs::write(&lock_path, &lock_content) {
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
    fn find_dead_pid() -> u32 {
        let start = std::process::id().saturating_add(10_000);
        for pid in start..start.saturating_add(100_000) {
            if !is_pid_alive(pid) {
                return pid;
            }
        }
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
        // 新格式：包含 PID 和进程名
        let content = fs::read_to_string(&path).unwrap();
        let parts: Vec<&str> = content.splitn(2, ' ').collect();
        assert_eq!(parts.len(), 2, "新格式应包含 PID 和进程名");
        assert_eq!(parts[0], std::process::id().to_string());
        assert!(!parts[1].is_empty(), "进程名不应为空");
        release(&path);
    }

    #[test]
    fn active_lock_rejected() {
        let dir = temp_lock_dir();
        let my_pid = std::process::id();
        let exe_name = current_exe_name();
        // 写入新格式：PID + 进程名
        fs::write(
            dir.join(".instance.lock"),
            format!("{} {}", my_pid, exe_name),
        )
        .unwrap();
        let lock = try_acquire_lock(&dir);
        assert!(lock.is_none(), "检测到活跃实例时应返回 None");
    }

    #[test]
    fn stale_lock_overwritten() {
        let dir = temp_lock_dir();
        let dead_pid = find_dead_pid();
        // 用不存在的 PID + 当前进程名写入，PID 不存在所以应被视为过期
        fs::write(
            dir.join(".instance.lock"),
            format!("{} {}", dead_pid, current_exe_name()),
        )
        .unwrap();
        let lock = try_acquire_lock(&dir);
        assert!(lock.is_some(), "过期锁应被覆盖");
        let content = fs::read_to_string(dir.join(".instance.lock")).unwrap();
        assert!(content.starts_with(&std::process::id().to_string()));
        release(&dir.join(".instance.lock"));
    }

    #[test]
    fn pid_reused_by_different_process_treated_as_stale() {
        let dir = temp_lock_dir();
        // 模拟 PID 被其他进程复用：锁文件中是 svchost.exe 的 PID
        // 但进程名不匹配当前 exe，应视为过期
        // 注意：此测试依赖系统中有 PID 4 (System) 不是当前进程
        // PID 4 在 Windows 上几乎总是 System 进程
        fs::write(dir.join(".instance.lock"), "4 svchost.exe").unwrap();
        let lock = try_acquire_lock(&dir);
        assert!(lock.is_some(), "PID 存在但进程名不匹配应视为过期锁");
        release(&dir.join(".instance.lock"));
    }

    #[test]
    fn old_format_lock_with_wrong_process_treated_as_stale() {
        let dir = temp_lock_dir();
        // 模拟旧格式锁文件（仅 PID），且该 PID 不属于当前进程
        // PID 4 在 Windows 上几乎总是 System 进程，不是当前 exe
        fs::write(dir.join(".instance.lock"), "4").unwrap();
        let lock = try_acquire_lock(&dir);
        assert!(lock.is_some(), "旧格式锁 + PID 不属于当前进程 → 应视为过期");
        release(&dir.join(".instance.lock"));
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
        fs::write(&lock_path, format!("{} {}", 12345, "test.exe")).unwrap();
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
        assert!(!is_pid_alive(0));
        let dead = find_dead_pid();
        assert!(!is_pid_alive(dead));
    }

    #[test]
    fn is_same_process_detects_self() {
        let my_pid = std::process::id();
        let exe_name = current_exe_name();
        assert!(
            is_same_process(my_pid, &exe_name),
            "当前进程应匹配自身 exe 名"
        );
    }

    #[test]
    fn is_same_process_rejects_wrong_name() {
        // PID 4 在 Windows 上几乎总是 System、svchost 或类似系统进程
        // 不可能是当前测试进程名
        assert!(
            !is_same_process(4, current_exe_name().as_str()),
            "系统 PID 4 不应匹配当前测试 exe 名"
        );
    }

    #[test]
    fn is_same_process_rejects_dead_pid() {
        let dead = find_dead_pid();
        assert!(
            !is_same_process(dead, "any-name.exe"),
            "不存在的 PID 应返回 false"
        );
    }
}
