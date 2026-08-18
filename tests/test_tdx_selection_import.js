"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { parseSelectionText, resolveSelectionRows } = require("../src/application/import-tdx-selection");
const { planBoardSelectionImport, verifyBoardSelection } = require("../src/domain/board-state");
const { normalizeMarketCode } = require("../src/domain/market-code");
const { localBoardUrl } = require("../src/infrastructure/board-api-client");
const { normalizeTqResult } = require("../src/infrastructure/tdx-tq-client");

test("normalizes TDX, Eastmoney, prefixed, and .blk market codes", () => {
  assert.deepEqual(normalizeMarketCode("600519.SH"), {
    code: "600519",
    exchange: "SH",
    secid: "1.600519",
    tdxCode: "600519.SH",
  });
  assert.equal(normalizeMarketCode("1.600519").tdxCode, "600519.SH");
  assert.equal(normalizeMarketCode("SH600519").secid, "1.600519");
  assert.equal(normalizeMarketCode("1600519").secid, "1.600519");
  assert.equal(normalizeMarketCode("0000001").secid, "0.000001");
  assert.equal(normalizeMarketCode("123277").tdxCode, "123277.SZ");
});

test("parses common TDX .blk, CSV, TSV, and plain text exports", () => {
  const rows = parseSelectionText(`
# condition selection
1600519
0000001
123277.SZ,玉禾转债
SH688596\t正帆科技
序号,代码,名称
5,118053,正帆转债
`);
  assert.deepEqual(rows, [
    { code: "600519.SH", name: "" },
    { code: "000001.SZ", name: "" },
    { code: "123277.SZ", name: "玉禾转债" },
    { code: "688596.SH", name: "正帆科技" },
    { code: "118053.SH", name: "正帆转债" },
  ]);
});

test("resolves names from TQ rows first and the local catalog second", () => {
  const catalog = new Map([
    ["1.600519", "贵州茅台"],
    ["0.123277", "玉禾转债"],
  ]);
  const resolved = resolveSelectionRows([
    { Code: "600519.SH", Name: "茅台新简称" },
    "123277.SZ",
    "510300.SH",
    "600519.SH",
  ], catalog);
  assert.deepEqual(resolved.stocks.map(({ name, secid }) => ({ name, secid })), [
    { name: "茅台新简称", secid: "1.600519" },
    { name: "玉禾转债", secid: "0.123277" },
    { name: "510300", secid: "1.510300" },
  ]);
  assert.deepEqual(resolved.unresolved.map((stock) => stock.tdxCode), ["510300.SH"]);
});

test("merge mode is idempotent and preserves unrelated sectors and stack groups", () => {
  const state = {
    version: "server-state-v1",
    updatedAt: "before",
    sectors: [
      { name: "原板块", stocks: [{ name: "平安银行", secid: "0.000001" }] },
      { name: "通达信选股", stocks: [{ name: "贵州茅台", secid: "1.600519" }] },
    ],
    stackGroups: [{ name: "组合", sectorNames: ["原板块"], expandedSectorNames: ["原板块"] }],
  };
  const plan = planBoardSelectionImport(state, {
    targetSector: "通达信选股",
    mode: "merge",
    stocks: [
      { name: "贵州茅台", secid: "1.600519" },
      { name: "玉禾转债", secid: "0.123277" },
    ],
  });
  assert.equal(plan.added.length, 1);
  assert.equal(plan.removed.length, 0);
  assert.equal(plan.afterCount, 2);
  assert.deepEqual(plan.nextState.stackGroups, state.stackGroups);
  assert.deepEqual(state.sectors[1].stocks, [{ name: "贵州茅台", secid: "1.600519" }]);
  assert.equal(verifyBoardSelection(plan.nextState, plan).ok, true);
});

test("replace mode reports removals and mirrors the TDX selection order", () => {
  const state = {
    sectors: [{
      name: "通达信选股",
      stocks: [
        { name: "贵州茅台", secid: "1.600519" },
        { name: "平安银行", secid: "0.000001" },
      ],
    }],
    stackGroups: [],
  };
  const plan = planBoardSelectionImport(state, {
    targetSector: "通达信选股",
    mode: "replace",
    stocks: [{ name: "玉禾转债", secid: "0.123277" }],
  });
  assert.deepEqual(plan.removed.map((stock) => stock.secid), ["1.600519", "0.000001"]);
  assert.deepEqual(
    plan.nextState.sectors[0].stocks,
    [{ name: "玉禾转债", secid: "0.123277" }],
  );
});

test("normalizes nested TQ results and surfaces TQ errors", () => {
  assert.deepEqual(normalizeTqResult({ result: { ErrorId: "0", Value: ["600519.SH"] } }), ["600519.SH"]);
  assert.throws(
    () => normalizeTqResult({ result: { ErrorId: "12", Error: "sector missing" } }),
    /sector missing/,
  );
});

test("board mutation client rejects non-loopback targets", () => {
  assert.equal(localBoardUrl("http://localhost:5173").hostname, "localhost");
  assert.throws(() => localBoardUrl("http://10.211.55.3:5173"), /loopback/);
});
