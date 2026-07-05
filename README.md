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
├── src/                              # Vue 前端
│   ├── components/
│   │   ├── AiAssistant.vue           # AI 助手对话界面
│   │   ├── AiFocusBar.vue            # 今日聚焦建议栏
│   │   ├── FloatingWindow.vue        # 悬浮窗（任务轮播）
│   │   ├── ImportFloating.vue        # 文本导入弹窗
│   │   ├── MiniCalendar.vue          # 迷你月历
│   │   ├── NoteEditor.vue            # Markdown 笔记编辑器
│   │   ├── ScreenshotSelector.vue    # 截图选区覆盖层
│   │   ├── SettingsPanel.vue         # 设置面板
│   │   ├── Sidebar.vue               # 侧边栏导航
│   │   ├── SyncStatus.vue            # 同步状态指示器
│   │   ├── TagFilterBar.vue          # 标签筛选栏
│   │   ├── TaskInput.vue             # 任务输入框
│   │   ├── TaskItem.vue              # 单个任务项
│   │   ├── TaskList.vue              # 任务列表
│   │   ├── TaskStats.vue             # 任务统计
│   │   ├── Toolbox.vue               # 开发者工具箱
│   │   ├── ToolShell.vue             # 工具容器
│   │   └── TreeNode.vue              # 递归文件树节点
│   ├── composables/
│   │   ├── useAuth.ts                # Supabase 匿名认证
│   │   ├── useSync.ts                # 跨设备同步逻辑
│   │   ├── useSyncCode.ts            # 同步码管理
│   │   ├── useTaskStore.ts           # 任务状态管理
│   │   ├── useTheme.ts               # 主题管理
│   │   ├── useAiStatus.ts            # AI 状态管理
│   │   └── useModuleRegistry.ts      # 模块注册表
│   ├── App.vue                       # 主窗口根组件
│   ├── main.ts                       # 入口（按窗口类型路由）
│   └── types.ts                      # TypeScript 类型定义
├── src-tauri/                        # Rust 后端
│   ├── src/
│   │   ├── main.rs                   # 应用入口、快捷键注册、提醒线程
│   │   ├── store.rs                  # 数据存储（JSON 读写、模型定义）
│   │   ├── ai.rs                     # AI 功能（8 个 Prompt 模板调用）
│   │   ├── notes.rs                  # 笔记文件操作
│   │   ├── prompt.rs                 # Prompt 模板管理
│   │   └── commands/
│   │       ├── tasks.rs              # 任务命令
│   │       ├── ai.rs                 # AI 命令
│   │       ├── config.rs             # 配置命令（窗口、主题、模块）
│   │       ├── sync.rs               # 同步配置命令
│   │       └── screenshot.rs         # 截图处理
│   ├── Cargo.toml
│   └── tauri.conf.json               # 窗口定义、打包配置
├── docs/                             # 项目文档（ADR、Agent 配置）
├── .github/workflows/rust.yml        # CI 流水线
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

# TODO 📝

一个轻量级桌面待办事项管理工具，基于 **Tauri v2 + Vue 3 + TypeScript** 构建。数据本地存储，无需网络，开箱即用。

## ✨ 功能

### 核心任务管理

- **任务管理** — 增删改查、完成/取消、批量清除已完成任务
- **每日任务** — 支持按日期记录完成状态,跨天独立追踪
- **标签系统** — 自定义标签、按标签筛选、标签管理
- **重要/置顶** — 标记重要任务、置顶任务优先展示
- **截止日期** — 设置任务截止日期,按日期筛选视图
- **到期提醒** — 自定义提醒提前量,系统原生通知
- **任务拆解** — AI 智能拆解复杂任务为可执行的子任务

### AI 智能助手

- **自然语言输入** — 用自然语言描述任务,AI 自动解析日期、标签、优先级
- **今日聚焦** — AI 根据截止日期和重要性智能推荐今日应优先处理的任务
- **过期任务处理** — AI 分析过期任务并给出重新安排、放弃或拆解的建议
- **智能对话** — 与 AI 助手自由对话,查询任务状态、获取建议
- **多供应商支持** — 支持配置多个 AI 供应商(OpenAI、通义千问等),灵活切换

### 界面与交互

- **迷你日历** — 侧边日历快速切换日期视图
- **悬浮窗模式** — 透明置顶小窗,轮播未完成任务,适合边工作边查看
- **侧边栏导航** — 任务看板、AI 助手、日历视图、设置模块一键切换
- **本地存储** — JSON 文件存储,数据完全离线,隐私安全

## 🖼️ 界面

| 主窗口（480×640）                          | 悬浮窗（320×360）                              | AI 助手                                  |
| ------------------------------------------ | ---------------------------------------------- | ---------------------------------------- |
| 完整任务管理：输入、列表、筛选、日历、统计 | 透明置顶小窗：轮播未完成任务、快速切换回主窗口 | 对话式交互：快捷操作、自由对话、智能建议 |

## 🛠️ 技术栈

