const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const LOCAL_A_SHARE_LIST_PATH = path.join(ROOT, "data", "a-share-list.json");
const BOARD_STATE_PATH = path.join(ROOT, "data", "board-state.json");
const EASTMONEY_SEARCH_TOKEN = "D43BF722C8E33BD69D955A7E7361F5D9";
const EASTMONEY_TRENDS_TOKEN = "fa5fd1943c7b386f172d6893dbfba10b";
const EASTMONEY_SEARCH_TIMEOUT_MS = 2500;
const GLOBAL_INDEX_SPARK_CACHE_MS = 60_000;
const TDX_OPEN_ENABLED = process.env.TDX_OPEN_ENABLED !== "0";
const TDX_VM_NAME = process.env.TDX_VM_NAME || "Windows 11";
const TDX_PRLCTL_PATH = process.env.TDX_PRLCTL_PATH || "/usr/local/bin/prlctl";
const TDX_OPEN_TIMEOUT_MS = Number(process.env.TDX_OPEN_TIMEOUT_MS || 5000);
const MINIQMT_API_HOST = process.env.MINIQMT_API_HOST || "127.0.0.1";
const MINIQMT_API_PORT = Number(process.env.MINIQMT_API_PORT || 18890);
const MINIQMT_API_AUTOSTART = process.env.MINIQMT_API_AUTOSTART !== "0";
const MINIQMT_PYTHON =
  process.env.MINIQMT_PYTHON || "/Users/seasnake/miniconda3/bin/python3";
const MINIQMT_API_SCRIPT = path.join(ROOT, "scripts", "miniqmt-dashboard-api.py");
let miniqmtApiProcess = null;
const DOMESTIC_INDEXES = [
  { key: "sh000001", name: "上证指数", symbol: "sh000001", secid: "1.000001" },
  { key: "sz399006", name: "创业板指", symbol: "sz399006", secid: "0.399006" },
  { key: "sh000680", name: "科创综指", symbol: "sh000680", secid: "1.000680" },
  {
    key: "sh000832",
    group: "转债",
    name: "中证转债",
    symbol: "sh000832",
    secid: "1.000832",
    source: "tencent",
  },
];
const GLOBAL_INDEX_SYMBOLS = ["b_KOSPI", "b_NKY", "int_nikkei", "rt_hkHSTECH"];
const globalIndexSparkCache = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (url.pathname === "/api/quotes") {
      await handleQuotes(url, response);
      return;
    }

    if (url.pathname === "/api/indices") {
      await handleIndices(response);
      return;
    }

    if (url.pathname === "/api/auction") {
      await handleAuction(url, response);
      return;
    }

    if (url.pathname === "/api/open-tdx") {
      await handleOpenTdx(request, response);
      return;
    }

    if (url.pathname === "/api/miniqmt/health") {
      await handleMiniQmtApi("/health", response);
      return;
    }

    if (url.pathname === "/api/miniqmt/bond") {
      const query = new URLSearchParams();
      for (const key of ["code", "date"]) {
        const value = url.searchParams.get(key);
        if (value) query.set(key, value);
      }
      await handleMiniQmtApi(`/bond?${query}`, response);
      return;
    }

    if (url.pathname === "/api/miniqmt/events") {
      const query = new URLSearchParams();
      for (const key of ["scope", "after_id", "limit"]) {
        const value = url.searchParams.get(key);
        if (value) query.set(key, value);
      }
      await handleMiniQmtApi(`/events?${query}`, response);
      return;
    }

    if (url.pathname === "/api/sparks") {
      await handleSparks(url, response);
      return;
    }

    if (url.pathname === "/api/resolve") {
      await handleResolve(url, response);
      return;
    }

    if (url.pathname === "/api/search") {
      await handleSearch(url, response);
      return;
    }

    if (url.pathname === "/api/state") {
      await handleState(request, response);
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    console.error(
      `[500] ${request.method || "GET"} ${url.pathname}${url.search}: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
});

server.listen(PORT, () => {
  console.log(`Finance board running at http://localhost:${PORT}`);
  void ensureMiniQmtApi();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopMiniQmtApi();
    server.close(() => process.exit(0));
  });
}

