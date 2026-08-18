# 2026-08-12 MiniQMT 信号与分时修复记录

## 结论

2026-08-12 盘中出现的“MiniQMT 信号不显示”并非单一页面故障，而是跨交易日游标、监控重启后的旧快照、分钟历史补洞和服务自恢复共同造成的链路问题。本次修复覆盖浏览器、Node 网关、Python 看板 API、短线监控和 Windows QMT Bridge 启动链路。

修复后的只读链路是：

```text
浏览器
  -> Node 看板 :5173
  -> Python MiniQMT API 127.0.0.1:18890
  -> 短线监控 SQLite/status
  -> Windows QMT Bridge 10.211.55.3:18888
  -> MiniQMT 行情
```

本次没有提交、撤单或修改账户，也没有清理历史 SQLite 事件。健康接口、端口监听和测试通过只能证明对应层可用；仍需用代表性实时行情或 K 线请求确认 Bridge 数据链路。

## 根因与影响时段

### 1. 跨交易日游标没有重置

前端保留了上一交易日的 `after_id`，事件 API 又没有接收并校验游标所属交易日。新交易日的事件 ID 小于旧游标时，API 会持续返回空数组，页面因此看起来“没有信号”，但 SQLite 中可能已经有当日事件。

### 2. 重启或断流后复用了过旧快照

涨速计算会寻找 1、3、5 分钟前的参考快照。旧实现允许远早于目标时刻的快照参与计算，也没有在跨日、累计成交额回退和行情恢复时完整清空盘中状态。服务恢复后的第一批行情因此可能把同一个旧价格同时当成 1、3、5 分钟基准，形成异常一致的涨速和信号突发。

已确认的污染窗口位于监控库 `runtime/data/20260812.sqlite3`：

- 2026-08-12 09:51:06～09:51:59 共写入 162 条事件，ID 为 1～162；
- 其中 156 条的非空 `speed_1m`、`speed_3m`、`speed_5m` 完全相等，属于本次根因的直接证据；
- 这些历史行被保留用于审计，没有自动删除。做回测或复盘时应排除该分钟，09:51～09:56 的重启/预热窗口也应谨慎使用。

### 3. 分钟历史补洞会阻塞 Bridge

全市场同步批量下载缺失分钟线会长时间占用 QMT 的 `xtdata` 锁，导致实时 `full_tick`、详情分时和其他行情请求排队或超时。详情页此前也可能在数据不完整或 Bridge 失败时反复触发下载，进一步放大阻塞。

### 4. 健康与前端状态过于乐观

旧健康接口只要找到数据库就可能返回正常，没有同时检查监控 PID、状态文件新鲜度、当日数据库、实时返回数量和最新行情时间。前端还会把空涨速渲染成 `0.00%`，旧筛选请求可能覆盖新筛选结果，空响应时加载状态也可能无法正确结束。

### 5. 服务进程与缓存缺少自恢复边界

Node 只在启动时拉起 18890 Python 子进程，子进程退出后不会自动恢复；竞价缓存也没有逐条校验交易日和时间。Windows QMT Bridge 计划任务原先受电池条件限制，且连续运行上限和失败重试不适合常驻服务。

## 修改点

### Finance 看板仓库

| 文件 | 修改摘要 |
| --- | --- |
| `app.js` | 保存信号交易日并随 cursor 请求发送；跨日或 API 返回 `cursor_reset` 时清空旧列表；用请求代次隔离过期响应；空响应也结束加载；健康提示使用服务端真实判定。打开转债预览或完整详情时暂停主看板批量行情与大面积重绘，丢弃旧的在途响应；关闭全部详情后只补一次行情。预览增加即时骨架、失败重试和持久 iframe 复用。 |
| `bond.js` | 盘口失败后按 15 秒、30 秒退避，成功后恢复正常频率；午休旧盘口不可用于快捷交易；默认 1 日分时不再串行等待或后台预取日 K；左侧 panel 使用 `fast=1` 本地快速首屏，panel 隐藏或页面不可见时停止 2 秒轮询。 |
| `scripts/miniqmt-dashboard-api.py` | 健康检查加入市场阶段、PID、状态/行情新鲜度、当日数据库和返回代码数；事件游标校验 `trading_date` 并在跨日或越界时归零；`fast=1` 严格只读 SQLite 与已有缓存；普通当日详情先返回，再由单线程去重的后台 GET 补齐缓存；互动日 K、正股日线与正股分时不再同步触发 `history_data2`。 |
| `server.js` | 转发事件交易日与详情 `fast` 参数；竞价缓存逐条校验日期、时刻和时间戳；18890 子进程退出后按 1～30 秒退避自动拉起，请求失败也会触发自愈检查。 |
| `scripts/start-finance-board.zsh` | 启动前轮转超过 100MB 的 `finance-board.log`，最多保留 5 份，并用固定 Node 路径启动服务。 |
| `tests/`、`package.json` | 增加游标、健康、分钟退避、竞价缓存、前端信号、盘口轮询、快速预览零 Bridge、并发压力和预览生命周期回归测试。 |

