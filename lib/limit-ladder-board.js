const { chinaClock, loadCalendar } = require('./limit-ladder-live.js');
const { validDate } = require('./limit-ladder-feed.js');
const STACK_NAME = '连板天梯';
const sectorName = (boards, current = false) => `连板·${current ? '' : '昨'}${boards === 1 ? '首' : boards}板`;

// Replace only memberships owned by the last successful scan. Manual additions
// inside these sectors and every other user sector/stack remain intact.
function mergeLadderIntoBoard(raw, previous, snapshot, targetDate, now = Date.now(), { liveGrouping = false } = {}) {
  if (!Array.isArray(raw?.sectors) || !Array.isArray(raw?.stackGroups)) throw new Error('主看板状态不完整');
  if (!validDate(targetDate) || !validDate(snapshot?.asOf) || snapshot.asOf > targetDate
      || (snapshot.asOf === targetDate && !liveGrouping)
      || snapshot.refreshFailed || !snapshot.stocks?.length) throw new Error('上一交易日涨停池未就绪，保留原分组');
  const current = snapshot.asOf === targetDate;
  const state = structuredClone(raw);
  const owned = new Map((previous?.groups || []).map(g => [g.name, g]));
  const pool = new Map();
  const seen = new Set();
  for (const stock of snapshot.stocks) {
    if (stock.status !== 'limit_up' || !Number.isInteger(stock.actualBoards) || stock.actualBoards < 1
        || !/^[01]\.\d{6}$/.test(stock.secid) || seen.has(stock.secid)) throw new Error('涨停池股票格式不完整');
    seen.add(stock.secid);
    const name = sectorName(stock.actualBoards, current);
    if (!pool.has(name)) pool.set(name, { name, boards: stock.actualBoards, stocks: [] });
    pool.get(name).stocks.push({ name: stock.name, secid: stock.secid });
  }
  const incoming = [...pool.values()].sort((a, b) => b.boards - a.boards);
  const stackName = previous?.stackName || STACK_NAME;
  let stack = state.stackGroups.find(g => g.name === stackName);
  if (stack && !previous?.stackName) throw new Error(`已有同名叠组「${stackName}」，未覆盖`);
  for (const group of incoming) {
    if (state.sectors.some(s => s.name === group.name) && !owned.has(group.name)) throw new Error(`已有同名板块「${group.name}」，未覆盖`);
  }
  const groups = [];
  const removedNames = new Set();
  for (const [name, old] of owned) {
    const sector = state.sectors.find(s => s.name === name);
    const oldCodes = new Set(old.secids);
    if (sector) sector.stocks = sector.stocks.filter(s => !oldCodes.has(s.secid));
    if (!pool.has(name) && sector && sector.stocks.length === 0) removedNames.add(name);
    if (!pool.has(name) && sector?.stocks.length) groups.push({ ...old, secids: [], count: 0 });
  }
  state.sectors = state.sectors.filter(s => !removedNames.has(s.name));
  for (const group of incoming) {
    let sector = state.sectors.find(s => s.name === group.name);
    if (!sector) {
      sector = { name: group.name, stocks: [] };
      const existingIndices = state.sectors.map((s, i) => owned.has(s.name) || groups.some(g => g.name === s.name) ? i : -1).filter(i => i >= 0);
      const index = existingIndices.length ? Math.max(...existingIndices) + 1 : Math.max(0, state.sectors.findIndex(s => s.name === '小热次') + 1);
      state.sectors.splice(index, 0, sector);
    }
    const manual = new Set(sector.stocks.map(s => s.secid));
    const added = group.stocks.filter(s => !manual.has(s.secid));
    sector.stocks.push(...added);
    groups.push({ name: group.name, boards: group.boards, count: group.stocks.length, secids: added.map(s => s.secid) });
  }
  const newNames = new Set(groups.map(g => g.name));
  // Remove only deleted, empty automation sectors from stack references.
  for (const group of state.stackGroups) {
    group.sectorNames = group.sectorNames.filter(n => !removedNames.has(n));
    group.expandedSectorNames = group.expandedSectorNames.filter(n => !removedNames.has(n));
  }
  if (!stack) {
    stack = { name: stackName, sectorNames: [], expandedSectorNames: [] };
    state.stackGroups.push(stack);
  }
  const previousNames = new Set(stack.sectorNames);
  const desired = groups.slice().sort((a, b) => b.boards - a.boards).map(g => g.name);
  // Keep manual stack members and user expansion choices; ladder heights stay descending.
  stack.sectorNames = [...desired, ...stack.sectorNames.filter(n => !newNames.has(n))];
  stack.expandedSectorNames = [...new Set([
    ...stack.expandedSectorNames.filter(n => stack.sectorNames.includes(n)),
    ...groups.filter(g => g.boards > 1 && !previousNames.has(g.name)).map(g => g.name),
  ])];
  const changed = JSON.stringify(state.sectors) !== JSON.stringify(raw.sectors) || JSON.stringify(state.stackGroups) !== JSON.stringify(raw.stackGroups);
  if (changed) state.updatedAt = new Date(now).toISOString();
  return { state, changed, manifest: {
    version: 1, stackName, targetDate, baseDate: snapshot.asOf, source: snapshot.source, scope: snapshot.scope,
    fetchedAt: snapshot.fetchedAt, appliedAt: new Date(now).toISOString(), count: snapshot.stocks.length,
    groups: groups.sort((a, b) => b.boards - a.boards), boardUpdatedAt: state.updatedAt, lastError: '',
    grouping: current ? 'today' : 'previous',
    coveragePending: Boolean(snapshot.coveragePending),
    fallback: Boolean(snapshot.fallback), sourceWarning: snapshot.sourceWarning || '',
    stockInfo: Object.fromEntries(snapshot.stocks.map(s => [s.secid, { boards: s.actualBoards, reason: s.reason || '', poolSource: s.poolSource || snapshot.source }])),
  } };
}

