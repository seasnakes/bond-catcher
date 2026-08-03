#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_SOURCE = path.join(ROOT, "data", "convertible-bond-tag-source.json");
const DEFAULT_OUTPUT = path.join(ROOT, "data", "convertible-bond-tags.json");
const OVERRIDES_PATH = path.join(ROOT, "data", "convertible-bond-tag-overrides.json");
const QMT_BASE = process.env.QMT_BRIDGE_BASE || "http://10.211.55.3:18888";
const SMALL_CAP_THRESHOLD = 5_000_000_000;
const RECENT_LISTING_DAYS = 365;
const TAG_ORDER = [
  "次新债",
  "小盘",
  "AI应用",
  "算力租赁",
  "医药",
  "油气",
  "玻纤",
  "PCB",
  "液冷",
  "机器人",
  "光模块",
  "ST",
  "能化",
  "电源",
  "食品",
  "饮料",
  "半导体",
  "半导体材料",
  "光刻机",
  "航天",
  "环保",
  "消费电子",
  "铜缆",
  "电力设备",
  "银行",
  "脑机接口",
];

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function marketCode(stockCode) {
  const code = String(stockCode || "").replace(/\D/g, "").slice(0, 6);
  if (!code) return "";
  return `${code}.${/^(5|6|9)/.test(code) ? "SH" : "SZ"}`;
}

function splitRows(values) {
  const headers = values[0].map(String);
  return values.slice(1).map((valuesRow) =>
    Object.fromEntries(headers.map((header, index) => [header, valuesRow[index]])),
  );
}

function includesAny(text, terms) {
  const normalized = String(text || "").toLowerCase();
  return terms.some((term) => normalized.includes(String(term).toLowerCase()));
}

