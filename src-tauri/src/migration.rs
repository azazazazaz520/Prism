use crate::models::*;
use crate::persistence::*;
use std::fs;

/// 检测旧 tasks.json 是否存在且 data.json 不存在（即需要迁移）
pub fn needs_migration() -> bool {
    get_legacy_path().exists() && !get_data_path().exists()
}

/// 将旧 tasks.json 拆分为 data.json + config.json，保留原文件为 .bak
pub fn migrate_legacy() -> Result<(), String> {
    let legacy_path = get_legacy_path();
    let content = fs::read_to_string(&legacy_path).map_err(|e| e.to_string())?;
    let legacy: LegacyStore =
        serde_json::from_str(&content).map_err(|e| format!("解析旧格式失败: {}", e))?;

    // 写入 data.json
    let data = DataStore {
        version: 1,
        tasks: legacy.tasks,
        daily_completions: legacy.daily_completions,
    };
    save_data(&data)?;

    // 写入 config.json
    let config = ConfigStore {
        vendors: legacy.vendors,
        active_vendor_id: legacy.active_vendor_id,
        theme: legacy.theme,
        reminder_minutes: legacy.reminder_minutes,
        module_enabled: std::collections::HashMap::new(),
        notes_dir: None,
    };
    save_config(&config)?;

    // 备份旧文件
    let bak_path = legacy_path.with_extension("json.bak");
    fs::rename(&legacy_path, &bak_path).map_err(|e| e.to_string())?;

    Ok(())
}