function createBoardLadderService({ loadPool, calendar = loadCalendar, readBoard, writeBoard,
  readManifest, writeManifest, backupBoard, withLock, now = Date.now, liveGrouping = false } = {}) {
  let inFlight = null;
  let lastAttemptAt = 0;
  let lastError = '';
  async function status() {
    const [manifest, board] = await Promise.all([readManifest(), readBoard()]);
    const clock = chinaClock(now());
    const date = clock.date;
    return { ...manifest, requestedDate: date, stale: manifest.targetDate !== date,
      phase: manifest.grouping === 'today' ? clock.time >= '15:15:00' ? 'close' : 'intraday' : 'previous',
      lastError: lastError || manifest.lastError || '', lastAttemptAt,
      boardUpdatedAt: board.updatedAt, ready: Boolean(manifest.baseDate), refreshing: Boolean(inFlight) };
  }
  async function scan({ apply = true } = {}) {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const clock = chinaClock(now());
      const date = clock.date;
      const prior = await readManifest();
      if (!liveGrouping && apply && prior.targetDate === date && !prior.lastError && !prior.coveragePending) return status();
      lastAttemptAt = now();
      try {
        const day = await calendar(date);
        if (!validDate(day.previousDate) || day.previousDate >= date) throw new Error('上一交易日历不完整');
        const current = liveGrouping && day.isTrading && clock.time >= '09:30:00';
        const poolDate = current ? date : day.previousDate;
        const pool = await loadPool(poolDate);
        if (pool.asOf !== poolDate || pool.refreshFailed) throw new Error('涨停池日期或刷新状态不正确，保留原分组');
        const snapshotMatches = value => value.targetDate === date && value.baseDate === poolDate
          && value.fetchedAt === pool.fetchedAt && Boolean(value.coveragePending) === Boolean(pool.coveragePending)
          && !value.lastError;
        if (!apply) return { targetDate: date, baseDate: pool.asOf, grouping: current ? 'today' : 'previous',
          isTrading: day.isTrading, source: pool.source, scope: pool.scope, count: pool.stocks.length,
          coveragePending: Boolean(pool.coveragePending), sourceWarning: pool.sourceWarning || '',
          groups: [...new Set(pool.stocks.map(s => s.actualBoards))].sort((a,b) => b-a).map(boards => ({ name: sectorName(boards, current), boards, count: pool.stocks.filter(s => s.actualBoards === boards).length })) };
        if (snapshotMatches(prior)) { lastError = ''; return status(); }
        await withLock(async () => {
          const [current, previous] = await Promise.all([readBoard(), readManifest()]);
          if (snapshotMatches(previous)) return;
          const result = mergeLadderIntoBoard(current, previous, pool, date, now(), { liveGrouping });
          result.manifest.isTrading = day.isTrading;
          if (result.changed) {
            await backupBoard(current, date);
            await writeBoard(result.state);
          }
          try { await writeManifest(result.manifest); }
          catch (error) { if (result.changed) await writeBoard(current); throw error; }
        });
        lastError = '';
      } catch (error) {
        lastError = error.message;
        throw error;
      }
      return status();
    })().finally(() => { inFlight = null; });
    return inFlight;
  }
  return { scan, status };
}
module.exports = { STACK_NAME, sectorName, mergeLadderIntoBoard, createBoardLadderService };
