# A股/转债实时板块表

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Frontend](https://img.shields.io/badge/Frontend-Vanilla%20JS-F7DF1E?logo=javascript&logoColor=black)
![Realtime](https://img.shields.io/badge/Realtime-A股%20%2F%20可转债-d73a49)
![Storage](https://img.shields.io/badge/Storage-local%20JSON-5865F2)
![License](https://img.shields.io/badge/License-MIT-green)

一个给盘中盯板块、盯转债用的本地实时行情看板。界面按短线板块池风格设计：小卡片、高密度、红涨绿跌、涨跌幅条按方向和幅度显示，适合快速扫板块强弱和转债活跃度。

![A股/转债实时板块表界面截图](docs/assets/finance-board.png)

## 功能

- 实时显示 A 股、ETF、港股和可转债行情。
- 支持板块、叠组、个股/转债的增删改和拖拽排序。
- 叠组可以把多个二级细分板块像卡牌一样收纳，多个分组可同时展开。
- 涨跌幅格子按方向和幅度显示红绿条，超过阈值才强化标红/标绿。
- 顶部显示主要指数：上证指数、创业板指、科创综指、中证转债、韩国 KOSPI、日经 225、恒生科技；“外围分时”与主力监控精灵左右排列，使用 TradingView 展示纳指100与韩国市场日内代理走势。
- “K线”开关可显示或隐藏每只标的的今日分时缩略走势。
- “转债星图”可按申万一至三级行业、主线题材或统一标签展示全部转债；标签分组优先使用人工主标签，未设置时优先采用题材标签，确保每只转债只出现一次。面积可切换成交额/发行规模，色彩可切换涨跌幅/转股溢价率/价格，并可用 MiniQMT 更新盘中价格、涨跌幅和成交额。小格会按可用空间缩写简称，悬浮分组标题可查看完整转债列表和今日分时缩略线。
- “活跃转债指数”是盘中监控页：显示复刻指数分时、日K、成交额和成分宽度，并实时列出成分债的涨跌幅、现价、估算量比、1分钟涨速、成交额、1分钟金额和3日涨跌。复刻指数由既定成分等权合成，明确区别于通达信官方实时指数。
- “实盘”页面通过 QMT Bridge 查询真实账户，展示脱敏后的资金概览、当前持仓、今日委托、成交明细和按标的汇总；交易时段每15秒刷新，非交易时段停止自动轮询。本机页面可临时解锁单笔限价买卖和撤单，局域网访问始终只读。实盘提交须经过账户/资金/可卖量/实时价格校验、30秒预览令牌、完整确认语和一次性提交保护；默认单笔不超过2万元、限价偏离现价不超过5%。
- 单债详情支持“分时 / 日K”切换；正股名称、代码、现价、涨跌幅和日内缩略图合并在同一卡片，切换视图时保持固定尺寸。日K可查看近60、120或250个交易日的转债蜡烛图、MA5/MA10/MA20和成交额，双击某根K线可按日期从MiniQMT读取并切换到当日历史分时。日K使用固定周期槽位，新上市转债保持与其他转债一致的K线间距和宽度，缺少的交易日保留为右侧空白。
- 搜索和添加标的优先走本地沪深 A 股名单，远程联想只作兜底。
- 当前板块、叠组和标的池保存到 `data/board-state.json`，不同浏览器打开时使用同一份默认数据。

## 快速启动

```bash
npm start
```

打开：

```text
http://localhost:5173
```

更新本地沪深 A 股联想名单：

```bash
npm run update:stocks
```

使用通达信本地 `.day` 文件重新生成活跃转债指数研究快照：

```bash
npm run build:active-bond-index -- \
  --index /path/to/sh880677.day \
  --bonds-dir /path/to/cb_day_files \
  --names /path/to/cb_details_or_name_summary.json \
  --output data/active-convertible-bond-index.json
```

通达信 TQ 中已有的条件选股公式可直接生成项目快照，并在“公式选股”页面查看：

```bash
npm run run:tdx-formulas
```

当前默认在通达信“可转债”分类中运行 `单针`、`异动`、`ZX`，结果保存在未跟踪的 `runtime/` 目录。详细说明见 [通达信公式选股结果看板](docs/runbooks/tdx-formula-selection.md)。

生成器会用 880677 当日成交额审计本地转债历史是否完整；未通过审计的日期不会混入复刻统计。

## 可转债标签

当前 306 只普通上市可转债使用统一标签库，标签会显示在主力监控、活跃转债指数成分表和个债分时页，并可在“转债星图”按标签筛选。

```bash
npm run build:bond-tags -- --as-of 2026-07-31
```

- `data/convertible-bond-tag-source.json`：从“当前上市可转债完整名单与题材分类”工作簿抽取的名单、申万行业和 F10 题材底稿。
- `data/convertible-bond-tags.json`：生成后的统一标签库。
- `data/convertible-bond-tag-overrides.json`：人工增删标签和页面新增的自定义标签，键使用带市场后缀的转债代码。
- “次新债”按上市未满 365 天；“小盘”按正股实时流通市值低于 50 亿元；“光伏”和“核电”只纳入具有直接产品、运营资产或核级供货关系的转债。
- `bond-tags.html` 可筛选、批量移除、设置主标签和新增自定义标签；自定义标签在重建标签库后仍会保留。
- 本地接口 `/api/miniqmt/tags` 支持 `code` 或 `tag` 查询。

## 编辑方式

点击页面右上角的“编辑”后，可以直接在界面上维护板块和标的：

- 板块标题旁的 `+` 可以按名称或代码联想添加股票、ETF、港股或可转债。
- 板块和叠组支持拖拽，也可以用置顶/置底按钮快速移动。
- 个股和转债支持拖拽排序、删除。
- 叠组内的小板块可独立折叠/展开，也能调整顺序。

批量编辑时支持下面的格式：

```text
板块|名称|代码
光模块|中际旭创|300308
白酒|贵州茅台
可转债|韦尔转债|113616
港股|腾讯控股|00700
ETF|科创50ETF|588000
```

省略代码时会用名称自动查询。常见代码格式如 `600519`、`sh600519`、`sz000001`、`113616`、`00700` 也能识别。

## 数据来源

前端只访问本地 Node 服务，由后端统一代理外部行情接口：

- `/api/miniqmt/quotes`：主看板板块内的 A 股、ETF、可转债价格和涨跌幅统一使用 MiniQMT `full_tick` 实时行情；单只缺失时显示 `--`，不混入外部行情。
- `/api/miniqmt/daily`：通过 QMT Bridge 补齐并读取指定转债的日线行情，支持60/120/250日视图；服务内五分钟缓存避免重复下载。
- `/api/miniqmt/intraday-backfill`：分时“立即刷新”和盘后自动修复使用的单标的维护队列。盘中只排队，工作日 15:12～18:00 且 Monitor 确认停止后才串行下载并复验；人工任务优先，连续 Bridge 故障会自动冷却，不修改历史信号库。
- `/api/auction/series`：服务端在 09:15–09:25:30 每 3 秒采集当前看板沪深标的的 MiniQMT 竞价快照，保存竞价价格、累计金额与增量金额；网页首次读取历史，后续按 cursor 增量更新。
- `/api/auction/signals`：在上述竞价快照上按转债—正股配对计算“正股领先、转债放量、联动确认”等只读异动信号，并返回覆盖率与采样状态。
- `/api/quotes`：新浪行情兜底，并继续负责 MiniQMT 不覆盖的港股等标的。
- `/api/indices`：国内和外围指数报价；上证、创业板、科创综指来自新浪报价，中证转债来自腾讯报价，韩国 KOSPI / 日经 225 / 恒生科技使用对应外围指数源。
- “外围分时”通过 TradingView Mini Chart 嵌入 `CAPITALCOM:NAS100` 与 `BBG:BSK200`。前者是纳指100 CFD（CME NQ 方向代理），后者是 Bloomberg 韩国200指数（KOSPI 方向代理）；TradingView 网页组件不允许嵌入 `CME_MINI:NQ1!`、`TVC:KOSPI` 或 `KRX:KOSPI`，因此不把代理行情标成对应交易所原始指数。
- `/api/sparks`：主看板板块内的今日分时缩略走势使用 MiniQMT 1 分钟缓存与现有 `full_tick` 实时采样合并；盘后维护队列会把看板内缺失的沪深股票按单代码、单交易日串行补齐到持久化分钟缓存，不再为板块标的请求腾讯、东方财富或新浪分时。
- `/api/new-bond-second-day`：读取“上市第二交易日”候选，并在开盘前自动把候选幂等加入 `小热次` 板块。上市资料来自动态可转债列表，交易日来自 QMT Bridge 日历，实时价格仍只来自 MiniQMT；因此 MiniQMT 债券列表短暂滞后时，仍能发现新上市沪市转债。目标板块可通过 `NEW_BOND_SECOND_DAY_TARGET_SECTOR` 修改，POST 仅允许本机调用。

集合竞价期间，卡片缩略图会切换为 MiniQMT 竞价价格线和金额柱；09:25:30 后冻结到 09:30，随后恢复普通盘中分时缩略图。竞价采样缓存写入 `runtime/auction-series.json`，不纳入 Git。
- `/api/search`：添加标的联想，本地沪深名单优先，东方财富远程搜索兜底。
- `/api/state`：读取和保存 `data/board-state.json`。

顶部指数 K 线的当前顺序：

- A 股指数：腾讯分时 -> 新浪 5 分钟 K 线。
- 中证转债：腾讯分时。
- 恒生科技：腾讯分时 -> Yahoo 分时。
- 韩国 KOSPI / 日经 225：Yahoo 分时 -> 东方财富分时。
- 纳指100 / 韩国市场 TradingView 图：Capital.com NAS100 CFD / Bloomberg South Korea 200，只用于观察外围方向。
- 指数没有真实分时数据时不画假线；个股没有分时数据时会按当前价画平线占位，并在提示里标明。

## 运行与维护

- [2026-08-12 MiniQMT 信号与分时修复记录](docs/2026-08-12-miniqmt-signal-repair.md)：根因、影响窗口、跨仓库修改、启动/健康检查、测试证据、遗留风险与回滚排障。

## 项目结构

```text
.
├── app.js                    # 前端交互、行情渲染、编辑逻辑
├── server.js                 # 本地 Node 行情代理和状态 API
├── styles.css                # 板块表样式
├── index.html                # 页面入口
├── bond-heatmap.html         # 可转债全市场星图
├── bond-heatmap.js           # 星图布局、筛选和 MiniQMT 行情刷新
├── bond-heatmap.css          # 星图样式
├── bond-tags.html            # 转债标签筛选与管理
├── bond-tags.js              # 标签新增、编辑与批量管理
├── bond-tags.css             # 标签管理页样式
├── active-bond-index.html    # 活跃转债指数盘中监控
├── active-bond-index.js      # 分时/日K、实时成分表与排序筛选
├── active-bond-index.css     # 活跃转债指数监控页样式
├── trading.html              # QMT 实盘监控与受控交易页
├── trading.js                # 账户视图、下单预览、二次确认和撤单
├── trading.css               # 实盘监控页样式
├── scripts/trading_execution.py # 实盘风控、一次性预览令牌与审计
├── tests/test_trading_execution.py # 假执行器交易安全测试
├── data/
│   ├── a-share-list.json     # 本地沪深 A 股联想名单
│   ├── active-convertible-bond-index.json # 880677 已核验历史研究快照
│   ├── convertible-bond-heatmap.json # 转债行业/题材基础快照
│   ├── convertible-bond-tag-source.json # 当前上市转债标签源数据
│   ├── convertible-bond-tags.json # 统一转债标签库
│   ├── convertible-bond-tag-overrides.json # 人工标签修订
│   └── board-state.json      # 默认板块/叠组/标的池
└── docs/assets/
    └── finance-board.png     # README 截图
```

## 说明

- 这是本地自用看板，不是交易系统，也不提供投资建议。
- 盘中自动刷新，收盘和非交易时段会降低不必要的请求。
- 浏览器本地存储只作兜底；后端可用时以 `data/board-state.json` 为准。

## License

MIT
