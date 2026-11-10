const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculatePriorDailyAtr,
  runAtrGridBacktest,
} = require("../lib/cb-atr-grid-engine.js");

function dailyBars(count = 16) {
  return Array.from({ length: count }, (_, index) => ({
    date: `202608${String(index + 1).padStart(2, "0")}`,
    high: 101,
    low: 99,
    close: 100,
  }));
}

function minute(time, close, open = close) {
  return { time, open, high: close + 0.1, low: close - 0.1, close };
}

test("ATR只使用目标交易日前已完成的日K", () => {
  const rows = [
    ...dailyBars(16),
    { date: "20260828", high: 200, low: 1, close: 150 },
  ];
  const atr = calculatePriorDailyAtr(rows, "20260828", 14);
  assert.equal(atr.complete, true);
  assert.equal(atr.sample_count, 14);
  assert.equal(atr.last_completed_date, "20260816");
  assert.equal(atr.value, 2);
});

test("ATR网格按当前分钟触发并在下一分钟成交", () => {
  const result = runAtrGridBacktest({
    code: "127067.SZ",
    tradingDate: "20260828",
    dailyBars: dailyBars(16),
    minuteBars: [
      minute("09:30", 100),
      minute("09:31", 99),
      minute("09:32", 99, 99.1),
      minute("09:33", 100),
      minute("09:34", 100, 100.1),
    ],
    initialCash: 100_000,
    initialPosition: 100,
    positionSize: 100,
    maxPosition: 500,
    atrPeriod: 14,
    atrMultiplier: 0.5,
    minGridSpacingPct: 0.1,
    maxGridSpacingPct: 0.8,
    maPeriod: 20,
    trendThresholdPct: 20,
    commissionRate: 0,
    slippageBps: 0,
  });
  assert.equal(result.atr.value, 2);
  assert.equal(result.trades.length, 2);
  assert.deepEqual(result.trades.map((trade) => trade.side), ["buy", "sell"]);
  assert.equal(result.trades[0].signal_time, "09:31");
  assert.equal(result.trades[0].execution_time, "09:32");
  assert.equal(result.trades[0].execution_price, 99.1);
  assert.equal(result.trades[1].signal_time, "09:33");
  assert.equal(result.trades[1].execution_time, "09:34");
  assert.equal(result.metrics.ending_position, 100);
  assert.equal(result.equity_curve[0].reference_price, 100);
  assert.equal(result.equity_curve[0].lower_trigger_price, 99.2);
  assert.equal(result.equity_curve[0].upper_trigger_price, 100.8);
  assert.equal(result.equity_curve[2].reference_price, 99.1);
});

test("ATR不足时明确降级到最小网格间距", () => {
  const result = runAtrGridBacktest({
    tradingDate: "20260828",
    dailyBars: dailyBars(5),
    minuteBars: [minute("09:30", 100), minute("09:31", 99), minute("09:32", 99)],
    minGridSpacingPct: 0.5,
    commissionRate: 0,
    slippageBps: 0,
  });
  assert.equal(result.atr.complete, false);
  assert.equal(result.atr.value, null);
  assert.equal(result.metrics.minimum_grid_spacing_pct, 0.5);
});

test("ATR网格缺省参数与页面无底仓配置一致", () => {
  const result = runAtrGridBacktest({
    tradingDate: "20260828",
    dailyBars: dailyBars(5),
    minuteBars: [minute("09:30", 100), minute("09:31", 100)],
  });
  assert.equal(result.params.initial_cash, 80_000);
  assert.equal(result.params.initial_position, 0);
  assert.equal(result.params.position_size, 40);
  assert.equal(result.params.max_position, 240);
  assert.equal(result.params.atr_period, 14);
  assert.equal(result.params.atr_multiplier, 0.5);
  assert.equal(result.params.min_grid_spacing_pct, 0.1);
  assert.equal(result.params.max_grid_spacing_pct, 0.8);
  assert.equal(result.params.ma_period, 20);
  assert.equal(result.params.trend_threshold_pct, 0.3);
  assert.equal(result.params.commission_rate, 0.00005);
  assert.equal(result.params.slippage_bps, 2);
});
