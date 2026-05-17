# TODO 桌面工具 — 设计文档

**日期**: 2026-05-17  
**版本**: 1.0 (基础版)

## 概述

一个基于 Tauri + Vue 3 的桌面 TODO 应用。基础版支持任务的添加、完成、编辑和删除，数据通过 JSON 文件本地存储。

## 技术栈

| 项 | 选择 |
|----|------|
| 桌面框架 | Tauri 2.x |
| 前端框架 | Vue 3 (Composition API) |
| 构建工具 | Vite |
| 后端语言 | Rust |
| 数据存储 | 本地 JSON 文件 |

## 架构

```
┌──────────────────────────────┐
│       Tauri 桌面壳            │
│  ┌────────────────────────┐  │
│  │    Vue 前端             │  │
│  │  TaskInput / TaskList   │  │
│  │  TaskItem / TaskStats   │  │
│  └────────────────────────┘  │
│         ↕ Tauri IPC           │
│  ┌────────────────────────┐  │
│  │   Rust 后端 (store.rs)  │  │
│  │   JSON 文件读写          │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

## 数据模型

```typescript
interface Task {
  id: string;           // UUID v4
  title: string;        // 任务内容
  completed: boolean;   // 是否完成
  createdAt: string;    // 创建时间 ISO-8601
  completedAt?: string; // 完成时间 ISO-8601
}
```

JSON 文件格式 (`~/.todo-app/tasks.json`):

```json
{
  "version": 1,
  "tasks": [...]
}
```

## 组件树

```
App.vue
├── TaskInput.vue      # 输入框 + 添加按钮
├── TaskList.vue       # 任务列表容器
│   └── TaskItem.vue   # 单条任务行 (显示/编辑/删除)
└── TaskStats.vue      # 底部统计 + 清除已完成
```

## 项目文件结构

```
TODO/
├── src/
│   ├── App.vue
│   ├── main.ts
│   ├── types.ts
│   └── components/
│       ├── TaskInput.vue
│       ├── TaskList.vue
│       ├── TaskItem.vue
│       └── TaskStats.vue
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   └── store.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## 数据流

1. 应用启动 → Rust 读取 JSON 文件 → 返回任务列表 → Vue 渲染
2. 用户操作 (增/改/删) → Vue 调用 `invoke()` → Rust 更新 JSON 文件 → 返回结果
3. 每次操作后自动保存，无需手动存盘

## 界面

- 顶部：输入框 + 添加按钮
- 中间：任务列表（复选框 | 文字 | 创建时间 | 删除按钮）
- 底部：统计信息（总数/已完成） + 清除已完成按钮

## 边界情况

- JSON 文件不存在：创建空文件 `{ "version": 1, "tasks": [] }`
- JSON 格式损坏：重置为空任务列表并提示用户
- 空标题：拒绝添加，给出视觉提示
- 窗口关闭：Tauri 生命周期确保写入完成

## 不在范围内 (基础版)

- 分类/标签
- 截止日期/优先级
- 搜索/过滤
- 云端同步
- 子任务/备注
- 日历视图
