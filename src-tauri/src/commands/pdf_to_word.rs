use std::path::PathBuf;

use serde::Serialize;
use tauri::State;

use crate::pdf_to_word_service::{
    self, PdfToWordDownloadResult, PdfToWordHealth, PdfToWordJob, PdfToWordService,
};
use crate::AppState;

/// PDF 转 Word 配置状态，不向前端返回访问令牌。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfToWordConfigStatus {
    pub base_url: Option<String>,
    pub configured: bool,
}

fn service_from_state(state: &State<'_, AppState>) -> Result<PdfToWordService, String> {
    let base_url = state.with_config(|config| config.pdf_to_word_base_url.clone());
    let base_url = base_url.ok_or("PDF_TO_WORD_CONFIG_REQUIRED: 请先配置服务地址".to_string())?;
    let token = pdf_to_word_service::read_token()?;
    PdfToWordService::new(&base_url, token)
}

/// 获取 PDF 转 Word 服务配置状态。
#[tauri::command]
pub fn pdf_to_word_get_config(state: State<'_, AppState>) -> Result<PdfToWordConfigStatus, String> {
    let base_url = state.with_config(|config| config.pdf_to_word_base_url.clone());
    let configured = pdf_to_word_service::has_token()?;
    Ok(PdfToWordConfigStatus {
        base_url,
        configured,
    })
}

/// 保存服务地址和可选令牌。令牌为空时保留现有令牌。
#[tauri::command]
pub fn pdf_to_word_save_config(
    base_url: String,
    token: Option<String>,
    state: State<'_, AppState>,
) -> Result<PdfToWordConfigStatus, String> {
    let base_url = pdf_to_word_service::validate_base_url(&base_url)?;
    if let Some(token) = token.filter(|value| !value.trim().is_empty()) {
        pdf_to_word_service::save_token(&token)?;
    }
    state.with_config_mut(|config| {
        config.pdf_to_word_base_url = Some(base_url.clone());
    })?;
    let configured = pdf_to_word_service::has_token()?;
    Ok(PdfToWordConfigStatus {
        base_url: Some(base_url),
        configured,
    })
}

/// 清除操作系统凭据存储中的 PDF 转 Word 令牌。
#[tauri::command]
pub fn pdf_to_word_clear_token() -> Result<(), String> {
    pdf_to_word_service::clear_token()
}

/// 检查远程 PDF 转 Word 服务状态。
#[tauri::command]
pub async fn pdf_to_word_check_health(
    state: State<'_, AppState>,
) -> Result<PdfToWordHealth, String> {
    let service = service_from_state(&state)?;
    service.health().await
}

/// 上传本地 PDF 并创建远程转换任务。
#[tauri::command]
pub async fn pdf_to_word_create_job(
    input_path: String,
    state: State<'_, AppState>,
) -> Result<PdfToWordJob, String> {
    let service = service_from_state(&state)?;
    service.create_job(&PathBuf::from(input_path)).await
}

/// 查询远程转换任务状态。
#[tauri::command]
pub async fn pdf_to_word_get_job(
    job_id: String,
    state: State<'_, AppState>,
) -> Result<PdfToWordJob, String> {
    let service = service_from_state(&state)?;
    service.get_job(&job_id).await
}

/// 取消远程转换任务。
#[tauri::command]
pub async fn pdf_to_word_cancel_job(
    job_id: String,
    state: State<'_, AppState>,
) -> Result<PdfToWordJob, String> {
    let service = service_from_state(&state)?;
    service.cancel_job(&job_id).await
}

/// 下载远程任务结果到用户选择的 DOCX 路径。
#[tauri::command]
pub async fn pdf_to_word_download_result(
    job_id: String,
    output_path: String,
    state: State<'_, AppState>,
) -> Result<PdfToWordDownloadResult, String> {
    let service = service_from_state(&state)?;
    service
        .download_result(&job_id, &PathBuf::from(output_path))
        .await
}
