const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cbQuoteExecutionState,
  expectedCompletedCbDate,
} = require("../server.js");

test("模拟成交只接受连续交易时段内三分钟以内的当日报价", () => {
  const now = Date.parse("2026-08-31T10:00:00+08:00");
  const live = cbQuoteExecutionState({
    date: "20260831",
    timestamp: now - 30_000,
  }, now);
  assert.equal(live.executable, true);
  assert.equal(live.quality, "live_miniqmt_quote");

  const stale = cbQuoteExecutionState({
    date: "20260831",
    timestamp: now - 181_000,
  }, now);
  assert.equal(stale.executable, false);
  assert.equal(stale.quality, "stale_quote");
});

test("休市时上一交易日最后报价不能冒充实时模拟成交价", () => {
  const saturday = Date.parse("2026-08-29T10:00:00+08:00");
  const result = cbQuoteExecutionState({
    date: "20260828",
    timestamp: Date.parse("2026-08-28T15:00:00+08:00"),
  }, saturday);
  assert.equal(result.executable, false);
  assert.equal(result.quality, "market_closed_last_quote");
});

test("盘中策略只把前一已完成交易日作为日K新鲜度基准", () => {
  const health = { available_dates: ["20260831", "20260828", "20260827"] };
  assert.equal(
    expectedCompletedCbDate(health, Date.parse("2026-08-31T10:00:00+08:00")),
    "20260828",
  );
  assert.equal(
    expectedCompletedCbDate(health, Date.parse("2026-08-31T15:06:00+08:00")),
    "20260831",
  );
});
