"use strict";

const { extractMarketCode, normalizeMarketCode } = require("../domain/market-code");
const { validName } = require("../infrastructure/instrument-catalog");

function nameFromDelimitedLine(line, marketCode) {
  const parts = String(line || "")
    .split(/[,\t|;]/)
    .map((value) => value.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  const codeIndex = parts.findIndex((part) => normalizeMarketCode(part)?.secid === marketCode.secid);
  if (codeIndex < 0) return "";
  for (const part of parts.slice(codeIndex + 1)) {
    if (normalizeMarketCode(part) || /^\d+(?:\.\d+)?%?$/.test(part)) continue;
    const name = validName(part);
    if (name) return name;
  }
  return "";
}

function parseSelectionText(text) {
  const rows = [];
  for (const rawLine of String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^(#|\/\/|;)/.test(line)) continue;
    const marketCode = extractMarketCode(line);
    if (!marketCode) continue;
    rows.push({
      code: marketCode.tdxCode,
      name: nameFromDelimitedLine(line, marketCode),
    });
  }
  return rows;
}

function normalizeSelectionRow(row) {
  if (typeof row === "string") {
    const normalized = normalizeMarketCode(row) || extractMarketCode(row);
    return normalized ? { ...normalized, name: "" } : null;
  }
  const rawCode = row?.Code ?? row?.code ?? row?.StockCode ?? row?.stock_code ?? row?.secid;
  const normalized = normalizeMarketCode(rawCode);
  if (!normalized) return null;
  return {
    ...normalized,
    name: validName(row?.Name ?? row?.name ?? row?.StockName ?? row?.stock_name),
  };
}

function resolveSelectionRows(rows, catalog) {
  const result = [];
  const unresolved = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizeSelectionRow(row);
    if (!normalized || seen.has(normalized.secid)) continue;
    seen.add(normalized.secid);
    const name = normalized.name || catalog.get(normalized.secid) || "";
    const stock = {
      name: name || normalized.code,
      secid: normalized.secid,
      code: normalized.code,
      exchange: normalized.exchange,
      tdxCode: normalized.tdxCode,
    };
    result.push(stock);
    if (!name) unresolved.push(stock);
  }
  return { stocks: result, unresolved };
}

module.exports = {
  normalizeSelectionRow,
  parseSelectionText,
  resolveSelectionRows,
};
