# TODO 📝

一个轻量级桌面待办事项管理工具，基于 **Tauri v2 + Vue 3 + TypeScript** 构建。数据本地存储，无需网络，开箱即用。

## ✨ 功能

- **任务管理** — 增删改查、完成/取消、批量清除已完成任务
- **每日任务** — 支持按日期记录完成状态，跨天独立追踪
- **标签系统** — 自定义标签、按标签筛选、标签管理
- **重要/置顶** — 标记重要任务、置顶任务优先展示
- **截止日期** — 设置任务截止日期，按日期筛选视图
- **到期提醒** — 自定义提醒提前量，系统原生通知
- **迷你日历** — 侧边日历快速切换日期视图
- **悬浮窗模式** — 透明置顶小窗，轮播未完成任务，适合边工作边查看
- **本地存储** — JSON 文件存储，数据完全离线，隐私安全

## 🖼️ 界面

| 主窗口（480×640） | 悬浮窗（320×360） |
|---|---|
| 完整任务管理：输入、列表、筛选、日历、统计 | 透明置顶小窗：轮播未完成任务、快速切换回主窗口 |

## 🛠️ 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | [Tauri v2](https://v2.tauri.app/) |
| 前端 | Vue 3 + TypeScript + Vite |
| 后端 | Rust |
| 存储 | 本地 JSON 文件（`dirs` 自动定位系统数据目录） |
| 通知 | `tauri-plugin-notification`（系统原生通知） |

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
│   │   ├── DatePicker.vue        # 日期选择器
│   │   ├── FloatingWindow.vue    # 悬浮小窗（轮播+控制）
│   │   ├── MiniCalendar.vue      # 迷你月历
│   │   ├── TagFilterBar.vue      # 标签筛选栏
│   │   ├── TaskInput.vue         # 任务输入框
│   │   ├── TaskItem.vue          # 单个任务项
│   │   ├── TaskList.vue          # 任务列表
│   │   └── TaskStats.vue         # 任务统计
│   ├── App.vue                   # 主窗口根组件
│   ├── main.ts                   # 入口（按窗口类型路由）
│   └── types.ts                  # TypeScript 类型定义
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── main.rs               # 命令注册 + 应用入口 + 提醒线程
│   │   └── store.rs              # 数据存储（JSON 读写）
│   ├── Cargo.toml                # Rust 依赖
│   └── tauri.conf.json           # Tauri 配置（窗口、打包）
├── .github/workflows/
│   └── rust.yml                  # CI 流水线
├── package.json
├── vite.config.ts
└── README.md
```

## 🔧 配置说明

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

| 系统 | 路径 |
|---|---|
| Windows | `C:\Users\<用户名>\AppData\Roaming\com.todo.app\data\tasks.json` |
| macOS | `~/Library/Application Support/com.todo.app/data/tasks.json` |
| Linux | `~/.local/share/com.todo.app/data/tasks.json` |

## 🧪 CI/CD

项目包含 GitHub Actions 工作流（`.github/workflows/rust.yml`），在 `master` 分支的 push/PR 时自动执行：

- **前端**：TypeScript 类型检查 + Vite 构建
- **后端**：`cargo fmt` → `cargo clippy` → `cargo build` → `cargo test`

## 📄 许可

MIT
