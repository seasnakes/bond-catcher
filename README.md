# A股/转债实时板块表

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Frontend](https://img.shields.io/badge/Frontend-Vanilla%20JS-F7DF1E?logo=javascript&logoColor=black)
![Realtime](https://img.shields.io/badge/Realtime-A股%20%2F%20可转债-d73a49)
![Storage](https://img.shields.io/badge/Storage-local%20JSON-5865F2)
![License](https://img.shields.io/badge/License-Private-lightgrey)

一个给盘中盯板块、盯转债用的本地实时行情看板。界面按短线板块池风格设计：小卡片、高密度、红涨绿跌、涨跌幅条按方向和幅度显示，适合快速扫板块强弱和转债活跃度。

![A股/转债实时板块表界面截图](docs/assets/finance-board.png)

## 功能

- 实时显示 A 股、ETF、港股和可转债行情。
- 支持板块、叠组、个股/转债的增删改和拖拽排序。
- 叠组可以把多个二级细分板块像卡牌一样收纳，多个分组可同时展开。
- 涨跌幅格子按方向和幅度显示红绿条，超过阈值才强化标红/标绿。
- 顶部显示主要指数：上证指数、创业板指、科创综指、中证转债、韩国 KOSPI、日经 225、恒生科技。
- “K线”开关可显示或隐藏每只标的的今日分时缩略走势。
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

- `/api/quotes`：A 股、ETF、港股、可转债实时行情。
- `/api/indices`：国内和外围指数。
- `/api/sparks`：今日分时缩略走势，腾讯分时优先，新浪 5 分钟 K 线兜底。
- `/api/search`：添加标的联想，本地沪深名单优先，东方财富远程搜索兜底。
- `/api/state`：读取和保存 `data/board-state.json`。

## 项目结构

```text
.
├── app.js                    # 前端交互、行情渲染、编辑逻辑
├── server.js                 # 本地 Node 行情代理和状态 API
├── styles.css                # 板块表样式
├── index.html                # 页面入口
├── data/
│   ├── a-share-list.json     # 本地沪深 A 股联想名单
│   └── board-state.json      # 默认板块/叠组/标的池
└── docs/assets/
    └── finance-board.png     # README 截图
```

## 说明

- 这是本地自用看板，不是交易系统，也不提供投资建议。
- 盘中自动刷新，收盘和非交易时段会降低不必要的请求。
- 浏览器本地存储只作兜底；后端可用时以 `data/board-state.json` 为准。
