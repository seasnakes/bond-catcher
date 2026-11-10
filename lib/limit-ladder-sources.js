const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createLadderFeed, validDate } = require('./limit-ladder-feed.js');
const runFile = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function hithinkPage(date, page) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'finance-ladder-'));
  const output = path.join(dir, 'pool.json');
  const cli = process.env.HITHINK_FINANCE_CLI || path.join(path.dirname(process.execPath), 'hithink-finance');
  try {
    const { stdout } = await runFile(process.execPath, [cli, 'special', 'limit-up-pool',
      '--date-ms', String(Date.parse(`${date}T00:00:00+08:00`)), '--page', String(page), '--size', '200',
      '--sort-field', 'continue_day_cnt', '--sort-dir', 'desc', '--output', output, '--format', 'json'],
    { timeout: 30_000, maxBuffer: 1024 * 1024, env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}` } });
    if (JSON.parse(stdout).ok !== true) throw new Error('同花顺涨停池业务请求失败');
    return JSON.parse(await fs.readFile(output, 'utf8'));
  } catch (error) {
    // Do not include subprocess command/output or credential-store diagnostics.
    let code = '';
    try { code = JSON.parse(error.stdout || '{}').error?.code || ''; } catch {}
    throw Object.assign(new Error(`同花顺涨停池暂不可用${code ? `（${String(code).slice(0, 60)}）` : ''}`), { code });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

function normalizeHithinkPages(pages, date, now = Date.now()) {
  if (!validDate(date) || !pages.length) throw new Error('同花顺涨停池日期或分页缺失');
  const total = pages[0]?.data?.pagination?.total;
  const expectedPages = pages[0]?.data?.pagination?.pages;
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(expectedPages) || pages.length !== expectedPages) throw new Error('同花顺涨停池分页不完整');
  const seen = new Set();
  const stocks = [];
  for (const [index, page] of pages.entries()) {
    const p = page?.data?.pagination;
    if (page.ok !== true || !Array.isArray(page?.data?.item) || p?.total !== total
        || p?.pages !== expectedPages || p?.page !== index + 1 || p?.size !== 200
        || page.data.item.length !== Math.min(200, total - index * 200)) throw new Error('同花顺涨停池分页不完整');
    for (const row of page.data.item) {
      if (!/^\d{6}\.(SH|SZ|BJ)$/.test(row.thscode) || row.ticker !== row.thscode.slice(0,6)
          || !row.name || seen.has(row.thscode) || !Number.isInteger(row.continue_day_cnt) || row.continue_day_cnt < 1) throw new Error('同花顺涨停池股票不完整');
      seen.add(row.thscode);
      stocks.push({ symbol: row.thscode, secid: `${row.thscode.endsWith('.SH') ? 1 : 0}.${row.ticker}`, code: row.ticker,
        name: row.name, actualBoards: row.continue_day_cnt, previousBoards: row.continue_day_cnt - 1, targetBoards: row.continue_day_cnt,
        status: 'limit_up', price: Number.isFinite(row.last_price) ? row.last_price : null,
        changePct: Number.isFinite(row.price_change_ratio_pct) ? row.price_change_ratio_pct : null,
        reason: row.limit_up_reason || '', firstLimitTime: row.limit_up_time || '', isSt: row.is_st === true,
        oneWord: false, sealedStatus: null, poolSource: '同花顺 Agent',
      });
    }
  }
  if (stocks.length !== total) throw new Error('同花顺涨停池数量不完整');
  return { asOf: date, fetchedAt: new Date(now).toISOString(), quoteTime: null, source: '同花顺 Agent 涨停池',
    scope: '按交易日完整分页获取；股票范围以来源返回为准', coverage: 'limit_up_only', refreshFailed: false, sealedReady: false,
    dateEvidence: 'date_ms_request', stocks: stocks.sort((a,b) => b.actualBoards - a.actualBoards || a.code.localeCompare(b.code)) };
}

async function loadHithinkPool(date, { pageLoader = hithinkPage, wait = pause } = {}) {
  const pages = [];
  let expected = 1;
  for (let page = 1; page <= expected; page++) {
    if (page > 1) await wait(8000);
    let result;
    for (let attempt = 0; ; attempt++) {
      try { result = await pageLoader(date, page); break; }
      catch (error) {
        if (attempt >= 1 || !/429|4001|5\d{3}/.test(String(error.code))) throw error;
        await wait(8000);
      }
    }
    const p = result?.data?.pagination;
    if (result.ok !== true || !Number.isInteger(p?.pages) || p.pages < 1 || p.pages > 50) throw new Error('同花顺涨停池不可用或分页异常');
    if (page === 1) expected = p.pages;
    pages.push(result);
  }
  return normalizeHithinkPages(pages, date);
}

function createPreferredLadderFeed({ cacheDir = '', loadHithink = loadHithinkPool, loadEastmoney = createLadderFeed(), now = Date.now } = {}) {
  return createLadderFeed({ cacheDir, now,
    fetchSnapshot: async date => {
      let primary; let primaryError = '';
      try { primary = await loadHithink(date); }
      catch (error) { primaryError = error.message; }
      let eastmoney; let secondaryError = '';
      try { eastmoney = await loadEastmoney(date); if (eastmoney.refreshFailed) throw new Error('东方财富快照刷新失败'); }
      catch (error) { secondaryError = error.message; eastmoney = null; }
      if (!primary && !eastmoney) throw new Error(`${primaryError}；${secondaryError}`);
      if (!primary) return { ...eastmoney, source: '东方财富涨停池（同花顺回退）', fallback: true, sourceWarning: primaryError };
      if (!eastmoney) return { ...primary,
        coveragePending: true,
        sourceWarning: `北交所补充待核：${secondaryError}`,
        scope: `同花顺已核实 ${primary.stocks.length}只；北交所补充暂不可用，不能据此判断北交所没有涨停股。`,
      };
      if (primary.asOf !== date || eastmoney.asOf !== date) throw new Error('涨停池来源日期不一致');
      const bySymbol = new Map(primary.stocks.map(s => [s.symbol, s]));
      const mismatches = eastmoney.stocks.filter(s => bySymbol.has(s.symbol) && s.actualBoards !== bySymbol.get(s.symbol).actualBoards);
      if (mismatches.length) throw new Error('涨停池连板数交叉校验不一致，保留原分组');
      const supplemental = eastmoney.stocks.filter(s => s.symbol.endsWith('.BJ') && !bySymbol.has(s.symbol)).map(s => ({ ...s, poolSource: '东方财富（北交所补充）' }));
      return { ...primary, stocks: [...primary.stocks, ...supplemental].sort((a,b) => b.actualBoards - a.actualBoards || a.code.localeCompare(b.code)),
        source: supplemental.length ? '同花顺 Agent + 东方财富北交所补充' : primary.source,
        scope: `同花顺 ${primary.stocks.length}只；东方财富北交所补充 ${supplemental.length}只；按两家来源实际返回名单归组。`,
        supplementalCount: supplemental.length, crossCheckedCount: eastmoney.stocks.filter(s => bySymbol.has(s.symbol)).length,
        sourceDifferences: { eastmoneyOnly: eastmoney.stocks.filter(s => !bySymbol.has(s.symbol)).map(s => s.symbol),
          hithinkOnly: primary.stocks.filter(s => !eastmoney.stocks.some(e => e.symbol === s.symbol)).map(s => s.symbol) },
      };
    },
    normalize: (value, date, fetchedAt) => {
      if (!validDate(date) || value?.asOf !== date || value?.refreshFailed || !value.stocks?.length
          || !Number.isFinite(fetchedAt)) throw new Error('涨停池合并快照不完整');
      const seen = new Set();
      for (const s of value.stocks) {
        if (!/^\d{6}\.(SH|SZ|BJ)$/.test(s.symbol) || !/^[01]\.\d{6}$/.test(s.secid) || !s.name
            || seen.has(s.symbol) || !Number.isInteger(s.actualBoards) || s.actualBoards < 1 || s.status !== 'limit_up') throw new Error('涨停池合并股票不完整');
        seen.add(s.symbol);
      }
      return { ...value, fetchedAt: new Date(fetchedAt).toISOString() };
    },
  });
}
module.exports = { createPreferredLadderFeed, normalizeHithinkPages, loadHithinkPool };
