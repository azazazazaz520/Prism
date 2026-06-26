use std::fs;

use crate::store;

// ═══════════════════════════════════════════════════════════════
//  模板文件名常量
// ═══════════════════════════════════════════════════════════════

pub const PARSE_INPUT: &str = "parse-input.md";
pub const DAILY_FOCUS: &str = "daily-focus.md";
pub const DECOMPOSE: &str = "decompose.md";
pub const OVERDUE_SUGGEST: &str = "overdue-suggest.md";
pub const CHAT: &str = "chat.md";

// ═══════════════════════════════════════════════════════════════
//  编译时内嵌默认 prompt（文件缺失时回退）
// ═══════════════════════════════════════════════════════════════

const DEFAULT_PARSE_INPUT: &str = "\
# 任务解析助手

你是一个 TODO 应用的任务解析助手。用户会用自然语言描述一个待办事项，你需要将其解析为结构化的任务。

## 规则
- title: 去除时间/标签/标记后的纯任务描述
- due_date: 从\"明天/周五/下周一/5月20日\"等表达中提取，格式 YYYY-MM-DD。如果没有截止日期则为 null。今天的日期请根据用户消息中的上下文推断。
- tags: 从 #标签 格式中提取标签名列表
- important: 出现\"重要/紧急/!\"标记时为 true
- pinned: 出现\"置顶\"标记时为 true
- is_daily: 出现\"每日/每天/日常\"时为 true

{{tags_hint}}

