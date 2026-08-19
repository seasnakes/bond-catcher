# MiniQMT 本地公式旁路

这条旁路不修改主看板状态，也不替换通达信结果。它用于验证：以本地
MiniQMT 日线计算 `单针`、`异动`、`ZX` 时，能否与通达信逐券一致。

## 存储

默认数据库为 `runtime/convertible-bond-market.sqlite3`，包含：

- `instruments`：转债静态资料；
- `universe_membership`：按交易日保存当时的存续债池、新债来源和数据覆盖；
- `daily_bars`：MiniQMT 前复权日线，主键为转债、交易日、复权口径；
- `formula_runs` / `formula_signals`：公式版本、运行记录和逐券结果。

`runtime/` 不进入 Git。新债沿用主项目的东方财富上市资料，并回读
`/api/new-bond-second-day` 标记由现有新债流程发现的标的。MiniQMT 债券列表
暂未更新时，新债仍会先进入本地标的表，并明确标为行情缺失或不足。

## 运行

首次或需要补齐数据时，在盘后运行。下载端点返回成功后，脚本还会逐券
复读并确认最后交易日；只收到 `ok`、但缓存没有推进的标的不算完成：

```bash
npm run demo:local-formulas -- --as-of 20260819 --download
```

日常增量运行可缩短 `--start`，脚本会按主键幂等更新：

```bash
npm run demo:local-formulas -- --as-of 20260819 --start 20260819 --download
```

结果写入 `runtime/local-formula-demo.json`。对账以
`runtime/tdx-formula-selections.json` 为基准；公式实现会记录 `formula/*.md`
的 SHA-256，避免公式文本修改后仍沿用旧结论。
