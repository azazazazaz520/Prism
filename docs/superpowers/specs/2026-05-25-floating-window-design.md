# TODO 悬浮窗 + 透明度 + 截止提醒

**日期**: 2026-05-25
**状态**: 设计已确认

## 概述

为 TODO 桌面应用增加三个功能：
1. 悬浮窗模式 — 卡片轮播显示未完成任务，常驻屏幕
2. 可调透明度 — 滑块调节悬浮窗透明度
3. 截止提醒 — 任务到期前通过系统通知提醒

## 技术方案

Tauri v2 不支持动态切换 `transparent` 和 `decorations`，采用双窗口方案。

### 窗口配置

| 窗口 | label | 配置 |
|------|-------|------|
| 主窗口 | main | 480×640, 有标题栏, 不置顶, 默认可见 |
| 悬浮窗 | floating | 320×200, `decorations: false`, `transparent: true`, `alwaysOnTop: true`, `visible: false`, `resizable: false` |

两个窗口共享同一个 Rust 后端和数据。窗口切换通过互相显隐实现：
- 主窗口 → "切换到悬浮窗"按钮 → 隐藏 main，显示 floating
- 悬浮窗 → "退出悬浮窗"按钮 → 隐藏 floating，显示 main
- 关闭任一窗口 → 两个窗口同时退出

### 前端新增

**FloatingWindow.vue** — 卡片轮播悬浮窗（floating 窗口入口）
- 布局：顶部栏 + 任务卡片 + 轮播控制
- 顶部栏：未完成任务计数、⚙️控制按钮
- 控制面板下拉：透明度滑块(0.3–1.0)、自动轮播间隔(3s/5s/10s/关闭)、截止提醒时间、退出按钮
- 卡片：标题、标签、截止状态（过期/今天/即将）、重要标记
- 轮播：默认 5s 自动切换，悬停暂停，左右箭头手动切换，指示点

**App.vue** — 添加"切换到悬浮窗"按钮

**TaskInput.vue / TaskItem.vue** — 无需改动（截止提醒设置在悬浮窗控制面板中）

### 前端路由

Vite 单页面项目，通过查询参数区分窗口：
- 主窗口：`/index.html` (或 `/index.html?window=main`)
- 悬浮窗：`/index.html?window=floating`

入口时读取参数，条件渲染 `App.vue` 或 `FloatingWindow.vue`。

### Rust 后端新增

**依赖：**
- `tauri-plugin-notification` — 系统通知

**窗口管理命令：**
- `show_floating_window(app)` — 显示 floating，隐藏 main
- `show_main_window(app)` — 显示 main，隐藏 floating

**通知命令：**
- `set_reminder_minutes(minutes: u32)` — 设置提前提醒时间
- `get_reminder_minutes() -> u32` — 获取当前设置

**后台检查线程：**
- 每 60 秒扫描未完成任务
- 计算截止时间与当前时间的差值
- 差值在 (0, reminder_minutes] 区间内时，通过 notification plugin 发送系统通知
- 同一任务在同一天内不重复通知（通过内存中维护当天已通知任务 ID 集合）

**TaskStore 新增字段：**
```rust
#[serde(default = "default_reminder_minutes")]
pub reminder_minutes: u32,  // 默认 30
```

## 文件变更清单

| 文件 | 操作 |
|------|------|
| `src-tauri/Cargo.toml` | 新增 `tauri-plugin-notification` 依赖 |
| `src-tauri/tauri.conf.json` | 新增 floating 窗口配置 |
| `src-tauri/capabilities/default.json` | 新增 notification 权限 |
| `src-tauri/src/main.rs` | 新增窗口管理、通知命令、后台线程 |
| `src-tauri/src/store.rs` | TaskStore 新增 reminder_minutes |
| `src/App.vue` | 新增悬浮窗切换按钮 |
| `src/components/FloatingWindow.vue` | 新建 — 卡片轮播悬浮窗 |
| `src/main.ts` (或入口) | 根据查询参数条件渲染 |
| `index.html` | 可能新增 floating.html 入口 |

## 通知内容格式

```
⏰ 任务即将到期
"完成项目报告" 将在 30 分钟后到期
```

## 数据流

```
Rust后台线程 → 扫描tasks → 发现到期任务 → tauri-plugin-notification → 系统通知
                                                                    ↓
main窗口 ←── 按钮切换 ──→ floating窗口
  (完整功能)              (卡片轮播 + 透明度控制)
```
