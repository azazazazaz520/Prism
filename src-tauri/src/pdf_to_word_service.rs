use std::path::{Path, PathBuf};
use std::time::Duration;

use keyring::Entry;
use reqwest::{Client, RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use url::Url;

const KEYRING_SERVICE: &str = "com.prism.desktop";
const KEYRING_USER: &str = "pdf-to-word-token";
const MAX_UPLOAD_BYTES: u64 = 50 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// PDF 转 Word 服务的任务快照。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfToWordJob {
    pub job_id: String,
    pub filename: String,
    pub status: String,
    pub progress: u32,
    pub route: String,
    pub route_reason: Option<String>,
    pub table_count: u32,
    pub page_count: u32,
    pub error: Option<String>,
    pub created_at: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

/// PDF 转 Word 服务健康状态。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfToWordHealth {
    pub status: String,
    pub engine: String,
    pub worker_processes: u32,
    pub max_pending_jobs: u32,
    pub route_mode: String,
    pub export_mode: String,
    pub model_loaded: bool,
    pub max_upload_bytes: u64,
    pub max_pages: u32,
}

/// DOCX 下载结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfToWordDownloadResult {
    pub output_path: String,
    pub bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct ApiJob {
    job_id: String,
    filename: String,
    status: String,
    progress: u32,
    route: String,
    #[serde(default)]
    route_reason: Option<String>,
    table_count: u32,
    page_count: u32,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    started_at: Option<String>,
    #[serde(default)]
    finished_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct ApiHealth {
    status: String,
    engine: String,
    worker_processes: u32,
    max_pending_jobs: u32,
    route_mode: String,
    export_mode: String,
    model_loaded: bool,
    max_upload_bytes: u64,
    max_pages: u32,
}

#[derive(Debug, Deserialize)]
struct ApiError {
    detail: Option<String>,
}

/// 远程 PDF 转 Word API 的具体适配器。
pub struct PdfToWordService {
    base_url: String,
    token: Option<String>,
    client: Client,
}

impl PdfToWordService {
    /// 创建服务适配器并校验服务地址。
    pub fn new(base_url: &str, token: Option<String>) -> Result<Self, String> {
        let base_url = validate_base_url(base_url)?;
        let client = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|_| "PDF_TO_WORD_NETWORK: 无法创建网络客户端".to_string())?;
        let token = token
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        Ok(Self {
            base_url,
            token,
            client,
        })
    }

    /// 检查服务健康状态。服务端允许公开健康检查时无需令牌。
    pub async fn health(&self) -> Result<PdfToWordHealth, String> {
        let request = self.with_optional_auth(self.client.get(self.endpoint("/health")));
        let response = request.send().await.map_err(classify_network_error)?;
        parse_json_response::<ApiHealth>(response)
            .await
            .map(Into::into)
    }

    /// 上传 PDF 并创建远程转换任务。
    pub async fn create_job(&self, input_path: &Path) -> Result<PdfToWordJob, String> {
        let token = self.required_token()?;
        let metadata = tokio::fs::metadata(input_path)
            .await
            .map_err(|_| "PDF_TO_WORD_INPUT_MISSING: PDF 文件不存在或不可读".to_string())?;
        if !metadata.is_file() {
            return Err("PDF_TO_WORD_INPUT_INVALID: 输入路径不是文件".to_string());
        }
        if input_path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("pdf"))
            != Some(true)
        {
            return Err("PDF_TO_WORD_INPUT_INVALID: 输入文件扩展名必须是 .pdf".to_string());
        }
        if metadata.len() > MAX_UPLOAD_BYTES {
            return Err("PDF_TO_WORD_LIMIT_EXCEEDED: PDF 文件超过 50 MiB 限制".to_string());
        }

        let bytes = tokio::fs::read(input_path)
            .await
            .map_err(|_| "PDF_TO_WORD_INPUT_MISSING: PDF 文件读取失败".to_string())?;
        if !bytes.starts_with(b"%PDF-") {
            return Err("PDF_TO_WORD_INVALID_PDF: 输入文件不是有效的 PDF".to_string());
        }

        let filename = input_path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "input.pdf".to_string());
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(filename)
            .mime_str("application/pdf")
            .map_err(|_| "PDF_TO_WORD_INPUT_INVALID: 无法构造 PDF 上传请求".to_string())?;
        let form = reqwest::multipart::Form::new().part("file", part);
        let response = self
            .client
            .post(self.endpoint("/api/pdf-to-word/jobs"))
            .bearer_auth(token)
            .multipart(form)
            .send()
            .await
            .map_err(classify_network_error)?;
        parse_json_response::<ApiJob>(response)
            .await
            .map(Into::into)
    }

    /// 获取远程转换任务状态。
    pub async fn get_job(&self, job_id: &str) -> Result<PdfToWordJob, String> {
        validate_job_id(job_id)?;
        let token = self.required_token()?;
        let response = self
            .client
            .get(self.endpoint(&format!("/api/pdf-to-word/jobs/{job_id}")))
            .bearer_auth(token)
            .send()
            .await
            .map_err(classify_network_error)?;
        parse_json_response::<ApiJob>(response)
            .await
            .map(Into::into)
    }

    /// 取消远程转换任务。
    pub async fn cancel_job(&self, job_id: &str) -> Result<PdfToWordJob, String> {
        validate_job_id(job_id)?;
        let token = self.required_token()?;
        let response = self
            .client
            .delete(self.endpoint(&format!("/api/pdf-to-word/jobs/{job_id}")))
            .bearer_auth(token)
            .send()
            .await
            .map_err(classify_network_error)?;
        parse_json_response::<ApiJob>(response)
            .await
            .map(Into::into)
    }

    /// 下载已完成任务的 DOCX，并安全写入用户指定路径。
    pub async fn download_result(
        &self,
        job_id: &str,
        output_path: &Path,
    ) -> Result<PdfToWordDownloadResult, String> {
        validate_job_id(job_id)?;
        let token = self.required_token()?;
        let output_path = normalize_output_path(output_path)?;
        let parent = output_path
            .parent()
            .filter(|value| value.is_dir())
            .ok_or("PDF_TO_WORD_OUTPUT_INVALID: 输出目录不存在")?;
        if output_path.exists() {
            return Err("PDF_TO_WORD_OUTPUT_EXISTS: 目标 Word 文件已存在".to_string());
        }

        let filename = output_path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| "output.docx".to_string());
        let temp_path = parent.join(format!(
            ".{filename}.prism-{}.part",
            uuid::Uuid::new_v4().simple()
        ));
        let result = self
            .download_to_temp(job_id, &temp_path, &output_path, token)
            .await;
        if result.is_err() {
            let _ = tokio::fs::remove_file(&temp_path).await;
        }
        result
    }

    async fn download_to_temp(
        &self,
        job_id: &str,
        temp_path: &Path,
        output_path: &Path,
        token: String,
    ) -> Result<PdfToWordDownloadResult, String> {
        let response = self
            .client
            .get(self.endpoint(&format!("/api/pdf-to-word/jobs/{job_id}/result")))
            .bearer_auth(token)
            .send()
            .await
            .map_err(classify_network_error)?;
        let mut source = ensure_success(response).await?;
        let mut file = tokio::fs::File::create(temp_path)
            .await
            .map_err(|_| "PDF_TO_WORD_OUTPUT_FAILED: 无法创建临时文件".to_string())?;
        let mut total = 0u64;
        while let Some(chunk) = source.chunk().await.map_err(classify_network_error)? {
            total = total.saturating_add(chunk.len() as u64);
            file.write_all(&chunk)
                .await
                .map_err(|_| "PDF_TO_WORD_OUTPUT_FAILED: 写入 Word 文件失败".to_string())?;
        }
        file.flush()
            .await
            .map_err(|_| "PDF_TO_WORD_OUTPUT_FAILED: 保存 Word 文件失败".to_string())?;
        file.sync_all()
            .await
            .map_err(|_| "PDF_TO_WORD_OUTPUT_FAILED: 保存 Word 文件失败".to_string())?;
        tokio::fs::rename(temp_path, output_path)
            .await
            .map_err(|_| "PDF_TO_WORD_OUTPUT_FAILED: 无法完成 Word 文件保存".to_string())?;
        Ok(PdfToWordDownloadResult {
            output_path: output_path.to_string_lossy().into_owned(),
            bytes: total,
        })
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    fn required_token(&self) -> Result<String, String> {
        self.token
            .clone()
            .ok_or("PDF_TO_WORD_AUTH_REQUIRED: 请先配置 PDF 转 Word 服务令牌".to_string())
    }

    fn with_optional_auth(&self, request: RequestBuilder) -> RequestBuilder {
        match &self.token {
            Some(token) => request.bearer_auth(token),
            None => request,
        }
    }
}

