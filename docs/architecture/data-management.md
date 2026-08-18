# 数据统一管理方案

## 决策

“统一数据”采用统一契约、目录、生命周期和访问入口，不强行把所有数据塞进一个数据库。实时 tick、用户配置、研究快照和审计事件的写入频率与保留要求不同，物理存储应分层，但业务代码只依赖明确的 repository/provider 接口。

## 四类数据

| 类型 | 当前例子 | 目标存储 | Git 策略 |
| --- | --- | --- | --- |
| 参考/主数据 | A 股名单、转债标签、指数研究快照 | `data/` 下带版本、来源和生成时间的 JSON；后续迁入 `data/reference/` | 可重建且要共享的快照提交 |
| 用户配置状态 | `data/board-state.json`、标签人工覆盖 | JSON repository，原子写、schema version、`updatedAt` 乐观锁；后续迁入 `data/state/` | 默认不随功能提交；明确更新共享默认值时才提交 |
| 行情缓存与事件 | monitor SQLite、分钟缓存、竞价序列、回补状态 | 项目拥有的 `runtime/` SQLite/JSON，按交易日和数据集命名 | 永不提交 |
| 导出与分析产物 | 报告、截图、临时探针 | `outputs/`、`tmp/` | 永不提交，正式报告另行选择性发布 |

## 统一数据契约

所有行情或选股记录至少携带：

```json
{
  "instrumentId": "123277.SZ",
  "name": "玉禾转债",
  "asOf": "2026-08-18T10:15:03+08:00",
  "source": "tdx-tq",
  "quality": "observed",
  "fields": {}
}
```

- `instrumentId`：内部统一使用 `代码.交易所`；页面现有 `secid` 仅留在接口适配层。
- `asOf`：事件时间，不用请求时间冒充行情时间。
- `source`：必须可追到 `miniqmt-full-tick`、`tdx-tq`、`sina` 等具体来源。
- `quality`：区分 `observed`、`derived`、`approximate_without_level2`、`stale`、`missing`。
- 价格、成交额和成交量在契约中固定单位；适配器负责供应商字段和单位转换。

## 访问规则

1. 页面只调用本地 API，不直接选择第三方数据源。
2. 应用用例只调用 `MarketDataGateway`、`BoardStateRepository`、`EventRepository` 等接口。
3. 供应商降级在 gateway 内显式返回来源和质量，不允许静默覆盖主源。
4. 所有写入采用临时文件 + 原子替换或数据库事务；批量任务保存 generation、cursor、状态和失败原因。
5. 研究数据集必须记录 universe、交易日范围、字段覆盖和 PIT 截止时间，不能用当前债池替代历史债池。

## 迁移顺序

1. 先复用已新增的 `market-code` 和通达信适配器模式。
2. 抽出 `BoardStateRepository`，让 Node 路由和 CLI 共用同一校验与原子写实现。
3. 为 Python SQLite 建独立 repository，消除散落连接并解决连接未关闭警告。
4. 给每个 API 响应补 `source/asOf/quality`，保持旧字段兼容一个迁移周期。
5. 最后才评估把部分 JSON 状态迁入 SQLite；没有并发或查询收益时保留 JSON。
