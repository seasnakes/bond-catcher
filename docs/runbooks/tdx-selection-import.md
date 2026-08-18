# 通达信条件选股导入看板

这条管道负责“通达信 → 看板”。原有 `sync-tdx-sectors.js` 负责相反方向“看板 → 通达信”，二者不要混用。

## 通达信侧准备

条件选股完成后，把结果保存到一个自定义板块，并记下板块简称，例如 `CSBK`。TQ 的 `block_type=1` 接受预先定义的自定义板块简称；“自选股”和临时条件股不属于这个入口。

## 先预览

```bash
node scripts/import-tdx-selection.js \
  --tdx-sector CSBK \
  --block-type 1 \
  --target 通达信选股
```

默认行为：

- 通过 Parallels `Windows 11` 内的 `127.0.0.1:17709` 读取 TQ；
- 合并进目标板块，不删除旧标的；
- 只输出新增、删除、未变和名称未解析项；
- 不修改看板。

确认预览后再写入：

```bash
node scripts/import-tdx-selection.js \
  --tdx-sector CSBK \
  --block-type 1 \
  --target 通达信选股 \
  --apply
```

写入只允许回环地址，使用 `/api/state` 的 `updatedAt` 乐观锁，服务端原子替换文件；完成后会重新读取并核对目标板块。

## 精确镜像

需要让看板板块与本次通达信结果完全一致时，先预览 `replace` 模式：

```bash
node scripts/import-tdx-selection.js \
  --tdx-sector CSBK \
  --block-type 1 \
  --target 通达信选股 \
  --mode replace
```

确认删除清单无误后才添加 `--apply`。

## 文件兜底

通达信 TQ 未启动时，可导入 `.blk`、CSV、TSV 或纯文本。支持 `1600519`、`600519.SH`、`SH600519`、`1.600519`、`600519` 等常见代码形式，也会尝试解码 GB18030 文件。

```bash
node scripts/import-tdx-selection.js \
  --file /path/to/selection.blk \
  --target 通达信选股
```

## 验收记录

2026-08-18 使用真实 TQ 只读查询 `880677.SH`（`block_type=0`），取得 63 只转债，63 个名称全部解析，成功生成新增计划；未使用 `--apply`，看板状态未改变。

若提示 `selection source returned no valid market codes`，先在通达信检查板块简称是否存在、是否已保存成自定义板块、板块内是否有标的。空板块不会被当作成功导入。
