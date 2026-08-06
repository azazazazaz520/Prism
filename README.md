# Prism

一个本地优先、AI 辅助的模块化桌面工具平台，基于 **Tauri v2 + Vue 3 + Rust** 构建。首个模块为任务管理，平台设计支持多样化的实用工具模块扩展。

## 功能

### 任务管理

- **完整 CRUD** — 增删改查、完成/撤销、批量清除已完成任务
- **每日任务** — 按日期独立追踪每日重复任务的完成状态
- **标签系统** — 自定义标签、多标签筛选、全局标签管理
- **优先级管理** — 重要标记、置顶优先展示、截止日期设置
- **到期提醒** — 可配置提醒提前量，系统原生通知，每天每任务仅提醒一次
- **AI 任务拆解** — 智能将复杂任务分解为 3-5 个可执行子步骤
- **迷你日历** — 侧边日历快速切换日期视图，按日期筛选任务

### AI 智能助手

- **自然语言解析** — 用自然语言描述任务，AI 自动提取日期、标签、优先级
- **文本导入** — 粘贴聊天记录或消息文本，AI 批量识别并转为结构化任务
- **今日聚焦** — AI 根据截止日期和重要性推荐当日优先处理的 3-5 项任务
- **过期建议** — AI 分析过期任务，给出重新安排、放弃或拆解的建议
- **自由对话** — 与 AI 助手对话，查询任务状态、获取执行建议
- **多供应商** — 支持 OpenAI、通义千问等兼容 OpenAI API 的服务，灵活切换
- **可编辑 Prompt** — 内置 8 个 Prompt 模板（`.md` 文件），修改即生效，无需重新编译

### 笔记

- **Markdown 编辑** — 基于 CodeMirror 6 的 Markdown 编辑器，支持语法高亮
- **文件树** — 递归文件夹结构，创建、重命名、删除（移入系统回收站）
- **AI 元数据** — 可选 AI 生成标签、摘要和关联链接

### 开发者工具箱

内置六个实用小工具，即开即用：

- JSON 格式化与验证
- 正则表达式测试（支持 AI 生成）
- Base64 编解码
- Unix 时间戳转换
- UUID v4 生成
- HEX/RGB/HSL 颜色转换

### 跨设备同步

- **匿名认证** — 无需注册账号，基于 Supabase Anonymous Sign-In
- **配对码机制** — 首个设备生成同步码，其他设备输入后即可加入同一 Profile
- **双向同步** — 基于 Supabase Realtime 的 WebSocket 实时推送
- **离线优先** — 本地写入优先，离线队列自动排队，恢复网络后自动推送
- **LWW 冲突解决** — 最后写入者胜出，`updated_at` 由 Rust 后端统一生成
- **软删除传播** — 删除操作通过 `is_deleted` 标记同步到所有设备，30 天 GC 清理

### 界面与交互

- **多窗口架构** — 主窗口、悬浮窗、导入弹窗、截图选区四种窗口独立运行
- **悬浮窗** — 始终置顶的透明小窗，轮播待办任务，支持透明度调节和轮播间隔控制
- **全局快捷键** — `Ctrl+Shift+I` 打开导入窗口，`Ctrl+Alt+I` 触发区域截图
- **模块注册表** — 数据驱动侧边栏，模块可在设置中启用/禁用
- **三模主题** — 自动跟随系统 / 浅色 / 深色，通过 `data-theme` 属性驱动
- **本地存储** — 数据完全离线可用，隐私安全

## 技术栈

