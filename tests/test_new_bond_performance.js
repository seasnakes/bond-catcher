"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  chartDomain,
  chooseDefaultCodes,
  median,
  monotoneBezierSegments,
  nearestPoint,
  sortTooltipRows,
  summarizeSeries,
} = require("../new-bond-performance-core.js");

test("default comparison keeps the newest twelve listing dates", () => {
  const universe = Array.from({ length: 15 }, (_value, index) => ({
    code: `123${String(index).padStart(3, "0")}.SZ`,
    listing_date: `2026-08-${String(index + 1).padStart(2, "0")}`,
  }));
  const selected = chooseDefaultCodes(universe, 12);
  assert.equal(selected.length, 12);
  assert.equal(selected[0], "123014.SZ");
  assert.equal(selected.at(-1), "123003.SZ");
});

test("nearest point preserves an observed timestamp instead of inventing one", () => {
  const points = [
    { progress: 0, datetime: "2026-08-01 09:45", return_pct: 0 },
    { progress: 0.4, datetime: "2026-08-05 10:00", return_pct: 2 },
    { progress: 1, datetime: "2026-08-20 15:00", return_pct: 5 },
  ];
  assert.equal(nearestPoint(points, 0.31).datetime, "2026-08-05 10:00");
  assert.equal(nearestPoint(points, 0.8).datetime, "2026-08-20 15:00");
});

test("summary and domain include negative and positive observed returns", () => {
  const series = [
    { return_pct: -4, listing_day_complete: true, points: [{ return_pct: -7 }, { return_pct: -4 }] },
    { return_pct: 2, listing_day_complete: false, points: [{ return_pct: 0 }, { return_pct: 4 }] },
    { return_pct: 8, listing_day_complete: true, points: [{ return_pct: 0 }, { return_pct: 8 }] },
  ];
  assert.equal(median([-4, 2, 8]), 2);
  assert.deepEqual(summarizeSeries(series), {
    count: 3,
    medianReturn: 2,
    risingCount: 2,
    completeStartCount: 2,
  });
  const domain = chartDomain(series);
  assert.ok(domain.minimum < -7);
  assert.ok(domain.maximum > 8);
  const priceDomain = chartDomain([
    { points: [{ close: 101 }, { close: 112 }] },
  ], "close");
  assert.ok(priceDomain.minimum > 90);
  assert.ok(priceDomain.maximum > 112);
});

test("monotone smoothing passes through every real close without control-point overshoot", () => {
  const points = [
    { x: 0, y: 100 },
    { x: 40, y: 120 },
    { x: 80, y: 110 },
    { x: 120, y: 130 },
  ];
  const segments = monotoneBezierSegments(points);
  assert.equal(segments.length, 3);
  assert.deepEqual(segments[0].from, points[0]);
  assert.deepEqual(segments.at(-1).to, points.at(-1));
  for (const segment of segments) {
    const low = Math.min(segment.from.y, segment.to.y);
    const high = Math.max(segment.from.y, segment.to.y);
    assert.ok(segment.control1.y >= low && segment.control1.y <= high);
    assert.ok(segment.control2.y >= low && segment.control2.y <= high);
  }
});

test("tooltip rows follow the value at the hovered position", () => {
  const rows = [
    { item: { name: "甲转债" }, point: { close: 145, return_pct: 8 } },
    { item: { name: "乙转债" }, point: { close: 182, return_pct: -2 } },
    { item: { name: "丙转债" }, point: { close: 160, return_pct: 12 } },
  ];

  assert.deepEqual(
    sortTooltipRows(rows, "close").map((row) => row.item.name),
    ["乙转债", "丙转债", "甲转债"],
  );
  assert.deepEqual(
    sortTooltipRows(rows, "return_pct").map((row) => row.item.name),
    ["丙转债", "甲转债", "乙转债"],
  );
  assert.equal(rows[0].item.name, "甲转债");
});
