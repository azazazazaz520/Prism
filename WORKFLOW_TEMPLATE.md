# 开发工作流模板

> 将此文件复制到新项目的 `AGENTS.md`，按需调整技术栈相关命令。

## 开发工作流（强制执行）

每次代码修改必须严格按以下步骤执行，不得跳过：

### 1. 修改前：探索代码

- 先阅读相关文件，理解现有逻辑和架构
- 确认改动范围，避免盲目修改

### 2. 修改代码

- 遵循项目已有代码风格和注释规范

### 3. 本地质量门禁（提交前必跑）

| 检查项     | 命令                          | 通过标准 |
| ---------- | ----------------------------- | -------- |
| 代码格式化 | 根据项目配置运行 formatter    | 无改动   |
| 类型检查   | 根据项目配置运行 type checker | 零错误   |
| Lint 检查  | 根据项目配置运行 linter       | 零警告   |

> 如果检查不通过，必须先修复再提交。**不通过检查的代码绝不能提交。**

### 4. Git 提交

- 每个独立逻辑改动单独 commit
- 消息格式：Conventional Commits（`feat:`, `fix:`, `refactor:`, `style:`, `docs:` 等）
- 建议配置 Husky + lint-staged 自动格式化
- 建议配置 commitlint 自动校验提交信息

### 5. CI/CD（推荐配置）

Push/PR 时自动运行：

- 格式检查
- 类型检查
- Lint 检查
- 构建
- 测试

---

## 为本项目定制的命令

将此模板中的命令替换为实际项目命令。以 Tauri + Vue + Rust 项目为例：

```bash
# 前端
npm run format                     # Prettier 格式化
npx vue-tsc --noEmit               # TypeScript 类型检查

# 后端（进入后端目录）
cargo fmt --all --check            # Rust 格式检查
cargo clippy --all-targets -- -D warnings  # Rust Lint
cargo test --verbose               # Rust 测试
```

## 推荐的 npm 依赖

```bash
npm install --save-dev prettier husky lint-staged @commitlint/cli @commitlint/config-conventional
```

## 配置文件参考

见本仓库：

- `.prettierrc` — Prettier 配置
- `.prettierignore` — 忽略文件
- `commitlint.config.js` — Commitlint 配置
- `.husky/pre-commit` — 提交前自动格式化
- `.husky/commit-msg` — 提交信息校验
- `package.json` → `lint-staged` 字段
