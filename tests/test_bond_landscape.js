"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildTerrain,
  computeEmbedding,
  computeGroupStats,
  marchingSquares,
  project3D,
  selectAttentionPoints,
} = require("../bond-landscape.js");

const rows = [
  {
    code: "110001.SH", name: "甲转债", stock: "甲公司", stockCode: "600001.SH",
    industry1: "电子", industry2: "半导体", industry3: "芯片设计", theme: "AI",
    tags: ["半导体"], topics: ["人工智能"], price: 120, premium: 18, issue: 6,
    rating: "AA", change: 1.2, stockChange: 2.4, amount: 3.2,
  },
  {
    code: "110002.SH", name: "乙转债", stock: "乙公司", stockCode: "600002.SH",
    industry1: "电子", industry2: "半导体", industry3: "芯片设计", theme: "AI",
    tags: ["半导体"], topics: ["人工智能"], price: 123, premium: 20, issue: 5,
    rating: "AA-", change: 0.8, stockChange: 1.8, amount: 2.8,
  },
  {
    code: "123001.SZ", name: "丙转债", stock: "丙公司", stockCode: "300001.SZ",
    industry1: "农林牧渔", industry2: "养殖业", industry3: "生猪养殖", theme: "猪肉",
    tags: ["农业"], topics: ["猪肉概念"], price: 108, premium: 55, issue: 18,
    rating: "A+", change: -1.1, stockChange: -2.1, amount: 0.8,
  },
  {
    code: "123002.SZ", name: "丁转债", stock: "丁公司", stockCode: "300002.SZ",
    industry1: "农林牧渔", industry2: "养殖业", industry3: "生猪养殖", theme: "猪肉",
    tags: ["农业"], topics: ["猪肉概念"], price: 106, premium: 58, issue: 20,
    rating: "A", change: -0.7, stockChange: -1.6, amount: 0.6,
  },
];

test("embedding is deterministic, bounded, and ignores live quote changes", () => {
  const first = computeEmbedding(rows);
  const changedQuotes = rows.map((row) => ({ ...row, change: row.change * -9, amount: row.amount * 20 }));
  const second = computeEmbedding(changedQuotes);
  for (const row of rows) {
    assert.deepEqual(first.get(row.code), second.get(row.code));
    assert.ok(first.get(row.code).x >= 0.05 && first.get(row.code).x <= 0.95);
    assert.ok(first.get(row.code).y >= 0.05 && first.get(row.code).y <= 0.95);
  }
});

test("placeholder new-bond fields do not overpower manually assigned topic tags", () => {
  const candidates = [
    ...rows,
    {
      ...rows[0],
      code: "118888.SH",
      name: "新债甲",
      industry1: "新上市转债",
      industry2: "待分类",
      industry3: "待分类",
      theme: "半导体",
      tags: ["次新债", "半导体"],
      topics: ["半导体", "次新债", "新上市转债"],
    },
    {
      ...rows[2],
      code: "123888.SZ",
      name: "新债乙",
      industry1: "新上市转债",
      industry2: "待分类",
      industry3: "待分类",
      theme: "农业",
      tags: ["次新债", "农业"],
      topics: ["农业", "次新债", "新上市转债"],
    },
  ];
  const positions = computeEmbedding(candidates);
  const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
  assert.ok(
    distance(positions.get("118888.SH"), positions.get("110001.SH"))
      < distance(positions.get("118888.SH"), positions.get("123001.SZ")),
  );
  assert.ok(
    distance(positions.get("123888.SZ"), positions.get("123001.SZ"))
      < distance(positions.get("123888.SZ"), positions.get("110001.SH")),
  );
});

test("selected grouping produces deterministic group-aware coordinates", () => {
  const candidates = [
    { ...rows[0], code: "110011.SH", tags: ["成长"] },
    { ...rows[1], code: "110012.SH", tags: ["防御"] },
    { ...rows[2], code: "123011.SZ", tags: ["成长"] },
    { ...rows[3], code: "123012.SZ", tags: ["防御"] },
  ];
  const byIndustry = computeEmbedding(candidates, { groupFor: (row) => row.industry1 });
  const byTag = computeEmbedding(candidates, { groupFor: (row) => row.tags[0] });
  const repeated = computeEmbedding(candidates, { groupFor: (row) => row.tags[0] });
  const distance = (positions, left, right) => Math.hypot(
    positions.get(left).x - positions.get(right).x,
    positions.get(left).y - positions.get(right).y,
  );

  assert.deepEqual(byTag, repeated);
  assert.notDeepEqual(byIndustry.get("110012.SH"), byTag.get("110012.SH"));
  assert.ok(
    distance(byTag, "110011.SH", "123011.SZ")
      < distance(byTag, "110011.SH", "110012.SH"),
  );
  assert.ok(
    distance(byIndustry, "110011.SH", "110012.SH")
      < distance(byIndustry, "110011.SH", "123011.SZ"),
  );
});

