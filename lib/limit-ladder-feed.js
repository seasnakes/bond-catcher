const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chinaClock } = require('./limit-ladder-live.js');
const SOURCE = '东方财富涨停池';
const SCOPE = '东方财富当日涨停池；覆盖范围以来源实际返回为准';
function validDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
}
function normalizeLadder(payload, date, fetchedAt = Date.now()) {
  const d = payload?.data;
  if (!validDate(date) || payload?.rc !== 0 || String(d?.qdate) !== date.replaceAll('-', '')
      || !Array.isArray(d?.pool) || d.tc !== d.pool.length || d.tc < 1) {
    throw new Error('涨停池日期、数量或格式不完整，保留原分组');
  }
  const seen = new Set();
  const stocks = d.pool.map(r => {
    if (!/^\d{6}$/.test(r.c) || ![0, 1].includes(r.m)
        || (r.m === 1 ? !r.c.startsWith('6') : !/^[03489]/.test(r.c))
        || typeof r.n !== 'string' || !r.n.trim() || seen.has(r.c)
        || !Number.isInteger(r.lbc) || r.lbc < 1
        || !Number.isFinite(r.p) || r.p <= 0 || !Number.isFinite(r.zdp)) {
      throw new Error('涨停池股票数据不完整，保留原分组');
    }
    seen.add(r.c);
    return {
      symbol: `${r.c}.${r.m === 1 ? 'SH' : /^[489]/.test(r.c) ? 'BJ' : 'SZ'}`, secid: `${r.m}.${r.c}`, code: r.c, name: r.n.trim(),
      price: r.p / 1000, changePct: r.zdp,
      // lbc is consecutive boards. zttj.ct can include nonconsecutive limit-ups.
      actualBoards: r.lbc, previousBoards: r.lbc - 1, targetBoards: r.lbc,
      status: 'limit_up', oneWord: false, sealedStatus: null,
    };
  }).sort((a, b) => b.actualBoards - a.actualBoards || a.code.localeCompare(b.code));
  return { asOf: date, fetchedAt: new Date(fetchedAt).toISOString(), quoteTime: null, source: SOURCE,
    scope: SCOPE, coverage: 'limit_up_only', sealedReady: false, refreshFailed: false, stocks };
}
function requestLadder(date) {
  const url = new URL('https://push2ex.eastmoney.com/getTopicZTPool');
  Object.entries({ ut: '7eea3edcaed734bea9cbfc24409ed989', dpt: 'wz.ztzt', Pageindex: 0,
    pagesize: 10000, sort: 'fbt:asc', date: date.replaceAll('-', '') }).forEach(([k, v]) => url.searchParams.set(k, v));
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' } }, res => {
      const chunks = []; let size = 0;
      res.on('data', c => { size += c.length; if (size > 3 * 1024 * 1024) req.destroy(new Error('涨停池响应过大')); else chunks.push(c); });
      res.on('error', reject);
      res.on('end', () => {
        try { if (res.statusCode !== 200) throw new Error(`涨停池暂不可用（HTTP ${res.statusCode}）`); resolve(JSON.parse(Buffer.concat(chunks))); }
        catch (e) { reject(e); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('涨停池读取超时')), 8000);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject);
  });
}
function createLadderFeed({ fetchSnapshot = requestLadder, normalize = normalizeLadder, now = Date.now, ttl = 60_000, cacheDir = '' } = {}) {
  const entries = new Map();
  return async function load(date = '') {
    date ||= chinaClock(now()).date;
    if (!validDate(date)) throw Object.assign(new Error('请选择有效日期'), { statusCode: 400 });
    let entry = entries.get(date);
    if (!entry) {
      if (entries.size >= 32) {
        const idle = [...entries].find(([, v]) => !v.pending);
        if (idle) entries.delete(idle[0]); else throw Object.assign(new Error('涨停池查询繁忙'), { statusCode: 503 });
      }
      entry = { data: null, attemptedAt: -Infinity, pending: null }; entries.set(date, entry);
    }
    if (entry.pending) return entry.pending;
    if (entry.data && now() - entry.attemptedAt < ttl) return entry.data;
    entry.attemptedAt = now();
    entry.pending = (async () => {
      const clock = chinaClock(now());
      // Intraday responses must never become a persisted daily baseline.
      const completed = date < clock.date || (date === clock.date && clock.time >= '15:15:00');
      const file = cacheDir && completed ? path.join(cacheDir, `${date}.json`) : '';
      try {
        if (!entry.data && file) {
          try { const saved = JSON.parse(await fs.readFile(file, 'utf8')); entry.data = normalize(saved.payload, date, Date.parse(saved.fetchedAt)); }
          catch (e) { if (e.code !== 'ENOENT') console.warn(`Ladder cache ignored: ${e.message}`); }
        }
        if (entry.data && file && !entry.data.refreshFailed && !entry.data.coveragePending && entry.completed) return entry.data;
        // A validated disk snapshot was fetched after this session completed.
        if (entry.data && file && !entry.data.coveragePending && !entry.completed && Date.parse(entry.data.fetchedAt) >= Date.parse(`${date}T15:15:00+08:00`)) { entry.completed = true; return entry.data; }
        const payload = await fetchSnapshot(date);
        const next = normalize(payload, date, now());
        if (file) {
          await fs.mkdir(cacheDir, { recursive: true });
          const temp = `${file}.${process.pid}.tmp`;
          await fs.writeFile(temp, JSON.stringify({ payload, fetchedAt: next.fetchedAt })); await fs.rename(temp, file);
        }
        entry.data = next; entry.completed = completed && !next.coveragePending;
      } catch (e) {
        if (!entry.data) throw Object.assign(e, { statusCode: 503 });
        entry.data = { ...entry.data, refreshFailed: true, error: '刷新失败，保留同日快照' };
      }
      return entry.data;
    })().finally(() => { entry.pending = null; });
    return entry.pending;
  };
}
module.exports = { createLadderFeed, normalizeLadder, validDate, SOURCE, SCOPE };
