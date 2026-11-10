const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LOT_SIZE,
  computeMetrics,
  createPaperState,
  evaluateStrategy,
  executePaperOrder,
  listStrategies,
  normalizeConvertibleBondCode,
  runBacktest,
} = require("../lib/cb-quant-engine.js");

test("夏普比率只对日收益方差除一次样本数", () => {
  const equityCurve = [100, 101, 100, 102].map((total_asset, index) => ({
    date: tradingDate(index),
    total_asset,
  }));
  const returns = [0.01, 100 / 101 - 1, 0.02];
  const mean = returns.reduce((total, value) => total + value, 0) / returns.length;
  const variance = returns.reduce((total, value) => total + (value - mean) ** 2, 0)
    / returns.length;
  const expected = (mean / Math.sqrt(variance)) * Math.sqrt(252);
  const metrics = computeMetrics(100, [], equityCurve);
  assert.ok(Math.abs(metrics.sharpe_ratio - expected) < 0.0001);
});

function tradingDate(index) {
  return `2026${String(1 + Math.floor(index / 28)).padStart(2, "0")}${String(1 + (index % 28)).padStart(2, "0")}`;
}

function bar(index, close, overrides = {}) {
  return {
    date: tradingDate(index),
    open: close,
    high: close,
    low: close,
    close,
    volume: 10_000,
    amount: 1_000_000,
    ...overrides,
  };
}

test("可转债代码归一化覆盖沪深市场", () => {
  assert.equal(normalizeConvertibleBondCode("113667"), "113667.SH");
  assert.equal(normalizeConvertibleBondCode("sz123273"), "123273.SZ");
  assert.throws(() => normalizeConvertibleBondCode("600519"), /无法判断可转债市场/);
});

test("策略注册表包含参考策略与现有紫线适配", () => {
  const names = new Set(listStrategies().map((strategy) => strategy.name));
  for (const name of [
    "ma20_cross",
    "macd_daily",
    "ema_5_20",
    "purple_cross",
    "bollinger_revert",
    "donchian_breakout",
  ]) {
    assert.equal(names.has(name), true);
  }
});

test("回测在收盘出信号并于下一根K线开盘成交", () => {
  const bars = Array.from({ length: 21 }, (_value, index) => bar(index, 100));
  bars.push(bar(21, 110, { high: 110, low: 100, open: 100 }));
  bars.push(bar(22, 80, { open: 120, high: 120, low: 80 }));
  bars.push(bar(23, 70, { open: 70, high: 72, low: 68 }));

  const result = runBacktest({
    code: "123273.SZ",
    strategy: "donchian_breakout",
    bars,
    initialCash: 100_000,
    commissionRate: 0,
    slippageBps: 0,
    positionPct: 95,
  });

  assert.equal(result.trades.length, 2);
  assert.deepEqual(
    result.trades.map((trade) => [trade.signal_date, trade.date, trade.side, trade.price]),
    [
      [tradingDate(21), tradingDate(22), "buy", 120],
      [tradingDate(22), tradingDate(23), "sell", 70],
    ],
  );
  assert.equal(result.trades[0].quantity % LOT_SIZE, 0);
  assert.equal(result.params.settlement, "T+0");
  assert.match(result.execution_model, /T\+1根日K开盘价/);
  assert.equal(result.metrics.closed_trades, 1);
  assert.ok(result.metrics.total_return < 0);
});

test("回测不会用最后一根K线收盘信号在同一根K线成交", () => {
  const bars = Array.from({ length: 22 }, (_value, index) => bar(index, 100));
  bars.push(bar(22, 110, { high: 110 }));
  bars.push(bar(23, 111, { high: 111 }));
  const result = runBacktest({
    code: "113667.SH",
    strategy: "donchian_breakout",
    bars,
    initialCash: 100_000,
    commissionRate: 0,
    slippageBps: 0,
  });

  assert.equal(result.trades[0].signal_date, tradingDate(22));
  assert.equal(result.trades[0].date, tradingDate(23));
  assert.equal(result.trades[0].price, 111);
});

test("模拟账户真实更新现金持仓费用与T+0可卖数量", () => {
  let state = createPaperState(100_000);
  state = executePaperOrder(state, {
    code: "123273.SZ",
    side: "buy",
    price: 100,
    quantity: 10,
    commissionRate: 0,
    slippageBps: 0,
    timestamp: "2026-08-28T10:00:00+08:00",
  });

  assert.equal(state.cash, 99_000);
  assert.equal(state.positions["123273.SZ"].quantity, 10);
  assert.equal(state.positions["123273.SZ"].available_quantity, 10);

  state = executePaperOrder(state, {
    code: "123273.SZ",
    side: "sell",
    price: 110,
    quantity: 10,
    commissionRate: 0,
    slippageBps: 0,
    timestamp: "2026-08-28T10:01:00+08:00",
  });

  assert.equal(state.cash, 100_100);
  assert.equal(state.realized_pnl, 100);
  assert.equal(state.total_asset, 100_100);
  assert.equal(state.positions["123273.SZ"], undefined);
  assert.equal(state.fills.at(-1).settlement, "T+0");
});

test("模拟账户保留ATR网格参数与逐券运行状态", () => {
  const state = createPaperState(100_000);
  assert.equal(state.settings.grid_atr_period, 14);
  assert.equal(state.settings.grid_atr_multiplier, 0.5);
  assert.equal(state.settings.grid_position_size, 100);
  assert.deepEqual(state.strategy_state.atr_grid, {});
});

test("紫线策略只读取传入时点以前的日K", () => {
  const bars = Array.from({ length: 40 }, (_value, index) => bar(index, 100 + index * 0.1));
  const first = evaluateStrategy("purple_cross", bars);
  const second = evaluateStrategy("purple_cross", [...bars, bar(40, 50)]);
  assert.equal(first.strategy, "purple_cross");
  assert.notEqual(second.values.purple, undefined);
  assert.equal(second.side, "sell");
});
