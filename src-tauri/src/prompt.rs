use std::fs;

use crate::store;

// ═══════════════════════════════════════════════════════════════
//  模板文件名常量（保留 pub 以兼容 ai.rs 调用方）
// ═══════════════════════════════════════════════════════════════

pub const PARSE_INPUT: &str = "parse-input.md";
pub const DAILY_FOCUS: &str = "daily-focus.md";
pub const OVERDUE_SUGGEST: &str = "overdue-suggest.md";
pub const CHAT: &str = "chat.md";
pub const JSON_EXPLAIN: &str = "json-explain.md";
pub const REGEX_GENERATE: &str = "regex-generate.md";
pub const WECHAT_PARSE: &str = "wechat-parse.md";
pub const EXECUTE_AUTO: &str = "execute-auto.md";
pub const DAILY_SUMMARY: &str = "daily-summary.md";

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

你是一个 TODO 应用的智能排序助手。以下是用户全部未完成任务列表。请通盘审视所有任务，综合考虑截止日期紧迫度、重要性标记、任务描述中的关键词，推荐今天应优先处理的 3-5 项任务，并给出简短理由。

今天是 {{today}}。

summary 字段请**概括全局**：不要只盯着今天到期的任务，而是总结当前所有未完成工作的整体状况（如总量、分布、压力点），让用户一眼看清全局。

请**只**返回一个 JSON 对象，格式如下（不要包含其他文字）：
{\"items\":[{\"task_id\":\"...\",\"reason\":\"明天到期且标记重要\"}],\"summary\":\"一句话总结全局任务概况\"}";

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

const DEFAULT_EXECUTE_AUTO: &str = "\
# 任务管理助手（自动模式）

你是 Prism TODO 应用的 AI 助手。默认将所有用户输入视为**创建任务**，除非明确匹配其他意图。

## 核心规则：默认就是添加任务

以下内容**全部**按添加任务处理：
- 含时间/日期的通知、消息、聊天记录 → 提取为任务
- 含动作词（请/尽快/记得/别忘了/要/需要）→ 提取为任务
- 含 @ 群组标记、地点信息 → 提取为任务
- 任何有明确事项描述的文本 → 提取为任务
- **一句话中可能包含多条任务，请逐一提取**

## 特殊意图（仅以下情况不按添加处理）

- **总结日报**: 用户说\"总结\"\"日报\"\"今天做了什么\"\"工作汇报\" → mode: summary
- **今日聚焦**: 用户说\"该做什么\"\"优先级\"\"建议\"\"分析任务\" → mode: focus
- **闲聊**: 用户说\"你好\"\"谢谢\"或问和任务管理无关的问题 → mode: chat

## 时间解析规则

- \"今天下午2:00-5:00\" → due_date 为当天的 YYYY-MM-DD，title 中保留时间信息
- \"明天/周五/下周一/5月20日\" → 提取为 due_date
- 时间段（2:00-5:00）→ 保留在 title 中
- 无法确定日期的 → due_date 为 null

## 输出格式

请**只**返回一个 JSON 对象：

- 添加任务: {\"mode\":\"add\",\"text\":\"已解析为 N 条任务\",\"tasks\":[{\"title\":\"...\",\"due_date\":null,\"tags\":[],\"important\":false,\"pinned\":false,\"is_daily\":false}],\"focus\":null}
- 日报总结: {\"mode\":\"summary\",\"text\":\"...\",\"tasks\":[],\"focus\":null}
- 今日聚焦: {\"mode\":\"focus\",\"text\":\"...\",\"tasks\":[],\"focus\":{\"items\":[{\"task_id\":\"...\",\"reason\":\"...\"}],\"summary\":\"...\"}}
- 闲聊: {\"mode\":\"chat\",\"text\":\"...\",\"tasks\":[],\"focus\":null}

## 示例

输入: \"@所有人 今天下午2：00-5：00 计组实验最后一次验收。机电楼303，304。请未验收的同学请尽快到实验室。\"
输出: {\"mode\":\"add\",\"text\":\"已解析为 1 条任务\",\"tasks\":[{\"title\":\"计组实验最后一次验收（2:00-5:00，机电楼303/304）\",\"due_date\":\"2026-07-12\",\"tags\":[\"学习\"],\"important\":true,\"pinned\":false,\"is_daily\":false}],\"focus\":null}

输入: \"明天提交项目报告 #工作\"
输出: {\"mode\":\"add\",\"text\":\"已解析为 1 条任务\",\"tasks\":[{\"title\":\"提交项目报告\",\"due_date\":\"2026-07-13\",\"tags\":[\"工作\"],\"important\":false,\"pinned\":false,\"is_daily\":false}],\"focus\":null}

输入: \"hello 你好\"
输出: {\"mode\":\"chat\",\"text\":\"你好！我是 Prism 任务管理助手，可以帮你添加任务、总结日报、分析优先级。\",\"tasks\":[],\"focus\":null}

输入: \"帮我总结一下今天做了什么\"
输出: {\"mode\":\"summary\",\"text\":\"\",\"tasks\":[],\"focus\":null}

{{context}}

用户输入：{{input}}";

const DEFAULT_DAILY_SUMMARY: &str = "\
# 日报总结

你是 Prism 任务管理应用的日报助手。根据用户今日已完成的任务，生成简洁的工作日报。

## 要点
- 概括今日完成的主要工作（2-3 句）
- 列出已完成任务清单
- 如果有未完成的重要任务，提醒明天继续
- 语气积极但不浮夸

## 格式
用 Markdown 格式，包含标题和列表。

今天是 {{today}}。

已完成任务：
{{completed_tasks}}

所有待办任务：
{{pending_tasks}}";

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
/// 新增 Prompt：在此数组中加一条即可——`get_default` 自动覆盖。
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
        PromptTemplate {
            name: EXECUTE_AUTO,
            default_content: DEFAULT_EXECUTE_AUTO,
            vars: &["context", "input"],
        },
        PromptTemplate {
            name: DAILY_SUMMARY,
            default_content: DEFAULT_DAILY_SUMMARY,
            vars: &["today", "completed_tasks", "pending_tasks"],
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
            OVERDUE_SUGGEST,
            CHAT,
            JSON_EXPLAIN,
            REGEX_GENERATE,
            WECHAT_PARSE,
            EXECUTE_AUTO,
            DAILY_SUMMARY,
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
        let expected_count = 9;
        assert_eq!(
            registry().len(),
            expected_count,
            "registry has {} entries, expected {}",
            registry().len(),
            expected_count
        );
    }
}
