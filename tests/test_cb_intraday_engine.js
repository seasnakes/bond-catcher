const test = require("node:test");
const assert = require("node:assert/strict");

const {
  findIntradayEntry,
  kellyRiskPlan,
  replayIntraday,
  summarizeAuctionPair,
} = require("../lib/cb-intraday-engine.js");

function auctionSeries(secid, previousClose, price, change, amount) {
  return {
    secid,
    previousClose,
    samples: [
      { time: "09:15:09", timestamp: 1, price: price * 0.9, change: -10, amount: 0 },
      { time: "09:25:00", timestamp: 2, price, change, amount },
    ],
  };
}

function minute(time, close, overrides = {}) {
  return {
    time,
    open: close,
    high: close + 0.2,
    low: close - 0.2,
    close,
    amount: 1_000_000,
    purple: close - 0.3,
    purple_ma27: close - 0.5,
    purple_rising: true,
    intraday_average: close - 0.4,
    dark_state: "inflow",
    macd: 0.2,
    ...overrides,
  };
}

function event(time, eventType, overrides = {}) {
  return {
    event_time: `2026-08-28 ${time}`,
    event_type: eventType,
    speed_3m: 0.006,
    speed_5m: 0.008,
    confidence: "indicator_derived_from_minute_bars",
    ...overrides,
  };
}

test("竞价状态只采纳09:25带成交额确认的债股配对", () => {
  const result = summarizeAuctionPair({
    bondSeries: auctionSeries("0.127067", 186.373, 186.019, -0.19, 2_025_700),
    stockSeries: auctionSeries("0.000703", 19.2, 19.2, 0, 13_975_600),
  });
  assert.equal(result.status, "neutral");
  assert.equal(result.allow_long, true);
  assert.equal(result.bond.time, "09:25");
  assert.equal(result.bond.price, 186.019);
  assert.equal(result.lead_gap_pct, 0.19);
});

test("凯利只给风险预算，并同时受风险与总仓位上限约束", () => {
  const result = kellyRiskPlan({
    winRate: 0.52,
    payoffRatio: 2,
    discount: 0.25,
    maxRiskPct: 0.005,
    maxPositionPct: 0.2,
    stopPct: 0.01,
    sampleSize: 0,
  });
  assert.equal(result.full_kelly_fraction, 0.28);
  assert.equal(result.discounted_kelly_fraction, 0.07);
  assert.equal(result.risk_budget_fraction, 0.005);
  assert.equal(result.position_fraction, 0.2);
  assert.equal(result.calibration_quality, "manual_assumption_insufficient_sample");
});

test("宽松紫线信号不直接买，结构与跨类别确认后下一分钟成交", () => {
  const rows = [
    minute("09:39", 99, { purple: 100, purple_ma27: 101, purple_rising: false, dark_state: "outflow", macd: -0.2 }),
    minute("09:40", 99.2, { purple: 100, purple_ma27: 101, purple_rising: false }),
    minute("09:41", 99.4, { purple: 100, purple_ma27: 101, purple_rising: false }),
    minute("09:42", 99.8, { purple: 100, purple_ma27: 101, purple_rising: false }),
    minute("09:43", 100.1),
    minute("09:44", 100.4),
    minute("09:45", 100.6),
    minute("09:46", 100.8, { open: 100.7, high: 101, low: 100.5 }),
    minute("09:47", 102, { open: 101, high: 103, low: 100.9 }),
    minute("09:48", 104, { open: 103, high: 105, low: 102.8 }),
  ];
  const events = [
    event("09:40:00", "purple_line_pullback_reclaim", { speed_3m: -0.001, speed_5m: -0.002 }),
    event("09:45:00", "dark_funds_inflow_accelerating"),
    event("09:45:00", "interval_volume"),
    event("09:45:00", "visible_funds_strong_inflow"),
  ];
  const auction = summarizeAuctionPair({
    bondSeries: auctionSeries("0.123273", 100, 100, 0, 2_000_000),
    stockSeries: auctionSeries("0.300000", 10, 10, 0, 5_000_000),
  });
  const analysis = findIntradayEntry({ code: "123273.SZ", date: "20260828", rows, events, auction });
  assert.equal(analysis.entry_signal.signal_time, "09:45:00");
  assert.equal(analysis.entry_signal.source_bar_time, "09:44");
  assert.ok(analysis.rejected_candidates.length >= 0);

  const replay = replayIntraday({
    code: "123273.SZ",
    date: "20260828",
    rows,
    events,
    auction,
    initialCash: 100_000,
    commissionRate: 0,
    slippageBps: 0,
  });
  assert.equal(replay.trade_plan.fill_time, "09:46");
  assert.equal(replay.fills[0].time, "09:46");
  assert.equal(replay.fills[0].side, "buy");
  assert.equal(replay.fills[0].price, 100.7);
  assert.ok(replay.fills.some((fill) => fill.side === "sell"));
});

test("竞价数据缺失时日内自动开仓被否决", () => {
  const result = findIntradayEntry({
    code: "127067.SZ",
    date: "20260828",
    rows: [minute("10:00", 100)],
    events: [event("10:00:00", "purple_line_pullback_reclaim")],
    auction: summarizeAuctionPair({}),
  });
  assert.equal(result.entry_signal, null);
  assert.equal(result.auction.allow_long, false);
  assert.deepEqual(result.rejected_candidates[0].reason_codes, ["AUCTION_0925_PAIR_MISSING"]);
});
