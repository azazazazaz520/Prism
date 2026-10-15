// 仅在 Release 模式下隐藏 Windows 控制台窗口（桌面端）
#![cfg_attr(
    all(not(debug_assertions), not(target_os = "android")),
    windows_subsystem = "windows"
)]

pub(crate) mod ai;
mod app;
mod commands;
pub(crate) mod logging;
pub(crate) mod models;
pub(crate) mod notes;
pub(crate) mod pdf_to_word;
pub(crate) mod plugins;
pub(crate) mod screenshot;
pub(crate) mod storage;
pub(crate) mod tasks;
pub(crate) mod update;

pub use app::run;
pub use app::state::AppState;
