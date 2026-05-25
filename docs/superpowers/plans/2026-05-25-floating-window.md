# 悬浮窗 + 透明度 + 截止提醒 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 TODO Tauri 桌面应用增加卡片轮播悬浮窗（始终置顶）、透明度滑块调节、任务截止前系统通知三个功能

**Architecture:** 双窗口方案 — 主窗口 (main) 用于完整功能，悬浮窗 (floating) 用于卡片轮播。两窗口共享同一个 Rust 后端，通过 `tauri::WebviewWindow` API 互相显隐。前端通过 URL query 参数 (`?window=floating`) 区分窗口并条件渲染不同组件。后台 Rust 线程每 60 秒扫描截止任务并通过 `tauri-plugin-notification` 发送系统通知

**Tech Stack:** Tauri v2, Rust, Vue 3 + TypeScript, Vite

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src-tauri/Cargo.toml` | 修改 | 新增 `tauri-plugin-notification` 依赖 |
| `src-tauri/tauri.conf.json` | 修改 | 新增 floating 窗口配置 + `withGlobalTauri: true` |
| `src-tauri/capabilities/default.json` | 修改 | 新增 notification 权限 |
| `src-tauri/src/store.rs` | 修改 | TaskStore 新增 `reminder_minutes` 字段 |
| `src-tauri/src/main.rs` | 修改 | 窗口管理命令 + 通知命令 + 后台检查线程 |
| `src/main.ts` | 修改 | 根据 URL query 参数条件挂载不同根组件 |
| `src/components/FloatingWindow.vue` | 新建 | 卡片轮播悬浮窗完整组件 |
| `src/App.vue` | 修改 | 新增"切换到悬浮窗"按钮 |
| `package.json` | 修改 | 新增 `@tauri-apps/plugin-notification` 前端依赖 |

---

### Task 1: Rust 依赖与数据模型

**Files:**
- Modify: `src-tauri/Cargo.toml:9-16`
- Modify: `src-tauri/src/store.rs:29-34`

- [ ] **Step 1: 添加 tauri-plugin-notification 依赖**

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 中添加：

```toml
[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
dirs = "5"
tauri-plugin-notification = "2"
```

- [ ] **Step 2: 在 TaskStore 中添加 reminder_minutes 字段**

修改 `src-tauri/src/store.rs` 的 `TaskStore` 结构体：

```rust
fn default_reminder_minutes() -> u32 { 30 }

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskStore {
    pub version: u32,
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub daily_completions: Vec<DailyCompletion>,
    #[serde(default = "default_reminder_minutes")]
    pub reminder_minutes: u32,
}
```

同步更新 `load_tasks` 中的 fallback 和测试代码：

`load_tasks` 中两处 fallback `TaskStore` 构造添加 `reminder_minutes: 30,`：

```rust
pub fn load_tasks() -> TaskStore {
    let path = get_store_path();
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| TaskStore {
            version: 1,
            tasks: vec![],
            daily_completions: vec![],
            reminder_minutes: 30,
        }),
        Err(_) => TaskStore {
            version: 1,
            tasks: vec![],
            daily_completions: vec![],
            reminder_minutes: 30,
        },
    }
}
```

- [ ] **Step 3: 验证编译**

```bash
cd src-tauri && cargo check
```

Expected: 编译通过，无错误

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/store.rs
git commit -m "feat: add tauri-plugin-notification dependency and reminder_minutes to TaskStore"
```

---

### Task 2: Tauri 窗口配置与权限

**Files:**
- Modify: `src-tauri/tauri.conf.json:12-23`
- Modify: `src-tauri/capabilities/default.json:1-7`

- [ ] **Step 1: 添加 floating 窗口配置**

修改 `src-tauri/tauri.conf.json` 的 `app.windows` 数组：

```json
"app": {
  "windows": [
    {
      "label": "main",
      "title": "TODO",
      "width": 480,
      "height": 640,
      "resizable": true
    },
    {
      "label": "floating",
      "title": "TODO",
      "width": 320,
      "height": 200,
      "decorations": false,
      "transparent": true,
      "alwaysOnTop": true,
      "resizable": false,
      "visible": false,
      "url": "/?window=floating"
    }
  ],
  "security": {
    "csp": null
  }
}
```

- [ ] **Step 2: 添加 notification 权限**

修改 `src-tauri/capabilities/default.json`，在 `permissions` 数组中添加 `notification:default`：

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "default capability",
  "windows": ["main", "floating"],
  "permissions": ["core:default", "notification:default"]
}
```

注意：`windows` 数组也需要添加 `"floating"`，否则 floating 窗口没有权限。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "feat: add floating window config and notification permissions"
```

