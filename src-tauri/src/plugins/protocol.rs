use crate::AppState;
use std::sync::Arc;
use tauri::{Manager, Runtime, UriSchemeResponder};

use std::collections::HashMap;
use std::sync::Mutex;

// ═══════════════════════════════════════════════════════════════
//  Token 注册表（一次性，3s TTL）
// ═══════════════════════════════════════════════════════════════

/// 一次性安全令牌条目，3 秒 TTL，用于插件身份验证。
pub(crate) struct TokenEntry {
    pub plugin_id: String,
    #[allow(dead_code)]
    pub permissions: Vec<String>,
    pub created_at: std::time::Instant,
}

/// 一次性令牌注册表，线程安全，支持注册、消费、主动注销。
pub struct TokenRegistry {
    tokens: Mutex<HashMap<String, TokenEntry>>,
}

impl TokenRegistry {
    pub fn new() -> Self {
        Self {
            tokens: Mutex::new(HashMap::new()),
        }
    }

    /// 注册有效期为 3 秒的一次性令牌，返回令牌字符串。
    #[allow(dead_code)]
    pub fn register(&self, plugin_id: &str, permissions: &[String]) -> String {
        let token = uuid::Uuid::new_v4().to_string();
        let mut map = self.tokens.lock().unwrap();
        // 清理过期 token
        map.retain(|_, v| v.created_at.elapsed().as_secs() < 3);
        map.insert(
            token.clone(),
            TokenEntry {
                plugin_id: plugin_id.to_string(),
                permissions: permissions.to_vec(),
                created_at: std::time::Instant::now(),
            },
        );
        token
    }

    /// 消费 token：验证有效 → 返回插件身份 → 立即注销
    pub fn consume(&self, token: &str) -> Result<TokenEntry, String> {
        let mut map = self.tokens.lock().unwrap();
        let entry = map
            .remove(token)
            .ok_or_else(|| "token 无效或已过期".to_string())?;

        // 检查 TTL
        if entry.created_at.elapsed().as_secs() > 3 {
            return Err("token 已过期".to_string());
        }

        Ok(entry)
    }

    /// 主动注销令牌。
    #[allow(dead_code)]
    pub fn revoke(&self, token: &str) {
        let mut map = self.tokens.lock().unwrap();
        map.remove(token);
    }
}

// ═══════════════════════════════════════════════════════════════
//  薄封装模块内容
// ═══════════════════════════════════════════════════════════════

