"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const https = require("node:https");
const path = require("node:path");

const EASTMONEY_DATA_CENTER = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const EASTMONEY_KLINE = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const FACTOR_REPORT = "RPTA_WEB_KZZ_LS";
const FACTOR_TOKEN = "894050c76af8597a853f5b408b759f5d";
const DEFAULT_CACHE_DIR = path.join(__dirname, "..", "runtime", "cb-portfolio-cache");

function normalizeDate(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  return /^\d{8}$/.test(digits) ? digits : "";
}

function displayDate(date) {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function shiftDate(date, days) {
  const parsed = new Date(`${displayDate(date)}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10).replaceAll("-", "");
}

function monthKeys(startDate, endDate) {
  const output = [];
  let year = Number(startDate.slice(0, 4));
  let month = Number(startDate.slice(4, 6));
  const endKey = Number(endDate.slice(0, 6));
  while (year * 100 + month <= endKey) {
    output.push(`${year}${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      year += 1;
      month = 1;
    }
  }
  return output;
}

function monthBounds(key) {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(4, 6));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${key}01`,
    end: `${key}${String(last).padStart(2, "0")}`,
  };
}

function normalizeCode(value) {
  const text = String(value || "").trim().toUpperCase();
  const matched = text.match(/^(\d{6})\.(SH|SZ)$/);
  if (!matched) return "";
  const valid = matched[2] === "SH"
    ? /^(110|111|113|118)/.test(matched[1])
    : /^(123|127|128)/.test(matched[1]);
  return valid ? text : "";
}

function requestJson(url, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        Accept: "application/json,text/plain,*/*",
        Referer: "https://data.eastmoney.com/",
        "User-Agent": "Mozilla/5.0 FinanceBoard/1.0",
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`东方财富 HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error("东方财富返回了非 JSON 数据"));
        }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("东方财富请求超时")));
    request.on("error", reject);
  });
}

async function requestJsonWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestJson(url);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  throw lastError;
}

async function mapConcurrent(values, limit, worker) {
  const output = new Array(values.length);
  let cursor = 0;
  async function run() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => run()));
  return output;
}

