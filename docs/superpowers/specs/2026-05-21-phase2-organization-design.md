# Phase 2: 分类组织 — Design Spec

**日期：** 2026-05-21
**状态：** 已确认

## 功能概述

在 Phase 1（时间维度）基础上，增加四项组织能力：

1. **标签系统** — 多标签，自由创建，标签筛选即分组
2. **重要标记** — 布尔开关，星标显示
3. **置顶** — 跨日期始终可见，列表顶部独立分区
4. **每日重复** — 统一实例，按日期记录完成状态

---

## 数据模型

### Task 新增字段（TypeScript）

```typescript
export interface Task {
  id: string;
  title: string;
  completed: boolean;
  created_at: string;
  completed_at: string | null;
  due_date: string | null;
  // Phase 2 新增
  tags: string[];
  important: boolean;
  pinned: boolean;
  is_daily: boolean;
}
```

### Task 新增字段（Rust）

```rust
pub struct Task {
    pub id: String,
    pub title: String,
    pub completed: bool,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub due_date: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub important: bool,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub is_daily: bool,
}
```

`#[serde(default)]` 确保现有 JSON 数据无需迁移，缺失字段自动填充默认值。

### DailyCompletion（每日完成追踪）

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyCompletion {
    pub task_id: String,
    pub date: String,  // YYYY-MM-DD
}
```

存放在 `TaskStore` 中：

```rust
pub struct TaskStore {
    pub version: u32,
    pub tasks: Vec<Task>,
    pub daily_completions: Vec<DailyCompletion>,  // Phase 2 新增
}
```

### 每日任务 completed 计算规则

- `task.is_daily == false` → `task.completed` 字段直接使用
- `task.is_daily == true` → 前端根据当前视图日期检查 `daily_completions`：
  - 存在 `{ task_id, 当前日期 }` → 显示为已完成
  - 不存在 → 显示为未完成

---

## UI 布局（方案 A：扁平展开）

### 整体结构（从上到下）

```
┌─ App ────────────────────────┐
│ 标题 "TODO"                   │
│ MiniCalendar（Phase 1）       │
│ 标签筛选栏（Phase 2 新增）     │
│ 过期提醒（Phase 1）           │
│ TaskInput（Phase 1 + 2 增强） │
│ TaskList                      │
│   ├─ 📌 已置顶 分区           │
│   │   ├─ 任务1 ⭐ ☀️ [标签]  │
│   │   └─ 任务2 ⭐ [标签]     │
│   └─ 其他任务                 │
│       └─ 任务3 [标签]         │
│ TaskStats                     │
└───────────────────────────────┘
```

### 标签筛选栏

- 位于 MiniCalendar 下方、TaskInput 上方
- 横向滚动 chips：`[全部] [工作] [会议] [健康] [+]`
- "全部" 默认选中，点击标签筛选，再点同一标签取消
- "+" 按钮用于创建新标签（输入标签名后回车）
- 自动从已有任务收集标签列表

### TaskInput 增强

- 现有：输入框 + 📅日历按钮 + 添加按钮
- 新增：快捷开关行 — ⭐重要 📌置顶 ☀️每日 🏷标签
- 标签展开：点击 🏷标签 出现标签输入框 + 已添加的 tag chips
- 底部摘要行显示当前配置预览

### TaskItem 增强

- 左边框颜色：保持 Phase 1 逻辑（过期红/今天橙/未来蓝）
- 标题右侧：⭐星标（重要） + ☀️太阳图标（每日）
- 标签行：多个 tag chips 灰色圆角显示
- 置顶任务：列表上方独立 "📌 已置顶" 分区
- 已完成任务：不显示标签颜色、星标

---

## 后端命令变更

### 新增命令

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `add_task` | `title, due_date, tags, important, pinned, is_daily` | `Task` | 签名扩展，新字段可选 |
| `update_task` | `id, title, due_date, tags, important, pinned, is_daily` | `()` | 签名扩展 |
| `toggle_daily_task` | `id, date` | `()` | 切换每日任务指定日期的完成状态 |
| `get_all_tags` | — | `Vec<String>` | 返回所有已用标签，去重排序 |
| `delete_tag` | `tag` | `()` | 从所有任务中移除此标签 |

### 修改命令

- `add_task` — 新增 `tags, important, pinned, is_daily` 参数，全部 `Option<T>` 带默认值：
  - `tags: Option<Vec<String>>` — 默认 `vec![]`
  - `important: Option<bool>` — 默认 `false`
  - `pinned: Option<bool>` — 默认 `false`
  - `is_daily: Option<bool>` — 默认 `false`
- `update_task` — 新增 `tags, important, pinned, is_daily` 参数，前端每次传全量值
- `toggle_task` — 仅用于非每日任务的完成切换，签名不变
- `toggle_daily_task` — 用于每日任务，接收 `(id, date)`，插入/删除 `DailyCompletion` 记录

### 前端 toggle 分流逻辑

TaskItem 点击 checkbox 时：
```
if (task.is_daily) → invoke('toggle_daily_task', { id, date: todayStr })
else → invoke('toggle_task', { id })
```

两种调用返回后都需重新计算 `completed` 的显示状态。

---

## 排序规则

1. 置顶任务排在最前（📌 分区）
2. 重要任务排在普通任务前
3. 同类内按 `created_at` 倒序
4. 已完成任务排在最后

---

## 前端状态

```typescript
// App.vue 新增
const selectedTags = ref<string[]>([]);  // 当前筛选的标签
const allTags = ref<string[]>([]);      // 所有可用标签

const filteredTasks = computed(() => {
  let result = tasks.value;
  // 日期筛选（Phase 1）
  if (filterDate.value) {
    result = result.filter(t => t.due_date === filterDate.value);
  }
  // 标签筛选（Phase 2）
  if (selectedTags.value.length > 0) {
    result = result.filter(t =>
      selectedTags.value.some(tag => t.tags.includes(tag))
    );
  }
  return result;
});

const sortedTasks = computed(() => {
  // 置顶 → 重要 → 普通 → 已完成
});
```

---

## 向后兼容性

- 所有新字段 `#[serde(default)]`，现有 JSON 无需迁移
- 标签为空数组 `[]`，布尔字段默认 `false`
- `daily_completions` 默认为空数组
- 前端所有现有调用不加新参数时使用默认值
