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
5. 提交信息采用 Conventional Commits，见下文“提交规范”。
6. 推送分支并发 PR；PR 写明数据源、交易边界、验证证据和回滚方式。
7. CI 绿色且审阅完成后合并；不要在功能未验收时积累几十个本地提交。

## 首次克隆后

```bash
npm run setup:git
```

该命令把 `core.hooksPath` 指向 `.githooks/`，启用 `.gitmessage` 提交模板，并设置 `pull.ff=only`、`fetch.prune=true`、`push.autoSetupRemote=true`。

## 分支命名

| 分支 | 用途 |
| --- | --- |
| `main` | 已验收、可部署的版本，只通过 PR 合并 |
| `codex/<topic>` | 单个功能或修复切片，例如 `codex/repo-hygiene-server-split` |
| `hotfix/<topic>` | 线上问题的最小修复，合并后删除 |

导入或部署前的快照用附注标签记录，例如 `import/2026-11-10`；发布版本用 `vYYYY.MM.DD`。

## 提交规范

格式为 `<type>(<scope>): <summary>`，摘要用祈使句，不超过 72 个字符，结尾不加句号。

- `type`：`feat`、`fix`、`perf`、`refactor`、`test`、`docs`、`chore`、`ci`、`build`、`revert`、`style`。
- `scope` 可选，沿用模块名：`board`、`bond`、`heatmap`、`bond-tags`、`quant`、`cb-ai`、`limit-ladder`、`auction`、`new-bond`、`qmt`、`miniqmt-api`、`server`、`prince`、`windows`、`data`、`git`。
- 不兼容的接口或数据格式变更在类型后加 `!`，并在正文写 `BREAKING CHANGE:`。
- 正文说明为什么改、涉及哪些数据源与交易边界、如何验证、如何回滚。

`.githooks/commit-msg` 在本地校验格式；PR 上的 `commit-messages` 检查只校验规范启用之后的提交（基线写在 `scripts/check-commit-message.sh`）。

## 提交前钩子

`.githooks/pre-commit` 只检查暂存文件，耗时在一秒左右：

- `git diff --cached --check`（行尾空白、冲突标记）；
- 暂存的 JavaScript 跑 `node --check`，Python 做语法编译；
- 单个文件超过 5 MB 拒绝提交（`MAX_COMMIT_FILE_BYTES` 可调）；
- 拒绝 `runtime/`、`tmp/`、`outputs/`、日志、`.env*` 和 SQLite 文件；
- 拒绝 `data/board-state.json`，确需发布为共享默认看板时用 `ALLOW_BOARD_STATE_COMMIT=1 git commit ...`。

完整测试和本地服务冒烟仍由 `bash scripts/verify.sh` 负责。

## CI 做什么

`.github/workflows/ci.yml` 在 PR、`main` push 和手动触发时运行 `repository-verification`：

- 全部项目 JavaScript 语法检查；
- Python 脚本编译；
- 全部 Node/Python 单测；
- 关闭 MiniQMT 自动拉起和通达信写能力后的本地服务冒烟；
- `/`、`/quant.html`、`/api/state`、`/api/indices` 和量化接口必须返回成功。

PR 上另有 `commit-messages`，检查新提交的标题格式。

CI 不连接真实账户、不下单，也不以外部行情 HTTP 200 证明实时数据完整。

## GitHub 建议设置

首次 workflow 在远端跑通后，为 `main` 建 branch protection/ruleset：

- Require a pull request before merging；
- Require status checks to pass；
- 必需检查选择 `repository-verification` 和 `commit-messages`；
- Require conversation resolution；
- 禁止 force push 和删除；
- 当前只有一位维护者时可不强制第二人审批，但不允许绕过 CI。

## 工作区卫生

- `.playwright-mcp/`、`.specstory/`、`runtime/`、`outputs/`、`tmp/`、日志和缓存不提交；启动脚本把轮换后的日志放进 `runtime/logs/`。
- `data/board-state.json` 是用户状态；只有明确要更新共享默认看板时才提交。
- 大批未提交修改先按功能拆分并逐批验证，不能用一次 `git add .` 混成一个提交。
- GitHub Actions 不自动提交本地修改；需要提醒时应由 Codex 在交付前报告 `git status`，而不是让机器人自动把未知文件推上远端。