async function handleQuotes(url, response) {
  const secids = (url.searchParams.get("secids") || "")
    .split(",")
    .map((value) => value.trim())
    .map(normalizeSecidInput)
    .filter(Boolean);

  if (secids.length === 0) {
    sendJson(response, 400, { error: "missing secids" });
    return;
  }

  const quotes = [];
  const failedGroups = [];
  for (const group of chunk(secids, 80)) {
    try {
      const rows = await fetchSinaQuotes(group);
      quotes.push(...rows);
    } catch (error) {
      failedGroups.push(group);
      console.warn(
        `Sina quote batch failed (${group.length} secids, first ${group[0]}): ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  sendJson(response, 200, {
    source: "新浪实时",
    time: new Date().toISOString(),
    quotes,
    failedGroups: failedGroups.length,
  });
}

async function handleIndices(response) {
  const indices = await fetchSinaGlobalIndices();

  sendJson(response, 200, {
    source: "新浪实时",
    time: new Date().toISOString(),
    indices,
  });
}

async function handleAuction(url, response) {
  const secids = Array.from(
    new Set(
      (url.searchParams.get("secids") || "")
        .split(",")
        .map((value) => value.trim())
        .map(normalizeSecidInput)
        .filter((secid) => /^[01]\.\d{6}$/.test(secid)),
    ),
  );

  if (secids.length === 0) {
    sendJson(response, 400, { error: "missing secids" });
    return;
  }

  const limitedSecids = secids.slice(0, 120);
  let source = "通达信价量";
  let results;
  try {
    results = await fetchTdxAuctionBatch(limitedSecids);
  } catch (error) {
    source = "东方财富分时竞价";
    console.warn(
      `Tdx auction batch failed, using Eastmoney fallback: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    results = await fetchEastmoneyAuctionBatch(limitedSecids);
  }

  const auctions = results.filter((item) => !item.error);
  const failed = results.filter((item) => item.error);

  sendJson(response, 200, {
    source,
    time: new Date().toISOString(),
    requested: secids.length,
    returned: limitedSecids.length,
    truncated: secids.length > limitedSecids.length,
    auctions,
    failed,
  });
}

async function handleOpenTdx(request, response) {
  if (request.method !== "POST") {
    response.writeHead(405, {
      "Content-Type": "text/plain; charset=utf-8",
      Allow: "POST",
    });
    response.end("Method not allowed");
    return;
  }

  if (!TDX_OPEN_ENABLED) {
    sendJson(response, 503, { error: "通达信跳转未启用" });
    return;
  }

  const body = await readJsonBody(request, 8 * 1024);
  const code = normalizeTdxOpenCode(body?.code || body?.secid);
  if (!code) {
    sendJson(response, 400, { error: "通达信跳转仅支持 6 位 A股/ETF/转债代码" });
    return;
  }

  const result = await openTdxCode(code);
  sendJson(response, 200, {
    ok: true,
    code,
    vm: TDX_VM_NAME,
    result,
  });
}

async function handleMiniQmtApi(pathname, response) {
  try {
    const payload = await fetchLocalJson(pathname, 12_000);
    sendJson(response, 200, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "MiniQMT API unavailable";
    const status = /\bHTTP 4\d\d\b/.test(message) ? Number(message.match(/HTTP (\d+)/)?.[1]) : 503;
    sendJson(response, status, {
      error: message,
      service: "miniqmt-dashboard",
    });
  }
}

async function ensureMiniQmtApi() {
  if (!MINIQMT_API_AUTOSTART) return;
  try {
    await fetchLocalJson("/health", 1200);
    console.log(`MiniQMT dashboard API already available on ${MINIQMT_API_HOST}:${MINIQMT_API_PORT}`);
    return;
  } catch {
    // The read-only helper is started below.
  }
  if (miniqmtApiProcess || !fs.existsSync(MINIQMT_API_SCRIPT)) return;
  miniqmtApiProcess = spawn(
    MINIQMT_PYTHON,
    [MINIQMT_API_SCRIPT, "--host", MINIQMT_API_HOST, "--port", String(MINIQMT_API_PORT)],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        NO_PROXY: mergeNoProxy(process.env.NO_PROXY),
        no_proxy: mergeNoProxy(process.env.no_proxy),
      },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  miniqmtApiProcess.once("error", (error) => {
    console.warn(`MiniQMT dashboard API failed to start: ${error.message}`);
    miniqmtApiProcess = null;
  });
  miniqmtApiProcess.once("exit", (code, signal) => {
    if (code && code !== 0) {
      console.warn(`MiniQMT dashboard API exited: code=${code} signal=${signal || ""}`);
    }
    miniqmtApiProcess = null;
  });
}

function stopMiniQmtApi() {
  if (!miniqmtApiProcess || miniqmtApiProcess.killed) return;
  miniqmtApiProcess.kill("SIGTERM");
  miniqmtApiProcess = null;
}

function mergeNoProxy(value) {
  const entries = new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  for (const item of ["127.0.0.1", "localhost", "::1"]) entries.add(item);
  return [...entries].join(",");
}

function fetchLocalJson(pathname, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: MINIQMT_API_HOST,
        port: MINIQMT_API_PORT,
        path: pathname,
        timeout,
        headers: { Accept: "application/json" },
      },
      (result) => {
        const chunks = [];
        result.on("data", (chunk) => chunks.push(chunk));
        result.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let payload;
          try {
            payload = raw ? JSON.parse(raw) : {};
          } catch {
            reject(new Error("MiniQMT API returned invalid JSON"));
            return;
          }
          if (result.statusCode && result.statusCode >= 400) {
            reject(new Error(`HTTP ${result.statusCode}: ${payload?.error || "MiniQMT API error"}`));
            return;
          }
          resolve(payload);
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("MiniQMT API timeout")));
    request.on("error", reject);
  });
}

async function handleSparks(url, response) {
  const secids = Array.from(
    new Set(
      (url.searchParams.get("secids") || "")
        .split(",")
        .map((value) => value.trim())
        .map(normalizeSecidInput)
        .filter(Boolean),
    ),
  );

  if (secids.length === 0) {
    sendJson(response, 400, { error: "missing secids" });
    return;
  }

  const sparks = await mapWithConcurrency(secids, 8, async (secid) => {
    try {
      return await fetchSecuritySparkline(secid);
    } catch {
      return null;
    }
  });

  sendJson(response, 200, {
    source: "腾讯今日分时优先",
    time: new Date().toISOString(),
    sparks: sparks.filter(Boolean),
  });
}

async function handleResolve(url, response) {
  const name = (url.searchParams.get("name") || "").trim();
  if (!name) {
    sendJson(response, 400, { error: "missing name" });
    return;
  }

  const stock = await resolveStock(name);
  if (!stock) {
    sendJson(response, 404, { error: `未找到股票：${name}` });
    return;
  }

  sendJson(response, 200, stock);
}

async function handleSearch(url, response) {
  const query = (url.searchParams.get("q") || "").trim();
  if (!query) {
    sendJson(response, 200, { results: [] });
    return;
  }

  const results = await searchStocks(query, 12);
  sendJson(response, 200, { results });
}

async function handleState(request, response) {
  if (request.method === "GET") {
    try {
      const raw = await fs.promises.readFile(BOARD_STATE_PATH, "utf8");
      sendJson(response, 200, { exists: true, ...JSON.parse(raw) });
    } catch (error) {
      if (error?.code === "ENOENT") {
        sendJson(response, 200, { exists: false });
        return;
      }
      throw error;
    }
    return;
  }

  if (request.method === "POST") {
    const body = await readJsonBody(request);
    const currentState = await readBoardStateFile().catch(() => null);
    if (
      currentState?.updatedAt &&
      (!body?.baseUpdatedAt || body.baseUpdatedAt !== currentState.updatedAt)
    ) {
      sendJson(response, 409, {
        error: "页面数据已过期，请刷新后再编辑",
        updatedAt: currentState.updatedAt,
      });
      return;
    }

    const state = normalizeBoardState(body);
    await fs.promises.mkdir(path.dirname(BOARD_STATE_PATH), { recursive: true });
    const temporaryPath = `${BOARD_STATE_PATH}.tmp`;
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
    await fs.promises.rename(temporaryPath, BOARD_STATE_PATH);
    sendJson(response, 200, {
      ok: true,
      updatedAt: state.updatedAt,
      sectorCount: state.sectors.length,
      stockCount: state.sectors.reduce((total, sector) => total + sector.stocks.length, 0),
      stackCount: state.stackGroups.length,
    });
    return;
  }

  response.writeHead(405, {
    "Content-Type": "text/plain; charset=utf-8",
    Allow: "GET, POST",
  });
  response.end("Method not allowed");
}

