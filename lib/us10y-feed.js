const https = require("node:https");

// Community scanner usage: matextrem/streamdeck-tickertap, helpers/tradingview.ts.
// This is an unofficial quote endpoint, not a historical bars API.
const SYMBOL = "TVC:US10Y";
const COLUMNS = ["close", "change", "change_abs", "last-price-update-time", "time", "type", "typespecs"];
const CACHE_MS = 20_000;
const STALE_MS = 15 * 60_000;

function requestSnapshot() {
  const body = JSON.stringify({ symbols: { tickers: [SYMBOL] }, columns: COLUMNS });
  return new Promise((resolve, reject) => {
    const req = https.request("https://scanner.tradingview.com/global/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > 256 * 1024) req.destroy(new Error("TradingView response too large"));
        else chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => {
        if (res.statusCode !== 200) {
          const error = new Error(`TradingView HTTP ${res.statusCode}`);
          error.status = res.statusCode;
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          error.invalidPayload = true;
          reject(error);
        }
      });
    });
    // Bound the entire attempt, including DNS/TLS, to fit the card's 12s timeout.
    const timer = setTimeout(() => req.destroy(new Error("TradingView request timeout")), 4500);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end(body);
  });
}

function dateTime(epochSeconds) {
  if (!epochSeconds) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(epochSeconds * 1000));
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

function parseSnapshot(payload, now = Date.now()) {
  const row = payload?.data?.find((item) => item.s === SYMBOL);
  const [price, percent, changeAbs, sourceTime, sessionTime, type, typespecs] = row?.d || [];
  const previousClose = price - changeAbs;
  if (type !== "bond" || !typespecs?.includes("yield") ||
      ![price, percent, changeAbs, previousClose].every((value) => typeof value === "number" && Number.isFinite(value)) ||
      price <= 0 || previousClose <= 0 || Math.abs(percent - changeAbs / previousClose * 100) > 0.01) {
    throw new Error("TradingView 美债收益率报价暂不可用");
  }
  // Missing source time stays unknown; retrieval time must not become quote time.
  const validTime = (value) => Number.isInteger(value) && value > 0 && value * 1000 <= now + 60_000;
  const timetag = validTime(sourceTime) ? sourceTime : null;
  return {
    key: "us10y", name: "美国10年期国债收益率", symbol: SYMBOL,
    unit: "%", priceDecimals: 3, price, previousClose, percent,
    changeBps: changeAbs * 100, ...dateTime(timetag), timetag,
    sessionTime: validTime(sessionTime) ? sessionTime : null,
    timeZone: "Asia/Shanghai", source: "TradingView · 社区接口",
    sourceUrl: "https://www.tradingview.com/symbols/TVC-US10Y/",
  };
}

function sampledChart(samples) {
  const count = Math.min(samples.length, 180);
  const indexes = Array.from({ length: count }, (_, i) => count <= 1 ? 0 : Math.round(i * (samples.length - 1) / (count - 1)));
  const rows = indexes.map((i) => samples[i]);
  const breaks = indexes.map((index, i) => i > 0 && samples.slice(indexes[i - 1] + 1, index + 1)
    .some((sample, j) => sample.at - samples[indexes[i - 1] + j].at > 90_000));
  return {
    points: rows.map((row) => row.price), sparkTimestamps: rows.map((row) => row.at), sparkBreaks: breaks,
    sparkTimes: rows.map((row) => dateTime(row.at / 1000).time),
    sparkStartDate: rows.length ? dateTime(rows[0].at / 1000).date : "",
    sparkDate: rows.length ? dateTime(rows.at(-1).at / 1000).date : "",
    sparkTime: rows.length ? dateTime(rows.at(-1).at / 1000).time : "",
    chartKind: "sampled", chartUnavailable: rows.length < 2,
  };
}

function createUs10yFeed({ fetchSnapshot = requestSnapshot, now = Date.now } = {}) {
  let cached = null;
  let attemptedAt = 0;
  let pending = null;
  let samples = [];
  async function refresh() {
    attemptedAt = now();
    try {
      let payload;
      try {
        payload = await fetchSnapshot();
      } catch (error) {
        // Retry a transport/server failure once; never retry denial/rate limits.
        if (error.invalidPayload || (error.status && error.status < 500)) throw error;
        payload = await fetchSnapshot();
      }
      const fetchedAt = now();
      const quote = parseSnapshot(payload, fetchedAt);
      if (cached?.timetag && quote.timetag && quote.timetag < cached.timetag) {
        throw new Error("TradingView returned an older quote");
      }
      if (cached && (quote.sessionTime !== cached.sessionTime ||
          Math.abs(quote.previousClose - cached.previousClose) > 0.000001)) samples = [];
      if (!quote.timetag || fetchedAt - quote.timetag * 1000 < STALE_MS) {
        samples.push({ at: fetchedAt, price: quote.price });
        samples = samples.slice(-3000);
      }
      cached = { ...quote, ...sampledChart(samples), fetchedAt, refreshFailed: false };
      return cached;
    } catch (error) {
      if (!cached) throw error;
      // Keep the original quote and retrieval timestamps on a failed refresh.
      cached = { ...cached, refreshFailed: true };
      return cached;
    }
  }
  return async function fetchUs10yQuote() {
    if (pending) return pending;
    if (cached && now() - attemptedAt < CACHE_MS) return cached;
    pending = refresh().finally(() => { pending = null; });
    return pending;
  };
}

module.exports = { createUs10yFeed, parseSnapshot, sampledChart };
