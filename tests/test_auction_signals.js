const assert = require("node:assert/strict");
const test = require("node:test");
const { appendAuctionSample, buildAuctionSignalRows, summarizeAuctionSeries } = require("../lib/auction-signals.js");

const date = "20260904";
const at = (time) => Date.parse(`2026-09-04T${time}+08:00`);
const pair = { bondSecid: "0.123213", stockSecid: "0.301127", bondName: "测试转债", stockName: "测试正股" };
function series(changes, times = ["09:20:00", "09:21:00", "09:22:00"], amount = 0) {
  return {
    date, previousClose: 100, source: "QMT test fixture",
    samples: changes.map((change, index) => ({
      date, time: times[index], timestamp: at(times[index]), capturedAt: at(times[index]) + 1000,
      price: 100 + change, change, amount: times[index] >= "09:25:00" ? amount : 0,
      deltaAmount: 0,
    })),
  };
}
function run(stock, bond, options = {}, pairs = [pair]) {
  return buildAuctionSignalRows(pairs, new Map([[pair.stockSecid, stock], [pair.bondSecid, bond]]), date, options);
}

test("water-to-positive prices warn before 09:25 even with zero amount everywhere", () => {
  const result = run(series([-1, -0.2, 0.8]), series([-0.8, -0.1, 0.5]), { asOf: at("09:22:02") });
  assert.equal(result.amountReady, false);
  assert.equal(result.signals.length, 1);
  const signal = result.signals[0];
  assert.equal(signal.stage, "indicative");
  assert.equal(signal.signalType, "price_paired");
  assert.equal(signal.stock.trajectory.kind, "recovery");
  assert.equal(signal.stock.amount, null);
  assert.equal(signal.stock.amountStatus, "pending");
  assert.doesNotMatch(signal.reason, /放量|已确认/);
});

test("same closing rise has a different verdict when the path keeps falling", () => {
  const rising = run(series([-1, 0.5, 2]), series([0, 0.7, 1.5])).signals[0];
  const falling = run(series([4, 3, 2]), series([3, 2, 1.5])).signals[0];
  assert.equal(rising.stock.trajectory.label, "水下拉起");
  assert.equal(falling.stock.trajectory.label, "持续回落");
  assert.equal(falling.status, "weakening");
  assert.ok(rising.rankScore > falling.rankScore);
  assert.ok(rising.priority > falling.priority);
});

test("post-09:20 fade overrides an early rally even with a large final turnover", () => {
  const times = ["09:15:00", "09:18:00", "09:20:00", "09:22:00", "09:25:00"];
  const result = run(series([-2, 4, 4, 3, 2], times, 30_000_000), series([-1, 3, 3, 2, 1], times, 3_000_000));
  assert.equal(result.signals[0].signalType, "price_fading");
  assert.equal(result.signals[0].stage, "final");
  assert.equal(result.signals[0].stock.trajectory.window, "09:20后");
  assert.equal(result.signals[0].stock.amount, 30_000_000);
});

test("an as-of replay cannot see future quotes, captures or final amounts", () => {
  const times = ["09:20:00", "09:22:00", "09:24:00", "09:25:00"];
  const s = series([-1, 0.4, 1.4, 2], times, 25_000_000);
  const early = run(s, s, { asOf: at("09:24:00") });
  assert.equal(early.latestQuoteTime, "09:22:00"); // 09:24 not received yet
  assert.equal(early.signals.length, 0); // 09:22 quote is already stale
  const before = run(s, s, { asOf: at("09:24:02") });
  assert.equal(before.signals[0].stock.amount, null);
  assert.equal(before.signals[0].stock.points.length, 3);
  const after = run(s, s, { asOf: at("09:25:02") });
  assert.equal(after.signals[0].signalType, "paired_confirmed");
  assert.equal(after.signals[0].stock.amount, 25_000_000);
});

test("final cumulative amount persists through later zero-increment snapshots", () => {
  const times = ["09:24:00", "09:24:30", "09:25:00", "09:25:03", "09:25:06", "09:25:09", "09:25:12", "09:25:15", "09:25:18"];
  const s = series(times.map(() => 2), times, 23_456_789);
  const result = run(s, s);
  assert.equal(result.signals[0].stock.amount, 23_456_789);
  assert.equal(result.signals[0].signalType, "paired_confirmed");
});

test("a valid pair is not blocked by missing amount coverage in other pairs", () => {
  const times = ["09:24:00", "09:24:30", "09:25:00"];
  const missing = Array.from({ length: 5 }, (_, i) => ({ stockSecid: `0.30000${i}`, bondSecid: `0.12300${i}` }));
  const result = run(series([1, 1.5, 2], times, 10_000_000), series([0.2, 0.8, 1.2], times, 2_000_000), {}, [pair, ...missing]);
  assert.equal(result.amountReady, false);
  assert.equal(result.signals[0].signalType, "paired_confirmed");
  assert.equal(result.coverage.requested, 6);
});

test("tiny amounts cannot be confirmed just because a small pool gives P100", () => {
  const times = ["09:24:00", "09:24:30", "09:25:00"];
  const result = run(series([1, 2, 3], times, 100), series([1, 2, 3], times, 100));
  assert.equal(result.signals[0].stock.amountPercentile, 1);
  assert.equal(result.signals[0].signalType, "price_paired");
});

