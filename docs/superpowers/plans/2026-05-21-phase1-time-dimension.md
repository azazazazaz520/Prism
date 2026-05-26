# Phase 1: Time Dimension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add due dates, a mini calendar for date filtering, date picker for task input, and overdue/in-app reminders to the TODO app.

**Architecture:** Extend the Task data model with `due_date: Option<String>` (ISO-8601) in both Rust and TypeScript. Add a `MiniCalendar` component at the top of the app for date-based filtering, a `DatePicker` popup for selecting dates, and update `TaskItem` to show due dates with colored left borders (overdue=red, today=orange, future=blue) and text labels. Add `get_tasks_by_date` backend command. Defer Tauri notification plugin to a follow-up — use in-app visual indicators instead.

**Tech Stack:** Tauri 2, Rust, Vue 3 + TypeScript, Vite

---

## File map

| File | Action | Responsibility |
|------|--------|---------------|
| `src-tauri/src/store.rs` | Modify | Add `due_date` field to Task struct |
| `src-tauri/src/main.rs` | Modify | Update `add_task`, `update_task`; add `get_tasks_by_date` |
| `src/types.ts` | Modify | Add `due_date` to Task interface |
| `src/components/MiniCalendar.vue` | Create | Embedded calendar for date filtering |
| `src/components/DatePicker.vue` | Create | Popup calendar for picking a due date |
| `src/components/TaskInput.vue` | Modify | Add date picker button next to input |
| `src/components/TaskItem.vue` | Modify | Show due date with colored border + text |
| `src/App.vue` | Modify | Integrate MiniCalendar, date filtering state |

---

### Task 1: Extend data model (Rust + TypeScript)

**Files:**
- Modify: `src-tauri/src/store.rs:6-12`
- Modify: `src/types.ts:1-7`