async function readBoardStateFile() {
  return JSON.parse(await fs.promises.readFile(BOARD_STATE_PATH, "utf8"));
}

async function fetchSinaQuotes(secids) {
  return new Promise((resolve, reject) => {
    const symbolBySecid = new Map(secids.map((secid) => [secid, secidToSinaSymbol(secid)]));
    const secidBySymbol = new Map([...symbolBySecid].map(([secid, symbol]) => [symbol, secid]));
    fetchSinaRaw([...symbolBySecid.values()])
      .then((raw) => resolve(parseSinaResponse(raw, secidBySymbol)))
      .catch(reject);
  });
}

function fetchSinaRaw(symbols) {
  return fetchText(
    {
      hostname: "hq.sinajs.cn",
      path: `/list=${symbols.join(",")}`,
      headers: {
        Referer: "https://finance.sina.com.cn/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      },
      timeout: 8000,
    },
    "latin1",
  );
}

function parseSinaResponse(raw, secidBySymbol) {
  const quotes = [];
  const regex = /var hq_str_([a-z0-9_]+)="([^"]*)";/g;
  let match;

  while ((match = regex.exec(raw))) {
    const symbol = match[1];
    const secid = secidBySymbol.get(symbol);
    if (!secid) continue;

    const parts = match[2].split(",");
    if (isHongKongSecid(secid)) {
      const price = Number(parts[6]);
      const change = Number(parts[8]);
      if (!Number.isFinite(price) || !Number.isFinite(change)) continue;

      quotes.push({
        secid,
        price,
        change,
        amount: Number(parts[11]) || 0,
        date: String(parts[17] || "").replaceAll("/", "-"),
        time: parts[18] || "",
      });
      continue;
    }

    const previousClose = Number(parts[2]);
    const current = Number(parts[3]);
    const price = Number.isFinite(current) && current > 0 ? current : previousClose;
    const change =
      Number.isFinite(price) && Number.isFinite(previousClose) && previousClose > 0
        ? ((price - previousClose) / previousClose) * 100
        : 0;

    quotes.push({
      secid,
      price,
      change,
      amount: Number(parts[9]) || 0,
      date: parts[30] || "",
      time: parts[31] || "",
      previousClose,
    });
  }

  if (quotes.length === 0) {
    throw new Error("Sina quote response is empty");
  }

  return quotes;
}

async function fetchSinaGlobalIndices() {
  const sinaDomesticIndexes = DOMESTIC_INDEXES.filter((item) => item.source !== "tencent");
  const tencentDomesticIndexes = DOMESTIC_INDEXES.filter((item) => item.source === "tencent");
  const raw = await fetchSinaRaw([
    ...sinaDomesticIndexes.map((item) => item.symbol),
    ...GLOBAL_INDEX_SYMBOLS,
  ]);
  const rows = parseSinaVars(raw);
  const sinaDomestic = await Promise.all(
    sinaDomesticIndexes.map(async (config) => {
      const quote = parseSinaDomesticIndex(rows.get(config.symbol), config);
      if (!quote) return null;

      try {
        const spark = await withTimeout(fetchTencentMinuteSparkline(config.symbol, 90), 2500);
        return {
          ...quote,
          points: spark.points,
          sparkChange: spark.change,
          sparkTime: spark.time,
          sparkSource: "腾讯分时",
        };
      } catch {
        try {
          const spark = await withTimeout(fetchSinaSparkline(config.secid, 90), 2500);
          return {
            ...quote,
            points: spark.points,
            sparkChange: spark.change,
            sparkTime: spark.time,
            sparkSource: "新浪5分钟K线",
          };
        } catch {
          return quote;
        }
      }
    }),
  );
  const tencentDomestic = await Promise.all(
    tencentDomesticIndexes.map((config) => fetchTencentIndex(config).catch(() => null)),
  );

  const indices = [...sinaDomestic, ...tencentDomestic].filter(Boolean);

  const kospi = rows.get("b_KOSPI");
  if (kospi) {
    const parts = kospi.split(",");
    const price = Number(parts[1]);
    const change = Number(parts[2]);
    const percent = Number(parts[3]);
    if ([price, change, percent].every(Number.isFinite)) {
      const quote = {
        key: "kospi",
        name: "韩国KOSPI",
        price,
        change,
        percent,
      };
      indices.push(
        await withGlobalIndexSparkline(quote, {
          yahooSymbol: "^KS11",
          eastmoneySecid: "100.KS11",
        }).catch(() => quote),
      );
    }
  }

  const nikkei = rows.get("b_NKY") || rows.get("int_nikkei");
  if (nikkei) {
    const parts = nikkei.split(",");
    const price = Number(parts[1]);
    const change = Number(parts[2]);
    const percent = Number(parts[3]);
    if ([price, change, percent].every(Number.isFinite)) {
      const quote = {
        key: "nikkei",
        name: "日经225",
        price,
        change,
        percent,
      };
      indices.push(
        await withGlobalIndexSparkline(quote, {
          yahooSymbol: "^N225",
          eastmoneySecid: "100.N225",
        }).catch(() => quote),
      );
    }
  }

  const hstech = rows.get("rt_hkHSTECH");
  if (hstech) {
    const parts = hstech.split(",");
    const price = Number(parts[6]);
    const change = Number(parts[7]);
    const percent = Number(parts[8]);
    if ([price, change, percent].every(Number.isFinite)) {
      const quote = {
        key: "hstech",
        name: "恒生科技",
        price,
        change,
        percent,
      };
      try {
        const spark = await withTimeout(fetchTencentMinuteSparkline("hkHSTECH", 90), 2500);
        indices.push({
          ...quote,
          points: spark.points,
          sparkChange: spark.change,
          sparkTime: spark.time,
          sparkSource: "腾讯分时",
        });
      } catch {
        try {
          const spark = await withTimeout(fetchYahooChartSparkline("HSTECH.HK", 90, "Yahoo分时"), 3000);
          indices.push({
            ...quote,
            points: spark.points,
            sparkChange: spark.change,
            sparkTime: spark.time,
            sparkSource: spark.source,
          });
        } catch {
          indices.push(quote);
        }
      }
    }
  }

  return indices;
}

