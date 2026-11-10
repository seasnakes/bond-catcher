const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeLadder, createLadderFeed, validDate } = require('../lib/limit-ladder-feed.js');
const DATE = '2026-09-07';
const BASE = Date.parse('2026-09-08T08:30:00+08:00');
function fixture(date = DATE) {
  return { rc: 0, data: { qdate: Number(date.replaceAll('-', '')), tc: 2, pool: [
    { c: '605577', m: 1, n: '龙版传媒', lbc: 6, p: 17110, zdp: 9.9678, zttj: { days: 10, ct: 8 } },
    { c: '002702', m: 0, n: '海欣食品', lbc: 2, p: 6170, zdp: 9.98217 },
  ] } };
}
test('Eastmoney prices /1000, percentage points unchanged, consecutive boards use lbc', () => {
  const d = normalizeLadder(fixture(), DATE, BASE);
  assert.equal(d.stocks[0].price, 17.11); assert.equal(d.stocks[0].changePct, 9.9678);
  assert.equal(d.stocks[0].actualBoards, 6); assert.equal(d.stocks[0].secid, '1.605577');
  assert.equal(d.stocks[1].secid, '0.002702'); assert.equal(d.quoteTime, null);
  assert.equal(d.coverage, 'limit_up_only'); assert.match(d.scope, /来源/);
});
test('wrong dates, empty/partial/error payloads, duplicate symbols and malformed stocks fail closed', () => {
  for (const date of ['2026-02-30', 'x', '2026-9-7']) assert.equal(validDate(date), false);
  assert.equal(validDate(DATE), true);
  const edits = [p => p.rc = 1, p => p.data.qdate = 20260904, p => p.data.tc++,
    p => { p.data.pool = []; p.data.tc = 0; }, p => p.data.pool[1] = p.data.pool[0],
    p => p.data.pool[0].lbc = null, p => p.data.pool[0].p = null,
    p => p.data.pool[0].zdp = null, p => p.data.pool[0].m = 0];
  for (const edit of edits) { const p = fixture(); edit(p); assert.throws(() => normalizeLadder(p, DATE)); }
});
test('concurrent calls coalesce; completed cache survives restart without another service', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ladder-pool-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const options = { now: () => BASE, cacheDir: dir, fetchSnapshot: async date => { calls++; return fixture(date); } };
  const feed = createLadderFeed(options);
  const [a,b] = await Promise.all([feed(DATE), feed(DATE)]); assert.equal(a,b); assert.equal(calls, 1);
  const restarted = createLadderFeed({ ...options, fetchSnapshot: async () => { throw new Error('offline'); } });
  assert.deepEqual(await restarted(DATE), a);
  await assert.rejects(restarted('2026-09-04'), e => e.statusCode === 503);
  await assert.rejects(feed('2026-02-30'), e => e.statusCode === 400);
});
test('intraday cache is refreshed after close before it can become the next-day baseline', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ladder-pool-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let now = Date.parse(`${DATE}T10:00:00+08:00`); let calls = 0;
  const feed = createLadderFeed({ now: () => now, cacheDir: dir, fetchSnapshot: async () => { const p = fixture(); p.data.pool[0].lbc = ++calls; return p; } });
  await feed(DATE); assert.deepEqual(await fs.readdir(dir), []);
  now = BASE;
  assert.equal((await feed(DATE)).stocks.find(s => s.code === '605577').actualBoards, 2);
  assert.equal(calls, 2); assert.equal((await fs.readdir(dir)).length, 1);
});
test('failed refresh keeps same-date data and original fetchedAt without borrowing another day', async () => {
  let now = BASE; let offline = false;
  const feed = createLadderFeed({ now: () => now, fetchSnapshot: async date => { if (offline) throw new Error('offline'); return fixture(date); } });
  const a = await feed(DATE); now += 61_000; offline = true;
  const b = await feed(DATE); assert.equal(b.refreshFailed, true); assert.equal(b.fetchedAt, a.fetchedAt);
  await assert.rejects(feed('2026-09-04'));
});