function dateDaysBetween(left, right) {
  const leftTime = new Date(`${left}T00:00:00+08:00`).getTime();
  const rightTime = new Date(`${right}T00:00:00+08:00`).getTime();
  return Math.floor((rightTime - leftTime) / 86_400_000);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function qmtMarketData(codes) {
  const details = {};
  const ticks = {};
  for (let index = 0; index < codes.length; index += 100) {
    const group = codes.slice(index, index + 100);
    const stocks = encodeURIComponent(group.join(","));
    const [detailPayload, tickPayload] = await Promise.all([
      fetchJson(`${QMT_BASE}/api/instrument/detail_list?stocks=${stocks}&iscomplete=true`),
      fetchJson(`${QMT_BASE}/api/market/full_tick?stocks=${stocks}`),
    ]);
    Object.assign(details, detailPayload.data || {});
    Object.assign(ticks, tickPayload.data || tickPayload || {});
  }
  return { details, ticks };
}

function classify(row, market, asOf) {
  const industry1 = String(row["申万一级行业"] || "");
  const industry2 = String(row["申万二级行业"] || "");
  const industry3 = String(row["申万三级行业"] || "");
  const topics = String(row["题材标签"] || "");
  const core = String(row["核心业务标签"] || "");
  const stockName = String(row["正股简称"] || "");
  const bondName = String(row["转债简称"] || "");
  const text = [industry1, industry2, industry3, topics, core, stockName, bondName].join("|");
  const tags = new Set();
  const listedDate = String(row["上市日期"] || "").slice(0, 10);
  if (listedDate && dateDaysBetween(listedDate, asOf) <= RECENT_LISTING_DAYS) {
    tags.add("次新债");
  }
  if (
    (Number.isFinite(market.floatMarketCap) && market.floatMarketCap < SMALL_CAP_THRESHOLD)
    || includesAny(topics, ["微盘股", "小盘价值"])
  ) {
    tags.add("小盘");
  }
  if (
    includesAny(topics, [
      "AI应用",
      "AIGC概念",
      "ChatGPT概念",
      "AI智能体",
      "DeepSeek概念",
      "虚拟数字人",
      "多模态AI",
      "生成式AI",
    ])
    || (industry2 === "软件开发" && includesAny(topics, ["人工智能"]))
  ) {
    tags.add("AI应用");
  }
  if (
    includesAny(topics, ["算力租赁", "算力概念", "东数西算", "数据中心"])
    && (
      includesAny(`${industry1}|${industry2}`, ["计算机", "通信", "软件开发", "IT服务"])
      || includesAny(core, ["数据中心", "IDC", "云计算", "算力"])
    )
  ) {
    tags.add("算力租赁");
  }
  if (industry1 === "医药生物" || includesAny(text, ["医疗器械", "创新药", "中药", "生物医药"])) {
    tags.add("医药");
  }
  if (
    industry1 === "石油石化"
    || includesAny(text, ["油气", "天然气", "页岩气", "可燃冰", "油服", "石油"])
  ) {
    tags.add("油气");
  }
  if (includesAny(text, ["玻纤", "玻璃纤维"])) tags.add("玻纤");
  if (includesAny(text, ["PCB", "印制电路", "覆铜板"])) tags.add("PCB");
  if (includesAny(topics, ["液冷概念", "数据中心液冷", "液冷服务器"])) tags.add("液冷");
  if (includesAny(topics, ["机器人"])) tags.add("机器人");
  if (includesAny(topics, ["光模块", "光通信模块", "CPO概念"])) tags.add("光模块");
  if (/^\*?ST/i.test(stockName) || includesAny(topics, ["ST股"])) tags.add("ST");
  if (["基础化工", "石油石化", "煤炭"].includes(industry1) || bondName === "能化转债") {
    tags.add("能化");
  }
  if (
    includesAny(text, [
      "数据中心电源",
      "开关电源",
      "UPS电源",
      "移动电源",
      "电源管理",
      "电源设备",
      "充电模块",
    ])
  ) {
    tags.add("电源");
  }
  const beverage = includesAny(`${industry2}|${industry3}`, [
    "饮料乳品",
    "白酒",
    "非白酒",
    "乳品",
    "软饮料",
    "啤酒",
  ]);
  if (industry1 === "食品饮料" && beverage) tags.add("饮料");
  if (industry1 === "食品饮料" && !beverage) tags.add("食品");
  if (
    includesAny(`${industry2}|${industry3}`, ["半导体"])
    || includesAny(topics, ["半导体概念", "国产芯片", "存储芯片", "汽车芯片"])
  ) {
    tags.add("半导体");
  }
  if (
    industry2 === "电子化学品Ⅱ"
    || includesAny(text, [
      "半导体材料",
      "电子化学品",
      "光刻胶",
      "硅片",
      "靶材",
      "电子特气",
      "抛光液",
      "光掩膜",
      "光罩",
    ])
  ) {
    tags.add("半导体材料");
  }
  if (includesAny(topics, ["光刻机", "光刻胶"])) tags.add("光刻机");
  if (
    industry1 === "国防军工"
    || includesAny(topics, ["商业航天", "航天航空", "卫星互联网", "卫星导航", "大飞机", "军工"])
  ) {
    tags.add("航天");
  }
  if (
    industry1 === "环保"
    || includesAny(text, ["节能环保", "固废治理", "污水处理", "大气治理", "垃圾分类"])
  ) {
    tags.add("环保");
  }
  if (includesAny(`${industry2}|${industry3}|${topics}`, ["消费电子"])) tags.add("消费电子");
  if (includesAny(topics, ["铜缆高速连接", "高速铜缆", "铜连接"])) tags.add("铜缆");
  if (industry1 === "电力设备") tags.add("电力设备");
  if (industry1 === "银行") tags.add("银行");
  if (includesAny(topics, ["脑机接口", "脑科学"])) tags.add("脑机接口");
  return TAG_ORDER.filter((tag) => tags.has(tag));
}

async function main() {
  const sourcePath = path.resolve(argument("--source", DEFAULT_SOURCE));
  const outputPath = path.resolve(argument("--output", DEFAULT_OUTPUT));
  const asOf = argument("--as-of", new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Shanghai",
  }));
  const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  const rows = splitRows(source.values);
  const stockCodes = [...new Set(rows.map((row) => marketCode(row["正股代码"])).filter(Boolean))];
  let marketData = { details: {}, ticks: {} };
  try {
    marketData = await qmtMarketData(stockCodes);
  } catch (error) {
    console.warn(`MiniQMT市值读取失败，改用题材中的微盘/小盘标记：${error.message}`);
  }
  const overrides = JSON.parse(await fs.readFile(OVERRIDES_PATH, "utf8")).overrides || {};
  const outputRows = rows.map((row) => {
    const stockMarketCode = marketCode(row["正股代码"]);
    const detail = marketData.details[stockMarketCode] || {};
    const tick = marketData.ticks[stockMarketCode] || {};
    const price = Number(tick.lastPrice) > 0 ? Number(tick.lastPrice) : Number(tick.lastClose);
    const floatVolume = Number(detail.FloatVolume);
    const floatMarketCap =
      price > 0 && floatVolume > 0 ? price * floatVolume : null;
    const market = { price, floatVolume, floatMarketCap };
    const bondCode = String(row["转债代码"] || "");
    const tags = new Set(classify(row, market, asOf));
    const override = overrides[bondCode] || {};
    for (const tag of override.add || []) {
      if (TAG_ORDER.includes(tag)) tags.add(tag);
    }
    for (const tag of override.remove || []) tags.delete(tag);
    const primaryTag = tags.has(override.primaryTag) ? override.primaryTag : "";
    return {
      code: bondCode,
      name: String(row["转债简称"] || ""),
      stockCode: stockMarketCode,
      stockName: String(row["正股简称"] || ""),
      listedDate: String(row["上市日期"] || "").slice(0, 10),
      industry1: String(row["申万一级行业"] || ""),
      industry2: String(row["申万二级行业"] || ""),
      industry3: String(row["申万三级行业"] || ""),
      floatMarketCap,
      tags: TAG_ORDER.filter((tag) => tags.has(tag)),
      primaryTag,
    };
  });
  const tagCounts = Object.fromEntries(
    TAG_ORDER.map((tag) => [
      tag,
      outputRows.filter((row) => row.tags.includes(tag)).length,
    ]),
  );
  const payload = {
    asOf,
    source: [
      "当前上市可转债完整名单与题材分类_2026-07-30.xlsx",
      "MiniQMT / QMT Bridge instrument_detail + full_tick",
      "申万行业 + 东方财富F10题材",
    ],
    definitions: {
      次新债: `上市未满${RECENT_LISTING_DAYS}天`,
      小盘: `正股流通市值低于${SMALL_CAP_THRESHOLD / 1e8}亿元；行情缺失时采用微盘股/小盘价值题材`,
      themeTags: "按申万行业、F10题材和核心业务关键词，可多标签",
    },
    tagOrder: TAG_ORDER,
    tagCounts,
    count: outputRows.length,
    rows: outputRows,
  };
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, count: outputRows.length, tagCounts }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
