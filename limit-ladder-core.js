(function (root) {
  const statusOrder = { limit_up: 0, auction: 0, auction_final: 0, tracking: 0, broken: 1, failed: 2, pending: 3 };
  function percent(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}%`;
  }
  function summarize(stocks) {
    const limits = stocks.filter((s) => s.status === "limit_up");
    const previous = stocks.filter((s) => s.previousBoards >= 1);
    const promoted = previous.filter((s) => s.status === "limit_up");
    const priorLeaders = stocks.filter((s) => s.previousBoards >= 2 && Number.isFinite(s.changePct));
    const height = Math.max(0, ...limits.map((s) => s.actualBoards));
    return {
      height, leaders: limits.filter((s) => s.actualBoards === height).map((s) => s.name),
      consecutive: limits.filter((s) => s.actualBoards >= 2).length,
      limits: limits.length, broken: stocks.filter((s) => s.status === "broken").length,
      candidates: previous.length, promoted: promoted.length,
      promotionRate: previous.length ? promoted.length / previous.length * 100 : null,
      priorLeaderChange: priorLeaders.length ? priorLeaders.reduce((sum, s) => sum + s.changePct, 0) / priorLeaders.length : null,
    };
  }
  function buildGroups(stocks, { view = "promotion", search = "", status = "all", hideSt = false, live = false } = {}) {
    const query = search.trim().toLowerCase();
    const groups = new Map();
    for (const stock of stocks) {
      if (view === "height" && !live && stock.status !== "limit_up") continue;
      const boards = live && view === "height" ? stock.previousBoards : stock.targetBoards;
      const key = boards === 1 && stock.status === "broken" ? "first-broken" : String(boards);
      if (!groups.has(key)) groups.set(key, { key, boards, all: [], stocks: [] });
      const group = groups.get(key);
      group.all.push(stock);
      if (status !== "all" && stock.status !== status) continue;
      if (hideSt && /ST/i.test(stock.name)) continue;
      if (query && !`${stock.name} ${stock.symbol}`.toLowerCase().includes(query)) continue;
      group.stocks.push(stock);
    }
    return [...groups.values()].filter((g) => g.stocks.length).sort((a, b) => b.boards - a.boards || (a.key === "first-broken" ? 1 : -1)).map((g) => ({
      ...g, promoted: g.all.filter((s) => s.status === "limit_up").length,
      stocks: g.stocks.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]
        || (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity) || a.code.localeCompare(b.code)),
    }));
  }
  const api = { percent, summarize, buildGroups };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LimitLadder = api;
})(typeof globalThis === "object" ? globalThis : this);
