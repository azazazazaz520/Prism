use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use crate::note_service;
use crate::store;
use crate::AppState;

const PANDOC_TIMEOUT: Duration = Duration::from_secs(60);
const PANDOC_VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_PANDOC_ERROR_LENGTH: usize = 4000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocxOptions {
    pub note_path: String,
    pub output_path: String,
    #[serde(default)]
    pub reference_doc: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ExportDocxResult {
    pub output_path: String,
    pub pandoc_version: String,
}

/// 使用 Pandoc 将当前笔记导出为 Word 文档。
#[tauri::command]
pub async fn export_note_to_docx(
    options: ExportDocxOptions,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExportDocxResult, String> {
    let notes_dir = state.with_config(store::get_notes_dir);
    let configured_pandoc = state.with_config(|config| config.pandoc_path.clone());
    let configured_reference = state.with_config(|config| config.pandoc_reference_doc.clone());
    let reference_doc = options
        .reference_doc
        .clone()
        .map(PathBuf::from)
        .or(configured_reference);

    export_note_to_docx_inner(app, notes_dir, configured_pandoc, options, reference_doc).await
}

/// 返回当前 Pandoc 检测结果，供设置界面和导出前诊断使用。
#[tauri::command]
pub async fn get_pandoc_info(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let configured = state.with_config(|config| config.pandoc_path.clone());
    let path = resolve_pandoc(&app, configured.as_deref())?;
    let version = detect_pandoc_version(&path).await?;
    Ok(serde_json::json!({
        "path": path.to_string_lossy(),
        "version": version,
    }))
}

async fn export_note_to_docx_inner(
    app: AppHandle,
    notes_dir: PathBuf,
    configured_pandoc: Option<PathBuf>,
    options: ExportDocxOptions,
    reference_doc: Option<PathBuf>,
) -> Result<ExportDocxResult, String> {
    let note_path = note_service::resolve_note_path(&notes_dir, &options.note_path)?;
    let output_path = PathBuf::from(&options.output_path);
    if output_path.as_os_str().is_empty() {
        return Err("DOCX_OUTPUT_FAILED: 输出路径为空".into());
    }
    if output_path == note_path {
        return Err("DOCX_OUTPUT_FAILED: 输出路径不能覆盖 Markdown 源文件".into());
    }
    let output_parent = output_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or("DOCX_OUTPUT_FAILED: 输出目录无效")?;
    if !output_parent.is_dir() {
        return Err("DOCX_OUTPUT_FAILED: 输出目录不存在".into());
    }

    let markdown = note_service::read_note_content(&notes_dir, &options.note_path)?;
    let reference_doc = reference_doc.filter(|path| !path.as_os_str().is_empty());
    if let Some(path) = &reference_doc {
        if !path.is_file() {
            return Err("PANDOC_RESOURCE_MISSING: Word 模板不存在或不可读".into());
        }
    }

    let pandoc = resolve_pandoc(&app, configured_pandoc.as_deref())?;
    let version = detect_pandoc_version(&pandoc).await?;
    let temp_path = create_temp_output_path(&output_path)?;
    let result = run_pandoc(
        &pandoc,
        &markdown,
        &temp_path,
        &notes_dir,
        note_path.parent().unwrap_or(&notes_dir),
        reference_doc.as_deref(),
    )
    .await;

    if let Err(error) = result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    if output_path.exists() {
        fs::remove_file(&output_path)
            .map_err(|error| format!("DOCX_OUTPUT_FAILED: 无法替换已有文件：{error}"))?;
    }
    fs::rename(&temp_path, &output_path)
        .map_err(|error| format!("DOCX_OUTPUT_FAILED: 无法写入 Word 文件：{error}"))?;

    Ok(ExportDocxResult {
        output_path: output_path.to_string_lossy().to_string(),
        pandoc_version: version,
    })
}

async fn run_pandoc(
    pandoc: &Path,
    markdown: &str,
    output_path: &Path,
    notes_dir: &Path,
    note_parent: &Path,
    reference_doc: Option<&Path>,
) -> Result<(), String> {
    let resource_separator = if cfg!(windows) { ";" } else { ":" };
    let resource_path = format!(
        "{}{}{}",
        note_parent.to_string_lossy(),
        resource_separator,
        notes_dir.to_string_lossy()
    );

    let mut command = Command::new(pandoc);
    command
        .arg("--from=gfm")
        .arg("--to=docx")
        .arg("--output")
        .arg(output_path)
        .arg("--resource-path")
        .arg(resource_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(reference_doc) = reference_doc {
        command.arg("--reference-doc").arg(reference_doc);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("PANDOC_INVALID: 无法启动 Pandoc：{error}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or("PANDOC_INVALID: 无法打开 Pandoc 标准输入")?;
    stdin
        .write_all(markdown.as_bytes())
        .await
        .map_err(|error| format!("PANDOC_INVALID: 无法传递 Markdown 内容：{error}"))?;
    drop(stdin);

    let output = timeout(PANDOC_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| "PANDOC_TIMEOUT: Pandoc 转换超过 60 秒".to_string())?
        .map_err(|error| format!("PANDOC_INVALID: Pandoc 进程异常：{error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "PANDOC_CONVERSION_FAILED: {}",
            truncate_error(detail.trim())
        ));
    }
    Ok(())
}

fn resolve_pandoc(app: &AppHandle, configured: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(path) = configured {
        if path.is_file() {
            return Ok(path.to_path_buf());
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = if cfg!(windows) {
            resource_dir.join("pandoc").join("pandoc.exe")
        } else {
            resource_dir.join("pandoc").join("pandoc")
        };
        if bundled.is_file() {
            return Ok(bundled);
        }
    }

    for candidate in common_pandoc_paths() {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Ok(PathBuf::from("pandoc"))
}

fn common_pandoc_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if cfg!(windows) {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            paths.push(
                PathBuf::from(local_app_data)
                    .join("Pandoc")
                    .join("pandoc.exe"),
            );
        }
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            paths.push(
                PathBuf::from(program_files)
                    .join("Pandoc")
                    .join("pandoc.exe"),
            );
        }
        if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)") {
            paths.push(
                PathBuf::from(program_files_x86)
                    .join("Pandoc")
                    .join("pandoc.exe"),
            );
        }
    } else {
        paths.push(PathBuf::from("/usr/local/bin/pandoc"));
        paths.push(PathBuf::from("/opt/homebrew/bin/pandoc"));
        paths.push(PathBuf::from("/usr/bin/pandoc"));
    }
    paths
}

async fn detect_pandoc_version(path: &Path) -> Result<String, String> {
    let output = timeout(
        PANDOC_VERSION_TIMEOUT,
        Command::new(path).arg("--version").output(),
    )
    .await
    .map_err(|_| "PANDOC_TIMEOUT: Pandoc 版本检测超时".to_string())?
    .map_err(|_| "PANDOC_NOT_FOUND: 未找到 Pandoc，请安装或配置 Pandoc 路径".to_string())?;
    if !output.status.success() {
        return Err("PANDOC_INVALID: Pandoc 版本检测失败".into());
    }
    let version = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    if version.is_empty() {
        return Err("PANDOC_INVALID: Pandoc 未返回版本信息".into());
    }
    Ok(version)
}

fn create_temp_output_path(output_path: &Path) -> Result<PathBuf, String> {
    let parent = output_path
        .parent()
        .ok_or("DOCX_OUTPUT_FAILED: 输出目录无效")?;
    let stem = output_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("prism-export");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "DOCX_OUTPUT_FAILED: 无法生成临时文件名")?
        .as_nanos();
    for attempt in 0..10u32 {
        let temp_path = parent.join(format!(".{stem}.prism-{nonce}-{attempt}.docx"));
        if !temp_path.exists() {
            return Ok(temp_path);
        }
    }
    Err("DOCX_OUTPUT_FAILED: 无法生成唯一的临时文件名".into())
}

fn truncate_error(value: &str) -> String {
    value.chars().take(MAX_PANDOC_ERROR_LENGTH).collect()
}