| 层       | 技术                                                                  |
| -------- | --------------------------------------------------------------------- |
| 桌面框架 | [Tauri v2](https://v2.tauri.app/)                                     |
| 前端     | Vue 3 + TypeScript + Vite                                             |
| 后端     | Rust（命令系统、文件操作、AI 集成、提醒线程）                         |
| 存储     | 本地 JSON（`data.json` + `config.json` + `sync.json`）+ Markdown 文件 |
| 编辑器   | CodeMirror 6                                                          |
| 同步     | Supabase（PostgreSQL + Realtime + Anonymous Auth）                    |
| 通知     | `tauri-plugin-notification`（系统原生通知）                           |
| 快捷键   | `tauri-plugin-global-shortcut`                                        |
| AI 集成  | `reqwest` + `tokio` 异步 HTTP 调用 LLM API                            |

## 环境要求

- **Node.js** ≥ 20
- **Rust** ≥ 1.70（通过 [rustup](https://rustup.rs/) 安装）
- **系统依赖**（仅 Linux）：

```bash
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev
```

> macOS 和 Windows 无需额外系统依赖。

### 同步功能（可选）

如需使用跨设备同步，需配置 Supabase 环境变量：

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 开发模式（热更新）
npm run tauri dev

# 3. 构建安装包
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`。

## 项目结构

```
prism/
├── src/                              # Vue 3 前端
│   ├── components/                   # UI 组件（按领域分目录）
│   │   ├── ai/                       # AI 助手、今日聚焦、命令面板
│   │   ├── app/                      # 应用壳（侧边栏、设置面板）
│   │   ├── notes/                    # 笔记编辑器、文件树、工作区叶
│   │   ├── overlays/                 # 悬浮窗、导入窗、截图选区、通用弹窗
│   │   ├── plugins/                  # 插件管理、脚本管理、插件视图宿主
│   │   ├── tasks/                    # 任务输入、任务列表、迷你日历、统计
│   │   ├── tools/                    # 开发者工具箱（JSON/正则/Base64 等）
│   │   ├── vendors/                  # AI 供应商管理
│   │   └── workspace/                # 工作区外壳（空态、同步设置）
│   ├── composables/                  # 共享状态与逻辑（模块级单例模式）
│   ├── diagnostics/                  # 结构化日志、错误归一化、invoke 追踪
│   ├── domain/                       # 笔记工作区领域模型
│   ├── notes/                        # 任务引用解析与索引
│   ├── plugin-api/                   # 插件沙箱运行时与权限 API
│   ├── styles/                       # 设计令牌（tokens.css）与全局样式
│   ├── utils/                        # 通用工具（错误码、文件树、编辑器工具）
│   ├── __tests__/                    # Vitest 单元测试
│   ├── App.vue                       # 主窗口根组件（模块切换）
│   ├── main.ts                       # 入口（按窗口类型挂载根组件）
│   └── types.ts                      # TypeScript 类型定义
├── src-tauri/                        # Rust 后端
│   ├── src/
│   │   ├── main.rs                   # 应用入口（委托 lib.rs）
│   │   ├── lib.rs                    # 应用初始化、82 个 Tauri 命令注册
│   │   ├── models.rs                 # 数据模型（Task、DataStore、ConfigStore）
│   │   ├── persistence.rs            # JSON 持久化、路径解析、工作区初始化
│   │   ├── store.rs                  # 兼容聚合入口（重导出）
│   │   ├── task_service.rs           # 任务业务逻辑
│   │   ├── note_service.rs           # 笔记文件操作
│   │   ├── ai.rs                     # AI 调用（OpenAI 兼容 API）
│   │   ├── prompt.rs                 # Prompt 模板管理（8 个内置模板）
│   │   ├── reminder.rs               # 到期提醒线程
│   │   ├── shortcuts.rs              # 全局快捷键
│   │   ├── instance_lock.rs          # 单实例锁
│   │   ├── file_watcher.rs           # 笔记文件监听
│   │   ├── plugin_protocol.rs        # 插件自定义协议
│   │   ├── logging.rs                # 结构化日志系统
│   │   └── commands/                 # Tauri 命令薄层
│   │       ├── tasks.rs              # 任务命令
│   │       ├── config.rs             # 配置命令（窗口、主题、模块）
│   │       ├── ai.rs                 # AI 命令
│   │       ├── notes.rs              # 笔记命令
│   │       ├── plugins.rs            # 插件与脚本命令
│   │       ├── prompt.rs             # Prompt 管理命令
│   │       ├── screenshot.rs         # 截图命令
│   │       ├── export.rs             # 笔记导出（Pandoc）
│   │       ├── update.rs             # 更新检查命令
│   │       ├── logging.rs            # 日志采集命令
│   │       └── mod.rs
│   ├── capabilities/default.json     # Tauri 权限配置
│   ├── Cargo.toml
│   └── tauri.conf.json               # 窗口定义、CSP、打包配置
├── supabase/migrations/              # 数据库迁移（RLS、Realtime）
├── docs/                             # 架构文档、ADR、实施计划、项目状态
├── scripts/                          # 构建辅助脚本
├── update/                           # 更新清单（windows.json）
├── .github/workflows/                # CI（rust.yml）与 CD（cd.yml）
└── package.json
```

## 配置说明

### AI 设置

1. 打开设置面板 → AI 供应商
2. 添加供应商（支持 OpenAI、通义千问等兼容 API）
3. 启用并设为默认
4. 配置后 AI 功能自动生效

Prompt 模板位于数据目录的 `prompts/` 子目录，可直接编辑 `.md` 文件调整 AI 行为。

### 同步设置

1. 在设置 → 同步中查看同步码或输入已有同步码
2. 确保已配置 Supabase 环境变量
3. 配对后任务数据自动双向同步

### 窗口模式

| 窗口       | 尺寸               | 特性                               |
| ---------- | ------------------ | ---------------------------------- |
| `main`     | 1000×600（可缩放） | 标准窗口、完整功能                 |
| `floating` | 260×320            | 无边框、透明背景、始终置顶、可拖拽 |
| `import`   | 400×560            | 无边框、透明背景、始终置顶         |
| `selector` | 全屏               | 透明选区覆盖层、截图 OCR           |

### 数据存储位置

| 系统    | 路径                                                    |
| ------- | ------------------------------------------------------- |
| Windows | `C:\Users\<用户名>\AppData\Roaming\com.prism.app\data\` |
| macOS   | `~/Library/Application Support/com.prism.app/data/`     |
| Linux   | `~/.local/share/com.prism.app/data/`                    |

## 质量保证

### 本地检查

| 检查项      | 命令                                        | 通过标准 |
| ----------- | ------------------------------------------- | -------- |
| 前端格式化  | `npm run format`                            | 无改动   |
| 类型检查    | `npx vue-tsc --noEmit`                      | 零错误   |
| Rust 格式化 | `cargo fmt --all --check`                   | 零差异   |
| Rust Clippy | `cargo clippy --all-targets -- -D warnings` | 零警告   |

### CI/CD

GitHub Actions 在 push/PR 到 `master` 时自动执行：

- 前端：Prettier → TypeScript 类型检查 → Vite 构建
- 后端：`cargo fmt` → `cargo clippy` → `cargo build` → `cargo test`

## 许可

MIT
