use std::path::PathBuf;

use serde::Serialize;

use crate::pdf_to_word_service::{
    configured_base_url, validate_base_url, PdfToWordDownloadResult, PdfToWordHealth, PdfToWordJob,
    PdfToWordService,
};

/// PDF 转 Word 服务状态
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfToWordConfigStatus {
    pub base_url: Option<String>,
    pub configured: bool,
}

fn resolve_base_url() -> Result<String, String> {
    let base_url = configured_base_url()
        .ok_or("PDF_TO_WORD_CONFIG_REQUIRED: 服务地址未注入应用构建配置".to_string())?;
    validate_base_url(&base_url)
}

fn service_from_config(auth_token: String) -> Result<PdfToWordService, String> {
    let base_url = resolve_base_url()?;
    PdfToWordService::new(&base_url, auth_token)
}

/// 获取内置 PDF 转 Word 服务状态。
#[tauri::command]
pub fn pdf_to_word_get_config() -> Result<PdfToWordConfigStatus, String> {
    let base_url = configured_base_url()
        .map(|value| validate_base_url(&value))
        .transpose()?;
    Ok(PdfToWordConfigStatus {
        configured: base_url.is_some(),
        base_url,
    })
}

/// 检查远程 PDF 转 Word 服务状态。
#[tauri::command]
pub async fn pdf_to_word_check_health(auth_token: String) -> Result<PdfToWordHealth, String> {
    let service = service_from_config(auth_token)?;
    service.health().await
}

/// 上传本地 PDF 并创建远程转换任务。
#[tauri::command]
pub async fn pdf_to_word_create_job(
    input_path: String,
    auth_token: String,
) -> Result<PdfToWordJob, String> {
    let service = service_from_config(auth_token)?;
    service.create_job(&PathBuf::from(input_path)).await
}

/// 查询远程转换任务状态。
#[tauri::command]
pub async fn pdf_to_word_get_job(
    job_id: String,
    auth_token: String,
) -> Result<PdfToWordJob, String> {
    let service = service_from_config(auth_token)?;
    service.get_job(&job_id).await
}

/// 取消远程转换任务。
#[tauri::command]
pub async fn pdf_to_word_cancel_job(
    job_id: String,
    auth_token: String,
) -> Result<PdfToWordJob, String> {
    let service = service_from_config(auth_token)?;
    service.cancel_job(&job_id).await
}

/// 下载远程任务结果到用户选择的 DOCX 路径。
#[tauri::command]
pub async fn pdf_to_word_download_result(
    job_id: String,
    output_path: String,
    auth_token: String,
) -> Result<PdfToWordDownloadResult, String> {
    let service = service_from_config(auth_token)?;
    service
        .download_result(&job_id, &PathBuf::from(output_path))
        .await
}