function parseSinaDomesticIndex(raw, config) {
  if (!raw) return null;

  const parts = raw.split(",");
  const previousClose = Number(parts[2]);
  const current = Number(parts[3]);
  const price = Number.isFinite(current) && current > 0 ? current : previousClose;
  const change =
    Number.isFinite(price) && Number.isFinite(previousClose) ? price - previousClose : 0;
  const percent =
    Number.isFinite(change) && Number.isFinite(previousClose) && previousClose > 0
      ? (change / previousClose) * 100
      : 0;

  if (!Number.isFinite(price)) return null;

  return {
    key: config.key,
    group: config.group || "A股",
    name: config.name,
    price,
    change,
    percent,
    secid: config.secid,
    time: `${parts[30] || ""} ${parts[31] || ""}`.trim(),
  };
}

async function fetchTencentIndex(config) {
  const raw = await fetchText({
    hostname: "qt.gtimg.cn",
    path: `/q=${encodeURIComponent(config.symbol)}`,
    headers: {
      Referer: "https://gu.qq.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    },
    timeout: 8000,
  });
  const quote = parseTencentIndex(raw, config);
  if (!quote) return null;

  try {
    const spark = await withTimeout(fetchTencentMinuteSparkline(config.symbol, 90), 2500);
    return {
      ...quote,
      points: spark.points,
      sparkChange: spark.change,
      sparkTime: spark.time,
      sparkSource: "腾讯分时",
    };
  } catch {
    return quote;
  }
}

function parseTencentIndex(raw, config) {
  const body = raw.match(/="([^"]*)"/)?.[1];
  if (!body) return null;

  const parts = body.split("~");
  const price = Number(parts[3]);
  const change = Number(parts[31]);
  const percent = Number(parts[32]);
  if (![price, change, percent].every(Number.isFinite)) return null;

  return {
    key: config.key,
    group: config.group || "A股",
    name: config.name || parts[1],
    price,
    change,
    percent,
    secid: config.secid,
    time: parts[30] || "",
  };
}

async function withGlobalIndexSparkline(quote, config) {
  let spark;
  try {
    spark = await withTimeout(fetchCachedYahooIndexSparkline(config.yahooSymbol, 90), 3000);
  } catch {
    spark = await withTimeout(fetchEastmoneyMinuteSparkline(config.eastmoneySecid, 90), 3000);
  }

  return {
    ...quote,
    points: spark.points,
    sparkChange: spark.change,
    sparkTime: spark.time,
    sparkSource: spark.source,
  };
}

async function fetchCachedYahooIndexSparkline(symbol, limit = 90) {
  const key = `${symbol}:${limit}`;
  const cached = globalIndexSparkCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < GLOBAL_INDEX_SPARK_CACHE_MS) {
    return cached.spark;
  }

  const spark = await fetchYahooIndexSparkline(symbol, limit);
  globalIndexSparkCache.set(key, {
    fetchedAt: Date.now(),
    spark,
  });
  return spark;
}

async function fetchYahooIndexSparkline(symbol, limit = 90) {
  return fetchYahooChartSparkline(symbol, limit, "Yahoo分时");
}

async function fetchYahooHongKongSparkline(secid, limit = 58) {
  const code = secid.split(".")[1];
  if (!code) {
    throw new Error(`invalid hong kong secid: ${secid}`);
  }

  const yahooCode = code.replace(/^0+/, "") || code;
  const spark = await fetchYahooChartSparkline(`${yahooCode}.HK`, limit, "Yahoo港股分时");
  return {
    ...spark,
    secid,
  };
}

async function fetchYahooChartSparkline(symbol, limit, source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch(
      "https://query2.finance.yahoo.com" +
        `/v8/finance/chart/${encodeURIComponent(symbol)}` +
        "?range=1d&interval=1m&includePrePost=false",
      {
        headers: {
          accept: "application/json,text/plain,*/*",
          "user-agent": "Mozilla/5.0",
        },
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`Yahoo index sparkline HTTP ${response.status}: ${symbol}`);
  }

  const result = (await response.json())?.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) {
    throw new Error(`empty yahoo index sparkline: ${symbol}`);
  }

  const points = downsample(
    closes.filter((value) => Number.isFinite(value) && value > 0),
    limit,
  );
  if (points.length < 2) {
    throw new Error(`invalid yahoo index sparkline: ${symbol}`);
  }

  const first = points[0];
  const last = points[points.length - 1];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const lastTimestamp = timestamps[timestamps.length - 1];

  return {
    points,
    change: first ? ((last - first) / first) * 100 : 0,
    time: formatUnixTime(lastTimestamp, result?.meta?.exchangeTimezoneName),
    source,
  };
}

function formatUnixTime(seconds, timeZone) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timeZone || "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value * 1000));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.hour || ""}:${map.minute || ""}`;
}

