const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeLadderIntoBoard, createBoardLadderService } = require('../lib/limit-ladder-board.js');
const { normalizeLadder } = require('../lib/limit-ladder-feed.js');
const NOW = Date.parse('2026-09-08T08:30:00+08:00');
const board = () => ({ version: 'v1', updatedAt: 'before', sectors: [
  { name: '小热次', stocks: [{ name: '振26', secid: '1.113709' }] },
  { name: '手动组', stocks: [{ name: '海欣食品', secid: '0.002702' }] },
], stackGroups: [{ name: '原叠组', sectorNames: ['手动组'], expandedSectorNames: ['手动组'] }] });
function pool(date = '2026-09-07', boards = 6) {
  return normalizeLadder({ rc: 0, data: { qdate: Number(date.replaceAll('-', '')), tc: 2, pool: [
    { c: '605577', m: 1, n: '龙版传媒', lbc: boards, p: 17110, zdp: 9.96 },
    { c: '002702', m: 0, n: '海欣食品', lbc: 1, p: 6170, zdp: 9.98 },
  ] } }, date, NOW);
}
test('native stack sits beside 小热次, default high tiers expand, other board data stays exact', () => {
  const original = board(); const copy = structuredClone(original);
  const r = mergeLadderIntoBoard(original, {}, pool(), '2026-09-08', NOW);
  assert.deepEqual(original, copy);
  assert.deepEqual(r.state.sectors[0], copy.sectors[0]); assert.deepEqual(r.state.sectors.at(-1), copy.sectors[1]);
  assert.deepEqual(r.state.stackGroups[0], copy.stackGroups[0]);
  assert.deepEqual(r.state.stackGroups[1].sectorNames, ['连板·昨6板', '连板·昨首板']);
  assert.deepEqual(r.state.stackGroups[1].expandedSectorNames, ['连板·昨6板']);
  assert.equal(r.manifest.count, 2);
});
test('same baseline merge is idempotent; daily rollover removes only owned membership and keeps manual additions', () => {
  const first = mergeLadderIntoBoard(board(), {}, pool(), '2026-09-08', NOW);
  const again = mergeLadderIntoBoard(first.state, first.manifest, pool(), '2026-09-08', NOW + 1000);
  assert.equal(again.changed, false); assert.equal(again.state.updatedAt, first.state.updatedAt);
  first.state.sectors.find(s => s.name === '连板·昨6板').stocks.push({ name: '手添', secid: '1.600000' });
  first.state.stackGroups[1].expandedSectorNames = ['连板·昨首板'];
  const next = mergeLadderIntoBoard(first.state, first.manifest, pool('2026-09-08', 7), '2026-09-09', NOW + 86400000);
  assert.deepEqual(next.state.sectors.find(s => s.name === '连板·昨6板').stocks, [{ name: '手添', secid: '1.600000' }]);
  assert.deepEqual(next.state.sectors.find(s => s.name === '手动组'), board().sectors[1]);
  assert.ok(next.state.stackGroups[1].expandedSectorNames.includes('连板·昨首板'));
  assert.ok(!next.state.stackGroups[1].expandedSectorNames.includes('连板·昨6板'));
});
test('manual name collisions and unready source do not overwrite anything', () => {
  const original = board(); original.sectors.push({ name: '连板·昨6板', stocks: [] });
  assert.throws(() => mergeLadderIntoBoard(original, {}, pool(), '2026-09-08'), /同名/);
  for (const snapshot of [{ ...pool(), refreshFailed: true }, { ...pool(), stocks: [] }, pool('2026-09-08')]) {
    assert.throws(() => mergeLadderIntoBoard(board(), {}, snapshot, '2026-09-08'), /未就绪/);
  }
});
function harness({ liveGrouping = false } = {}) {
  let current = board(), manifest = {}, now = NOW, failPool = false, failWrite = false;
  let boards = 6, coveragePending = false;
  let writes = 0, calendars = 0, pools = 0;
  const service = createBoardLadderService({ now: () => now, liveGrouping,
    calendar: async date => { calendars++; return { isTrading: true, previousDate: date === '2026-09-08' ? '2026-09-07' : '2026-09-08' }; },
    loadPool: async date => { pools++; if (failPool) throw new Error('offline'); return { ...pool(date, boards), fetchedAt: new Date(now).toISOString(), coveragePending }; },
    readBoard: async () => structuredClone(current), writeBoard: async value => { writes++; current = structuredClone(value); },
    readManifest: async () => structuredClone(manifest), writeManifest: async value => { if (failWrite) throw new Error('disk failure'); manifest = structuredClone(value); },
    backupBoard: async () => {}, withLock: async task => task(),
  });
  return { service, get current() { return current; }, get writes() { return writes; }, get calendars() { return calendars; }, get pools() { return pools; },
    get manifest() { return manifest; },
    advance: (ms, nextBoards = boards) => { now += ms; boards = nextBoards; },
    incomplete: value => coveragePending = value,
    nextDay: () => now += 86400000, offline: () => failPool = true, diskFail: () => failWrite = true };
}
test('read-only preview, concurrent scan coalescing and repeated same-day scans never duplicate writes', async () => {
  const h = harness(); const preview = await h.service.scan({ apply: false }); assert.equal(preview.count, 2); assert.equal(h.writes, 0);
  await Promise.all([h.service.scan(), h.service.scan()]); assert.equal(h.writes, 1);
  const calls = h.calendars; await h.service.scan(); assert.equal(h.calendars, calls); assert.equal(h.writes, 1);
});
test('next-day source outage preserves board and exposes stale dated baseline', async () => {
  const h = harness(); await h.service.scan(); const saved = structuredClone(h.current);
  h.nextDay(); h.offline(); await assert.rejects(h.service.scan(), /offline/);
  assert.deepEqual(h.current, saved); const status = await h.service.status();
  assert.equal(status.baseDate, '2026-09-07'); assert.equal(status.stale, true); assert.equal(status.lastError, 'offline');
});
test('manifest persistence failure rolls back board while holding the mutation lock', async () => {
  const h = harness(); const before = structuredClone(h.current); h.diskFail();
  await assert.rejects(h.service.scan(), /disk failure/); assert.deepEqual(h.current, before);
});
test('main board switches from previous session at open, then regroups actual intraday pool counts', async () => {
  const h = harness({ liveGrouping: true });
  await h.service.scan(); assert.equal(h.manifest.grouping, 'previous');
  h.advance(61 * 60_000, 3);
  const preview = await h.service.scan({ apply: false });
  assert.equal(preview.baseDate, '2026-09-08'); assert.equal(preview.grouping, 'today');
  assert.equal(preview.groups[0].name, '连板·3板');
  await h.service.scan();
  assert.equal(h.manifest.baseDate, '2026-09-08');
  assert.equal(h.current.sectors.some(s => s.name === '连板·昨6板'), false);
  h.current.sectors.find(s => s.name === '连板·3板').stocks.push({ name: '手添', secid: '1.600000' });
  h.advance(61_000, 4); await h.service.scan();
  assert.deepEqual(h.current.sectors.find(s => s.name === '连板·4板').stocks, [{ name: '龙版传媒', secid: '1.605577' }]);
  assert.deepEqual(h.current.sectors.find(s => s.name === '连板·3板').stocks, [{ name: '手添', secid: '1.600000' }]);
  assert.deepEqual(h.current.sectors.find(s => s.name === '手动组'), board().sectors[1]);
  const writes = h.writes, appliedAt = h.manifest.appliedAt;
  await h.service.scan(); assert.equal(h.writes, writes); assert.equal(h.manifest.appliedAt, appliedAt);
  h.advance(61_000); await h.service.scan(); assert.equal(h.writes, writes);
  const before = structuredClone(h.current), fetchedAt = h.manifest.fetchedAt;
  h.advance(61_000); h.offline(); await assert.rejects(h.service.scan(), /offline/);
  assert.deepEqual(h.current, before); assert.equal(h.manifest.fetchedAt, fetchedAt);
  assert.equal((await h.service.status()).lastError, 'offline');
});
test('partial baseline coverage keeps retrying and clears the warning when it recovers', async () => {
  const h = harness(); h.incomplete(true); await h.service.scan();
  assert.equal((await h.service.status()).coveragePending, true);
  h.advance(61_000); h.incomplete(false); const calls = h.pools; await h.service.scan();
  assert.equal(h.pools, calls + 1); assert.equal((await h.service.status()).coveragePending, false);
});