| 层       | 技术                                          |
| -------- | --------------------------------------------- |
| 桌面框架 | [Tauri v2](https://v2.tauri.app/)             |
| 前端     | Vue 3 + TypeScript + Vite                     |
| 后端     | Rust                                          |
| 存储     | 本地 JSON 文件（`dirs` 自动定位系统数据目录） |
| 通知     | `tauri-plugin-notification`（系统原生通知）   |
| AI 集成  | `reqwest` + `tokio` 异步 HTTP 调用 LLM API    |

## 📋 环境要求

### 开发环境

- **Node.js** ≥ 20
- **Rust** ≥ 1.70（通过 [rustup](https://rustup.rs/) 安装）
- **系统依赖**（仅 Linux）：

```bash
# Ubuntu/Debian
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev
```

> macOS 和 Windows 无需额外系统依赖。

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone <repo-url>
cd TODO
```

### 2. 安装前端依赖

```bash
npm install
```

### 3. 开发模式

```bash
npm run tauri dev
```

首次运行会自动下载 Tauri 运行时和 Rust 依赖，之后每次修改前端或后端代码都会热更新。

### 4. 构建安装包

```bash
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`，包括 `.msi`/`.exe`（Windows）、`.dmg`（macOS）、`.deb`/`.AppImage`（Linux）。

## 📁 项目结构

```
TODO/
├── src/                          # Vue 前端
│   ├── components/
│   │   ├── AddVendorModal.vue    # AI 供应商添加弹窗
│   │   ├── AiAssistant.vue       # AI 助手对话界面
│   │   ├── AiFocusBar.vue        # AI 今日聚焦建议栏
│   │   ├── CommandPalette.vue    # 命令面板（快捷操作）
│   │   ├── DatePicker.vue        # 日期选择器
│   │   ├── FloatingWindow.vue    # 悬浮小窗（轮播+控制）
│   │   ├── MiniCalendar.vue      # 迷你月历
│   │   ├── ProjectTree.vue       # 项目树（Phase 2）
│   │   ├── SettingsPanel.vue     # 设置面板（AI 配置等）
│   │   ├── Sidebar.vue           # 侧边栏导航
│   │   ├── TagFilterBar.vue      # 标签筛选栏
│   │   ├── TaskInput.vue         # 任务输入框
│   │   ├── TaskItem.vue          # 单个任务项
│   │   ├── TaskList.vue          # 任务列表
│   │   ├── TaskStats.vue         # 任务统计
│   │   └── VendorList.vue        # AI 供应商列表
│   ├── App.vue                   # 主窗口根组件
│   ├── main.ts                   # 入口（按窗口类型路由）
│   └── types.ts                  # TypeScript 类型定义
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── ai.rs                 # AI 功能实现（解析、拆解、建议、对话）
│   │   ├── main.rs               # 命令注册 + 应用入口 + 提醒线程
│   │   └── store.rs              # 数据存储（JSON 读写）
│   ├── capabilities/
│   │   └── default.json          # Tauri 权限配置
│   ├── Cargo.toml                # Rust 依赖
│   └── tauri.conf.json           # Tauri 配置（窗口、打包）
├── docs/                         # 项目文档
│   ├── agents/                   # Agent 配置文档
│   └── superpowers/              # 开发计划与设计文档
├── scripts/
│   └── vision.cjs                # 识图脚本
├── .github/workflows/
│   └── rust.yml                  # CI 流水线
├── package.json                  # 项目配置（含 Prettier、Commitlint）
├── vite.config.ts
└── README.md
```

## 🔧 配置说明

### AI 设置

1. 打开设置面板,进入"AI 供应商"页面
2. 添加供应商配置(支持 OpenAI、通义千问等兼容 OpenAI API 的服务)
3. 启用并设为默认供应商
4. 配置完成后,AI 功能自动启用

> AI 配置持久化到 `tasks.json`,支持多供应商管理和切换。

### 提醒设置

- 默认提前 **30 分钟** 提醒
- 可在悬浮窗中调整提醒提前量
- 设为 `0` 关闭提醒
- 每个任务每天只提醒一次

### 窗口模式

- **主窗口**（`main`）：480×640，可缩放，标准窗口
- **悬浮窗**（`floating`）：320×360，无边框、透明背景、始终置顶、可拖拽

悬浮窗支持：

- 轮播间隔调节（1s / 3s / 5s / 暂停）
- 透明度滑块
- 鼠标悬停暂停轮播

### 数据存储位置

任务数据自动保存在系统标准数据目录下的 `tasks.json`：

| 系统    | 路径                                                             |
| ------- | ---------------------------------------------------------------- |
| Windows | `C:\Users\<用户名>\AppData\Roaming\com.todo.app\data\tasks.json` |
| macOS   | `~/Library/Application Support/com.todo.app/data/tasks.json`     |
| Linux   | `~/.local/share/com.todo.app/data/tasks.json`                    |

## 🧪 CI/CD

项目包含 GitHub Actions 工作流（`.github/workflows/rust.yml`），在 `master` 分支的 push/PR 时自动执行：

- **前端**：TypeScript 类型检查 + Vite 构建
- **后端**：`cargo fmt` → `cargo clippy` → `cargo build` → `cargo test`

## 📄 许可

MIT