---

### Task 3: Rust 窗口管理命令

**Files:**
- Modify: `src-tauri/src/main.rs:1-10, 150-171`

- [ ] **Step 1: 添加窗口管理命令**

在 `src-tauri/src/main.rs` 文件末尾（`main()` 函数之前）添加两个新命令：

```rust
#[tauri::command]
fn show_floating_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main_win) = app.get_webview_window("main") {
        main_win.hide().map_err(|e| e.to_string())?;
    }
    if let Some(float_win) = app.get_webview_window("floating") {
        float_win.show().map_err(|e| e.to_string())?;
        float_win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(float_win) = app.get_webview_window("floating") {
        float_win.hide().map_err(|e| e.to_string())?;
    }
    if let Some(main_win) = app.get_webview_window("main") {
        main_win.show().map_err(|e| e.to_string())?;
        main_win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

- [ ] **Step 2: 注册 notification 插件和新命令**

修改 `main()` 函数，添加 plugin 注册和新命令到 `invoke_handler`：

```rust
fn main() {
    let store = store::load_tasks();
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            store: Mutex::new(store),
        })
        .invoke_handler(tauri::generate_handler![
            get_tasks,
            add_task,
            toggle_task,
            toggle_daily_task,
            update_task,
            delete_task,
            clear_completed,
            get_tasks_by_date,
            get_all_tags,
            delete_tag,
            get_daily_completions,
            show_floating_window,
            show_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: 验证编译**

```bash
cd src-tauri && cargo check
```

Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat: add window management commands for floating/main window switching"
```

---

### Task 4: Rust 截止提醒命令与后台线程

**Files:**
- Modify: `src-tauri/src/main.rs`（在 Task 3 基础上继续修改）

- [ ] **Step 1: 添加 AppState 中的通知追踪字段**

修改 `AppState` 结构体，新增 `notified_today` 字段用于追踪当天已通知任务：

```rust
use std::collections::HashSet;

struct AppState {
    store: Mutex<TaskStore>,
    notified_today: Mutex<HashSet<String>>,
}
```

同步更新 `main()` 中的 `manage`：

```rust
.manage(AppState {
    store: Mutex::new(store),
    notified_today: Mutex::new(HashSet::new()),
})
```

- [ ] **Step 2: 添加提醒设置命令**

在 `show_main_window` 命令之后添加：

```rust
#[tauri::command]
fn set_reminder_minutes(state: tauri::State<AppState>, minutes: u32) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.reminder_minutes = minutes;
    store::save_tasks(&store)
}

#[tauri::command]
fn get_reminder_minutes(state: tauri::State<AppState>) -> u32 {
    state.store.lock().unwrap().reminder_minutes
}
```

将这两个命令加入 `invoke_handler`。

- [ ] **Step 3: 添加后台检查线程**

在 `main()` 函数的 `.run()` 之前，通过 `.setup()` 启动后台线程：

```rust
.setup(|app| {
    let handle = app.handle().clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
            let state = handle.state::<AppState>();
            let store = state.store.lock().unwrap();
            let reminder = store.reminder_minutes;
            let now = chrono::Utc::now();
            let today = now.format("%Y-%m-%d").to_string();

            // Reset notified set at midnight
            {
                let mut notified = state.notified_today.lock().unwrap();
                if notified.get("__date__").map(|d| d != &today).unwrap_or(true) {
                    notified.clear();
                    notified.insert(today.clone());
                }
            }

            for task in &store.tasks {
                if task.completed { continue; }
                if task.due_date.is_none() { continue; }
                let due_date = task.due_date.as_ref().unwrap();

                // Parse due date as end of day UTC
                let due_str = format!("{}T23:59:59+00:00", due_date);
                if let Ok(due_time) = chrono::DateTime::parse_from_rfc3339(&due_str) {
                    let diff_secs = due_time.timestamp() - now.timestamp();
                    let diff_min = diff_secs / 60;
                    if diff_min > 0 && diff_min <= reminder as i64 {
                        let mut notified = state.notified_today.lock().unwrap();
                        if !notified.contains(&task.id) {
                            notified.insert(task.id.clone());
                            let title = task.title.clone();
                            let minutes_left = diff_min;
                            drop(notified);
                            drop(store);
                            let _ = handle
                                .plugin(
                                    tauri_plugin_notification::NotificationBuilder::new()
                                        .title("⏰ 任务即将到期")
                                        .body(format!(
                                            "\"{}\" 将在 {} 分钟后到期",
                                            title, minutes_left
                                        ))
                                        .build()
                                )
                                .map_err(|e| e.to_string());
                        }
                    }
                }
            }
        }
    });
    Ok(())
})
```

> **注意：** Tauri v2 notification plugin Rust API 若与上述代码有出入，以 `cargo doc` 中 `tauri_plugin_notification` 的实际 API 为准。核心逻辑不变：每 60s 扫描 × 截止时间差值判断 × 当天不重复通知。

- [ ] **Step 4: 验证编译**

```bash
cd src-tauri && cargo check
```

Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat: add deadline reminder commands and background notification thread"
```