/// 为给定模块生成薄封装 JS 代码。
/// 薄封装导入固定的宿主实现模块，注入插件身份和能力。
fn generate_api_module(module_name: &str, plugin_id: &str) -> String {
    match module_name {
        "api" => format!(
            r#"// prism:api (Plugin Protocol)
export const api = {{
  ui: {{
    notice(msg, level = 'info') {{ console.log('[{}]', msg); }},
  }},
  storage: {{
    async get(key) {{ return JSON.parse(localStorage.getItem('plugin:{}:' + key) || 'null'); }},
    async set(key, value) {{ localStorage.setItem('plugin:{}:' + key, JSON.stringify(value)); }},
    async delete(key) {{ localStorage.removeItem('plugin:{}:' + key); }},
    async keys() {{
      const prefix = 'plugin:{}:';
      const result = [];
      for (let i = 0; i < localStorage.length; i++) {{
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) result.push(k.slice(prefix.length));
      }}
      return result;
    }},
  }},
  diagnostics: {{
    log(level, msg) {{ console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log']('[diag:{}]', msg); }},
  }},
}};"#,
            plugin_id, plugin_id, plugin_id, plugin_id, plugin_id, plugin_id
        ),
        "commands" => {
            let prefix = format!("{}.", plugin_id);
            format!(
                r#"// prism:commands (Plugin Protocol)
const _registry = new Map();
export const commands = {{
  register(id, callback) {{
    const prefix = '{}';
    if (!id || !id.startsWith(prefix)) throw new TypeError('命令 ID 必须以 ' + prefix + ' 为前缀');
    _registry.set(id, callback);
    return {{ dispose() {{ _registry.delete(id); }} }};
  }},
  async execute(id, ...args) {{
    const cb = _registry.get(id);
    if (!cb) throw new Error('命令未注册: ' + id);
    return cb(...args);
  }},
}};"#,
                prefix
            )
        }
        "tasks" => format!(
            r#"// prism:tasks (Plugin Protocol)
const _pid = '{}';
const _invoke = window.__TAURI_INTERNALS__?.invoke || (() => {{ throw new Error('Tauri IPC 不可用'); }});
export const tasks = {{
  list: () => _invoke('plugin_tasks_list', {{ pluginId: _pid }}),
  listByDate: (date) => _invoke('plugin_tasks_list_by_date', {{ pluginId: _pid, date }}),
  create: (title, opts) => _invoke('plugin_tasks_create', {{ pluginId: _pid, args: {{ title, ...opts }} }}),
  update: (id, args) => _invoke('plugin_tasks_update', {{ pluginId: _pid, args: {{ id, ...args }} }}),
  toggle: (id) => _invoke('plugin_tasks_toggle', {{ pluginId: _pid, id }}),
  delete: (id) => _invoke('plugin_tasks_delete', {{ pluginId: _pid, id }}),
}};"#,
            plugin_id
        ),
        "network" => format!(
            r#"// prism:network (Plugin Protocol)
const _pid2 = '{}';
const _invoke2 = window.__TAURI_INTERNALS__?.invoke || (() => {{ throw new Error('Tauri IPC 不可用'); }});
export const network = {{
  fetch: (url, options) => _invoke2('plugin_network_fetch', {{ pluginId: _pid2, url, options }}),
}};"#,
            plugin_id
        ),
        _ => format!(
            r#"// Unknown module: {module}
export default {{}};"#,
            module = module_name
        ),
    }
}

/// 处理 /__prism/api/<module>.js?pluginId=X&token=Y 请求
/// 返回薄封装 JS 代码，token 验证通过后立即消费（一次性）
pub fn handle_api_request(
    registry: &TokenRegistry,
    module_name: &str,
    plugin_id: &str,
    token: &str,
) -> Result<String, String> {
    let entry = registry.consume(token)?;

    // 验证插件 ID 一致性
    if entry.plugin_id != plugin_id {
        return Err("pluginId 与 token 不匹配".to_string());
    }

    Ok(generate_api_module(module_name, plugin_id))
}

pub(crate) async fn respond_to_api_request<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: tauri::http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
    registry: Arc<TokenRegistry>,
) {
    let state = app_handle.state::<AppState>();
    let module_name = request
        .uri()
        .path()
        .trim_start_matches('/')
        .trim_end_matches(".js");
    let (plugin_id, token) = parse_api_credentials(&request.uri().to_string());

    if module_name == "module" {
        respond_with_plugin_module(&state, &token, responder);
        return;
    }

    let response = match handle_api_request(&registry, module_name, &plugin_id, &token) {
        Ok(body) => javascript_response(200, body),
        Err(error) => javascript_response(403, format!("// Error: {error}")),
    };
    responder.respond(response);
}

fn parse_api_credentials(uri: &str) -> (String, String) {
    let params: HashMap<String, String> = uri
        .split('?')
        .nth(1)
        .unwrap_or("")
        .split('&')
        .filter_map(|part| {
            let (key, value) = part.split_once('=')?;
            Some((key.to_string(), value.to_string()))
        })
        .collect();
    (
        params.get("pluginId").cloned().unwrap_or_default(),
        params.get("token").cloned().unwrap_or_default(),
    )
}

fn respond_with_plugin_module(
    state: &tauri::State<'_, AppState>,
    token: &str,
    responder: UriSchemeResponder,
) {
    let source = state.plugin_modules.lock().unwrap().remove(token);
    let response = match source {
        Some(body) => javascript_response(200, body),
        None => javascript_response(404, "// Error: module not found or token expired".into()),
    };
    responder.respond(response);
}

fn javascript_response(status: u16, body: String) -> tauri::http::Response<Vec<u8>> {
    let mut builder =
        tauri::http::Response::builder().header("Content-Type", "application/javascript");
    if status != 200 {
        builder = builder.status(status);
    }
    builder
        .body(body.into_bytes())
        .expect("固定的 JavaScript 响应头应始终有效")
}

/// 将插件主模块源码注册到内存中，返回 URL 供 import() 加载。
/// token 用于一次性安全校验，protocol handler 响应后即销。
pub fn register_plugin_module(
    state: &AppState,
    plugin_id: String,
    token: String,
    source: String,
) -> Result<String, String> {
    let mut modules = state.plugin_modules.lock().unwrap();
    modules.insert(token.clone(), source);
    Ok(format!(
        "prism-api://localhost/module.js?pluginId={}&token={}",
        urlencoding(&plugin_id),
        urlencoding(&token)
    ))
}

fn urlencoding(s: &str) -> String {
    // 简单的手动 URL 编码，避免引入额外依赖
    s.replace('%', "%25")
        .replace(' ', "%20")
        .replace('&', "%26")
        .replace('=', "%3D")
        .replace('?', "%3F")
}
