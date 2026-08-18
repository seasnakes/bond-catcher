# 规范化迭代与 Git/CI 工作流

## 核心事实

GitHub Actions 只能检查已经提交并推送到 GitHub 的代码，不能发现开发机上忘记提交的修改。因此要同时使用：

1. 本地统一验证；
2. 小而完整的提交；
3. Pull Request；
4. `main` 分支必需状态检查。

## 每个迭代切片

1. 从最新 `main` 建 `codex/<topic>` 分支。
2. 一个切片只解决一个可验收行为；数据迁移与功能代码分开。
3. 开发中运行目标测试，提交前运行：

   ```bash
   bash scripts/verify.sh
   ```

4. 查看 `git status --short` 和 `git diff --check`，只暂存本切片明确文件。
5. 提交信息采用 `feat:`、`fix:`、`refactor:`、`test:`、`docs:` 等前缀。
6. 推送分支并发 PR；PR 写明数据源、交易边界、验证证据和回滚方式。
7. CI 绿色且审阅完成后合并；不要在功能未验收时积累几十个本地提交。

## CI 做什么

`.github/workflows/ci.yml` 在 PR、`main` push 和手动触发时运行唯一检查 `repository-verification`：

- 全部项目 JavaScript 语法检查；
- Python 脚本编译；
- 全部 Node/Python 单测；
- 关闭 MiniQMT 自动拉起和通达信写能力后的本地服务冒烟；
- `/`、`/api/state`、`/api/indices` 必须返回成功。

CI 不连接真实账户、不下单，也不以外部行情 HTTP 200 证明实时数据完整。

## GitHub 建议设置

首次 workflow 在远端跑通后，为 `main` 建 branch protection/ruleset：

- Require a pull request before merging；
- Require status checks to pass；
- 必需检查选择唯一名称 `repository-verification`；
- Require conversation resolution；
- 禁止 force push 和删除；
- 当前只有一位维护者时可不强制第二人审批，但不允许绕过 CI。

## 工作区卫生

- `.playwright-mcp/`、`runtime/`、`outputs/`、`tmp/`、日志和缓存不提交。
- `data/board-state.json` 是用户状态；只有明确要更新共享默认看板时才提交。
- 大批未提交修改先按功能拆分并逐批验证，不能用一次 `git add .` 混成一个提交。
- GitHub Actions 不自动提交本地修改；需要提醒时应由 Codex 在交付前报告 `git status`，而不是让机器人自动把未知文件推上远端。
