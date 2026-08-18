"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formulaUniverseSignature,
  mergeDateCounts,
  mergeSelectedRows,
  normalizeFormulaBatchResult,
  normalizeTdxUniverse,
} = require("../src/domain/tdx-formula-selection");
const { canResume } = require("../src/application/run-tdx-formula-selection");

test("normalizes the TDX A-share universe with names and board secids", () => {
  assert.deepEqual(normalizeTdxUniverse([
    { Code: "600519.SH", Name: "贵州茅台" },
    { Code: "000001.SZ", Name: "平安银行" },
    { Code: "600519.SH", Name: "duplicate" },
  ]), [
    { code: "600519.SH", secid: "1.600519", name: "贵州茅台" },
    { code: "000001.SZ", secid: "0.000001", name: "平安银行" },
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