`data/board-state.json` 是用户看板状态，不属于本次修复记录的源代码范围；回滚或提交时不要顺带覆盖。

### MiniQMT 短线监控仓库

相关仓库位于：

```text
/Users/seasnake/Documents/Codex/2026-07-27/miniqmt
```

关键改动位于：

| 相对路径 | 修改摘要 |
| --- | --- |
| `outputs/miniqmt_cb_shortline_monitor/shortline_monitor.py` | 拒绝非当前交易日行情；跨日、成交额回退和全市场断流恢复时重置实时状态；1/3/5 分钟参考快照最多偏离目标 15 秒；午休不当成一分钟窗口；行情覆盖率、鲜度和请求错误进入 `quote_feed`；指标只使用连续、足够新的完整分钟；盘中后台历史缓存读取和下载默认禁用，只允许维护时显式开启，避免与实时行情争抢 Bridge 串行锁。 |
| `outputs/miniqmt_cb_shortline_monitor/service_control.py` | 保持全市场只读启动，不启用阻塞式同步历史下载；关闭父进程日志句柄；启动前轮转 100MB 日志并保留 5 份。 |
| `outputs/miniqmt_cb_shortline_monitor/test_shortline_monitor.py` | 覆盖跨日、错误日期、成交额回退、午休、20 分钟断流、低覆盖/陈旧行情、恢复清理、指标连续性和单标的补洞。 |
| `outputs/miniqmt_cb_shortline_monitor/test_service_control.py` | 覆盖日志轮转上限和启动参数不启用阻塞式批量下载。 |

监控仍是只读程序。普通五档推导的疑似主买、托盘/压盘，以及分钟指标推导的“明盘/暗盘资金”均不是 Level-2 逐笔真值。

### 服务启动链路

- macOS Finance LaunchAgent 使用 `scripts/start-finance-board.zsh`，`KeepAlive` 保证 Node 主进程退出后自动重启。
- Node 管理 18890 Python 子进程，已实测子进程退出后 1 秒重新监听。
- Monitor LaunchAgent 每 5 分钟运行一次 `service_control.py start-scheduled`，只在工作日 09:15～15:10 兜底拉起，15:10 后由监控生成收盘报告并退出。
- Windows `QMT Bridge` 计划任务当前允许电池状态启动，错过触发后补跑，失败每 1 分钟重试，最多 999 次，连续运行上限为 3650 天。
- Finance、Monitor 和 Bridge 日志都会在服务启动时检查 100MB 阈值并最多保留 5 个归档。

## 启动与健康检查

### 1. Finance 看板和内部 API

```bash
launchctl print gui/$(id -u)/com.seasnake.finance-board \
  | rg 'state =|pid =|last exit code'
lsof -nP -iTCP:5173 -sTCP:LISTEN
lsof -nP -iTCP:18890 -sTCP:LISTEN
curl --noproxy '*' -fsS http://127.0.0.1:5173/api/miniqmt/health
```

交易时段的健康结果应至少满足：

- `ok=true`、`degraded=false`；
- `monitor_alive=true`；
- `latest_trading_date` 与当日一致；
- `last_returned_codes>0`；
- `status_age_seconds` 和 `quote_age_seconds` 未超过响应中的阈值。

### 2. 短线监控

```bash
cd /Users/seasnake/Documents/Codex/2026-07-27/miniqmt/outputs/miniqmt_cb_shortline_monitor
python3 service_control.py status
```

重点查看：

- `alive=true`、`monitor.status=running`；
- `monitor.trading_date` 为当日；
- `quote_feed.status=ok`，覆盖率和鲜度达到阈值；
- `indicator_warmup.status`。`partial` 表示指标分钟覆盖仍不完整，不能把顶层 health 正常等同于所有指标已完整预热；
- `history_repair.status` 盘中默认应为 `disabled`；只有维护时显式启用后，才检查单标的修复结果和失败队列。

### 3. Windows QMT Bridge

