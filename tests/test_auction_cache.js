const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAuctionSignalRows,
  filterAuctionCacheSeries,
  validateAuctionQuote,
  validateAuctionSample,
} = require("../server.js");

const goodTimestamp = Date.parse("2026-08-12T09:24:31+08:00");
const capturedAt = Date.parse("2026-08-12T09:24:32+08:00");

test("accepts a same-day MiniQMT quote inside call auction", () => {
  const result = validateAuctionQuote(
    {
      date: "20260812",
      time: "09:24:31",
      timetag: "20260812 09:24:31",
      timestamp: goodTimestamp,
    },
    "20260812",
    capturedAt,
  );

  assert.equal(result.ok, true);
  assert.equal(result.date, "20260812");
  assert.equal(result.time, "09:24:31");
});

test("rejects yesterday close even if top-level cache date is today", () => {
  const result = validateAuctionSample(
    {
      capturedAt,
      timestamp: Date.parse("2026-08-11T15:00:01+08:00"),
      time: "15:00:01",
      price: 100,
    },
    "20260812",
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, "quote_date_mismatch");
});

test("rejects a quote when timetag disagrees with date and time fields", () => {
  const result = validateAuctionQuote(
    {
      date: "20260812",
      time: "09:24:31",
      timetag: "20260811 15:00:01",
      timestamp: goodTimestamp,
    },
    "20260812",
    capturedAt,
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, "quote_timetag_mismatch");
});

test("rejects timestamp whose time disagrees with quote time", () => {
  const result = validateAuctionQuote(
    {
      date: "20260812",
      time: "09:24:31",
      timetag: "20260812 09:24:31",
      timestamp: Date.parse("2026-08-12T09:20:00+08:00"),
    },
    "20260812",
    capturedAt,
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, "quote_timestamp_time_mismatch");
});

test("cache reload drops yesterday samples and keeps valid today samples", () => {
  const result = filterAuctionCacheSeries(
    [
      {
        secid: "0.123273",
        previousClose: 100,
        samples: [
          {
            capturedAt,
            timestamp: Date.parse("2026-08-11T15:00:01+08:00"),
            time: "15:00:01",
            price: 100,
          },
          {
            capturedAt,
            date: "20260812",
            timestamp: goodTimestamp,
            time: "09:24:31",
            timetag: "20260812 09:24:31",
            price: 101,
          },
        ],
      },
      {
        secid: "1.113707",
        previousClose: 200,
        samples: [
          {
            capturedAt,
            timestamp: Date.parse("2026-08-11T15:00:02+08:00"),
            time: "15:00:02",
            price: 200,
          },
        ],
      },
    ],
    "20260812",
  );

  assert.equal(result.filteredSampleCount, 2);
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].secid, "0.123273");
  assert.equal(result.series[0].samples.length, 1);
  assert.equal(result.series[0].samples[0].timestamp, goodTimestamp);
});

function auctionSeries(secid, change, deltaAmount) {
  return {
    secid,
    date: "20260812",
    samples: Array.from({ length: 5 }, (_, index) => ({
      date: "20260812",
      time: `09:2${index}:00`,
      timestamp: goodTimestamp + index * 3000,
      capturedAt: capturedAt + index * 3000,
      price: 100 + change,
      change,
      amount: deltaAmount * (index + 1),
      deltaAmount,
    })),
  };
}

test("builds stock-leading and paired-confirmed auction signals", () => {
  const pairs = [
    {
      bondSecid: "0.123213",
      bondCode: "123213",
      bondName: "天源转债",
      stockSecid: "0.301127",
      stockCode: "301127",
      stockName: "武汉天源",
    },
    {
      bondSecid: "1.118062",
      bondCode: "118062",
      bondName: "天准转债",
      stockSecid: "1.688003",
      stockCode: "688003",
      stockName: "天准科技",
    },
    {
      bondSecid: "0.123273",
      bondCode: "123273",
      bondName: "低量转债",
      stockSecid: "0.300001",
      stockCode: "300001",
      stockName: "低量正股",
    },
  ];
  const series = new Map([
    ["0.123213", auctionSeries("0.123213", 1.0, 100_000)],
    ["0.301127", auctionSeries("0.301127", 3.8, 10_000_000)],
    ["1.118062", auctionSeries("1.118062", 1.2, 2_000_000)],
    ["1.688003", auctionSeries("1.688003", 3.0, 10_000_000)],
    ["0.123273", auctionSeries("0.123273", 0.2, 10_000)],
    ["0.300001", auctionSeries("0.300001", 0.1, 10_000)],
  ]);

  const result = buildAuctionSignalRows(pairs, series, "20260812");
  assert.equal(result.sampledPairs, 3);
  assert.equal(result.coverage.sampled, 3);
  assert.equal(result.signals[0].bondName, "天准转债");
  assert.equal(result.signals[0].signalType, "paired_confirmed");
  assert.equal(
    result.signals.find((signal) => signal.bondName === "天源转债")?.signalType,
    "stock_lead",
  );
});

test("does not label zero-amount auction prices as volume anomalies", () => {
  const pairs = [
    {
      bondSecid: "0.123213",
      bondCode: "123213",
      bondName: "天源转债",
      stockSecid: "0.301127",
      stockCode: "301127",
      stockName: "武汉天源",
    },
    {
      bondSecid: "1.118062",
      bondCode: "118062",
      bondName: "天准转债",
      stockSecid: "1.688003",
      stockCode: "688003",
      stockName: "天准科技",
    },
  ];
  const series = new Map([
    ["0.123213", auctionSeries("0.123213", 1.5, 0)],
    ["0.301127", auctionSeries("0.301127", 4.0, 0)],
    ["1.118062", auctionSeries("1.118062", 1.2, 0)],
    ["1.688003", auctionSeries("1.688003", 3.0, 0)],
  ]);

  const result = buildAuctionSignalRows(pairs, series, "20260812");
  assert.equal(result.amountReady, false);
  assert.deepEqual(result.amountCoverage, { stock: 0, bond: 0 });
  assert.equal(result.signals.length, 0);
});

test("deduplicates the same bond-stock pair across board groups", () => {
  const pair = {
    bondSecid: "0.123213",
    bondCode: "123213",
    bondName: "天源转债",
    stockSecid: "0.301127",
    stockCode: "301127",
    stockName: "武汉天源",
  };
  const series = new Map([
    ["0.123213", auctionSeries("0.123213", 1.5, 2_000_000)],
    ["0.301127", auctionSeries("0.301127", 4.0, 10_000_000)],
  ]);

  const result = buildAuctionSignalRows([pair, { ...pair }], series, "20260812");
  assert.equal(result.coverage.requested, 1);
  assert.equal(result.sampledPairs, 1);
  assert.equal(result.signals.length, 1);
  assert.equal(result.signals[0].signalType, "paired_confirmed");
});