/// 校验并规范化服务地址。
pub fn validate_base_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("PDF_TO_WORD_CONFIG_INVALID: 服务地址不能为空".to_string());
    }
    let parsed = Url::parse(trimmed)
        .map_err(|_| "PDF_TO_WORD_CONFIG_INVALID: 服务地址格式无效".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("PDF_TO_WORD_CONFIG_INVALID: 服务地址必须使用 HTTP 或 HTTPS".to_string());
    }
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("PDF_TO_WORD_CONFIG_INVALID: 服务地址不能包含凭据、查询参数或片段".to_string());
    }
    Ok(trimmed.to_string())
}

/// 规范化用户选择的 DOCX 输出路径。
pub fn normalize_output_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("PDF_TO_WORD_OUTPUT_INVALID: 输出路径必须是绝对路径".to_string());
    }
    let mut output = path.to_path_buf();
    if output.extension().and_then(|value| value.to_str()) != Some("docx") {
        output.set_extension("docx");
    }
    Ok(output)
}

/// 校验服务返回的任务编号，避免将用户输入拼接为任意路径。
pub fn validate_job_id(job_id: &str) -> Result<(), String> {
    if job_id.is_empty()
        || !job_id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
    {
        return Err("PDF_TO_WORD_JOB_INVALID: 任务编号格式无效".to_string());
    }
    Ok(())
}