```bash
curl --noproxy '*' -fsS http://10.211.55.3:18888/api/meta/health
curl --noproxy '*' -fsS --get \
  http://10.211.55.3:18888/api/market/full_tick \
  --data-urlencode 'stocks=113681.SH'
```

在 Windows PowerShell 中可检查：

```powershell
Get-ScheduledTask -TaskName "QMT Bridge"
Get-NetTCPConnection -LocalPort 18888 -State Listen
```

不要只看计划任务显示 `Ready` 或 Bridge health 为 200；至少再执行一次代表性 `full_tick` 或短区间 K 线请求。

## 测试与验收证据

2026-08-12 11:42（Asia/Shanghai）的只读验收结果：

- Finance Python 测试：15/15；
- Finance Node 测试（竞价 5 + 前端信号/详情 11）：16/16；
- Monitor `python3 -m unittest -v test_shortline_monitor.py test_service_control.py`：46/46；
- Finance 与 Monitor 合计：77/77；
- `node --check server.js app.js bond.js`、Python `py_compile` 和 `git diff --check` 均通过；
- 5173、18890、18888 均在监听；Finance LaunchAgent 为 `running`；
- Finance health 返回 `ok=true`、`degraded=false`；午休阶段正确返回 `healthy_outside_market_session`；
- Monitor 已加载最新代码，PID 5140、`started_at=2026-08-12T11:36:02`；午休 `quote_feed.status=inactive`，盘中历史修复为 `disabled`；
- 旧游标 `after_id=30435&trading_date=20260811` 实测返回 `cursor_reset=true`、`effective_after_id=0` 并读取 20260812 事件；
- 18890 子进程在 10:54:33 退出后触发 1 秒自愈，10:54:34 重新监听并继续返回 200；
- Bridge health 返回 `status=ok`、`trading.enabled=true`、`trading.connected=true`，代表性 `000001.SZ` K 线只读请求成功。

这组验收没有执行交易写操作。

### 详情分时性能验收

修复前，默认 1 日分时在 `/bond` 返回后仍会串行等待 `/daily?count=30`。实测 `118073` 的这个多余日 K 请求在 12.004 秒后由 5173 网关返回 503，因此单击分时可被一个不属于首屏的请求拖慢甚至失败。仅把该请求改为后台预取也不够：它仍可占用 Bridge `xtdata` 锁，并拖慢紧接着查看的下一只转债。最终实现为默认 1 日路径完全不请求日 K。

修复后的只读实测：

- 单标的首次历史缺口路径中，Bridge `market_data_ex` 首读约 0.012 秒、必要时的单标的下载约 0.135 秒、下载后重读约 0.016 秒；缓存命中不再下载。
- 18890 在 11:38:58 自愈重启为 PID 6383 并加载 60 秒缓存后，8 只转债跨 35 秒连续请求全部返回 200，端到端中位数 94.3ms，最大 706.6ms，未再出现 12 秒卡顿。
- 额外用 4 只本地 09:30～09:50 存在缺口的转债并发冷启，首次各用时 2.319～2.345 秒（Bridge 并发竞争的压力边界）；随后 30 秒内每只 15 次热请求的中位数为 75.7～85.6ms、最大 117.7ms，64 次全部返回 200 且均为 121 根分钟数据。

以上三项记录第一轮“减少重复读取”的阶段结果。用户复测仍感觉慢后，继续按浏览器点击到首价的完整链路剖析，发现主看板每 5 秒批量行情和整板重绘仍会与详情竞争，且多个已打开的看板标签会放大 Bridge 全局串行锁排队，因此又实施了下面的快速首屏与详情暂停方案。

页面保留完整图表语义：当日早盘缺口仍由 MiniQMT 1m 补齐，本地监控和实时快照继续合并最新分钟；仅取消无关日 K 等待和过度刷新。

2026-08-12 的进一步分段剖析确认，冷详情的 555～735ms 中，同步 `historical_minute_rows` 占 489～694ms；相比之下 SQLite 约 1ms、指标计算约 1～2ms、`full_tick` 约 21～43ms，热详情总耗时约 23ms。Windows Bridge 日志同时记录 14 次 15 秒全局 `xtdata` 锁等待超时，且紧邻 `history_data2`，证实互动请求不应同步下载历史。

因此详情链路继续收紧为：