async function readCache(file, maximumAgeMs = Infinity) {
  try {
    const stat = await fsp.stat(file);
    if (Date.now() - stat.mtimeMs > maximumAgeMs) return null;
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeCache(file, payload) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(payload)}\n`, "utf8");
  await fsp.rename(temporary, file);
}

function dataCenterUrl(params) {
  const url = new URL(EASTMONEY_DATA_CENTER);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url;
}

async function fetchReportPages(params) {
  const first = await requestJsonWithRetry(dataCenterUrl({ ...params, pageNumber: 1, pageSize: 500 }));
  if (first?.success !== true || !first?.result) throw new Error(first?.message || "东方财富数据报告不可用");
  const pages = Number(first.result.pages || 1);
  const pageNumbers = Array.from({ length: Math.max(0, pages - 1) }, (_value, index) => index + 2);
  const rest = await mapConcurrent(pageNumbers, 6, async (pageNumber) => {
    const payload = await requestJsonWithRetry(dataCenterUrl({ ...params, pageNumber, pageSize: 500 }));
    if (payload?.success !== true || !payload?.result) throw new Error(payload?.message || `第${pageNumber}页不可用`);
    return payload.result.data || [];
  });
  return [...(first.result.data || []), ...rest.flat()];
}

async function loadNames(cacheDir, status) {
  const file = path.join(cacheDir, "universe.json");
  const cached = await readCache(file, 24 * 60 * 60 * 1000);
  if (cached?.rows) {
    status.universe_cache = "hit";
    return cached.rows;
  }
  const raw = await fetchReportPages({
    reportName: "RPT_BOND_CB_LIST",
    columns: "ALL",
    sortColumns: "SECURITY_CODE",
    sortTypes: "1",
    source: "WEB",
    client: "WEB",
  });
  const rows = raw.map((row) => ({
    code: normalizeCode(row.SECUCODE),
    name: String(row.SECURITY_NAME_ABBR || row.SECURITY_CODE || ""),
    stock_code: String(row.CONVERT_STOCK_CODE || ""),
    listing_date: normalizeDate(row.LISTING_DATE),
    delist_date: normalizeDate(row.DELIST_DATE),
    rating: row.RATING || null,
  })).filter((row) => row.code);
  await writeCache(file, { updated_at: new Date().toISOString(), rows });
  status.universe_cache = "miss_refreshed";
  return rows;
}

async function loadFactorMonth(key, cacheDir, status) {
  const file = path.join(cacheDir, "factors", `${key}.json`);
  const currentKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }).replaceAll("-", "").slice(0, 6);
  const maximumAge = key === currentKey ? 30 * 60 * 1000 : Infinity;
  const cached = await readCache(file, maximumAge);
  if (cached?.rows) {
    status.factor_cache_hits += 1;
    return cached.rows;
  }
  const bounds = monthBounds(key);
  const raw = await fetchReportPages({
    reportName: FACTOR_REPORT,
    columns: "ALL",
    sortColumns: "DATE,ZCODE",
    sortTypes: "1,1",
    filter: `(DATE>='${displayDate(bounds.start)}')(DATE<='${displayDate(bounds.end)}')`,
    source: "WEB",
    client: "WEB",
    token: FACTOR_TOKEN,
  });
  const rows = raw.map((row) => ({
    date: normalizeDate(row.DATE),
    code: normalizeCode(row.SECUCODE),
    close: row.FCLOSE,
    conversion_value: row.SWAPVALUE,
    premium_rate: row.SWAPOR,
    pure_bond_value: row.PUREBONDVALUE,
    remaining_balance_yuan: row.SYFE,
  })).filter((row) => row.date && row.code && Number(row.close) > 0);
  await writeCache(file, { updated_at: new Date().toISOString(), rows });
  status.factor_cache_misses += 1;
  return rows;
}

async function loadPortfolioFactors(options = {}) {
  const startDate = normalizeDate(options.startDate);
  const endDate = normalizeDate(options.endDate);
  if (!startDate || !endDate || startDate > endDate) throw new Error("自动补数日期无效");
  if (Number(endDate) - Number(startDate) > 50000) throw new Error("单次组合回测请控制在约5年以内");
  const warmupStart = shiftDate(startDate, -Math.max(45, Number(options.warmupCalendarDays || 90)));
  const cacheDir = options.cacheDir || DEFAULT_CACHE_DIR;
  const status = {
    source: "东方财富 RPTA_WEB_KZZ_LS 历史截面",
    factor_cache_hits: 0,
    factor_cache_misses: 0,
    universe_cache: "unknown",
  };
  const [namesRows, factorChunks] = await Promise.all([
    loadNames(cacheDir, status),
    mapConcurrent(monthKeys(warmupStart, endDate), 2, (key) => loadFactorMonth(key, cacheDir, status)),
  ]);
  const names = Object.fromEntries(namesRows.map((row) => [row.code, row.name]));
  const factorRows = factorChunks.flat().map((row) => ({ ...row, code: normalizeCode(row.code) }))
    .filter((row) => row.code && row.date >= warmupStart && row.date <= endDate);
  const requestedRows = factorRows.filter((row) => row.date >= startDate);
  const requestedCodes = new Set(requestedRows.map((row) => row.code));
  const balanceCodes = new Set(factorRows.filter((row) => Number(row.remaining_balance_yuan) > 0).map((row) => row.code));
  return {
    factorRows,
    names,
    status: {
      ...status,
      warmup_start_date: warmupStart,
      requested_start_date: startDate,
      requested_end_date: endDate,
      factor_rows: factorRows.length,
      requested_rows: requestedRows.length,
      requested_codes: requestedCodes.size,
      historical_balance_codes: [...requestedCodes].filter((code) => balanceCodes.has(code)).length,
    },
  };
}

async function loadKline(code, startDate, endDate, cacheDir, status) {
  const safeCode = normalizeCode(code);
  if (!safeCode) return [];
  const file = path.join(cacheDir, "klines", `${safeCode.replace(".", "-")}-${startDate}-${endDate}.json`);
  const cached = await readCache(file, 7 * 24 * 60 * 60 * 1000);
  if (cached?.rows) {
    status.kline_cache_hits += 1;
    return cached.rows;
  }
  const [bare, market] = safeCode.split(".");
  const url = new URL(EASTMONEY_KLINE);
  const params = {
    secid: `${market === "SH" ? 1 : 0}.${bare}`,
    klt: 101,
    fqt: 0,
    beg: startDate,
    end: endDate,
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const payload = await requestJsonWithRetry(url);
  const rows = (payload?.data?.klines || []).map((line) => {
    const fields = String(line).split(",");
    return {
      date: normalizeDate(fields[0]),
      code: safeCode,
      open: Number(fields[1]),
      close: Number(fields[2]),
      high: Number(fields[3]),
      low: Number(fields[4]),
      volume: Number(fields[5]),
      amount: Number(fields[6]),
      suspend: 0,
      source: "东方财富历史日K自动补缺",
    };
  }).filter((row) => row.date && row.open > 0);
  await writeCache(file, { updated_at: new Date().toISOString(), rows });
  status.kline_cache_misses += 1;
  return rows;
}

async function loadEastmoneyOpenRows(codes, startDateValue, endDateValue, options = {}) {
  const startDate = normalizeDate(startDateValue);
  const endDate = normalizeDate(endDateValue);
  const cacheDir = options.cacheDir || DEFAULT_CACHE_DIR;
  const uniqueCodes = [...new Set((codes || []).map(normalizeCode).filter(Boolean))];
  const status = { kline_cache_hits: 0, kline_cache_misses: 0, failed_codes: [] };
  const chunks = await mapConcurrent(uniqueCodes, 6, async (code) => {
    try {
      return await loadKline(code, startDate, endDate, cacheDir, status);
    } catch (error) {
      status.failed_codes.push({ code, error: error.message });
      return [];
    }
  });
  return {
    rows: chunks.flat(),
    status: {
      ...status,
      requested_codes: uniqueCodes.length,
      returned_codes: chunks.filter((rows) => rows.length).length,
      returned_rows: chunks.flat().length,
    },
  };
}

module.exports = {
  DEFAULT_CACHE_DIR,
  loadEastmoneyOpenRows,
  loadPortfolioFactors,
  mapConcurrent,
  normalizeDate,
  shiftDate,
};