test("missing bond samples still allow a stock price watch, never paired confirmation", () => {
  const result = run(series([-1, 0, 1]), null);
  assert.equal(result.coverage.partial, 1);
  assert.equal(result.sampledPairs, 0);
  assert.equal(result.signals[0].signalType, "price_stock_lead");
  assert.equal(result.signals[0].bond, null);
  assert.match(result.signals[0].reason, /转债缺少采样/);
});

test("stale prices are not announced as fresh pre-auction warnings", () => {
  const result = run(series([-1, 0, 1]), series([-1, 0, 1]), { asOf: at("09:24:00") });
  assert.equal(result.signals.length, 0);
  assert.equal(result.coverage.stale, 1);
});

test("one or closely spaced samples cannot establish a rising trajectory", () => {
  assert.equal(summarizeAuctionSeries(series([2], ["09:20:00"]), date).trajectory.sufficient, false);
  const short = series([-1, 0, 1], ["09:20:00", "09:20:03", "09:20:06"]);
  assert.equal(summarizeAuctionSeries(short, date).trajectory.kind, "insufficient");
});

test("unknown previous close and unknown change cannot produce a false zero baseline", () => {
  const s = series([1, 2, 3]);
  s.previousClose = null;
  s.samples.forEach((sample) => { sample.change = null; });
  assert.equal(summarizeAuctionSeries(s, date), null);
});

test("invalid date and mismatched time samples are excluded", () => {
  const s = series([1, 2, 3]);
  s.samples[0].date = "20260903";
  s.samples[1].time = "09:24:00";
  const result = summarizeAuctionSeries(s, date);
  assert.equal(result.sampleCount, 1);
  assert.equal(summarizeAuctionSeries(s, "20260907"), null);
});

test("sample ingestion updates a late final amount at the same source timestamp and rejects regressions", () => {
  const s = series([1], ["09:25:00"], 0);
  assert.equal(appendAuctionSample(s, { ...s.samples[0], amount: 900_000, capturedAt: at("09:25:04") }), true);
  assert.equal(s.samples.length, 1);
  assert.equal(s.samples[0].amount, 900_000);
  assert.equal(appendAuctionSample(s, { ...s.samples[0], capturedAt: at("09:25:05") }), false);
  assert.equal(appendAuctionSample(s, { ...s.samples[0], timestamp: at("09:24:00"), amount: 0 }), false);
  assert.equal(summarizeAuctionSeries(s, date).amount, 900_000);
});

test("a same-time volume correction is kept and pre-match volume stays unavailable", () => {
  const s = series([2, 2], ["09:24:00", "09:25:00"], 10000);
  s.samples.forEach((sample) => { sample.volume = 8; });
  assert.equal(summarizeAuctionSeries(s, date, { asOf: at("09:24:01") }).auctionVolume, null);
  assert.ok(appendAuctionSample(s, { ...s.samples.at(-1), volume: 11 }));
  assert.equal(summarizeAuctionSeries(s, date).auctionVolume, 11);
});

test("auction volume compares each final leg with the exact previous session and backfills legacy ticks by timestamp", async () => {
  const { createAuctionVolumeComparison } = require("../lib/auction-volume-comparison.js");
  const requests = [];
  const enrich = createAuctionVolumeComparison((code) => code, async (path) => {
    const url = new URL(path, "http://localhost");
    requests.push(url);
    if (url.pathname.includes("prev_trading_date")) return { prev_trading_date: Date.parse("2026-09-04T00:00:00+08:00") };
    if (url.searchParams.get("period") === "1d") {
      assert.equal(url.searchParams.get("start_time"), "20260904");
      assert.equal(url.searchParams.get("end_time"), "20260904");
      return { data: { stock: [{ index: "20260904", volume: 2000 }], bond: [{ index: "20260904", volume: 5000 }],
        absent: [{ index: "20260903", volume: 999 }], zero: [{ index: "20260904", volume: 0 }] } };
    }
    assert.equal(url.searchParams.get("stocks"), "bond");
    return { data: { bond: [{ time: tick, volume: 25 }, { time: tick + 1000, volume: 300 }] } };
  });
  const tick = Date.parse("2026-09-07T09:25:00+08:00");
  const final = { stage: "final", timestamp: tick, auctionVolume: 50 };
  const rows = [
    { stockSecid: "stock", bondSecid: "bond", stock: { ...final }, bond: { ...final, auctionVolume: null } },
    { stockSecid: "absent", bondSecid: "zero", stock: { ...final }, bond: { ...final } },
  ];
  const early = { stockSecid: "stock", stock: { stage: "indicative", auctionVolume: null } };
  enrich([early], "20260907");
  assert.equal(requests.length, 0);
  enrich(rows, "20260907");
  enrich(rows, "20260907");
  await new Promise((resolve) => setImmediate(resolve));
  enrich(rows, "20260907");
  assert.equal(rows[0].stock.auctionVolumePct, 2.5);
  assert.equal(rows[0].bond.auctionVolumePct, 0.5);
  assert.equal(rows[0].stock.previousVolumeDate, "20260904");
  assert.equal(rows[1].stock.auctionVolumePct, null);
  assert.equal(rows[1].bond.auctionVolumePct, null);
  assert.equal(requests.length, 3);
  enrich(rows.map((s) => ({ ...s, stock: { ...final }, bond: null })), "20260908");
  assert.equal(requests[3].searchParams.get("date"), "20260908");
});