- 左侧 panel 使用 `/bond?fast=1`，首响应严格只读 SQLite 与已有内存缓存，不触发 `full_tick`、`market_data_ex` 或 `history_data2`；
- 普通当日详情先返回本地 SQLite 与限时实时 tick，早盘缺口由单线程、按标的去重的后台 `market_data_ex` GET 补齐，后续轮询合并；该后台任务不调用下载端点；
- panel 隐藏或页面不可见时停止 2 秒轮询，恢复时才继续；
- `/daily`、正股日 K 与正股分时的互动 GET 全部改为 cache-only/read-first，不再同步调用 `history_data2`。专用维护流程仍可在页面请求之外补数。
- 打开预览或完整详情时，父看板暂停批量 `/quotes` 和整板重绘；已经在途的旧请求不再落地。两种详情都关闭后只进行一次恢复刷新；同一只转债重开会复用已加载的 iframe。

最终部署后的验收：

- 持续施加 100 只标的批量行情压力时，20 次 `/bond?fast=1` 全部返回 200，中位 5.72ms、P95 7.85ms、最大 22.98ms；64 路并发快速预览也全部返回 200，中位 203ms、最大 281ms。
- 经 5173 网关对 10 只代表性转债逐只请求，全部返回 200，单次 7.1～26.5ms。
- 真实浏览器点击约 333ms 即出现目标转债面板与加载骨架，约 636ms 显示首价和图表；同债关闭后重开保留 iframe，价格可直接显示。页面状态栏会明确显示“转债详情打开 · 主看板暂停刷新”。
- 2026-08-12 12:21:44，Finance Node 与 18890 API 已统一重启加载新版；随后 health 为 `ok=true`、`degraded=false`，实际 panel 请求带 `fast=1`，首价、摘要和六栏分时图均通过浏览器验收。

### 分时缺口自动补齐与最新分钟成交额修复

午后继续核对发现，极速预览虽然明显缩短了首屏等待，但它只读取本地监控数据库与已有缓存；若上午经历行情断流或监控重启，页面会忠实显示缺失分钟形成的断线，却不会主动从普通只读详情链路启动补齐。现在 panel 在首屏显示后会延迟 1.5 秒发起一次普通只读请求，由服务端单线程、按标的去重执行 `market_data_ex` GET。补齐响应只在交易日一致且分钟行数不回退时合并，并立即重绘；页面隐藏、panel 关闭、切换到日 K、多日或历史日期时停止。任务未完成时遵守服务端重试时间，失败按 15、30、60、120 秒退避，避免恢复此前的 2 秒高频 Bridge 压力。整个互动链路仍不调用 `history_data2` 下载。

同时确认了“刚进入详情时最新一分钟成交额异常大”的独立根因：QMT `full_tick.amount` 是当日累计成交额，旧逻辑用该进程中稀疏的上一条快照做差。若该标的数分钟前才被访问过，差额就覆盖了这几分钟，而后合并顺序又让这个实时行覆盖 SQLite 同一分钟的正确分钟成交额。实测 14:07 的鼎通转债由本地约 236 万元被放大为约 1878 万元，普联转债由约 151 万元被放大为约 3374 万元。

修复后，实时 `full_tick` 只负责补当前价格，不再从稀疏快照推导分钟成交额；`market_data_ex` 只补缺口，SQLite 同分钟数据优先，实时快照仅更新 `close/high/low` 并保留可信的 `open/amount/volume`。若监控尚未写入一个全新分钟，该分钟成交额暂显示为 0，待本地分钟形成后更新，避免用累计额伪造巨量。本修复没有新增 Bridge 请求、历史下载或交易写操作。

2026-08-12 14:16～14:26 的部署验收：18890 自动恢复为 PID 62599，health 为 `ok=true`、`degraded=false`。鼎通、胜蓝、普联等代表性标的的最新一分钟成交额已与 SQLite 同分钟逐一相等。真实 panel 打开 `113647.SH` 时，页面先显示“极速预览 · 后台补齐中”，随后仅发出一次普通 `/bond?code=113647` 请求；约 2 秒后切换为“极速预览 · 分时已补齐”，分钟行由本地 179 根增加至 208 根并自动重绘。该窗口后续只有原有的 Bridge-free `fast=1` 实时轮询，没有重复普通补齐请求。Finance Python 23 项与 Node 29 项测试共 52/52 通过，JavaScript/Python 语法和 diff 检查通过。

### 分时 MA5、MA10、支撑和压力参考线修复

详情提速时曾移除分时页的日线参考加载，但绘图仍只从 `referenceDailyPayload` 读取参考值，导致该状态始终为空，1 日和 5 日分时都固定提示“日线参考位暂不可用”。本次恢复了首图完成后的独立异步加载：参考数据成功后只重绘图表，不重新请求分时，也不阻塞首价和六栏图。