- [ ] **Step 1: Add `due_date` to Rust Task struct**

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub completed: bool,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub due_date: Option<String>,  // ISO-8601 date string
}
```

- [ ] **Step 2: Add `due_date` to TypeScript Task interface**

```typescript
export interface Task {
  id: string;
  title: string;
  completed: boolean;
  created_at: string;
  completed_at: Option<string>;
  due_date: string | null;
}
```

- [ ] **Step 3: Update Rust test in store.rs for new field**

In `src-tauri/src/store.rs`, update `test_task_serialization`:

```rust
#[test]
fn test_task_serialization() {
    let task = Task {
        id: "test-id".to_string(),
        title: "测试任务".to_string(),
        completed: false,
        created_at: "2026-05-17T00:00:00+08:00".to_string(),
        completed_at: None,
        due_date: Some("2026-05-21".to_string()),
    };
    let json = serde_json::to_string(&task).unwrap();
    let parsed: Task = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.title, "测试任务");
    assert!(!parsed.completed);
    assert!(parsed.completed_at.is_none());
    assert_eq!(parsed.due_date, Some("2026-05-21".to_string()));
}
```

- [ ] **Step 4: Run Rust tests**

```bash
cd src-tauri && cargo test
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/store.rs src/types.ts
git commit -m "feat: add due_date field to Task model (Rust + TS)"
```

---

### Task 2: Update backend commands

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Update `add_task` to accept optional `due_date`**

In `src-tauri/src/main.rs`, replace the `add_task` function:

```rust
#[tauri::command]
fn add_task(state: tauri::State<AppState>, title: String, due_date: Option<String>) -> Result<store::Task, String> {
    let mut store = state.store.lock().unwrap();
    let task = store::Task {
        id: uuid::Uuid::new_v4().to_string(),
        title,
        completed: false,
        created_at: chrono::Utc::now().to_rfc3339(),
        completed_at: None,
        due_date,
    };
    store.tasks.push(task.clone());
    store::save_tasks(&store)?;
    Ok(task)
}
```

- [ ] **Step 2: Update `update_task` to support `due_date`**

In `src-tauri/src/main.rs`, replace the `update_task` function:

```rust
#[tauri::command]
fn update_task(state: tauri::State<AppState>, id: String, title: Option<String>, due_date: Option<String>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    if let Some(task) = store.tasks.iter_mut().find(|t| t.id == id) {
        if let Some(t) = title {
            task.title = t;
        }
        // due_date is passed explicitly: None = no change, Some(None) = clear, Some(Some(d)) = set
        if due_date.is_some() {
            task.due_date = due_date.unwrap();
        }
    }
    store::save_tasks(&store)
}
```

Wait — Tauri doesn't support `Option<Option<String>>` well via serde. Use a sentinel approach instead: `due_date` is always passed, but we use a string to distinguish "clear" from "keep". Simpler: pass `due_date: Option<String>` where `None` = keep current, `Some("")` = clear, `Some(date)` = set.

Actually, even simpler: just always pass `due_date` as `Option<String>`. If `None`, don't change. If `Some(str)`, set it (empty string clears).

No wait — Tauri's command deserialization should handle Option. But needing to distinguish "don't change" from "clear" requires a workaround. Let's keep it simple: always pass the full due_date value. The frontend will always send the current value.

Actually, the simplest approach for `update_task`: just accept `due_date: Option<String>` where:
- Not provided / omitted in JS = treated as "don't change"  
- Actually, in Tauri, if we make it `Option<String>`, the frontend can pass `null` or omit it.

But the existing `update_task` takes `id` and `title`. If we add `due_date` as optional, the frontend needs to know what to pass. Let me just make it explicit:

The `update_task` will take `id`, `title` (optional), and `due_date` (optional). The frontend always passes the current value it wants. So from the frontend:

```ts
await invoke('update_task', { id, title, dueDate: task.due_date });
```

So in Rust, `due_date` is `Option<String>` — when the frontend passes `null` it becomes `None`, when it passes a string it becomes `Some(date)`.

The issue is: the current `update_task` takes `title: String`. If we change it to `title: Option<String>`, existing callers break. Let me instead add a separate `update_task_due_date` command or just change the signature.

Simplest approach: Change `update_task` to take `title: Option<String>` and `due_date: Option<String>`. Since `Option<String>` in Tauri deserializes from both missing and null values, the frontend can selectively pass what it wants to update.

Let me rewrite:

```rust
#[tauri::command]
fn update_task(state: tauri::State<AppState>, id: String, title: Option<String>, due_date: Option<String>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    if let Some(task) = store.tasks.iter_mut().find(|t| t.id == id) {
        if let Some(t) = title {
            task.title = t;
        }
        task.due_date = due_date;
    }
    store::save_tasks(&store)
}
```

Wait, this changes the semantics. Currently the frontend calls `update_task(id, title)` — if we change to `Option<String>` for title, the frontend must pass `{ id, title }` as before and it works because a string deserializes to `Some(title)`. And if `due_date` is omitted, it becomes `None`.

But `task.due_date = due_date` would set it to `None` when omitted, clearing any existing due_date. That's wrong.

OK, let me just keep it simple and direct. Use `due_date: Option<String>` where:
- The frontend always passes the current `task.due_date` value
- If the frontend wants to clear it, pass `null`

So:
```rust
#[tauri::command]
fn update_task(state: tauri::State<AppState>, id: String, title: String, due_date: Option<String>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    if let Some(task) = store.tasks.iter_mut().find(|t| t.id == id) {
        task.title = title;
        task.due_date = due_date;
    }
    store::save_tasks(&store)
}
```

This is cleaner. `title` stays required, `due_date` is optional. Frontend always passes both. Let me go with this.

- [ ] **Step 2 (revised): Update `update_task` to support `due_date`**

```rust
#[tauri::command]
fn update_task(state: tauri::State<AppState>, id: String, title: String, due_date: Option<String>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    if let Some(task) = store.tasks.iter_mut().find(|t| t.id == id) {
        task.title = title;
        task.due_date = due_date;
    }
    store::save_tasks(&store)
}
```

- [ ] **Step 3: Add `get_tasks_by_date` command**

```rust
#[tauri::command]
fn get_tasks_by_date(state: tauri::State<AppState>, date: String) -> Vec<store::Task> {
    state.store.lock().unwrap()
        .tasks
        .iter()
        .filter(|t| t.due_date.as_deref() == Some(&date))
        .cloned()
        .collect()
}
```

- [ ] **Step 4: Update invoke_handler registration**

In the `main()` function, update the handler list (add `get_tasks_by_date`):

```rust
.invoke_handler(tauri::generate_handler![
    get_tasks,
    add_task,
    toggle_task,
    update_task,
    delete_task,
    clear_completed,
    get_tasks_by_date,
])
```

- [ ] **Step 5: Verify Rust compiles**

```bash
cd src-tauri && cargo build
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/main.rs src-tauri/Cargo.toml
git commit -m "feat: update backend commands for due_date support"
```

---

### Task 3: Create DatePicker popup component

**Files:**
- Create: `src/components/DatePicker.vue`

- [ ] **Step 1: Create DatePicker.vue**

This is a popup that appears next to the input. It shows a mini calendar grid for picking a single date.

```vue
<script setup lang="ts">
import { ref, computed } from 'vue';

