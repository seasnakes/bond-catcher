# Windows 单机部署

本部署包来自 Mac 本地工作区，包含未提交的最新修改及仓库外的监控源码。程序包与数据包分别保存；包内的 `release-program.json` / `release-data.json` 提供逐文件 SHA-256 清单。QMT 策略与中继配置带有本人的账户标识，这是一份私用迁移包，不应上传公开仓库。

## 首次安装

1. 在目标 Windows 安装并登录券商大 QMT；另外安装独立 Python 3.11 或更新版本。QMT 自带的旧 Python 只供券商终端使用，不能用来启动网页和数据 API。
2. 将 `finance-windows-program.zip` 解压到如 `D:\Finance`，得到 `D:\Finance\finance-windows`。将数据包解压到同一个父目录，使数据落入同一 `finance-windows` 文件夹。第一次使用空目录；以后升级不要用程序包的 `data` 覆盖自己的板块和人工标签。
3. 双击 `01-install.cmd`，它建立专用 Python 环境并安装固定版本依赖；若没有 Node，会下载官方 Node 22.22.1 Windows x64 便携版并核对 SHA-256。不会改变系统 PATH 或全局 PowerShell 执行策略。需要联网。
4. 在 QMT 中导入 `qmt\FINANCE_BIGQMT_READONLY_PIPE.py` 并运行。同一终端已有此策略时直接复用，在编辑器观察至少 10 秒日志持续更新；不要重复导入或重复运行。策略文件是 GBK 编码，不要用文本编辑器另存成其他编码。配置必须与目标账户一致；更换账户应重新构建策略和中继配置。
5. 双击 `02-start.cmd`，启动中继、网关、数据服务、网页并打开 `http://localhost:5173`。若本机已有 15588 中继，复用它；其他端口被占用时会报错，不会终止别的程序。
6. 双击 `03-check.cmd`，实际检查主页、板块状态、转债标签、正价报价和至少 5 根日 K。全部通过后，盘中用 `04-monitor.cmd` 启动新数据采集。生产监控默认关闭通达信旁路采集，避免调用原 Mac 工具路径。

`05-stop.cmd` 只停止本安装启动的进程，不停止券商 QMT 或复用的外部中继。`06-status.cmd` 查询进程状态。日志在 `runtime\windows-logs`。本包未自动创建开机任务；QMT 登录和策略运行仍是前提。监控默认收盘后结束，下一交易日需再次启动。

可指定已安装的独立 Python 和 Node：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\setup.ps1 -Python 'C:\Python311\python.exe' -Node 'C:\Program Files\nodejs\node.exe'
```

## 配置和数据

`windows.local.json` 在首次安装时生成，可以设置 `web_port`、`api_port`、`gateway_port`、`relay_port`、`relay_root`、`monitor_root` 和 `node`。默认端口为 5173、18890、18889、15588；只监听本机，内部连接均使用 127.0.0.1，交易路由关闭。代理例外自动保留并补上回环地址。停止本安装后再改端口。

- `data`：当前板块、标签和静态资料，随程序初次迁移。
- `runtime`：研究库、分钟补数、竞价历史、模拟账户、星图和看板缓存等。
- `monitor\runtime\data`：每日监控 SQLite 库；`monitor\runtime\board-spark-samples.sqlite3` 保存采样。
- 数据包的 SQLite 文件通过在线备份 API 导出，每库执行 `quick_check`，不直接复制活动 WAL。各数据库在各自备份时刻保持一致，不宣称所有数据库是同一时刻的全局快照。
- 不复制 Mac 的服务 PID、任务队列、日志、旧重复备份、登录令牌或 Python 环境。已有历史库的日期范围与缺口保持原样。
- QMT 原始行情缓存属于券商终端，本包不含；新主机若未下载相应历史，需要在其 QMT 中准备。复制 Mac 研究库不等于复制了 QMT 原始缓存。

## 可选功能

Mac 访问 Windows 时，使用 Windows 的局域网 IP 和网页端口，例如 `http://Windows局域网IP:15173/`；`127.0.0.1` 始终指打开浏览器的那台电脑。默认仅本机访问；需要局域网访问时，在 `windows.local.json` 设置 `web_bind_host` 为 `0.0.0.0`，并在 `web_allowed_remote_addresses` 数组中填写允许访问的 Mac IP，再配套添加仅允许该 Mac 到网页端口的防火墙规则。网页入口会额外核对真实连接地址；网关、数据 API 和中继继续只监听回环地址。原有的仅本机写操作限制仍保留，包括发起 AI 分析、模拟盘修改和实盘操作。IP 变化后需相应更新配置与规则。

可用 `windows.local.json` 的 `codex` 字段保存本机实际 `codex.exe` 路径；启动管理器会将其传入 AI 服务，重启后仍生效。

AI 分析需要在 Windows 本机安装并登录 Codex；可用 `CB_AI_CODEX_PATH` 指定实际 `codex.exe`。不复制 Mac 登录凭据。通达信跳转需要 Windows 本机 TQ 服务 17709；未安装通达信时，不影响 QMT 主链路。原 Mac 的 Codex 定时任务、飞书和其他外部工具不是本包的后台服务。

## 验证范围

以随交付的验收报告为准。虚拟机测试与物理 Windows 主机验收分别记录，程序能启动不代表全市场历史完整或盘中持续采集已验收。