新增 `/api/miniqmt/daily?reference=1` 只读路径。它逐日查询本地 Monitor SQLite 中当前转债的分钟行，聚合首笔开盘、末笔收盘、最高、最低和成交额；只返回该标的确有数据的日期，不访问 Bridge、`full_tick` 或 `history_data2`。常规 `/daily` 仍保留给用户主动查看日 K，不改变原有语义。参考请求失败时按 15、30、60、120 秒退避，页面隐藏或 panel 关闭时暂停。

同时修复 5 日模式的历史请求风暴：历史四日按交易日缓存并对在途请求去重，后续 2 秒刷新只更新当天；某个全局日期没有该转债数据时会跳过并继续寻找更早日期。修复前每个标签页约产生 150 次历史请求/分钟，修复后代表性页面只在首次切换时请求四个历史日。

2026-08-12 14:47～14:49 部署验收：5173 PID 75270、18890 PID 75272，health 为 `ok=true`、`degraded=false`。`127054` 的本地参考接口返回 12 个有效交易日，真实 Chrome 页面在 1 日和 5 日模式均显示 MA5 127.678、MA10 127.205、支撑 126.419、压力 128.709；5 日状态为“5日分时 · MiniQMT真实分钟数据”。服务日志只在首次切换时出现 20260811、20260810、20260807、20260806 四个历史请求，随后连续实时刷新没有再次请求历史日。Finance Python 25/25、前端 Node 34/34、语法与差异检查全部通过。

本地数据库覆盖统计为 298 只转债拥有 12 个交易日、其余少数标的为 1～11 日。少于 5 个历史日的标的无法计算 MA5/支撑/压力，少于 10 个历史日的标的无法计算 MA10；这种情况继续明确显示参考不足，不会用不存在的历史值伪造参考线。

### “立即刷新”真实补齐与盘后自动补齐

此前页面所称的“后台补齐”只会低频重读 MiniQMT 已有的 `market_data_ex` 缓存，不会触发 `history_data2`。因此，当 QMT 本地缓存自身也缺少分钟时，页面会长期停在 `partial`，等待多久都不会增加数据；原“立即刷新”按钮也只是重新请求 `/bond`，没有提交真正的补齐任务。

现在新增独立维护任务接口 `/api/miniqmt/intraday-backfill`：

- 点击分时页“立即刷新”会先用现有数据立即重绘，同时提交一个单标的、单交易日补齐任务；提交、排队、执行、部分完成、失败和完成均有独立状态，不再被普通 2 秒行情刷新覆盖。
- 补齐任务只允许在工作日 15:12～18:00 执行。盘中点击只排队，Monitor 进程仍为当日 `running` 时即使已过 15:12 也继续等待；实际下载前和下载后验证前都会再次检查门禁。
- 盘后常驻 Finance API 从当日 SQLite 的 `meta.codes` 读取 Monitor 实际使用的完整转债池，并与当日分钟/事件代码取并集；不需要为了扫描再次争抢 Bridge。零分钟标的也会获得明确任务结果，不再静默遗漏。
- 所有下载由一个 worker 串行执行，人工任务优先；同一代码和日期去重，并用 generation/status 比较避免旧自动任务覆盖新人工任务。每只任务完成验证后至少间隔 1 秒才处理下一只。
- `history_data2` 返回 HTTP 200 后仍会检查单代码结果，并等待至少 1 秒、最多复读三次缓存。只有分钟确实出现且内部缺口消失才标 `ready`；源端无数据标 `partial`，明确超时标 `failed`，不会伪造直线或插值。
- 连续三次 Bridge 系统失败会暂停全队列 5 分钟，之后自动续跑；`partial/failed` 单码不会整夜死循环。任务摘要原子保存到 `runtime/intraday-backfill-jobs.json`，服务重启后可恢复等待任务。
- 页面隐藏、切换日期、切到日 K 或关闭 panel 时暂停状态轮询；恢复后继续。旧日期的在途响应不能覆盖新任务，补齐完成也只有在新数据确实应用后才记录为已重绘。

2026-08-12 15:43～16:09 的真实验收：

