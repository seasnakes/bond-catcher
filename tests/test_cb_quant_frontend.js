const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "quant.html"), "utf8");
const frontend = fs.readFileSync(path.join(ROOT, "quant.js"), "utf8");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

test("主看板提供可转债量化实验室入口", () => {
  assert.match(index, /href="\.\/quant\.html">量化实验室/);
  assert.match(html, /日线回测/);
  assert.match(html, /日内回放/);
  assert.match(html, /ATR网格/);
  assert.match(html, /模拟盘/);
});

test("量化页面明确纸面边界且不引用真实交易接口", () => {
  assert.match(html, /不连接真实账户/);
  assert.match(html, /不调用下单、撤单/);
  assert.doesNotMatch(frontend, /api\/miniqmt\/trading/);
  assert.doesNotMatch(frontend, /order-execute|cancel-execute/);
});

test("服务端同时提供日线回测、日内回放与纸面账户路由", () => {
  for (const route of [
    "/api/cb-quant/strategies",
    "/api/cb-quant/backtest",
    "/api/cb-quant/portfolio-backtest",
    "/api/cb-quant/replay",
    "/api/cb-quant/atr-grid-backtest",
    "/api/cb-quant/paper/reset",
    "/api/cb-quant/paper/start",
    "/api/cb-quant/paper/stop",
    "/api/cb-quant/paper/cycle",
    "/api/cb-quant/paper/order",
  ]) {
    assert.match(server, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(server, /isLoopbackRequest\(request\).*isSameOriginRequest\(request\)/s);
});

test("量化页面使用竞价、主力监控和凯利风险口径", () => {
  assert.match(html, /竞价只定开盘状态/);
  assert.match(html, /主力监控/);
  assert.match(html, /凯利只控制风险/);
  assert.match(frontend, /api\/cb-quant\/replay/);
  assert.match(frontend, /api\/cb-quant\/backtest/);
  assert.match(frontend, /api\/cb-quant\/portfolio-backtest/);
  assert.match(frontend, /api\/cb-quant\/atr-grid-backtest/);
  assert.match(html, /原有日线策略完整保留/);
  assert.match(html, /全市场转债组合轮动/);
  assert.match(html, /自动补齐历史转股价值/);
  assert.match(server, /intraday-backfill/);
  assert.match(server, /auction-series-history/);
});

test("ATR动态网格作为独立日内策略保留并明确前日ATR口径", () => {
  assert.match(html, /ATR 动态网格 · 日内历史回放/);
  assert.match(html, /前一交易日 ATR 定网宽/);
  assert.match(html, /运行ATR网格并自动补数/);
  assert.match(server, /grid_strategies/);
  assert.match(server, /runCbAtrGridBacktest/);
  assert.match(html, /日线 \/ 日内事件 \/ ATR网格模拟盘/);
  assert.match(frontend, /日内网格 ·/);
  assert.match(server, /runCbAtrGridPaperCode/);
});

test("ATR网格展示标的走势、触发带和逐笔买卖点", () => {
  assert.match(html, /id="gridPriceCanvas"/);
  assert.match(html, /标的走势与网格买卖点/);
  assert.match(html, /参考价/);
  assert.match(frontend, /function drawGridPrice/);
  assert.match(frontend, /lower_trigger_price/);
  assert.match(frontend, /upper_trigger_price/);
  assert.match(frontend, /\$\{buy \? "买" : "卖"\}/);
});

test("量化页转债代码输入复用主看板搜索联想", () => {
  for (const id of ["dailyCodeSuggestions", "replayCodeSuggestions", "gridCodeSuggestions"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(frontend, /\/api\/search\?q=/);
  assert.match(frontend, /attachBondAutocomplete/);
  assert.match(frontend, /item\?\.type === "Bond"/);
  assert.match(server, /Local convertible-bond list unavailable/);
});

test("ATR参数在页面解释趋势阈值与单边滑点", () => {
  assert.match(html, /趋势阈值决定未成交阶段的MA基准何时更新/);
  assert.match(html, /2bp=0\.02%/);
  assert.match(html, /完成一次买入和卖出约合4bp/);
});

test("ATR网格使用无底仓默认参数并自动读取最新交易日", () => {
  const defaults = {
    gridCash: "80000",
    gridInitialPosition: "0",
    gridPositionSize: "40",
    gridMaxPosition: "240",
    gridAtrPeriod: "14",
    gridAtrMultiplier: "0.5",
    gridMinSpacing: "0.1",
    gridMaxSpacing: "0.8",
    gridMaPeriod: "20",
    gridTrendThreshold: "0.3",
    gridCommission: "0.5",
    gridSlippage: "2",
  };
  for (const [id, value] of Object.entries(defaults)) {
    assert.match(html, new RegExp(`id="${id}"[^>]*value="${value}"`));
  }
  assert.match(html, /id="gridDate" type="date" title="打开页面时自动读取 QMT 最新可用交易日/);
  assert.match(frontend, /fetchJson\("\/api\/miniqmt\/health"\)/);
  assert.match(frontend, /miniQmtHealth\?\.latest_trading_date/);
  assert.doesNotMatch(frontend, /localStorage\.getItem\("finance\.quant\.grid\.date"\)/);
});

test("量化图表重复重绘时不会累乘高清屏画布高度", () => {
  const start = frontend.indexOf("function setupCanvas");
  const end = frontend.indexOf("\n}\n\nfunction drawLineChart", start) + 2;
  assert.ok(start >= 0 && end > start, "setupCanvas source should be extractable");

  const context = { window: { devicePixelRatio: 2 } };
  vm.runInNewContext(`${frontend.slice(start, end)}; this.setupCanvas = setupCanvas;`, context);

  let intrinsicHeight = "340";
  const drawingContext = {
    setTransform() {},
    clearRect() {},
  };
  const canvas = {
    dataset: {},
    parentElement: { clientWidth: 900 },
    getBoundingClientRect: () => ({ width: 900, height: 280 }),
    getAttribute: (name) => name === "height" ? intrinsicHeight : null,
    getContext: () => drawingContext,
  };
  Object.defineProperty(canvas, "height", {
    get: () => Number(intrinsicHeight),
    set: (value) => { intrinsicHeight = String(value); },
  });

  const first = context.setupCanvas(canvas);
  const second = context.setupCanvas(canvas);

  assert.equal(first.height, 280);
  assert.equal(second.height, 280);
  assert.equal(canvas.height, 560);
  assert.equal(canvas.dataset.logicalHeight, "280");
});
