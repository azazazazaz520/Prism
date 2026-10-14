#[path = "../src/startup.rs"]
mod startup;

use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Manager;

struct SharedState;

#[test]
fn startup_keeps_webviews_absent_until_shared_state_is_registered() {
    let mut context = mock_context(noop_assets());
    *context.config_mut() = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let expected_windows = context.config().app.windows.len();
    let mut app = mock_builder()
        .setup(|app| {
            startup::create_initial_windows(app, |app| {
                assert!(
                    app.webview_windows().is_empty(),
                    "WebView 已启动，但 get_task_snapshot 所需的共享状态尚未注册"
                );
                app.manage(SharedState);
            })?;
            Ok(())
        })
        .build(context)
        .unwrap();
    #[allow(deprecated)]
    app.run_iteration(|_, _| {});
    assert!(app.try_state::<SharedState>().is_some());
    assert_eq!(app.webview_windows().len(), expected_windows);
    for label in ["main", "floating", "import", "selector"] {
        assert!(app.get_webview_window(label).is_some());
    }
}