const emit = defineEmits<{
  select: [date: string | null];
}>();

defineProps<{
  visible: boolean;
}>();

const today = new Date();
const currentYear = ref(today.getFullYear());
const currentMonth = ref(today.getMonth());

const weekDays = ['一', '二', '三', '四', '五', '六', '日'];

const daysInMonth = computed(() => {
  return new Date(currentYear.value, currentMonth.value + 1, 0).getDate();
});

const firstDayOfWeek = computed(() => {
  const d = new Date(currentYear.value, currentMonth.value, 1).getDay();
  return d === 0 ? 6 : d - 1; // Monday = 0
});

const days = computed(() => {
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek.value; i++) {
    cells.push(null);
  }
  for (let d = 1; d <= daysInMonth.value; d++) {
    cells.push(d);
  }
  return cells;
});

function prevMonth() {
  if (currentMonth.value === 0) {
    currentMonth.value = 11;
    currentYear.value--;
  } else {
    currentMonth.value--;
  }
}

function nextMonth() {
  if (currentMonth.value === 11) {
    currentMonth.value = 0;
    currentYear.value++;
  } else {
    currentMonth.value++;
  }
}

function selectDay(day: number) {
  const m = String(currentMonth.value + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  emit('select', `${currentYear.value}-${m}-${d}`);
}

function clearDate() {
  emit('select', null);
}

function isToday(day: number): boolean {
  return (
    currentYear.value === today.getFullYear() &&
    currentMonth.value === today.getMonth() &&
    day === today.getDate()
  );
}
</script>

<template>
  <div v-if="visible" class="datepicker">
    <div class="dp-header">
      <button class="dp-nav" @click="prevMonth">&lt;</button>
      <span class="dp-month">{{ currentYear }}年 {{ currentMonth + 1 }}月</span>
      <button class="dp-nav" @click="nextMonth">&gt;</button>
    </div>
    <div class="dp-weekdays">
      <span v-for="wd in weekDays" :key="wd" class="dp-wd">{{ wd }}</span>
    </div>
    <div class="dp-grid">
      <button
        v-for="(cell, i) in days"
        :key="i"
        :class="[
          'dp-day',
          { empty: cell === null, today: cell !== null && isToday(cell) }
        ]"
        :disabled="cell === null"
        @click="cell !== null && selectDay(cell)"
      >
        {{ cell }}
      </button>
    </div>
    <button class="dp-clear" @click="clearDate">清除日期</button>
  </div>
</template>

<style scoped>
.datepicker {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: white;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 12px;
  z-index: 10;
  width: 260px;
}

.dp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.dp-month {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.dp-nav {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: #666;
  padding: 2px 8px;
  border-radius: 4px;
}

.dp-nav:hover {
  background: #f0f0f0;
}

.dp-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  margin-bottom: 4px;
}

.dp-wd {
  text-align: center;
  font-size: 12px;
  color: #999;
  padding: 4px 0;
}

.dp-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.dp-day {
  aspect-ratio: 1;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #333;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dp-day.empty {
  cursor: default;
}

.dp-day:hover:not(.empty) {
  background: #e8f0fe;
}

.dp-day.today {
  background: #4a90d9;
  color: white;
}