async function fetchTencentMinuteAmounts(symbol) {
  const raw = await fetchText({
    hostname: "ifzq.gtimg.cn",
    path: `/appstock/app/minute/query?code=${encodeURIComponent(symbol)}`,
    headers: {
      Referer: "https://gu.qq.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    },
    timeout: 10000,
  });
  const json = JSON.parse(raw);
  const dataNode = json?.data?.[symbol]?.data;
  const date = dateKeyFromCompactDate(dataNode?.date);
  const data = dataNode?.data;
  if (!Array.isArray(data)) return [];

  return data
    .map((line) => {
      const [time, price, volume, amount] = String(line).trim().split(/\s+/);
      return {
        date,
        time,
        price: Number(price),
        volume: Number(volume),
        amount: Number(amount),
      };
    })
    .filter((item) => item.time && Number.isFinite(item.amount));
}

async function fetchTencentMinuteSparkline(symbol, limit = 58) {
  const rows = await fetchTencentMinuteAmounts(symbol);
  const points = downsample(
    rows.map((item) => item.price).filter((value) => Number.isFinite(value) && value > 0),
    limit,
  );
  if (points.length < 2) {
    throw new Error(`empty tencent sparkline: ${symbol}`);
  }

  const first = points[0];
  const last = points[points.length - 1];
  return {
    points,
    change: first ? ((last - first) / first) * 100 : 0,
    date: rows[rows.length - 1]?.date || currentChinaDateKey(),
    time: rows[rows.length - 1]?.time || "",
  };
}

async function fetchSecuritySparkline(secid) {
  const symbol = secidToTencentSymbol(secid);
  try {
    const spark = await fetchTencentMinuteSparkline(symbol);
    return {
      ...spark,
      secid,
      source: "腾讯分时",
    };
  } catch {
    if (isHongKongSecid(secid)) {
      try {
        return await fetchYahooHongKongSparkline(secid);
      } catch {
        // Continue through the existing mainland fallback chain.
      }
    }

    try {
      return await fetchEastmoneyMinuteSparkline(secid);
    } catch {
      return fetchSinaSparkline(secid);
    }
  }
}

function smoothedAverage(values, period, weight) {
  const result = [];
  let previous = values[0];

  for (const value of values) {
    previous = (weight * value + (period - weight) * previous) / period;
    result.push(previous);
  }

  return result;
}

function parseSinaVars(raw) {
  const rows = new Map();
  const regex = /var hq_str_([A-Za-z0-9_]+)="([^"]*)";/g;
  let match;

  while ((match = regex.exec(raw))) {
    rows.set(match[1], match[2]);
  }

  return rows;
}

