"use strict";

const crypto = require("node:crypto");
const { normalizeMarketCode } = require("./market-code");

const DEFAULT_TDX_FORMULAS = Object.freeze(["单针", "异动", "ZX"]);

function normalizeTdxUniverse(rows) {
  const seen = new Set();
  const universe = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const rawCode = typeof row === "string" ? row : row?.Code ?? row?.code;
    const normalized = normalizeMarketCode(rawCode);
    if (!normalized || seen.has(normalized.tdxCode)) continue;
    seen.add(normalized.tdxCode);
    universe.push({
      code: normalized.tdxCode,
      secid: normalized.secid,
      name: String(row?.Name ?? row?.name ?? normalized.code).trim() || normalized.code,
    });
  }
  return universe;
}

function formulaUniverseSignature(options) {
  const payload = JSON.stringify({
    formulas: options.formulas,
    codes: options.universe.map((row) => row.code),
    period: options.period,
    historyCount: options.historyCount,
    dividendType: options.dividendType,
    batchSize: options.batchSize,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function latestFormulaValue(outputs) {
  if (!outputs || typeof outputs !== "object") return null;
  for (const [lineName, series] of Object.entries(outputs)) {
    if (!Array.isArray(series) || series.length === 0) continue;
    const latest = series[series.length - 1];
    if (latest && typeof latest === "object") {
      return {
        lineName,
        date: String(latest.Date ?? latest.date ?? "").trim(),
        value: String(latest.Value ?? latest.value ?? "").trim(),
      };
    }
    return { lineName, date: "", value: String(latest ?? "").trim() };
  }
  return null;
}

function normalizeFormulaBatchResult(result, universe) {
  const errorId = String(result?.ErrorId ?? result?.error_id ?? "0");
  if (errorId !== "0") {
    throw new Error(String(result?.Error ?? result?.msg ?? `TQ formula error ${errorId}`));
  }

  const rowsByCode = new Map(universe.map((row) => [row.code, row]));
  const selected = [];
  const returnedCodes = [];
  const dateCounts = new Map();
  const lineNames = new Set();
  for (const [code, outputs] of Object.entries(result || {})) {
    if (code === "ErrorId" || code === "Error" || code === "Msg") continue;
    const normalized = normalizeMarketCode(code);
    if (!normalized) continue;
    const canonicalCode = normalized.tdxCode;
    const latest = latestFormulaValue(outputs);
    if (!latest) continue;
    returnedCodes.push(canonicalCode);
    if (latest.lineName) lineNames.add(latest.lineName);
    if (latest.date) dateCounts.set(latest.date, (dateCounts.get(latest.date) || 0) + 1);
    if (latest.value !== "1") continue;
    const instrument = rowsByCode.get(canonicalCode) || {
      code: canonicalCode,
      secid: normalized.secid,
      name: normalized.code,
    };
    selected.push({
      code: canonicalCode,
      secid: instrument.secid,
      name: instrument.name,
      date: latest.date,
      value: latest.value,
    });
  }

  const returnedSet = new Set(returnedCodes);
  return {
    returnedCount: returnedSet.size,
    missingCodes: universe.map((row) => row.code).filter((code) => !returnedSet.has(code)),
    selected,
    dates: Object.fromEntries([...dateCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    lineNames: [...lineNames],
  };
}

function mergeSelectedRows(existing, incoming) {
  const byCode = new Map();
  for (const row of [...(existing || []), ...(incoming || [])]) {
    if (!row?.code) continue;
    byCode.set(row.code, row);
  }
  return [...byCode.values()].sort((left, right) => left.code.localeCompare(right.code));
}

function mergeDateCounts(existing, incoming) {
  const merged = { ...(existing || {}) };
  for (const [date, count] of Object.entries(incoming || {})) {
    merged[date] = Number(merged[date] || 0) + Number(count || 0);
  }
  return merged;
}

module.exports = {
  DEFAULT_TDX_FORMULAS,
  formulaUniverseSignature,
  latestFormulaValue,
  mergeDateCounts,
  mergeSelectedRows,
  normalizeFormulaBatchResult,
  normalizeTdxUniverse,
};