/// 读取操作系统凭据存储中的服务令牌。
pub fn read_token() -> Result<Option<String>, String> {
    let entry = credential_entry()?;
    match entry.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("PDF_TO_WORD_CREDENTIALS: 无法读取服务令牌".to_string()),
    }
}

/// 保存服务令牌到操作系统凭据存储。
pub fn save_token(token: &str) -> Result<(), String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("PDF_TO_WORD_AUTH_REQUIRED: 服务令牌不能为空".to_string());
    }
    credential_entry()?
        .set_password(token)
        .map_err(|_| "PDF_TO_WORD_CREDENTIALS: 无法保存服务令牌".to_string())
}

/// 删除操作系统凭据存储中的服务令牌。
pub fn clear_token() -> Result<(), String> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("PDF_TO_WORD_CREDENTIALS: 无法清除服务令牌".to_string()),
    }
}

/// 判断服务令牌是否已经配置。
pub fn has_token() -> Result<bool, String> {
    Ok(read_token()?.is_some())
}

fn credential_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|_| "PDF_TO_WORD_CREDENTIALS: 无法访问操作系统凭据存储".to_string())
}

async fn parse_json_response<T: DeserializeOwned>(response: Response) -> Result<T, String> {
    let response = ensure_success(response).await?;
    response
        .json()
        .await
        .map_err(|_| "PDF_TO_WORD_BAD_RESPONSE: 服务返回的数据格式无效".to_string())
}

async fn ensure_success(response: Response) -> Result<Response, String> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let detail = response
        .json::<ApiError>()
        .await
        .ok()
        .and_then(|value| value.detail)
        .unwrap_or_default();
    Err(classify_http_error(status, &detail))
}

fn classify_http_error(status: StatusCode, _detail: &str) -> String {
    let (code, message) = match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            ("PDF_TO_WORD_AUTH_INVALID", "服务访问令牌无效或没有权限")
        }
        StatusCode::BAD_REQUEST => ("PDF_TO_WORD_BAD_REQUEST", "PDF 转换请求参数无效"),
        StatusCode::NOT_FOUND => (
            "PDF_TO_WORD_ENDPOINT_NOT_FOUND",
            "PDF 转 Word 服务接口不存在",
        ),
        StatusCode::PAYLOAD_TOO_LARGE => (
            "PDF_TO_WORD_LIMIT_EXCEEDED",
            "PDF 文件大小或页数超过服务限制",
        ),
        StatusCode::UNSUPPORTED_MEDIA_TYPE => ("PDF_TO_WORD_INVALID_PDF", "上传文件不是有效的 PDF"),
        StatusCode::TOO_MANY_REQUESTS => ("PDF_TO_WORD_QUEUE_FULL", "服务队列已满，请稍后重试"),
        status if status.is_server_error() => {
            ("PDF_TO_WORD_SERVER_ERROR", "PDF 转 Word 服务暂时不可用")
        }
        _ => ("PDF_TO_WORD_HTTP_ERROR", "PDF 转 Word 服务返回异常状态"),
    };
    format!("{code}: {message}（HTTP {}）", status.as_u16())
}

