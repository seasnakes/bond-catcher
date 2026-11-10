"use strict";

const { normalizeSecidInput } = require("./secid.js");

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];

  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function normalizeBoardSectors(sectors) {
  if (!Array.isArray(sectors)) return [];

  return sectors
    .map((sector) => ({
      name: String(sector?.name || "").trim(),
      stocks: Array.isArray(sector?.stocks)
        ? sector.stocks
            .map((stock) => ({
              name: String(stock?.name || "").trim(),
              secid: normalizeSecidInput(stock?.secid),
            }))
            .filter((stock) => stock.name && stock.secid)
        : [],
    }))
    .filter((sector) => sector.name);
}

function normalizeBoardState(raw) {
  const sectors = normalizeBoardSectors(raw?.sectors);
  const sectorNames = new Set(sectors.map((sector) => sector.name));
  const stackGroups = Array.isArray(raw?.stackGroups)
    ? raw.stackGroups
        .map((group) => {
          const names = uniqueStrings(group?.sectorNames).filter((name) => sectorNames.has(name));
          return {
            name: String(group?.name || "").trim(),
            sectorNames: names,
            expandedSectorNames: uniqueStrings(group?.expandedSectorNames).filter((name) =>
              names.includes(name),
            ),
          };
        })
        .filter((group) => group.name)
    : [];

  return {
    version: String(raw?.version || "server-state-v1"),
    updatedAt: new Date().toISOString(),
    sectors,
    stackGroups,
  };
}

function uniqueStocks(stocks) {
  const seen = new Set();
  const result = [];
  for (const stock of Array.isArray(stocks) ? stocks : []) {
    const name = String(stock?.name || "").trim();
    const secid = String(stock?.secid || "").trim();
    if (!name || !secid || seen.has(secid)) continue;
    seen.add(secid);
    result.push({ name, secid });
  }
  return result;
}

function planBoardSelectionImport(state, options) {
  const targetSector = String(options?.targetSector || "").trim();
  if (!targetSector) throw new Error("target sector is required");

  const mode = options?.mode === "replace" ? "replace" : "merge";
  const incoming = uniqueStocks(options?.stocks);
  if (incoming.length === 0) throw new Error("selection is empty");

  const nextState = structuredClone(state || {});
  const sectors = Array.isArray(nextState.sectors) ? nextState.sectors : [];
  nextState.sectors = sectors;
  let sector = sectors.find((item) => String(item?.name || "").trim() === targetSector);
  const existed = Boolean(sector);
  if (!sector) {
    sector = { name: targetSector, stocks: [] };
    sectors.push(sector);
  }

  const current = uniqueStocks(sector.stocks);
  const currentBySecid = new Map(current.map((stock) => [stock.secid, stock]));
  const incomingBySecid = new Map(incoming.map((stock) => [stock.secid, stock]));
  const added = incoming.filter((stock) => !currentBySecid.has(stock.secid));
  const removed = mode === "replace"
    ? current.filter((stock) => !incomingBySecid.has(stock.secid))
    : [];
  const unchanged = incoming.filter((stock) => currentBySecid.has(stock.secid));

  sector.name = targetSector;
  sector.stocks = mode === "replace"
    ? incoming
    : uniqueStocks([...current, ...incoming]);

  return {
    mode,
    targetSector,
    targetSectorExisted: existed,
    beforeCount: current.length,
    afterCount: sector.stocks.length,
    added,
    removed,
    unchanged,
    nextState,
  };
}

function verifyBoardSelection(state, plan) {
  const sector = (Array.isArray(state?.sectors) ? state.sectors : [])
    .find((item) => String(item?.name || "").trim() === plan.targetSector);
  if (!sector) return { ok: false, reason: "target sector missing after apply" };

  const actual = uniqueStocks(sector.stocks);
  const expectedSector = plan.nextState.sectors.find((item) => item.name === plan.targetSector);
  const expected = uniqueStocks(expectedSector?.stocks);
  const actualIds = actual.map((stock) => stock.secid);
  const expectedIds = expected.map((stock) => stock.secid);
  const ok = actualIds.length === expectedIds.length
    && actualIds.every((value, index) => value === expectedIds[index]);
  return {
    ok,
    reason: ok ? "" : "target sector differs after apply",
    actualCount: actual.length,
    expectedCount: expected.length,
  };
}

module.exports = {
  normalizeBoardSectors,
  normalizeBoardState,
  planBoardSelectionImport,
  uniqueStocks,
  uniqueStrings,
  verifyBoardSelection,
};