async function fetchSinaSparkline(secid, limit = 58) {
  const symbol = secidToSinaSymbol(secid);
  const raw = await fetchText({
    hostname: "money.finance.sina.com.cn",
    path:
      "/quotes_service/api/json_v2.php/CN_MarketData.getKLineData" +
      `?symbol=${encodeURIComponent(symbol)}&scale=5&ma=no&datalen=48`,
    headers: {
      Referer: "https://finance.sina.com.cn/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    },
    timeout: 10000,
  });
  const json = JSON.parse(raw);

  if (!Array.isArray(json) || json.length < 2) {
    throw new Error(`empty sparkline: ${secid}`);
  }

  const latestRows = latestDatedRows(json, (row) => dateKeyFromDateTime(row?.day));
  if (latestRows.length < 2) {
    throw new Error(`empty latest-day sparkline: ${secid}`);
  }

  const points = downsample(
    latestRows
      .map((row) => Number(row?.close))
      .filter((value) => Number.isFinite(value) && value > 0),
    limit,
  );

  if (points.length < 2) {
    throw new Error(`invalid sparkline: ${secid}`);
  }

  const first = points[0];
  const last = points[points.length - 1];

  return {
    secid,
    points,
    change: first ? ((last - first) / first) * 100 : 0,
    date: dateKeyFromDateTime(latestRows[latestRows.length - 1]?.day),
    time: latestRows[latestRows.length - 1]?.day || "",
    source: "新浪5分钟K线",
  };
}

async function fetchEastmoneyMinuteSparkline(secid, limit = 58) {
  const raw = await fetchText({
    hostname: "push2his.eastmoney.com",
    path: eastmoneyTrendsPath(secid),
    headers: {
      Referer: "https://quote.eastmoney.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    },
    timeout: 10000,
  });
  const trends = JSON.parse(raw)?.data?.trends;
  if (!Array.isArray(trends) || trends.length < 2) {
    throw new Error(`empty eastmoney sparkline: ${secid}`);
  }

  const latestTrends = latestDatedRows(trends, (line) => dateKeyFromDateTime(String(line).split(",")[0]));
  if (latestTrends.length < 2) {
    throw new Error(`empty latest-day eastmoney sparkline: ${secid}`);
  }

  const points = downsample(
    latestTrends
      .map((line) => Number(String(line).split(",")[2]))
      .filter((value) => Number.isFinite(value) && value > 0),
    limit,
  );
  if (points.length < 2) {
    throw new Error(`invalid eastmoney sparkline: ${secid}`);
  }

  const first = points[0];
  const last = points[points.length - 1];
  return {
    secid,
    points,
    change: first ? ((last - first) / first) * 100 : 0,
    date: dateKeyFromDateTime(String(latestTrends[latestTrends.length - 1] || "").split(",")[0]),
    time: String(latestTrends[latestTrends.length - 1] || "").split(",")[0] || "",
    source: "东方财富分时",
  };
}

async function fetchEastmoneyAuction(secid) {
  const raw = await fetchText({
    hostname: "push2his.eastmoney.com",
    path: eastmoneyTrendsPath(secid),
    headers: {
      Referer: "https://quote.eastmoney.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    },
    timeout: 10000,
  });
  const data = JSON.parse(raw)?.data;
  const trends = data?.trends;
  if (!Array.isArray(trends) || trends.length === 0) {
    throw new Error(`empty eastmoney auction: ${secid}`);
  }

  const latestTrends = latestDatedRows(trends, (line) => dateKeyFromDateTime(String(line).split(",")[0]));
  const rows = latestTrends.map(parseEastmoneyTrendLine).filter((row) => isAuctionMinute(row.time));
  if (rows.length === 0) {
    throw new Error(`empty auction rows: ${secid}`);
  }

  const latest = rows
    .filter((row) => Number.isFinite(row.price) && row.price > 0)
    .at(-1);
  const previousClose = Number(data?.preClose || data?.prePrice);
  const change =
    latest && Number.isFinite(previousClose) && previousClose > 0
      ? ((latest.price - previousClose) / previousClose) * 100
      : 0;

  return {
    secid,
    code: data?.code || secid.split(".")[1],
    name: data?.name || "",
    date: rows[rows.length - 1]?.date || "",
    previousClose: Number.isFinite(previousClose) ? previousClose : null,
    latest: latest
      ? {
          time: latest.time,
          price: latest.price,
          change,
        }
      : null,
    rows,
  };
}

async function fetchEastmoneyAuctionBatch(secids) {
  return mapWithConcurrency(secids, 8, async (secid) => {
    try {
      return await fetchEastmoneyAuction(secid);
    } catch (error) {
      return {
        secid,
        error: error instanceof Error ? error.message : "unknown error",
      };
    }
  });
}

async function fetchTdxAuctionBatch(secids) {
  const stockList = secids.map(secidToTdxStockCode);
  const psStockList = stockList.map((code) => `'${code}'`).join(",");
  const script = [
    `$body = @{ id=1; method='get_pricevol'; params=@{ stock_list=@(${psStockList}) } } | ConvertTo-Json -Depth 6`,
    "$result = Invoke-RestMethod -Uri 'http://127.0.0.1:17709/' -Method Post -ContentType 'application/json' -Body $body",
    "$result | ConvertTo-Json -Depth 10",
  ].join("; ");
  const { stdout } = await execFileAsync(
    TDX_PRLCTL_PATH,
    ["exec", TDX_VM_NAME, "--current-user", "powershell", "-NoProfile", "-Command", script],
    {
      timeout: Number.isFinite(TDX_OPEN_TIMEOUT_MS) ? Math.max(TDX_OPEN_TIMEOUT_MS, 8000) : 8000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );

  const result = parseLastJsonObject(stdout);
  const errorId = String(result?.result?.ErrorId ?? result?.ErrorId ?? "");
  if (errorId && errorId !== "0") {
    throw new Error(`通达信返回错误：${errorId}`);
  }

  const values = result?.result?.Value || result?.Value;
  if (!values || typeof values !== "object") {
    throw new Error("通达信价量返回为空");
  }

  const { date, time } = currentChinaDateTimeParts();
  return secids.map((secid, index) => {
    const tdxCode = stockList[index];
    const row = values[tdxCode];
    if (!row) {
      return {
        secid,
        error: `missing tdx pricevol: ${tdxCode}`,
      };
    }

    const previousClose = Number(row.LastClose);
    const now = Number(row.Now);
    const price = Number.isFinite(now) && now > 0 ? now : previousClose;
    const change =
      Number.isFinite(price) && Number.isFinite(previousClose) && previousClose > 0
        ? ((price - previousClose) / previousClose) * 100
        : 0;
    const volume = Number(row.Volume);
    const latest = {
      time,
      price,
      change,
      volume: Number.isFinite(volume) ? volume : 0,
    };

    return {
      secid,
      code: secid.split(".")[1],
      tdxCode,
      date,
      previousClose: Number.isFinite(previousClose) ? previousClose : null,
      latest,
      rows: [latest],
    };
  });
}

function eastmoneyTrendsPath(secid) {
  return (
    "/api/qt/stock/trends2/get" +
    "?fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13" +
    "&fields2=f51,f52,f53,f54,f55,f56,f57,f58" +
    `&ut=${EASTMONEY_TRENDS_TOKEN}` +
    "&ndays=1" +
    `&secid=${encodeURIComponent(secid)}`
  );
}

function parseEastmoneyTrendLine(line) {
  const [dateTime, open, close, high, low, volume, amount, average] = String(line).split(",");
  const [date, time] = String(dateTime || "").trim().split(/\s+/);
  return {
    date: date || "",
    time: time || "",
    open: Number(open),
    price: Number(close),
    high: Number(high),
    low: Number(low),
    volume: Number(volume),
    amount: Number(amount),
    average: Number(average),
  };
}

function isAuctionMinute(time) {
  return typeof time === "string" && time >= "09:15" && time <= "09:25";
}

function secidToTdxStockCode(secid) {
  const [market, code] = String(secid || "").split(".");
  if (!code) return secid;
  if (/^[89]/.test(code)) return `${code}.BJ`;
  if (market === "1") return `${code}.SH`;
  return `${code}.SZ`;
}

function currentChinaDateTimeParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}:${map.second}`,
  };
}

function normalizeTdxOpenCode(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const secid = normalizeSecidInput(text);
  const code = /^[01]\.\d{6}$/.test(secid) ? secid.split(".")[1] : text.replace(/^(sh|sz|bj)/i, "");
  return /^\d{6}$/.test(code) ? code : "";
}

async function openTdxCode(code) {
  const url = `http://www.treeid/code_${code}`;
  const script = [
    `$body = @{ id=1; method='exec_to_tdx'; params=@{ url='${url}' } } | ConvertTo-Json -Depth 5`,
    "$result = Invoke-RestMethod -Uri 'http://127.0.0.1:17709/' -Method Post -ContentType 'application/json' -Body $body",
    "$result | ConvertTo-Json -Depth 8",
  ].join("; ");

  const { stdout } = await execFileAsync(
    TDX_PRLCTL_PATH,
    ["exec", TDX_VM_NAME, "--current-user", "powershell", "-NoProfile", "-Command", script],
    {
      timeout: Number.isFinite(TDX_OPEN_TIMEOUT_MS) ? TDX_OPEN_TIMEOUT_MS : 5000,
      maxBuffer: 1024 * 1024,
    },
  );
  const result = parseLastJsonObject(stdout);
  const errorId = String(result?.result?.ErrorId ?? result?.ErrorId ?? "");
  if (errorId && errorId !== "0") {
    throw new Error(`通达信返回错误：${errorId}`);
  }
  return result;
}

function execFileAsync(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message || "").trim();
        reject(new Error(detail || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseLastJsonObject(output) {
  const text = String(output || "").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return {};
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return {};
    }
  }
}

function latestDatedRows(rows, getDateKey) {
  const datedRows = rows
    .map((row) => ({ row, date: getDateKey(row) }))
    .filter((item) => item.date);
  if (datedRows.length === 0) return rows;

  const latestDate = datedRows.reduce(
    (latest, item) => (item.date > latest ? item.date : latest),
    datedRows[0].date,
  );
  return datedRows.filter((item) => item.date === latestDate).map((item) => item.row);
}

function dateKeyFromDateTime(value) {
  const match = String(value || "").match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function dateKeyFromCompactDate(value) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function currentChinaDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function downsample(values, limit) {
  if (values.length <= limit) return values;
  if (limit < 4) return [values[0], values[values.length - 1]].slice(0, limit);

  const sampled = [values[0]];
  const bucketCount = Math.max(1, Math.floor((limit - 2) / 2));
  const bucketSize = (values.length - 2) / bucketCount;

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = 1 + Math.floor(bucket * bucketSize);
    const end = Math.min(values.length - 1, 1 + Math.floor((bucket + 1) * bucketSize));
    if (start >= end) continue;

    let minIndex = start;
    let maxIndex = start;
    for (let index = start + 1; index < end; index += 1) {
      if (values[index] < values[minIndex]) minIndex = index;
      if (values[index] > values[maxIndex]) maxIndex = index;
    }

    if (minIndex === maxIndex) {
      sampled.push(values[minIndex]);
    } else if (minIndex < maxIndex) {
      sampled.push(values[minIndex], values[maxIndex]);
    } else {
      sampled.push(values[maxIndex], values[minIndex]);
    }
  }

  sampled.push(values[values.length - 1]);
  while (sampled.length > limit) {
    sampled.splice(sampled.length - 2, 1);
  }

  return sampled;
}

async function resolveStock(name) {
  const query = String(name || "").trim();
  const localExact = searchLocalStocks(query, 20).find(
    (item) => item.name === query || item.code === codeFromInput(query),
  );
  if (localExact) return localExact;

  const searchTerms = Array.from(new Set([query, codeFromInput(query)].filter(Boolean)));
  let fallbackCandidate = null;
  for (const term of searchTerms) {
    const candidates = await searchStocks(term, 20);
    fallbackCandidate ||= candidates[0] || null;
    const exact =
      candidates.find((item) => item.name === query || item.code === codeFromInput(query)) ||
      candidates.find((item) => item.name.includes(query) || query.includes(item.name));
    if (exact) return exact;
  }

  const directCodeStock = await resolveSinaCode(query);
  return directCodeStock || fallbackCandidate;
}

async function searchStocks(keyword, limit = 10) {
  const codeNeedle = codeFromInput(keyword);
  if (/^hk/i.test(String(keyword).trim()) || /^\d{5}$/.test(codeNeedle)) {
    const remoteResults = await fetchRemoteSearchStocks(codeNeedle || keyword, limit);
    const hongKongResults = remoteResults.filter((item) => item.type === "HKStock");
    if (hongKongResults.length > 0) return hongKongResults;
  }

  const localResults = searchLocalStocks(keyword, limit);
  if (localResults.length > 0) return localResults;

  return fetchRemoteSearchStocks(keyword, limit);
}

async function fetchRemoteSearchStocks(keyword, limit) {
  try {
    const raw = await fetchText({
      hostname: "searchapi.eastmoney.com",
      path:
        `/api/suggest/get?input=${encodeURIComponent(keyword)}` +
        `&type=14&token=${EASTMONEY_SEARCH_TOKEN}`,
      headers: {
        Referer: "https://quote.eastmoney.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      },
      timeout: EASTMONEY_SEARCH_TIMEOUT_MS,
    });
    const rows = JSON.parse(raw)?.QuotationCodeTable?.Data;
    return Array.isArray(rows) ? rows.map(normalizeSearchResult).filter(Boolean).slice(0, limit) : [];
  } catch (error) {
    console.warn("Eastmoney search failed.", error.message);
    return [];
  }
}

async function resolveSinaCode(input) {
  const secid = normalizeSecidInput(input);
  if (!isSupportedSecid(secid)) return null;

  try {
    const raw = await fetchSinaRaw([secidToSinaSymbol(secid)]);
    const match = raw.match(/var hq_str_[a-z0-9_]+="([^"]*)";/);
    const parts = match?.[1]?.split(",") || [];
    const name = (isHongKongSecid(secid) ? parts[0] : parts[0])?.trim();
    const code = secid.split(".")[1];
    if (!name || name === "FAILED") return null;

    return {
      name,
      code,
      secid,
      market: marketNameForSecid(secid),
      type: typeForSecid(secid),
    };
  } catch {
    return null;
  }
}

function normalizeSearchResult(row) {
  const code = String(row?.Code || "").trim();
  const name = String(row?.Name || "").trim();
  const secid = normalizeSecidInput(row?.QuoteID);
  const classify = String(row?.Classify || "");
  const market = String(row?.SecurityTypeName || "");
  if (!code || !name || !isSupportedSecid(secid)) return null;

  const isBond = classify === "Bond" || market.includes("债") || isConvertibleBondCode(code);
  const isFund = classify === "Fund" || /基金|ETF|LOF/.test(market) || /ETF|LOF|基金/.test(name);
  const isHK = classify === "HK" || market.includes("港股") || isHongKongSecid(secid);
  const isAStock =
    classify === "AStock" || /沪A|深A|京A|科创板|创业板|北交所|A股/.test(market);
  if (!isBond && !isFund && !isHK && !isAStock) return null;

  return {
    name,
    code,
    secid,
    market,
    type: isBond ? "Bond" : isHK ? "HKStock" : isFund ? "Fund" : "AStock",
  };
}

let localSearchIndex = null;

function searchLocalStocks(keyword, limit) {
  const needle = String(keyword || "").trim().toLowerCase();
  if (!needle) return [];
  const codeNeedle = codeFromInput(needle);

  return getLocalSearchIndex()
    .filter(
      (stock) =>
        stock.name.toLowerCase().includes(needle) || (codeNeedle && stock.code.includes(codeNeedle)),
    )
    .sort((left, right) => {
      return searchRank(left, keyword, codeNeedle) - searchRank(right, keyword, codeNeedle);
    })
    .slice(0, limit);
}

function searchRank(stock, keyword, codeNeedle) {
  const query = String(keyword || "").trim().toLowerCase();
  const name = stock.name.toLowerCase();
  if (stock.code === codeNeedle || name === query) return 0;
  if ((codeNeedle && stock.code.startsWith(codeNeedle)) || name.startsWith(query)) {
    return 10 + name.length;
  }
  return 100 + name.indexOf(query) + name.length;
}

function getLocalSearchIndex() {
  if (localSearchIndex) return localSearchIndex;

  const source = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const stockBySecid = new Map();
  for (const stock of loadLocalAshareStocks()) {
    addLocalSearchStock(stockBySecid, stock.name, stock.secid, stock.market, stock.type);
  }

  const seedText = source.match(/const SCREENSHOT_SECTOR_TEXT = `([\s\S]*?)`\.trim\(\);/)?.[1] || "";
  seedText.split(/\r?\n/).forEach((line) => {
    const [, name, code] = line.split("|").map((part) => part.trim());
    addLocalSearchStock(stockBySecid, name, normalizeSecidInput(code));
  });

  source
    .matchAll(/\["([^"]+)",\s*"([01]\.\d{6})"\]/g)
    .forEach((match) => addLocalSearchStock(stockBySecid, match[1], match[2]));

  localSearchIndex = [...stockBySecid.values()];
  return localSearchIndex;
}

function loadLocalAshareStocks() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCAL_A_SHARE_LIST_PATH, "utf8"));
    return Array.isArray(parsed?.stocks) ? parsed.stocks : [];
  } catch (error) {
    console.warn(`Local A-share list unavailable: ${error.message}`);
    return [];
  }
}