fn classify_network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "PDF_TO_WORD_TIMEOUT: 连接 PDF 转 Word 服务超时".to_string();
    }
    "PDF_TO_WORD_NETWORK: 无法连接 PDF 转 Word 服务".to_string()
}

impl From<ApiJob> for PdfToWordJob {
    fn from(value: ApiJob) -> Self {
        Self {
            job_id: value.job_id,
            filename: value.filename,
            status: value.status,
            progress: value.progress,
            route: value.route,
            route_reason: value.route_reason,
            table_count: value.table_count,
            page_count: value.page_count,
            error: value.error,
            created_at: value.created_at,
            started_at: value.started_at,
            finished_at: value.finished_at,
        }
    }
}

impl From<ApiHealth> for PdfToWordHealth {
    fn from(value: ApiHealth) -> Self {
        Self {
            status: value.status,
            engine: value.engine,
            worker_processes: value.worker_processes,
            max_pending_jobs: value.max_pending_jobs,
            route_mode: value.route_mode,
            export_mode: value.export_mode,
            model_loaded: value.model_loaded,
            max_upload_bytes: value.max_upload_bytes,
            max_pages: value.max_pages,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_http_and_https_base_urls() {
        assert_eq!(
            validate_base_url(" https://example.com/ ").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            validate_base_url("http://127.0.0.1:8765").unwrap(),
            "http://127.0.0.1:8765"
        );
    }

    #[test]
    fn rejects_base_url_credentials_and_query() {
        assert!(validate_base_url("https://user:pass@example.com").is_err());
        assert!(validate_base_url("https://example.com?token=secret").is_err());
        assert!(validate_base_url("ftp://example.com").is_err());
    }

    #[test]
    fn validates_job_id_characters() {
        assert!(validate_job_id("abc-123_DEF").is_ok());
        assert!(validate_job_id("../secret").is_err());
        assert!(validate_job_id("").is_err());
    }

    #[test]
    fn normalizes_docx_output_extension() {
        let path = if cfg!(windows) {
            PathBuf::from(r"C:\Temp\result")
        } else {
            PathBuf::from("/tmp/result")
        };
        assert_eq!(
            normalize_output_path(&path).unwrap().extension().unwrap(),
            "docx"
        );
    }

    #[test]
    fn maps_snake_case_health_response_to_camel_case_output() {
        let health: ApiHealth = serde_json::from_str(
            r#"{
                "status": "ok",
                "engine": "structure-lite",
                "worker_processes": 1,
                "max_pending_jobs": 4,
                "route_mode": "auto",
                "export_mode": "hybrid",
                "model_loaded": true,
                "max_upload_bytes": 52428800,
                "max_pages": 100,
                "text_min_page_chars": 20
            }"#,
        )
        .unwrap();
        let output: PdfToWordHealth = health.into();
        let json = serde_json::to_value(output).unwrap();
        assert_eq!(json["workerProcesses"], 1);
        assert_eq!(json["maxUploadBytes"], 52428800u64);
    }

    #[test]
    fn maps_http_status_to_stable_error_codes() {
        assert!(classify_http_error(StatusCode::UNAUTHORIZED, "")
            .starts_with("PDF_TO_WORD_AUTH_INVALID"));
        assert!(classify_http_error(StatusCode::PAYLOAD_TOO_LARGE, "")
            .starts_with("PDF_TO_WORD_LIMIT_EXCEEDED"));
        assert!(classify_http_error(StatusCode::TOO_MANY_REQUESTS, "")
            .starts_with("PDF_TO_WORD_QUEUE_FULL"));
    }
}
