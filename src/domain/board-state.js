"use strict";

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
  planBoardSelectionImport,
  uniqueStocks,
  verifyBoardSelection,
};
