// 仅在 Release 模式下隐藏 Windows 控制台窗口（桌面端）
#![cfg_attr(
    all(not(debug_assertions), not(target_os = "android")),
    windows_subsystem = "windows"
)]

fn main() {
    prism::run();
}
