use std::fs;

use crate::store;

// ═══════════════════════════════════════════════════════════════
//  模板文件名常量（保留 pub 以兼容 ai.rs 调用方）
// ═══════════════════════════════════════════════════════════════

pub const PARSE_INPUT: &str = "parse-input.md";
pub const DAILY_FOCUS: &str = "daily-focus.md";
pub const DECOMPOSE: &str = "decompose.md";
pub const OVERDUE_SUGGEST: &str = "overdue-suggest.md";
pub const CHAT: &str = "chat.md";
pub const JSON_EXPLAIN: &str = "json-explain.md";
pub const REGEX_GENERATE: &str = "regex-generate.md";
pub const WECHAT_PARSE: &str = "wechat-parse.md";

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

const DEFAULT_JSON_EXPLAIN: &str = "\
# JSON 结构解释

你是一个数据结构分析助手。用户会提供一段 JSON 文本，请分析其结构并以自然语言解释：

1. 顶层字段含义和数据类型
2. 嵌套结构（数组/对象）的用途
3. 可能的 API 或业务场景

请用中文简洁回答，不超过 200 字。";

const DEFAULT_REGEX_GENERATE: &str = "\
# 正则表达式生成

你是一个正则表达式生成助手。用户会用自然语言描述一个字符串匹配规则，请生成对应的正则表达式。

规则：
- 只输出正则表达式本身，不要加引号、markdown 代码块或任何解释文字
- 优先使用 JavaScript/ECMAScript 兼容的语法
- 如果用户描述模糊，选择最常见、最实用的匹配方式";

const DEFAULT_WECHAT_PARSE: &str = "\
# 聊天记录任务提取

你是一个 TODO 应用的智能解析助手。用户会粘贴一段聊天记录（可能是微信、钉钉、Slack 等），你需要从中提取所有可能的待办任务。

## 格式
聊天消息通常按行排列，忽略具体的格式差异（时间戳、发言者等），关注语义内容。

## 规则
- 逐条分析每条消息，识别其中隐含的待办事项、承诺、约定、截止日期
- 忽略纯闲聊、表情、问候语、已完成的陈述
- 如果多条消息讨论同一件事，合并为一个任务（取最完整的描述）
- 每个任务 title 应为简洁可执行的行动描述（动词开头，不超过 30 字）
- due_date: 从「明天/周五/下周一/5月20日/下午3点」等表达中提取，格式 YYYY-MM-DD。如无明确日期则为 null
- tags: 根据消息上下文提取 1-2 个关键词标签（如「工作」「生活」「学习」）
- important: 出现「重要/紧急/赶紧/!」或明显紧迫语境时为 true
- pinned: 出现「置顶」标记时为 true，聊天中极少出现则默认 false
- is_daily: 出现「每日/每天/日常」时为 true

{{tags_hint}}