.dp-clear {
  width: 100%;
  margin-top: 8px;
  padding: 6px;
  background: none;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 13px;
  color: #999;
  cursor: pointer;
}

.dp-clear:hover {
  background: #f5f5f5;
}
</style>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx vue-tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/DatePicker.vue
git commit -m "feat: add DatePicker popup component"
```

---

### Task 4: Create MiniCalendar component

**Files:**
- Create: `src/components/MiniCalendar.vue`

- [ ] **Step 1: Create MiniCalendar.vue**

Embedded calendar at the top of the app. Click a date to filter tasks. Shows dots on dates that have tasks.

```vue
<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Task } from '../types';

const props = defineProps<{
  tasks: Task[];
}>();

const emit = defineEmits<{
  selectDate: [date: string | null];
}>();

const selectedDate = ref<string | null>(null);
const today = new Date();
const currentYear = ref(today.getFullYear());
const currentMonth = ref(today.getMonth());

const weekDays = ['一', '二', '三', '四', '五', '六', '日'];

const daysInMonth = computed(() =>
  new Date(currentYear.value, currentMonth.value + 1, 0).getDate()
);

const firstDayOfWeek = computed(() => {
  const d = new Date(currentYear.value, currentMonth.value, 1).getDay();
  return d === 0 ? 6 : d - 1;
});

const days = computed(() => {
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek.value; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth.value; d++) cells.push(d);
  return cells;
});

const datesWithTasks = computed(() => {
  const set = new Set<string>();
  for (const t of props.tasks) {
    if (t.due_date) set.add(t.due_date);
  }
  return set;
});

