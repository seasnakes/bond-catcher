const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const app = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const server = fs.readFileSync(require.resolve('../server.js'), 'utf8');
function extract(source, start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
test('main board caption distinguishes current counts, prior baseline and incomplete coverage', () => {
  const ctx = vm.createContext({ state: { limitLadder: { ready: true, baseDate: '2026-09-16', count: 64,
    grouping: 'today', phase: 'intraday', fetchedAt: '2026-09-16T03:56:00.000Z' } } });
  vm.runInContext(extract(app, 'function ladderCaption(', '\nfunction updateLadderCaption('), ctx);
  assert.match(ctx.ladderCaption(), /09\/16 盘中 · 64只 · 11:56/);
  ctx.state.limitLadder.coveragePending = true; assert.match(ctx.ladderCaption(), /北交待核/);
  ctx.state.limitLadder.lastError = 'offline'; assert.match(ctx.ladderCaption(), /更新待重试/);
  Object.assign(ctx.state.limitLadder, { coveragePending: false, lastError: '', grouping: 'previous' });
  assert.match(ctx.ladderCaption(), /底表/);
});
test('a background board reload cannot replace edits made while its request was in flight', async () => {
  let finish;
  const ctx = vm.createContext({ console, state: { sectors: 'manual', editMode: false }, serverPersistTimer: 0, boardPersistInFlight: 0, boardPersistFailed: false,
    fetchJson: () => new Promise(resolve => finish = resolve), normalizeSectors: v => v, normalizeStackGroups: v => v, writeLocalBoardState: () => {} });
  vm.runInContext(extract(app, 'async function loadServerBoardState(', '\nasync function refreshBoardLadderState('), ctx);
  const pending = ctx.loadServerBoardState({ background: true }); ctx.state.editMode = true;
  finish({ exists: true, sectors: [{ name: 'remote' }], stackGroups: [] });
  assert.equal(await pending, false); assert.equal(ctx.state.sectors, 'manual');
});
test('save timer releases, pending request stays protected, failed local save blocks automatic reload', async () => {
  let callback, finish;
  const ctx = vm.createContext({ console: { warn(){} }, state: { sectors: [], stackGroups: [] }, serverPersistTimer: 0,
    boardPersistInFlight: 0, boardPersistFailed: false, ACTIVE_DEFAULT_SECTOR_VERSION: 'v',
    window: { clearTimeout() {}, setTimeout: fn => { callback = fn; return 10; } },
    serializeSectors: x => x, serializeStackGroups: x => x, postJson: () => new Promise((resolve, reject) => finish = reject),
  });
  vm.runInContext(extract(app, 'function persistBoardStateSoon(', '\nfunction syncStackGroupsWithSectors('), ctx);
  ctx.persistBoardStateSoon(); assert.equal(ctx.serverPersistTimer, 10); callback();
  assert.equal(ctx.serverPersistTimer, 0); assert.equal(ctx.boardPersistInFlight, 1);
  finish(new Error('conflict')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(ctx.boardPersistInFlight, 0); assert.equal(ctx.boardPersistFailed, true);
});
test('native board quote bridge isolates BJ from the SH/SZ Python endpoint and preserves partial results', async () => {
  const calls = [];
  const ctx = vm.createContext({ URLSearchParams,
    fetchLocalJson: async url => { calls.push(url); return { quotes: [{ secid: '1.605577', price: 17.11 }] }; },
    loadBeijingLadderQuotes: async codes => { assert.ok(codes.includes('920821.BJ')); return [{ secid: '0.920821', price: 23.59 }]; },
  });
  vm.runInContext(extract(server, 'async function fetchBoardQmtQuotes(', '\nasync function sampleAuctionQuotes('), ctx);
  const d = await ctx.fetchBoardQmtQuotes('605577.SH,920821.BJ'); assert.equal(d.quotes.length, 2);
  assert.ok(!calls[0].includes('920821'));
  ctx.loadBeijingLadderQuotes = async () => { throw new Error('offline'); };
  const partial = await ctx.fetchBoardQmtQuotes('605577.SH,920821.BJ'); assert.equal(partial.quotes.length, 1); assert.equal(partial.failed, true);
});
