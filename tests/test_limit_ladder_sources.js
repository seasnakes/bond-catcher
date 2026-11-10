const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHithinkPages, loadHithinkPool, createPreferredLadderFeed } = require('../lib/limit-ladder-sources.js');
const DATE = '2026-09-07';
const NOW = Date.parse('2026-09-08T08:00:00+08:00');
function page({ page = 1, total = 1, pages = 1, rows } = {}) {
  return { ok: true, data: { timestamp: NOW, pagination: { page, size: 200, pages, total },
    item: rows || [{ thscode: '605577.SH', ticker: '605577', name: '龙版传媒', continue_day_cnt: 6,
      last_price: 17.11, price_change_ratio_pct: 10.0322, limit_up_reason: '出版发行' }] } };
}
const ths = () => normalizeHithinkPages([page()], DATE, NOW);
const em = () => ({ ...ths(), source: '东方财富涨停池', stocks: [...ths().stocks, {
  symbol: '920821.BJ', secid: '0.920821', code: '920821', name: '则成电子', actualBoards: 1, status: 'limit_up',
}] });
test('Hithink uses declared percent units, full symbol and reason; never infer date from response assembly timestamp', () => {
  const d = ths(); assert.equal(d.stocks[0].changePct, 10.0322); assert.equal(d.stocks[0].reason, '出版发行');
  assert.equal(d.asOf, DATE); assert.equal(d.dateEvidence, 'date_ms_request');
});
test('pagination truncation, duplicate stocks and malformed business envelopes fail closed', () => {
  for (const p of [page({ total: 2 }), page({ pages: 2 }), { ...page(), ok: false }, page({ rows: [] })]) {
    assert.throws(() => normalizeHithinkPages([p], DATE));
  }
  const row = page().data.item[0];
  assert.throws(() => normalizeHithinkPages([page({ total: 2, rows: [row, row] })], DATE));
});
test('full pagination walks beyond the first 200 rows with bounded pacing', async () => {
  const calls = [], waits = [];
  const rows = Array.from({ length: 201 }, (_,i) => ({ ...page().data.item[0], ticker: String(600000+i), thscode: `${600000+i}.SH` }));
  const result = await loadHithinkPool(DATE, { wait: async ms => waits.push(ms), pageLoader: async (date, n) => {
    assert.equal(date, DATE); calls.push(n); return page({ page: n, pages: 2, total: 201, rows: rows.slice((n-1)*200,n*200) });
  } });
  assert.deepEqual(calls, [1,2]); assert.deepEqual(waits, [8000]); assert.equal(result.stocks.length, 201);
});
test('primary Hithink remains intact, with only missing BJ members supplemented and attributed', async () => {
  const feed = createPreferredLadderFeed({ now: () => NOW, loadHithink: async () => ths(), loadEastmoney: async () => em() });
  const d = await feed(DATE); assert.equal(d.stocks.length, 2); assert.equal(d.crossCheckedCount, 1);
  assert.equal(d.stocks[0].reason, '出版发行'); assert.equal(d.stocks[1].poolSource, '东方财富（北交所补充）');
});
test('source disagreements fail closed; missing BJ supplement keeps current verified primary with a visible warning', async () => {
  const feed = (loadHithink, loadEastmoney) => createPreferredLadderFeed({ now: () => NOW, loadHithink, loadEastmoney });
  await assert.rejects(feed(async () => ths(), async () => { const d = em(); d.stocks[0].actualBoards = 5; return d; })(DATE), /不一致/);
  const primary = await feed(async () => ths(), async () => { throw new Error('日期不符'); })(DATE);
  assert.equal(primary.stocks.length, 1); assert.equal(primary.asOf, DATE);
  assert.equal(primary.refreshFailed, false); assert.equal(primary.coveragePending, true);
  assert.match(primary.sourceWarning, /北交所补充待核.*日期不符/);
  assert.match(primary.scope, /不能据此判断/);
  const fallback = await feed(async () => { throw new Error('account offline'); }, async () => em())(DATE);
  assert.equal(fallback.fallback, true); assert.match(fallback.source, /回退/); assert.equal(fallback.asOf, DATE);
});
test('partial completed-day cache retries after TTL and after restart, then accepts recovered BJ coverage', async t => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ladder-partial-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let now = NOW, calls = 0, offline = true;
  const options = { cacheDir: dir, now: () => now, loadHithink: async () => ths(),
    loadEastmoney: async () => { calls++; if (offline) throw new Error('wrong date'); return em(); } };
  const feed = createPreferredLadderFeed(options);
  assert.equal((await feed(DATE)).coveragePending, true);
  await feed(DATE); assert.equal(calls, 1);
  now += 61_000; await feed(DATE); assert.equal(calls, 2);
  offline = false;
  const restored = await createPreferredLadderFeed(options)(DATE);
  assert.equal(calls, 3); assert.equal(restored.coveragePending, undefined); assert.equal(restored.stocks.length, 2);
  await createPreferredLadderFeed({ ...options, loadEastmoney: async () => { throw new Error('must use completed cache'); } })(DATE);
});