function dateKey(day: number): string {
  const m = String(currentMonth.value + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${currentYear.value}-${m}-${d}`;
}

function prevMonth() {
  if (currentMonth.value === 0) { currentMonth.value = 11; currentYear.value--; }
  else currentMonth.value--;
}

function nextMonth() {
  if (currentMonth.value === 11) { currentMonth.value = 0; currentYear.value++; }
  else currentMonth.value++;
}

function selectDay(day: number) {
  const dk = dateKey(day);
  if (selectedDate.value === dk) {
    selectedDate.value = null;
    emit('selectDate', null);
  } else {
    selectedDate.value = dk;
    emit('selectDate', dk);
  }
}

function isToday(day: number): boolean {
  return currentYear.value === today.getFullYear() &&
    currentMonth.value === today.getMonth() &&
    day === today.getDate();
}

function isSelected(day: number): boolean {
  return selectedDate.value === dateKey(day);
}
</script>

<template>
  <div class="mini-calendar">
    <div class="mc-header">
      <button class="mc-nav" @click="prevMonth">&lt;</button>
      <span class="mc-month">{{ currentYear }}年 {{ currentMonth + 1 }}月</span>
      <button class="mc-nav" @click="nextMonth">&gt;</button>
    </div>
    <div class="mc-weekdays">
      <span v-for="wd in weekDays" :key="wd" class="mc-wd">{{ wd }}</span>
    </div>
    <div class="mc-grid">
      <button
        v-for="(cell, i) in days"
        :key="i"
        :class="[
          'mc-day',
          {
            empty: cell === null,
            today: cell !== null && isToday(cell),
            selected: cell !== null && isSelected(cell),
            'has-task': cell !== null && datesWithTasks.has(dateKey(cell))
          }
        ]"
        :disabled="cell === null"
        @click="cell !== null && selectDay(cell)"
      >
        {{ cell }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.mini-calendar {
  background: white;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  padding: 12px 16px;
  margin-bottom: 16px;
}

.mc-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.mc-month {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.mc-nav {
  background: none;
  border: none;
  font-size: 14px;
  cursor: pointer;
  color: #888;
  padding: 2px 8px;
  border-radius: 4px;
}

.mc-nav:hover { background: #f0f0f0; }

.mc-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  margin-bottom: 2px;
}

.mc-wd {
  text-align: center;
  font-size: 11px;
  color: #aaa;
  padding: 2px 0;
}

.mc-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.mc-day {
  aspect-ratio: 1;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: #333;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.mc-day.empty { cursor: default; }

.mc-day:hover:not(.empty) { background: #e8f0fe; }

.mc-day.today {
  font-weight: 700;
  color: #4a90d9;
}

.mc-day.selected {
  background: #4a90d9;
  color: white;
}

.mc-day.has-task::after {
  content: '';
  position: absolute;
  bottom: 2px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #4a90d9;
}

.mc-day.selected.has-task::after {
  background: white;
}
</style>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx vue-tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/MiniCalendar.vue
git commit -m "feat: add MiniCalendar component"
```

---

### Task 5: Update TaskInput with date selection

**Files:**
- Modify: `src/components/TaskInput.vue`

- [ ] **Step 1: Add DatePicker integration to TaskInput**

The emit now includes an optional `due_date`. A calendar icon button opens the DatePicker.

```vue
<script setup lang="ts">
import { ref } from 'vue';
import DatePicker from './DatePicker.vue';

const emit = defineEmits<{
  add: [title: string, due_date: string | null];
}>();

const title = ref('');
const showError = ref(false);
const dueDate = ref<string | null>(null);
const showPicker = ref(false);

function handleSubmit() {
  const trimmed = title.value.trim();
  if (!trimmed) {
    showError.value = true;
    setTimeout(() => { showError.value = false; }, 2000);
    return;
  }
  emit('add', trimmed, dueDate.value);
  title.value = '';
  dueDate.value = null;
  showError.value = false;
  showPicker.value = false;
}

function onDateSelect(date: string | null) {
  dueDate.value = date;
  showPicker.value = false;
}

function formatDueDate(d: string): string {
  const [y, m, day] = d.split('-');
  return `${m}/${day}`;
}
</script>

<template>
  <div class="task-input">
    <div class="input-row">
      <input
        v-model="title"
        type="text"
        placeholder="输入新任务..."
        :class="['task-input-field', { error: showError }]"
        @keydown.enter="handleSubmit"
      />
      <div class="date-btn-wrapper">
        <button
          :class="['date-btn', { active: dueDate }]"
          title="设置截止日期"
          @click="showPicker = !showPicker"
        >
          📅
        </button>
        <DatePicker
          :visible="showPicker"
          @select="onDateSelect"
        />
      </div>
      <button class="task-input-btn" @click="handleSubmit">添加</button>
    </div>
    <div v-if="dueDate" class="due-preview">
      截止: {{ formatDueDate(dueDate) }}
      <button class="due-preview-clear" @click="dueDate = null">×</button>
    </div>
  </div>
</template>

<style scoped>
.task-input { margin-bottom: 16px; }

.input-row {
  display: flex;
  gap: 8px;
}

.task-input-field {
  flex: 1;
  padding: 10px 14px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s;
}

.task-input-field:focus { border-color: #4a90d9; }
.task-input-field.error { border-color: #e74c3c; }

.date-btn-wrapper {
  position: relative;
}

.date-btn {
  padding: 10px;
  background: none;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  transition: border-color 0.2s;
}

.date-btn:hover, .date-btn.active { border-color: #4a90d9; }

.task-input-btn {
  padding: 10px 20px;
  background: #4a90d9;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.task-input-btn:hover { background: #357abd; }

.due-preview {
  margin-top: 6px;
  font-size: 13px;
  color: #4a90d9;
  display: flex;
  align-items: center;
  gap: 6px;
}

.due-preview-clear {
  background: none;
  border: none;
  color: #ccc;
  cursor: pointer;
  font-size: 16px;
  padding: 0;
  line-height: 1;
}

.due-preview-clear:hover { color: #e74c3c; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TaskInput.vue
git commit -m "feat: add date picker integration to TaskInput"
```

---

### Task 6: Update TaskItem with due date display

**Files:**
- Modify: `src/components/TaskItem.vue`

- [ ] **Step 1: Add due date display with colored left border**

Add a computed property for due date status and display it below the title. Left border color indicates status.

```vue
<script setup lang="ts">
import { ref, nextTick, computed } from 'vue';
import type { Task } from '../types';

const props = defineProps<{
  task: Task;
}>();

const emit = defineEmits<{
  toggle: [id: string];
  update: [id: string, title: string];
  delete: [id: string];
}>();

const editing = ref(false);
const editTitle = ref('');

function startEdit() {
  editTitle.value = props.task.title;
  editing.value = true;
  nextTick(() => {
    const input = document.getElementById(`edit-${props.task.id}`) as HTMLInputElement;
    input?.focus();
    input?.select();
  });
}

function confirmEdit() {
  const trimmed = editTitle.value.trim();
  if (trimmed && trimmed !== props.task.title) {
    emit('update', props.task.id, trimmed);
  }
  editing.value = false;
}

function cancelEdit() { editing.value = false; }

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffHr < 24) return `${diffHr} 小时前`;
  if (diffDay < 7) return `${diffDay} 天前`;
  return date.toLocaleDateString('zh-CN');
}

const dueStatus = computed<'overdue' | 'today' | 'upcoming' | null>(() => {
  if (!props.task.due_date) return null;
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;
  if (props.task.due_date < todayStr) return 'overdue';
  if (props.task.due_date === todayStr) return 'today';
  return 'upcoming';
});

const dueLabel = computed(() => {
  if (!props.task.due_date) return '';
  if (dueStatus.value === 'today') return '今天到期';
  if (dueStatus.value === 'overdue') return '已过期';
  return props.task.due_date;
});
</script>

<template>
  <div
    :class="['task-item', {
      completed: task.completed,
      editing: editing,
      [dueStatus || '']: !task.completed && dueStatus
    }]"
  >
    <input
      type="checkbox"
      class="task-checkbox"
      :checked="task.completed"
      @change="emit('toggle', task.id)"
    />

    <div class="task-body" @dblclick="startEdit">
      <template v-if="!editing">
        <span :class="['task-title', { done: task.completed }]">{{ task.title }}</span>
        <span class="task-meta">
          <span class="task-time">{{ formatTime(task.created_at) }}</span>
          <span v-if="dueLabel" :class="['due-badge', dueStatus]">{{ dueLabel }}</span>
        </span>
      </template>
      <template v-else>
        <input
          :id="`edit-${task.id}`"
          v-model="editTitle"
          type="text"
          class="task-edit-input"
          @keydown.enter="confirmEdit"
          @keydown.escape="cancelEdit"
          @blur="confirmEdit"
        />
      </template>
    </div>

    <button
      v-if="!editing"
      class="task-delete-btn"
      title="删除"
      @click="emit('delete', task.id)"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
.task-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  border-left: 3px solid transparent;
  transition: background 0.15s;
}

.task-item:hover { background: #f8f9fa; }
.task-item.completed { background: #fafafa; }

.task-item.overdue { border-left-color: #e74c3c; }
.task-item.today { border-left-color: #f39c12; }
.task-item.upcoming { border-left-color: #4a90d9; }

.task-checkbox {
  width: 18px;
  height: 18px;
  margin-right: 12px;
  cursor: pointer;
  accent-color: #4a90d9;
  flex-shrink: 0;
}

.task-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  cursor: default;
}

.task-title {
  font-size: 15px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-title.done { text-decoration: line-through; color: #aaa; }

.task-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.task-time {
  font-size: 12px;
  color: #999;
}

.due-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.due-badge.overdue { background: #fde8e8; color: #e74c3c; }
.due-badge.today { background: #fef3e0; color: #e67e22; }
.due-badge.upcoming { background: #e8f0fe; color: #4a90d9; }

.task-edit-input {
  font-size: 15px;
  padding: 4px 8px;
  border: 2px solid #4a90d9;
  border-radius: 6px;
  outline: none;
  width: 100%;
}

.task-delete-btn {
  background: none;
  border: none;
  color: #ccc;
  font-size: 20px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.15s;
}

.task-delete-btn:hover { color: #e74c3c; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TaskItem.vue
git commit -m "feat: add due date display with colored borders to TaskItem"
```

---

### Task 7: Integrate everything in App.vue

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: Add MiniCalendar, date filtering, and updated prop passing**

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { Task } from './types';
import TaskInput from './components/TaskInput.vue';
import TaskList from './components/TaskList.vue';
import TaskStats from './components/TaskStats.vue';
import MiniCalendar from './components/MiniCalendar.vue';

const tasks = ref<Task[]>([]);
const filterDate = ref<string | null>(null);

onMounted(async () => {
  tasks.value = await invoke<Task[]>('get_tasks');
});

const filteredTasks = computed(() => {
  if (!filterDate.value) return tasks.value;
  return tasks.value.filter(t => t.due_date === filterDate.value);
});

const overdueCount = computed(() => {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;
  return tasks.value.filter(t => t.due_date && t.due_date < todayStr && !t.completed).length;
});

async function handleAdd(title: string, due_date: string | null) {
  const task = await invoke<Task>('add_task', { title, dueDate: due_date });
  tasks.value.push(task);
}

async function handleToggle(id: string) {
  await invoke('toggle_task', { id });
  const task = tasks.value.find(t => t.id === id);
  if (task) {
    task.completed = !task.completed;
    task.completed_at = task.completed ? new Date().toISOString() : null;
  }
}

async function handleUpdate(id: string, title: string) {
  const task = tasks.value.find(t => t.id === id);
  const dueDate = task?.due_date ?? null;
  await invoke('update_task', { id, title, dueDate });
  if (task) task.title = title;
}

async function handleDelete(id: string) {
  await invoke('delete_task', { id });
  tasks.value = tasks.value.filter(t => t.id !== id);
}

async function handleClearCompleted() {
  await invoke('clear_completed');
  tasks.value = tasks.value.filter(t => !t.completed);
}

function handleSelectDate(date: string | null) {
  filterDate.value = date;
}
</script>

<template>
  <div class="app">
    <h1 class="app-title">TODO</h1>
    <MiniCalendar
      :tasks="tasks"
      @select-date="handleSelectDate"
    />
    <div v-if="overdueCount > 0" class="overdue-alert">
      ⚠️ {{ overdueCount }} 项任务已过期
    </div>
    <TaskInput @add="handleAdd" />
    <TaskList
      :tasks="filteredTasks"
      @toggle="handleToggle"
      @update="handleUpdate"
      @delete="handleDelete"
    />
    <TaskStats
      :tasks="tasks"
      @clear-completed="handleClearCompleted"
    />
  </div>
</template>

<style scoped>
.app {
  max-width: 480px;
  margin: 0 auto;
  padding: 24px 20px;
  min-height: 100vh;
}

.app-title {
  font-size: 28px;
  font-weight: 700;
  color: #1a1a2e;
  margin-bottom: 16px;
  text-align: center;
}

.overdue-alert {
  background: #fde8e8;
  color: #c0392b;
  font-size: 13px;
  padding: 8px 12px;
  border-radius: 8px;
  margin-bottom: 12px;
  text-align: center;
}
</style>
```

- [ ] **Step 2: Verify full TypeScript compilation**

```bash
npx vue-tsc --noEmit
```

- [ ] **Step 3: Verify Rust compilation**

```bash
cd src-tauri && cargo build
```

- [ ] **Step 4: Commit**

```bash
git add src/App.vue
git commit -m "feat: integrate MiniCalendar, date filtering, and overdue alerts"
```

---

### Task 8: End-to-end verification

- [ ] **Step 1: Build and run the app**

```bash
npm run tauri dev
```

- [ ] **Step 2: Manual smoke test checklist**

1. Add a task without a due date — should work as before
2. Add a task WITH a due date — date preview shown before adding; task appears with blue left border
3. Add a task due today — orange left border + "今天到期" badge
4. Add a task due yesterday — red left border + "已过期" badge + overdue alert at top
5. Click a date in MiniCalendar — only tasks due on that date shown
6. Click the same date again — filter cleared, all tasks shown
7. Dates with tasks show a dot in MiniCalendar
8. Toggle a task — completed tasks don't show due date status
9. Clear completed — only uncompleted tasks remain
10. Double-click to edit — works as before

- [ ] **Step 3: Fix any issues found**

- [ ] **Step 4: Final commit if changes needed**

```bash
git add -A && git commit -m "fix: address issues found during e2e testing"
```