请**只**返回一个 JSON 对象，不要包含其他文字。格式示例：
{\"title\":\"提交报告\",\"due_date\":\"2026-06-27\",\"tags\":[\"工作\"],\"important\":true,\"pinned\":false,\"is_daily\":false}";

const DEFAULT_DAILY_FOCUS: &str = "\
# 今日聚焦

你是一个 TODO 应用的智能排序助手。根据以下未完成任务列表，综合考虑截止日期紧迫度、重要性标记、任务描述中的关键词，推荐今天应优先处理的 3-5 项任务，并给出简短理由。

今天是 {{today}}。

请**只**返回一个 JSON 对象，格式如下（不要包含其他文字）：
{\"items\":[{\"task_id\":\"...\",\"reason\":\"明天到期且标记重要\"}],\"summary\":\"一句话总结今日任务概况\"}";

const DEFAULT_DECOMPOSE: &str = "\
# 任务拆解

你是一个任务管理助手。把一个抽象的大任务拆解成 3-5 个具体可执行的小步骤。每个步骤应该是有明确完成标准的具体动作。
{{subtask_hint}}

请**只**返回一个 JSON 数组，格式如下（不要包含其他文字）：
[{\"title\":\"...\",\"estimated_minutes\":30}, ...]
estimated_minutes 为估计耗时（分钟），可为 null。";

const DEFAULT_OVERDUE_SUGGEST: &str = "\
# 过期任务处理建议

你是一个任务管理助手。以下任务已过期（当前日期 {{today}}），请对每个任务给出处理建议。

action 取值：
- \"reschedule\": 重新安排到新日期（给出 new_date）
- \"abandon\": 建议放弃（任务可能不再需要）
- \"decompose\": 任务太大需要拆解为子任务

请**只**返回一个 JSON 数组，格式如下（不要包含其他文字）：
[{\"task_id\":\"...\",\"action\":\"reschedule\",\"new_date\":\"2026-07-01\",\"reason\":\"...\"}, ...]
new_date 仅在 action 为 reschedule 时需要，其他情况为 null。";

const DEFAULT_CHAT: &str = "\
# AI 助手

你是一个 TODO 应用的 AI 助手，帮助用户管理任务。你可以：
- 分析任务优先级
- 建议任务排序
- 帮助拆解复杂任务
- 回答关于任务管理的问题

以下是用户当前的任务数据（仅标题和截止日期）：
{{context}}";

// ═══════════════════════════════════════════════════════════════
//  加载与渲染
// ═══════════════════════════════════════════════════════════════

fn get_default(name: &str) -> &'static str {
    match name {
        PARSE_INPUT => DEFAULT_PARSE_INPUT,
        DAILY_FOCUS => DEFAULT_DAILY_FOCUS,
        DECOMPOSE => DEFAULT_DECOMPOSE,
        OVERDUE_SUGGEST => DEFAULT_OVERDUE_SUGGEST,
        CHAT => DEFAULT_CHAT,
        _ => "",
    }
}

/// 替换模板中的 `{{variable}}` 占位符
fn render(template: &str, vars: &[(&str, &str)]) -> String {
    let mut result = template.to_string();
    for (key, value) in vars {
        result = result.replace(&format!("{{{{{}}}}}", key), value);
    }
    result
}

/// 加载 Prompt 模板：优先从文件读取，缺失时回退到编译时默认值。
/// 每次调用都重新读取文件，用户外部编辑后下次调用自动生效。
pub fn load(name: &str, vars: &[(&str, &str)]) -> String {
    let path = store::get_workspace_dir().join("prompts").join(name);
    let template = fs::read_to_string(&path).unwrap_or_else(|_| get_default(name).to_string());
    render(&template, vars)
}

/// 首次启动时创建默认 Prompt 文件（已存在则跳过）
pub fn create_defaults() {
    let dir = store::get_workspace_dir().join("prompts");
    fs::create_dir_all(&dir).ok();
    let defaults = [
        (PARSE_INPUT, DEFAULT_PARSE_INPUT),
        (DAILY_FOCUS, DEFAULT_DAILY_FOCUS),
        (DECOMPOSE, DEFAULT_DECOMPOSE),
        (OVERDUE_SUGGEST, DEFAULT_OVERDUE_SUGGEST),
        (CHAT, DEFAULT_CHAT),
    ];
    for (name, content) in defaults {
        let path = dir.join(name);
        if !path.exists() {
            fs::write(&path, content).ok();
        }
    }
}

// ═══════════════════════════════════════════════════════════════
//  测试
// ═══════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_render_single_variable() {
        let template = "Today is {{today}}.";
        let vars = &[("today", "2026-06-26")];
        assert_eq!(render(template, vars), "Today is 2026-06-26.");
    }

    #[test]
    fn test_render_multiple_variables() {
        let template = "{{greeting}}, today is {{today}}.";
        let vars = &[("greeting", "Hello"), ("today", "2026-06-26")];
        assert_eq!(render(template, vars), "Hello, today is 2026-06-26.");
    }

    #[test]
    fn test_render_no_variables() {
        let template = "No variables here.";
        let vars: &[(&str, &str)] = &[];
        assert_eq!(render(template, vars), "No variables here.");
    }

    #[test]
    fn test_render_preserves_json_braces() {
        // JSON 格式示例中的单花括号不应被替换
        let template = r#"Return: {"title":"test","due":"{{today}}"}"#;
        let vars = &[("today", "2026-06-26")];
        assert_eq!(
            render(template, vars),
            r#"Return: {"title":"test","due":"2026-06-26"}"#
        );
    }

    #[test]
    fn test_render_ignores_non_identifier_braces() {
        // {{"title":...}} 不应匹配，因为 "title" 不是合法标识符（含引号）
        let template = r#"{{"title":"test"}}"#;
        let vars = &[("title", "replaced")];
        // "title" 作为 \w+ 会匹配，但引号不在 \w 范围内
        // 实际模板中 "{{" 后面的第一个字符是 "，不是 \w，所以不匹配
        let result = render(template, vars);
        // {{title}} 模式不存在于模板中（模板是 {{"title"），所以无替换
        assert_eq!(result, r#"{{"title":"test"}}"#);
    }

    #[test]
    fn test_render_missing_variable_unchanged() {
        let template = "Hello {{name}}, today is {{today}}.";
        let vars = &[("today", "2026-06-26")];
        assert_eq!(
            render(template, vars),
            "Hello {{name}}, today is 2026-06-26."
        );
    }

    #[test]
    fn test_get_default_returns_non_empty() {
        assert!(!get_default(PARSE_INPUT).is_empty());
        assert!(!get_default(DAILY_FOCUS).is_empty());
        assert!(!get_default(DECOMPOSE).is_empty());
        assert!(!get_default(OVERDUE_SUGGEST).is_empty());
        assert!(!get_default(CHAT).is_empty());
    }

    #[test]
    fn test_get_default_unknown_returns_empty() {
        assert_eq!(get_default("unknown.md"), "");
    }

    #[test]
    fn test_default_prompts_contain_variable_placeholders() {
        assert!(DEFAULT_PARSE_INPUT.contains("{{tags_hint}}"));
        assert!(DEFAULT_DAILY_FOCUS.contains("{{today}}"));
        assert!(DEFAULT_DECOMPOSE.contains("{{subtask_hint}}"));
        assert!(DEFAULT_OVERDUE_SUGGEST.contains("{{today}}"));
        assert!(DEFAULT_CHAT.contains("{{context}}"));
    }
}