- `118073` 在补齐前 `/bond` 只有 123 根，QMT 旧缓存 119 根；人工任务实际调用一次 `history_data2`，等待缓存可见后返回 241 根，时间范围 09:30～15:00、`complete_session=true`、内部缺口为 0。
- 真实 Chrome 页面点击“立即刷新”后先显示“正在补齐 · 已获取241/241分钟”，约 3 秒后恢复为“立即刷新”并显示“补齐完成 · 已获取241分钟”，随后只重载和重绘一次。
- 第一轮盘后任务覆盖 298 个已有分钟记录的缺口标的，最终 293 个 `ready`、3 个源端仅有部分数据、2 个 QMT 明确超时。完整池修复上线后任务覆盖增加到 305 个缺口标的，补上此前遗漏的 7 个零分钟标的；连续无源/超时触发 5 分钟冷却，未开始的任务保留在持久队列等待自动续跑。
- 最终回归为 MiniQMT API 40/40、交易安全 4/4、前端 46/46；Python/JavaScript 语法和 `git diff --check` 全部通过。本次维护没有触发账户查询、委托或撤单，也没有改写 Monitor SQLite 和历史信号。

## 遗留风险

1. `20260812.sqlite3` 中 09:51 的已知污染事件仍然存在。修复阻止未来同类错误，不会悄悄改写历史审计库。
2. 当日早盘断流造成的预热缺口仍会标为 `partial`。为保护实时行情，盘中不会主动读取或下载历史来补洞；15:12～18:00 的盘后维护队列会按单标的串行修复图表缓存。依赖 MACD、紫线、日内均线或明暗盘的历史信号仍应结合 `indicator_warmup` 判断覆盖，因为盘后补图不会回填或补造历史信号。
3. 日志轮转发生在进程启动时，不会在长时间运行过程中立即切割刚超过 100MB 的活动文件。Finance 和 Bridge 若长期不重启，仍需关注磁盘增长。
4. MiniQMT/QMT Bridge health 不代表每个行情端点均可用；`xtdata` 锁、单标的缓存缺失或 MiniQMT 登录状态仍可能造成局部失败。
5. 无 Level-2 时，五档和普通快照信号只能称为近似或疑似，不应作为逐笔主动买卖事实。
6. 当前修复分布在 finance 与 miniqmt 两个 Git 仓库，发布或回滚必须分别处理，不能只提交其中一个仓库。

## 回滚与排障

### 安全回滚

1. 先记录当前 5173、18890、18888、监控 PID 和 health，不要直接删除运行目录。
2. 使用 `git revert <commit>` 分别回滚两个仓库的已知提交；不要使用会覆盖本地状态的 `git reset --hard`。
3. Finance 回滚时只包含本记录列出的源代码、脚本和测试，不要恢复或覆盖 `data/board-state.json`、`runtime/auction-series.json`、日志与临时目录。
4. Monitor 回滚时保留 `runtime/data/*.sqlite3`、`runtime/status.json`、报告和日志，以便继续审计历史信号。
5. LaunchAgent 或 Windows 计划任务设置需要单独记录和回滚；Git 回滚不会自动恢复这些系统级配置。
6. 回滚后按“启动与健康检查”从 5173 到 18888 逐层验证，并继续保持只读。

### 信号区为空

1. 检查 `/api/miniqmt/health`，先确认 monitor PID、交易日和状态/行情新鲜度。
2. 直接请求 `/api/miniqmt/events?scope=focus&after_id=0&limit=5&trading_date=YYYYMMDD`。若有事件而页面为空，重点检查 cursor 日期、筛选条件和浏览器请求代次。
3. 若 API 也为空，读取 Monitor `service_control.py status`，再只读查询当日 SQLite；不要先清库或重启所有服务。

### 突然出现大量相同涨速

1. 对比 `speed_1m`、`speed_3m`、`speed_5m` 和事件时刻；三者大量完全相同通常意味着参考快照过旧。
2. 检查行情日期、累计成交额是否回退、是否刚经历断流或午休。
3. 确认正在运行的 Monitor 启动时间晚于 `shortline_monitor.py` 修改时间，否则先安排一次受控重启加载新代码。

### 详情分时卡住或 Bridge 变慢

1. 检查 18888 health 和单标的 `full_tick`，不要立刻发起全市场历史下载。
2. 查看 API 返回的分钟数据状态和退避时间；失败期间等待按标的退避，不要高频刷新详情页。
3. Bridge 日志若出现 `xtdata_lock timeout`，停止新的批量补数，等待当前请求释放锁后再测试单标的短区间数据。

### health 正常但指标不可信

读取 Monitor 的 `indicator_warmup`、`quote_feed` 和 `history_repair`。health 正常只说明服务与实时行情链路符合阈值，不能替代指标分钟覆盖检查。
