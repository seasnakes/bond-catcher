"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formulaUniverseSignature,
  mergeDateCounts,
  mergeSelectedRows,
  normalizeFormulaBatchResult,
  normalizeTdxUniverse,
  partitionOrdinaryConvertibleBonds,
} = require("../src/domain/tdx-formula-selection");
const {
  canResume,
  runTdxFormulaSelections,
} = require("../src/application/run-tdx-formula-selection");

test("normalizes the TDX security universe with names and board secids", () => {
  assert.deepEqual(normalizeTdxUniverse([
    { Code: "600519.SH", Name: "贵州茅台" },
    { Code: "000001.SZ", Name: "平安银行" },
    { Code: "123064.SZ", Name: "万孚转债" },
    { Code: "810011.BJ", Name: "优机定转" },
    { Code: "600519.SH", Name: "duplicate" },
  ]), [
    { code: "600519.SH", secid: "1.600519", name: "贵州茅台" },
    { code: "000001.SZ", secid: "0.000001", name: "平安银行" },
    { code: "123064.SZ", secid: "0.123064", name: "万孚转债" },
    { code: "810011.BJ", secid: "0.810011", name: "优机定转" },
  ]);
});

test("extracts the latest 0/1 values from condition formula batches", () => {
  const universe = normalizeTdxUniverse([
    { Code: "600519.SH", Name: "贵州茅台" },
    { Code: "000001.SZ", Name: "平安银行" },
    { Code: "002131.SZ", Name: "利欧股份" },
  ]);
  const normalized = normalizeFormulaBatchResult({
    "600519.SH": { XG: [{ Date: "20260817", Value: "1" }, { Date: "20260818", Value: "0" }] },
    "000001.SZ": { XG: [{ Date: "20260818", Value: "0" }] },
    "002131.SZ": { XG: [{ Date: "20260818", Value: "1" }] },
    ErrorId: "0",
  }, universe);
  assert.equal(normalized.returnedCount, 3);
  assert.deepEqual(normalized.missingCodes, []);
  assert.deepEqual(normalized.lineNames, ["XG"]);
  assert.deepEqual(normalized.selected, [{
    code: "002131.SZ",
    secid: "0.002131",
    name: "利欧股份",
    date: "20260818",
    value: "1",
  }]);
});

test("excludes directed convertible bonds from the ordinary bond universe", () => {
  const universe = normalizeTdxUniverse([
    { Code: "123064.SZ", Name: "万孚转债" },
    { Code: "124025.SZ", Name: "富乐定转" },
    { Code: "110815.SH", Name: "九丰定01" },
    { Code: "118500.SH", Name: "思瑞定转" },
    { Code: "810011.BJ", Name: "优机定转" },
  ]);
  const partitioned = partitionOrdinaryConvertibleBonds(universe);
  assert.deepEqual(partitioned.included.map((row) => row.code), ["123064.SZ"]);
  assert.deepEqual(partitioned.excluded.map((row) => row.code), [
    "124025.SZ",
    "110815.SH",
    "118500.SH",
    "810011.BJ",
  ]);
});

test("reports missing formula rows and rejects TQ errors", () => {
  const universe = normalizeTdxUniverse([
    { Code: "600519.SH", Name: "贵州茅台" },
    { Code: "000001.SZ", Name: "平安银行" },
  ]);
  const normalized = normalizeFormulaBatchResult({
    "600519.SH": { SELECT: [{ Date: "20260818", Value: "1" }] },
    ErrorId: "0",
  }, universe);
  assert.deepEqual(normalized.missingCodes, ["000001.SZ"]);
  assert.throws(() => normalizeFormulaBatchResult({ ErrorId: "9", Error: "formula failed" }, universe), /formula failed/);
});

test("merges incremental results without duplicating codes or dates", () => {
  assert.deepEqual(mergeSelectedRows(
    [{ code: "600519.SH", name: "old" }],
    [{ code: "600519.SH", name: "new" }, { code: "000001.SZ", name: "平安银行" }],
  ), [
    { code: "000001.SZ", name: "平安银行" },
    { code: "600519.SH", name: "new" },
  ]);
  assert.deepEqual(mergeDateCounts({ 20260818: 2 }, { 20260818: 3, 20260817: 1 }), {
    20260818: 5,
    20260817: 1,
  });
});

test("resume requires the same universe and formula signature", () => {
  const universe = normalizeTdxUniverse([{ Code: "600519.SH", Name: "贵州茅台" }]);
  const signature = formulaUniverseSignature({
    formulas: ["单针"], universe, period: "1d", historyCount: 250, dividendType: 1, batchSize: 50,
  });
  const snapshot = {
    schemaVersion: 1,
    status: "running",
    universe: { signature },
    settings: { formulas: ["单针"] },
  };
  assert.equal(canResume(snapshot, signature, ["单针"]), true);
  assert.equal(canResume(snapshot, "other", ["单针"]), false);
  assert.equal(canResume({ ...snapshot, status: "complete" }, signature, ["单针"]), false);
});

test("uses the TDX convertible-bond category by default", async () => {
  const calls = [];
  const snapshot = await runTdxFormulaSelections({
    formulas: ["单针"],
    callTq: async (_options, method, params) => {
      calls.push({ method, params });
      if (method === "formula_get_all") return [{ acCode: "单针" }];
      if (method === "formula_get_info") return { acName: "单针", ParaNum: 0, Line: [{ LineName: "XG" }] };
      if (method === "get_stock_list") return [{ Code: "123064.SZ", Name: "万孚转债" }];
      if (method === "formula_process_mul_xg") {
        return { "123064.SZ": { XG: [{ Date: "20260818", Value: "1" }] }, ErrorId: "0" };
      }
      throw new Error(`unexpected method ${method}`);
    },
    readSnapshot: async () => null,
    writeSnapshot: async () => {},
  });

  assert.equal(calls.find((call) => call.method === "get_stock_list").params.market, "32");
  assert.equal(snapshot.universe.label, "可转债");
  assert.equal(snapshot.universe.count, 1);
  assert.equal(snapshot.universe.scope, "沪深公开发行可转债");
  assert.equal(snapshot.formulas[0].selectedCount, 1);
});