function addLocalSearchStock(stockBySecid, name, secid, market, type) {
  const code = String(secid || "").split(".").pop();
  if (!name || !/^\d{6}$/.test(code) || stockBySecid.has(secid)) return;

  stockBySecid.set(secid, {
    name,
    code,
    secid,
    market: market || marketNameForSecid(secid),
    type: type || typeForSecid(secid),
  });
}

function codeFromInput(input) {
  return String(input || "")
    .trim()
    .replace(/^[a-z]+/i, "")
    .split(".")
    .pop()
    .replace(/\D/g, "");
}

function marketNameForCode(code) {
  if (isConvertibleBondCode(code)) return "转债";
  if (code.startsWith("688")) return "科创板";
  if (code.startsWith("300") || code.startsWith("301")) return "创业板";
  if (code.startsWith("8") || code.startsWith("9")) return "北交所";
  if (code.startsWith("6")) return "沪A";
  return "深A";
}

function marketNameForSecid(secid) {
  if (isHongKongSecid(secid)) return "港股";
  const code = String(secid || "").split(".").pop() || "";
  if (isFundCode(code)) return "ETF";
  return marketNameForCode(code);
}

function typeForSecid(secid) {
  const code = String(secid || "").split(".").pop() || "";
  if (isHongKongSecid(secid)) return "HKStock";
  if (isConvertibleBondCode(code)) return "Bond";
  if (isFundCode(code)) return "Fund";
  return "AStock";
}