---

### Task 5: 前端入口路由

**Files:**
- Modify: `src/main.ts:1-4`

- [ ] **Step 1: 根据 query 参数条件渲染**

将 `src/main.ts` 改为：

```typescript
import { createApp } from 'vue';
import App from './App.vue';
import FloatingWindow from './components/FloatingWindow.vue';

const params = new URLSearchParams(window.location.search);
const isFloating = params.get('window') === 'floating';

if (isFloating) {
  createApp(FloatingWindow).mount('#app');
} else {
  createApp(App).mount('#app');
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npx vue-tsc --noEmit
```

Expected: 无类型错误（FloatingWindow.vue 还未创建，会有 import 错误，这是预期的）

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: add conditional rendering for floating window based on URL query param"
```

---

### Task 6: FloatingWindow.vue 悬浮窗组件

**Files:**
- Create: `src/components/FloatingWindow.vue`

- [ ] **Step 1: 创建 FloatingWindow.vue**

创建文件 `src/components/FloatingWindow.vue`：

```vue
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { Task } from '../types';

const tasks = ref<Task[]>([]);
const currentIndex = ref(0);
const opacity = ref(0.92);
const carouselInterval = ref(5000);
const reminderMinutes = ref(30);
const showPanel = ref(false);
const isPaused = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

const incompleteTasks = computed(() => tasks.value.filter(t => !t.completed));

const currentTask = computed(() => {
  const list = incompleteTasks.value;
  if (list.length === 0) return null;
  return list[currentIndex.value % list.length];
});

const dueStatus = computed(() => {
  if (!currentTask.value?.due_date) return null;
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;
  if (currentTask.value.due_date < todayStr) return 'overdue';
  if (currentTask.value.due_date === todayStr) return 'today';
  return 'upcoming';
});

const dueLabel = computed(() => {
  if (!currentTask.value?.due_date) return '';
  if (dueStatus.value === 'today') return '今天到期';
  if (dueStatus.value === 'overdue') return '已过期';
  const parts = currentTask.value.due_date.split('-');
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
});

async function loadTasks() {
  tasks.value = await invoke<Task[]>('get_tasks');
  const mins = await invoke<number>('get_reminder_minutes');
  reminderMinutes.value = mins;
}

function nextCard() {
  const list = incompleteTasks.value;
  if (list.length === 0) return;
  currentIndex.value = (currentIndex.value + 1) % list.length;
  resetTimer();
}

function prevCard() {
  const list = incompleteTasks.value;
  if (list.length === 0) return;
  currentIndex.value = (currentIndex.value - 1 + list.length) % list.length;
  resetTimer();
}

function goToCard(i: number) {
  currentIndex.value = i;
  resetTimer();
}

function setOpacity(val: number) {
  opacity.value = val / 100;
}

function setCarouselInterval(ms: number) {
  carouselInterval.value = ms;
  resetTimer();
}

async function setReminder(val: number) {
  reminderMinutes.value = val;
  await invoke('set_reminder_minutes', { minutes: val });
}

function resetTimer() {
  if (timer) clearInterval(timer);
  if (carouselInterval.value > 0 && !isPaused.value) {
    timer = setInterval(nextCard, carouselInterval.value);
  }
}

function onMouseEnter() {
  isPaused.value = true;
  if (timer) clearInterval(timer);
}

function onMouseLeave() {
  isPaused.value = false;
  resetTimer();
}

async function exitFloating() {
  await invoke('show_main_window');
}