test("group strength separates rising and falling unique underlyings", () => {
  const stats = computeGroupStats(rows, (row) => row.industry1);
  assert.ok(stats.get("电子").medianChange > 0);
  assert.ok(stats.get("农林牧渔").medianChange < 0);
  assert.ok(stats.get("电子").strength > stats.get("农林牧渔").strength);
});

test("missing stock changes fall back to bond changes instead of zero", () => {
  const missing = rows.map((row) => ({ ...row, stockChange: null }));
  const stats = computeGroupStats(missing, (row) => row.industry1);
  assert.ok(stats.get("电子").medianChange > 0);
  assert.ok(stats.get("农林牧渔").medianChange < 0);
});

test("terrain and contours share one normalized scalar field", () => {
  const positions = computeEmbedding(rows);
  const terrain = buildTerrain(rows, positions, {
    columns: 28,
    rows: 20,
    groupFor: (row) => row.industry1,
    heightMode: "groupStrength",
  });
  assert.equal(terrain.values.length, 28 * 20);
  assert.ok(Math.max(...terrain.values) <= 1);
  assert.ok(Math.max(...terrain.values) > 0.9);
  assert.ok(terrain.points.every((point) => point.z >= 0 && point.z <= 1));
  const contours = marchingSquares(terrain, [0.2, 0.5, 0.8], 800, 600);
  assert.equal(contours.length, 3);
  assert.ok(contours.some((contour) => contour.segments.length > 0));
});

test("group-peak terrain uses one source per group instead of rewarding group size", () => {
  const strong = {
    ...rows[0], code: "110101.SH", stockCode: "600101.SH", stockChange: 5,
    industry1: "强组",
  };
  const weak = Array.from({ length: 12 }, (_value, index) => ({
    ...rows[2],
    code: `1231${String(index).padStart(2, "0")}.SZ`,
    stockCode: `3001${String(index).padStart(2, "0")}.SZ`,
    stockChange: -2,
    industry1: "弱组",
  }));
  const candidates = [strong, ...weak];
  const positions = new Map([[strong.code, { x: 0.2, y: 0.5 }]]);
  weak.forEach((row, index) => positions.set(row.code, {
    x: 0.76 + (index % 4) * 0.025,
    y: 0.45 + Math.floor(index / 4) * 0.04,
  }));
  const terrain = buildTerrain(candidates, positions, {
    columns: 48,
    rows: 30,
    groupFor: (row) => row.industry1,
    heightMode: "groupPeak",
  });
  const strongPoint = terrain.points.find((point) => point.group === "强组");
  const weakPeak = Math.max(...terrain.points.filter((point) => point.group === "弱组").map((point) => point.z));

  assert.ok(strongPoint.z > weakPeak);
  assert.ok(terrain.groupStats.get("强组").strength > terrain.groupStats.get("弱组").strength);
});

test("3D projection raises a point when elevation increases", () => {
  const low = project3D(0.5, 0.5, 0.1, 1000, 700);
  const high = project3D(0.5, 0.5, 0.9, 1000, 700);
  assert.equal(low.x, high.x);
  assert.ok(high.y < low.y);
  assert.ok(Number.isFinite(high.depth));
});

test("3D projection responds to camera rotation and zoom", () => {
  const front = project3D(0.8, 0.5, 0.4, 1000, 700, { yaw: 0, pitch: Math.PI / 4, zoom: 1 });
  const quarterTurn = project3D(0.8, 0.5, 0.4, 1000, 700, {
    yaw: Math.PI / 2,
    pitch: Math.PI / 4,
    zoom: 1,
  });
  const zoomed = project3D(0.8, 0.5, 0.4, 1000, 700, { yaw: 0, pitch: Math.PI / 4, zoom: 1.3 });
  assert.notEqual(front.x, quarterTurn.x);
  assert.notEqual(front.y, quarterTurn.y);
  assert.ok(Math.abs(zoomed.x - 500) > Math.abs(front.x - 500));
});

test("3D projection applies camera pan without changing depth", () => {
  const centered = project3D(0.6, 0.4, 0.5, 1000, 700, { panX: 0, panY: 0 });
  const panned = project3D(0.6, 0.4, 0.5, 1000, 700, { panX: 0.12, panY: -0.08 });
  assert.equal(panned.x - centered.x, 120);
  assert.ok(Math.abs((panned.y - centered.y) + 56) < 1e-9);
  assert.equal(panned.depth, centered.depth);
});

test("attention labels respect the absolute move threshold and strongest-first limit", () => {
  const points = rows.map((row) => ({ row }));
  const selected = selectAttentionPoints(points, 1, 2);
  assert.deepEqual(selected.map((point) => point.row.code), ["110001.SH", "123001.SZ"]);
  assert.deepEqual(selectAttentionPoints(points, 3, 10), []);
  assert.deepEqual(selectAttentionPoints(points, 0, 10), []);
});
