use tauri::{App, Runtime, WebviewWindowBuilder};

/// 初始化共享状态后，按配置创建启动窗口。
pub fn create_initial_windows<R: Runtime>(
    app: &App<R>,
    initialize: impl FnOnce(&App<R>),
) -> tauri::Result<()> {
    initialize(app);
    for config in &app.config().app.windows {
        if !config.create {
            WebviewWindowBuilder::from_config(app.handle(), config)?.build()?;
        }
    }
    Ok(())
}
