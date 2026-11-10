# 交给 DESKTOP-BLT0L0L 本机 Codex

用户已要求将本地最新版 finance 看板迁移到这台 Windows 主机，并明确由本机 Codex 完成。直接执行安装、兼容修复和验证；只在确实缺少账号匹配信息或系统权限时询问用户。不要再要求 SSH、远程桌面或共享文件夹。不要操作 Mac 或 Parallels 虚拟机。

## 目标与边界

- 首先执行 `hostname`，应是 `DESKTOP-BLT0L0L`。这与已完成验收的 Parallels VM `SNAKEC590` 是不同机器。
- 使用本包 `finance-windows` 目录作为新的独立安装目录；发现已有运行版本时先确认其路径，备份后再决定如何切换，不能覆盖不明来源的板块数据。
- 目标是 Windows 浏览器 → 本机网页 5173 → 数据 API 18890 → 网关 18889 → 中继 15588 → 本机大 QMT 只读 PIPE 策略。MiniQMT 已退役；交易保持 disabled，不启用下单或撤单。
- 用户已授权启动这一只读链路。QMT 已登录且策略已运行时复用，不重复导入，不为验证而重新登录或重启终端。

## 执行步骤

1. 找到已下载并解压的本包，先阅读 `Windows-使用说明.md`。程序与数据 ZIP 应解压到同一父目录。使用 `.sha256` 核对压缩包，然后在首次启动前执行 `python scripts/windows/verify_package.py` 核对逐文件清单。程序包是未提交本地工作区快照，不能用 GitHub main 覆盖它。
2. 检查本机独立 Python 与 Node。已在 Windows 11 下用 Python 3.11.9 x64、Node 22.22.1、固定依赖验证通过。运行 `scripts/windows/setup.ps1`；必要时用 `-Python` / `-Node` 指定已安装的可执行文件。不要把 QMT 内置 Python 3.6 当成网页运行环境。缺少依赖时按官方途径安装到当前用户范围。
3. 用本机进程和 computer use 查看券商大 QMT 的路径、登录及已有策略。包中的 QMT 策略和中继配置来自用户现有账户；只核对是否匹配，不把完整账号写进报告。账户不匹配时暂停策略启动并询问用户，不能自动换账户。
4. 已有 `FINANCE_BIGQMT_READONLY_PIPE` 时，通过“我的 → 对应策略 → 编辑 → 日志输出”查看两次日志，间隔 10–12 秒确认时间戳、定时回调持续更新；仅凭“执行中策略 0”或播放三角无法判断。没有此策略时导入包内 `qmt/FINANCE_BIGQMT_READONLY_PIPE.py`（GBK 编码），确认只读配置后启动。
5. 检查端口是否被占用。默认只绑定 127.0.0.1；可以在 `windows.local.json` 更改网页/API/网关端口，不要关闭其他软件来抢端口。运行 `scripts/windows/run.ps1 -Action start`。它会复用已有 15588 中继或启动本安装的中继，并记录所管理进程的 PID、创建时间和命令行。
6. 运行 `-Action check`，再用浏览器实际检查主看板、星图、标签页、单债日 K 和一个有历史数据的分时日期。核验正价报价、有效 K 线、日期和数据条数，不能只看 HTTP 200。用 `tests/test_process_utils.py` 验证检查进程不会终止进程；用 `tests/test_windows_services.py` 验证重复启动、端口冲突和停止隔离。
7. 使用 `-Action monitor-smoke` 做 8 秒短测，结果写入 `monitor/smoke-runtime`。盘后会正常轮询但不采集新盘中行情，必须在报告中区分这一点。盘中正式采集使用 `-Action monitor`，核验每日库中的分钟记录与监控状态；默认不会安装开机计划任务，监控收盘后会退出。
8. AI 分析复用目标 Windows 本机 Codex 登录；必要时设置 `CB_AI_CODEX_PATH` 为有效 `codex.exe`，不从 Mac 复制登录令牌。通达信跳转/TQ 属可选功能，依赖本机通达信 17709；监控的旧 Mac 通达信旁路采集默认关闭。
9. 输出简短验收报告：安装目录、访问地址、实际运行进程/端口、QMT/报价/日线/历史分时/星图/监控分别是否通过、数据日期、剩余限制。确认 Windows 可以独立工作后，再由用户决定是否停掉 Mac 生产服务。

## 已完成的验证

Mac 侧已生成在线 SQLite 备份和 SHA-256 清单。Windows 虚拟机已验证独立 Python 安装、网页/API/网关启动、标签、报价、日 K、星图绘制和重复启动；星图实际显示转债 312/312、正股 309/309。监控盘后短测为 8 次轮询、0 错误，属于启动与退出验证，尚非盘中采集验收。详细证据见交付目录的 `Windows-acceptance.md`。

本文件是可执行的交接任务，不是已经完成 DESKTOP-BLT0L0L 部署的声明。目标主机还需要完成上述步骤。