请**只**返回一个 JSON 数组，每个元素是一个任务对象，不要包含其他文字。格式示例：
[{\"title\":\"提交项目报告\",\"due_date\":\"2026-06-29\",\"tags\":[\"工作\"],\"important\":true,\"pinned\":false,\"is_daily\":false}]
如果没有发现任何任务，返回空数组 []。";

// ═══════════════════════════════════════════════════════════════
//  Prompt 注册表 — 单一真相来源
// ═══════════════════════════════════════════════════════════════

/// 一个 Prompt 模板的完整元数据：文件名、默认内容、接受的变量列表。
pub struct PromptTemplate {
    pub name: &'static str,
    pub default_content: &'static str,
    /// 该模板接受的 `{{variable}}` 占位符列表（用于验证和文档）。
    pub vars: &'static [&'static str],
}

/// 所有已注册 Prompt 模板的单一真相来源。
/// 新增 Prompt：在此数组中加一条即可——`get_default` 和 `create_defaults` 自动覆盖。
fn registry() -> Vec<PromptTemplate> {
    vec![
        PromptTemplate {
            name: PARSE_INPUT,
            default_content: DEFAULT_PARSE_INPUT,
            vars: &["tags_hint"],
        },
        PromptTemplate {
            name: DAILY_FOCUS,
            default_content: DEFAULT_DAILY_FOCUS,
            vars: &["today"],
        },
        PromptTemplate {
            name: DECOMPOSE,
            default_content: DEFAULT_DECOMPOSE,
            vars: &["subtask_hint"],
        },
        PromptTemplate {
            name: OVERDUE_SUGGEST,
            default_content: DEFAULT_OVERDUE_SUGGEST,
            vars: &["today"],
        },
        PromptTemplate {
            name: CHAT,
            default_content: DEFAULT_CHAT,
            vars: &["context"],
        },
        PromptTemplate {
            name: JSON_EXPLAIN,
            default_content: DEFAULT_JSON_EXPLAIN,
            vars: &[],
        },
        PromptTemplate {
            name: REGEX_GENERATE,
            default_content: DEFAULT_REGEX_GENERATE,
            vars: &[],
        },
        PromptTemplate {
            name: WECHAT_PARSE,
            default_content: DEFAULT_WECHAT_PARSE,
            vars: &["tags_hint"],
        },
    ]
}

/// 公开的注册表访问器，供命令层和外部使用。
pub fn all() -> Vec<PromptTemplate> {
    registry()
}

// ═══════════════════════════════════════════════════════════════
//  加载与渲染
// ═══════════════════════════════════════════════════════════════

/// 从注册表查找默认 Prompt 内容。未找到返回空字符串。
fn get_default(name: &str) -> &'static str {
    registry()
        .iter()
        .find(|t| t.name == name)
        .map(|t| t.default_content)
        .unwrap_or("")
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
    for template in &registry() {
        let path = dir.join(template.name);
        if !path.exists() {
            fs::write(&path, template.default_content).ok();
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

    // ── 注册表完整性测试 ──

    #[test]
    fn test_registry_all_have_non_empty_defaults() {
        for template in &registry() {
            assert!(
                !template.default_content.is_empty(),
                "Prompt '{}' has empty default content",
                template.name
            );
        }
    }

    #[test]
    fn test_get_default_returns_content_for_every_registered_prompt() {
        for template in &registry() {
            let content = get_default(template.name);
            assert!(
                !content.is_empty(),
                "get_default('{}') returned empty",
                template.name
            );
        }
    }

    #[test]
    fn test_get_default_unknown_returns_empty() {
        assert_eq!(get_default("unknown.md"), "");
    }

    #[test]
    fn test_all_prompts_declare_expected_variable_placeholders() {
        for template in &registry() {
            for var in template.vars {
                let placeholder = format!("{{{{{}}}}}", var);
                assert!(
                    template.default_content.contains(&placeholder),
                    "Prompt '{}' declares var '{}' but default content doesn't contain '{}'",
                    template.name,
                    var,
                    placeholder
                );
            }
        }
    }

    #[test]
    fn test_registry_covers_all_name_constants() {
        // 确保每个 pub const 名称都有对应的注册表条目
        let all_names: Vec<&str> = registry().iter().map(|t| t.name).collect();
        for expected in &[
            PARSE_INPUT,
            DAILY_FOCUS,
            DECOMPOSE,
            OVERDUE_SUGGEST,
            CHAT,
            JSON_EXPLAIN,
            REGEX_GENERATE,
            WECHAT_PARSE,
        ] {
            assert!(
                all_names.contains(expected),
                "registry() missing entry for name constant '{}'",
                expected
            );
        }
    }

    #[test]
    fn test_registry_entry_count_matches_name_constants() {
        // 注册表条目数应等于名称常量数（防止多余条目）
        let expected_count = 8;
        assert_eq!(
            registry().len(),
            expected_count,
            "registry has {} entries, expected {}",
            registry().len(),
            expected_count
        );
    }
}
