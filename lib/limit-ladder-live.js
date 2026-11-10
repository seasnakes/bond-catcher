const http = require("node:http");

function chinaClock(now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

function bridgeRequest(path, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: process.env.QMT_BRIDGE_HOST || "127.0.0.1", port: Number(process.env.QMT_BRIDGE_PORT || 18889), path }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => { size += chunk.length; if (size > 2 * 1024 * 1024) req.destroy(new Error("QMT响应过大")); else chunks.push(chunk); });
      res.on("error", reject);
      res.on("end", () => { try { if (res.statusCode !== 200) throw new Error("QMT接口暂不可用"); resolve(JSON.parse(Buffer.concat(chunks))); } catch (e) { reject(e); } });
    });
    const timer = setTimeout(() => req.destroy(new Error("QMT接口读取超时")), timeoutMs);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
  });
}

async function loadCalendar(date) {
  const query = `?market=SH&date=${date.replaceAll("-", "")}`;
  const [today, previous] = await Promise.all([
    bridgeRequest(`/api/calendar/is_trading_date${query}`),
    bridgeRequest(`/api/calendar/prev_trading_date${query}`),
  ]);
  if (typeof today.is_trading !== "boolean" || !Number.isFinite(previous.prev_trading_date)) throw new Error("交易日历不完整");
  return { isTrading: today.is_trading, previousDate: chinaClock(previous.prev_trading_date).date };
}

// The board's existing Python quote endpoint intentionally only accepts SH/SZ.
// Fetch BJ through the same active gateway; do not classify BJ as Shenzhen.
async function loadBeijingLadderQuotes(codes) {
  const symbols = codes.filter((code) => /^\d{6}\.BJ$/.test(code));
  if (!symbols.length) return [];
  const payload = await bridgeRequest(`/api/market/full_tick?stocks=${encodeURIComponent(symbols.join(","))}`);
  return symbols.flatMap((symbol) => {
    const tick = payload?.data?.[symbol];
    if (!tick) return [];
    const tag = String(tick.timetag || "");
    return [{ monitor_code: symbol, secid: `0.${symbol.slice(0, 6)}`, code: symbol.slice(0, 6),
      price: tick.lastPrice, previousClose: tick.lastClose,
      change: Number.isFinite(tick.lastPrice) && Number.isFinite(tick.lastClose) && tick.lastClose > 0 ? (tick.lastPrice / tick.lastClose - 1) * 100 : null,
      amount: tick.amount, volume: tick.volume, timetag: tag,
      date: tag.slice(0, 8), time: tag.slice(9, 17), timestamp: tick.time, source: "QMT full_tick · 北交所" }];
  });
}

function overlayLiveLadder(base, payload, { now = Date.now(), isTrading = true } = {}) {
  const clock = chinaClock(now);
  const auction = isTrading && clock.time >= "09:15:00" && clock.time < "09:30:00";
  const finalAuction = auction && clock.time >= "09:25:00";
  const active = isTrading && ((clock.time >= "09:15:00" && clock.time <= "11:30:00") || (clock.time >= "13:00:00" && clock.time <= "15:00:00"));
  const quoteMap = new Map((payload?.quotes || []).map((quote) => [quote.monitor_code, quote]));
  const source = payload?.quote_backend?.active === "bigqmt" ? "大 QMT" : payload?.quote_backend?.active === "miniqmt" ? "MiniQMT" : "QMT";
  const stocks = base.stocks.filter((stock) => stock.status === "limit_up").map((stock) => {
    const quote = quoteMap.get(stock.symbol);
    const date = String(quote?.date || "").replaceAll("-", "");
    const time = String(quote?.time || "");
    const quoteTimestamp = /^\d{2}:\d{2}:\d{2}$/.test(time) && date.length === 8 ? Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time}+08:00`) : NaN;
    const sameDay = date === clock.date.replaceAll("-", "");
    const valid = sameDay && Number.isFinite(quoteTimestamp) && quoteTimestamp <= now + 10_000
      && typeof quote?.price === "number" && Number.isFinite(quote.price) && quote.price > 0
      && typeof quote?.previousClose === "number" && Number.isFinite(quote.previousClose) && quote.previousClose > 0;
    const frozenFinal = finalAuction && time >= "09:25:00";
    const stale = valid && active && !frozenFinal && now - quoteTimestamp > 60_000;
    return {
      ...stock, previousBoards: stock.actualBoards, targetBoards: stock.actualBoards + 1,
      actualBoards: null, status: valid ? frozenFinal ? "auction_final" : auction ? "auction" : "tracking" : "pending", oneWord: false, sealedStatus: null,
      price: valid ? quote.price : null, previousClose: valid ? quote.previousClose : null,
      changePct: valid ? (quote.price / quote.previousClose - 1) * 100 : null,
      quoteDate: valid ? clock.date : null, quoteTime: valid ? time : null,
      quoteTimestamp: valid ? quoteTimestamp : null, quoteStale: stale, quoteSource: source,
    };
  });
  const times = stocks.filter((s) => s.quoteTime).map((s) => s.quoteTime).sort();
  const covered = times.length;
  return {
    asOf: clock.date, baseDate: base.asOf, fetchedAt: new Date(now).toISOString(),
    source: `${source} 实时报价 · ${base.source || "东方财富涨停池"} 昨日梯队`, scope: base.scope, live: true,
    phase: !isTrading ? "closed" : finalAuction ? "auction_final" : auction ? "auction" : clock.time < "09:15:00" ? "preopen" : active ? "trading" : "closed",
    phaseLabel: !isTrading ? "休市" : finalAuction ? "竞价结果 · 等待开盘" : auction ? "集合竞价" : clock.time < "09:15:00" ? "等待竞价" : active ? "盘中跟踪" : "休市 / 收盘报价",
    refreshIntervalMs: active || (isTrading && clock.time >= "09:14:00" && clock.time < "09:15:00") ? 3000 : 30_000,
    quoteTime: times.at(-1) || null, oldestQuoteTime: times[0] || null,
    covered, fresh: stocks.filter((s) => s.quoteTime && !s.quoteStale).length,
    refreshFailed: payload?.failed === true || base.refreshFailed, sealedReady: false, stocks,
  };
}

function createLiveLadderFeed({ loadHistory, loadQuotes, calendar = loadCalendar, now = Date.now } = {}) {
  let day = null;
  let base = null;
  let cached = null;
  let attemptedAt = 0;
  let pending = null;
  return async () => {
    if (pending) return pending;
    if (cached && now() - attemptedAt < 2000) return cached;
    attemptedAt = now();
    pending = (async () => {
      const date = chinaClock(now()).date;
      if (!day || day.date !== date) {
        day = { ...await calendar(date), date };
        base = null;
      }
      if (!base) {
        base = await loadHistory(day.previousDate);
        if (base.asOf !== day.previousDate || !base.stocks.length) { base = null; throw new Error("上一交易日连板底表尚未就绪"); }
      }
      const codes = base.stocks.filter((s) => s.status === "limit_up").map((s) => s.symbol);
      let quotes;
      try { quotes = codes.length ? await loadQuotes(codes) : { quotes: [] }; }
      catch { quotes = { quotes: [], failed: true }; }
      cached = overlayLiveLadder(base, quotes, { now: now(), isTrading: day.isTrading });
      return cached;
    })().finally(() => { pending = null; });
    return pending;
  };
}

module.exports = { bridgeRequest, chinaClock, loadCalendar, overlayLiveLadder, createLiveLadderFeed, loadBeijingLadderQuotes };