onMounted(async () => {
  await loadTasks();
  resetTimer();
  const interval = setInterval(loadTasks, 30000);
  onUnmounted(() => clearInterval(interval));
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div
    class="floating-window"
    :style="{ background: `rgba(30, 30, 40, ${opacity})` }"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <div class="topbar">
      <div class="topbar-left">
        <span>🎯 未完成:</span>
        <span class="count">{{ incompleteTasks.length }}</span>
        <span>项</span>
      </div>
      <div class="topbar-btns">
        <button
          :class="['topbar-btn', { active: showPanel }]"
          @click="showPanel = !showPanel"
        >
          ⚙️ 控制
        </button>
      </div>
    </div>

    <div class="card-area">
      <div v-if="incompleteTasks.length === 0" class="no-tasks">
        🎉 全部完成！
      </div>
      <div v-else-if="currentTask" class="card" :key="currentTask.id">
        <div class="card-title">
          <span v-if="currentTask.pinned" class="card-pin">📌</span>
          <span>{{ currentTask.title }}</span>
        </div>
        <div class="card-meta">
          <span v-for="tag in currentTask.tags" :key="tag" class="card-tag">🏷 {{ tag }}</span>
          <span v-if="dueStatus" :class="['card-due', dueStatus]">📅 {{ dueLabel }}</span>
          <span v-if="currentTask.important" class="card-important">⭐ 重要</span>
        </div>
      </div>
    </div>

    <div v-if="incompleteTasks.length > 0" class="carousel-controls">
      <button class="arrow-btn" @click="prevCard">◀</button>
      <div class="dots">
        <span
          v-for="(_, i) in incompleteTasks"
          :key="i"
          :class="['dot', { active: i === currentIndex % incompleteTasks.length }]"
          @click="goToCard(i)"
        ></span>
      </div>
      <button class="arrow-btn" @click="nextCard">▶</button>
    </div>

    <div v-if="showPanel" class="panel">
      <div class="panel-row">
        <label>🔆 透明度</label>
        <input
          type="range"
          min="30"
          max="100"
          :value="Math.round(opacity * 100)"
          @input="setOpacity(($event.target as HTMLInputElement).valueAsNumber)"
        />
        <span class="opacity-val">{{ opacity.toFixed(2) }}</span>
      </div>
      <div class="panel-row">
        <label>⏱ 自动轮播</label>
        <select
          :value="carouselInterval"
          @change="setCarouselInterval(Number(($event.target as HTMLSelectElement).value))"
        >
          <option :value="3000">3 秒</option>
          <option :value="5000">5 秒</option>
          <option :value="10000">10 秒</option>
          <option :value="0">关闭</option>
        </select>
      </div>
      <div class="panel-row">
        <label>🔔 截止提醒</label>
        <select
          :value="reminderMinutes"
          @change="setReminder(Number(($event.target as HTMLSelectElement).value))"
        >
          <option :value="0">关闭</option>
          <option :value="10">提前 10 分钟</option>
          <option :value="30">提前 30 分钟</option>
          <option :value="60">提前 1 小时</option>
        </select>
      </div>
      <button class="exit-btn" @click="exitFloating">↩ 退出悬浮窗</button>
    </div>
  </div>
</template>

<style scoped>
* { margin: 0; padding: 0; box-sizing: border-box; }

.floating-window {
  width: 320px;
  min-height: 180px;
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08);
  overflow: hidden;
  user-select: none;
  font-family: -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(255,255,255,0.05);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.topbar-left {
  font-size: 12px;
  color: #aaa;
  display: flex;
  align-items: center;
  gap: 6px;
}

.count {
  color: #4a90d9;
  font-weight: 600;
  font-size: 13px;
}

.topbar-btns { display: flex; gap: 6px; }

.topbar-btn {
  background: rgba(255,255,255,0.08);
  border: none;
  color: #999;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.topbar-btn:hover { background: rgba(255,255,255,0.15); color: #ddd; }
.topbar-btn.active { background: rgba(74,144,217,0.2); color: #4a90d9; }

.card-area {
  padding: 16px;
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card {
  width: 100%;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 14px 16px;
  animation: fadeIn 0.35s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.card-title {
  font-size: 15px;
  color: #eee;
  margin-bottom: 10px;
  line-height: 1.4;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.card-pin { flex-shrink: 0; font-size: 13px; }

.card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.card-tag {
  font-size: 10px;
  background: rgba(74,144,217,0.2);
  color: #6db3f2;
  padding: 2px 7px;
  border-radius: 8px;
}

.card-due {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 8px;
  font-weight: 500;
}

.card-due.overdue { background: rgba(231,76,60,0.2); color: #f07070; }
.card-due.today { background: rgba(243,156,18,0.2); color: #f5b642; }
.card-due.upcoming { background: rgba(74,144,217,0.15); color: #6db3f2; }

.card-important { font-size: 11px; color: #f5b642; }

.no-tasks { text-align: center; color: #666; font-size: 14px; }

.carousel-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px 12px;
  gap: 14px;
}

.arrow-btn {
  background: rgba(255,255,255,0.06);
  border: none;
  color: #888;
  font-size: 16px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.arrow-btn:hover { background: rgba(255,255,255,0.15); color: #ddd; }

.dots { display: flex; gap: 6px; }

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255,255,255,0.2);
  transition: all 0.2s;
  cursor: pointer;
}

.dot.active {
  background: #4a90d9;
  box-shadow: 0 0 6px rgba(74,144,217,0.5);
}

.panel {
  border-top: 1px solid rgba(255,255,255,0.06);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.panel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #999;
}

.panel-row label { flex-shrink: 0; margin-right: 10px; }

.panel-row input[type="range"] {
  flex: 1;
  accent-color: #4a90d9;
  height: 4px;
}

.opacity-val {
  min-width: 32px;
  text-align: right;
  font-family: monospace;
  font-size: 11px;
}

.panel-row select {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.1);
  color: #ccc;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 12px;
  outline: none;
  cursor: pointer;
}

.panel-row select option { background: #2d2d2d; color: #ccc; }

.exit-btn {
  width: 100%;
  margin-top: 4px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  color: #999;
  padding: 6px;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.exit-btn:hover {
  background: rgba(231,76,60,0.15);
  color: #e74c3c;
  border-color: rgba(231,76,60,0.3);
}
</style>
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npx vue-tsc --noEmit
```

Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add src/components/FloatingWindow.vue
git commit -m "feat: add FloatingWindow component with card carousel, opacity slider, and reminder settings"
```

---

### Task 7: App.vue 悬浮窗切换按钮

**Files:**
- Modify: `src/App.vue:197`

- [ ] **Step 1: 在 App.vue 模板中添加悬浮窗切换按钮**

在 `src/App.vue` 的 `<template>` 中，`<h1 class="app-title">TODO</h1>` 之后添加按钮：

```html
<h1 class="app-title">TODO</h1>
<button class="float-mode-btn" @click="switchToFloating">🔲 悬浮窗模式</button>
```

- [ ] **Step 2: 添加对应的 script 方法和样式**

在 `<script setup>` 中添加方法：

```typescript
import { invoke } from '@tauri-apps/api/core';

async function switchToFloating() {
  await invoke('show_floating_window');
}
```

注意：`invoke` 已经在 App.vue 中被 import 了（line 3），所以只需要添加 `switchToFloating` 函数。

在 `<style scoped>` 中添加按钮样式：

```css
.float-mode-btn {
  display: block;
  width: 100%;
  padding: 8px;
  margin-bottom: 12px;
  background: #1a1a2e;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.float-mode-btn:hover { background: #2d2d44; }
```

- [ ] **Step 3: 验证编译**

```bash
npx vue-tsc --noEmit
```

Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/App.vue
git commit -m "feat: add floating mode toggle button to App.vue"
```

---

### Task 8: 前端 notification 依赖与最终验证

**Files:**
- Modify: `package.json:13-14`

- [ ] **Step 1: 安装前端 notification 依赖**

```bash
npm install @tauri-apps/plugin-notification
```

- [ ] **Step 2: 完整构建验证**

```bash
npm run build
```

Expected: 构建成功，`dist/` 目录生成

- [ ] **Step 3: Tauri 完整编译验证**

```bash
cd src-tauri && cargo build
```

Expected: Rust 编译成功

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @tauri-apps/plugin-notification frontend dependency"
```

---

## 验证清单

实现完成后，逐项验证：

1. `npm run tauri dev` 启动应用，主页正常显示
2. 点击"悬浮窗模式"按钮 → 主窗口隐藏，悬浮窗显示在屏幕右上角
3. 悬浮窗卡片自动轮播，鼠标悬停暂停
4. ◀ ▶ 按钮和指示点手动切换卡片
5. ⚙️ 控制面板 → 透明度滑块拖动能看到窗口变透明
6. 自动轮播间隔下拉切换正常
7. 截止提醒时间下拉切换并持久化（重启应用后保持）
8. 点击"退出悬浮窗" → 悬浮窗隐藏，主窗口显示
9. 创建一个2分钟后到期的任务，设置提醒为"提前30分钟" → 等待约1分钟后收到系统通知