function isSupportedSecid(secid) {
  return /^[01]\.\d{6}$/.test(secid) || isHongKongSecid(secid);
}

function isHongKongSecid(secid) {
  return /^116\.\d{5}$/.test(String(secid || ""));
}

function isFundCode(code) {
  return /^(15|16|50|51|52|56|58)\d{4}$/.test(String(code || ""));
}

function isConvertibleBondCode(code) {
  return /^(110|111|113|118|123|127|128)\d{3}$/.test(code);
}

function secidToSinaSymbol(secid) {
  const [market, code] = secid.split(".");
  if (!code) return secid;
  if (market === "116") return `rt_hk${code.padStart(5, "0")}`;
  if (market === "1") return `sh${code}`;
  if (code.startsWith("8") || code.startsWith("9")) return `bj${code}`;
  return `sz${code}`;
}

function secidToTencentSymbol(secid) {
  const [market, code] = secid.split(".");
  if (!code) return secid;
  if (market === "116") return `hk${code.padStart(5, "0")}`;
  return secidToSinaSymbol(secid);
}

function normalizeSecidInput(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const hkPrefixed = text.replace(/^rt_hk/i, "116.").replace(/^hk/i, "116.");
  if (/^116\.\d{1,5}$/.test(hkPrefixed)) {
    const code = hkPrefixed.split(".")[1].padStart(5, "0");
    return `116.${code}`;
  }
  if (/^\d{5}$/.test(hkPrefixed)) return `116.${hkPrefixed}`;

  const prefixed = hkPrefixed.replace(/^sh/i, "1.").replace(/^(sz|bj)/i, "0.");
  if (/^[01]\.\d{6}$/.test(prefixed)) return prefixed;
  if (/^\d{6}$/.test(prefixed)) return `${marketFromCode(prefixed)}.${prefixed}`;
  return prefixed;
}

function marketFromCode(code) {
  if (/^(5|6|110|111|113|118)/.test(code)) return "1";
  return "0";
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function fetchText(options, encoding = "utf8") {
  return new Promise((resolve, reject) => {
    const req = https.get(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        resolve(Buffer.concat(chunks).toString(encoding));
      });
    });

    if (options.timeout) {
      req.setTimeout(options.timeout);
    }
    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
    req.on("error", reject);
  });
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`operation timeout after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function readJsonBody(request, limitBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        request.destroy(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw.trim() ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function normalizeBoardState(raw) {
  const sectors = normalizeBoardSectors(raw?.sectors);
  const sectorNames = new Set(sectors.map((sector) => sector.name));
  const stackGroups = Array.isArray(raw?.stackGroups)
    ? raw.stackGroups
        .map((group) => {
          const names = uniqueStrings(group?.sectorNames).filter((name) => sectorNames.has(name));
          return {
            name: String(group?.name || "").trim(),
            sectorNames: names,
            expandedSectorNames: uniqueStrings(group?.expandedSectorNames).filter((name) =>
              names.includes(name),
            ),
          };
        })
        .filter((group) => group.name)
    : [];

  return {
    version: String(raw?.version || "server-state-v1"),
    updatedAt: new Date().toISOString(),
    sectors,
    stackGroups,
  };
}

function normalizeBoardSectors(sectors) {
  if (!Array.isArray(sectors)) return [];

  return sectors
    .map((sector) => ({
      name: String(sector?.name || "").trim(),
      stocks: Array.isArray(sector?.stocks)
        ? sector.stocks
            .map((stock) => ({
              name: String(stock?.name || "").trim(),
              secid: normalizeSecidInput(stock?.secid),
            }))
            .filter((stock) => stock.name && stock.secid)
        : [],
    }))
    .filter((sector) => sector.name);
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];

  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function serveStatic(pathname, response) {
  return new Promise((resolve, reject) => {
    const cleanPath = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.normalize(path.join(ROOT, cleanPath));

    if (!filePath.startsWith(ROOT)) {
      response.writeHead(403);
      response.end("Forbidden");
      resolve();
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500, {
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end(error.code === "ENOENT" ? "Not found" : "Server error");
        resolve();
        return;
      }

      response.writeHead(200, {
        "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(content);
      resolve();
    });
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}
