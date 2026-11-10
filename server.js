const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  codeFromInput,
  isConvertibleBondCode,
  isHongKongSecid,
  isSupportedSecid,
  marketNameForSecid,
  normalizeSecidInput,
  normalizeTagSecid,
  secidToMiniQmtMarketCode,
  secidToSinaSymbol,
  secidToTdxStockCode,
  secidToTencentSymbol,
  typeForSecid,
} = require("./src/domain/secid.js");
const { normalizeBoardState } = require("./src/domain/board-state.js");
const { chunk, mapWithConcurrency, withTimeout } = require("./src/shared/async.js");
const { readJsonFile, writeJsonAtomic } = require("./src/infrastructure/json-file-store.js");
const { execFileAsync, parseLastJsonObject } = require("./src/infrastructure/process-exec.js");
const { fetchText } = require("./src/infrastructure/https-text-client.js");
const {
  isLoopbackRequest,
  isSameOriginRequest,
  readJsonBody,
  sendJson,
} = require("./src/interfaces/http/http-io.js");
const { createStaticFileServer } = require("./src/interfaces/http/static-files.js");
const { createCbAiService } = require("./lib/cb-ai-service.js");
const {
  compareStrategies,
  createPaperState,
  evaluateStrategy,
  executePaperOrder,
  listStrategies: listCbQuantStrategies,
  markPaperState,
  normalizeConvertibleBondCode,
  normalizePaperState,
  runBacktest: runCbBacktest,
} = require("./lib/cb-quant-engine.js");
const {
  buildTradePlan: buildCbIntradayTradePlan,
  findIntradayEntry: findCbIntradayEntry,
  replayIntraday: replayCbIntraday,
  summarizeAuctionPair: summarizeCbAuctionPair,
} = require("./lib/cb-intraday-engine.js");
const {
  buildPortfolioRankings: buildCbPortfolioRankings,
  listPortfolioStrategies: listCbPortfolioStrategies,
  runPortfolioBacktest: runCbPortfolioBacktest,
} = require("./lib/cb-portfolio-engine.js");
const {
  calculatePriorDailyAtr: calculateCbPriorDailyAtr,
  runAtrGridBacktest: runCbAtrGridBacktest,
} = require("./lib/cb-atr-grid-engine.js");
const {
  loadEastmoneyOpenRows: loadCbEastmoneyOpenRows,
  loadPortfolioFactors: loadCbPortfolioFactors,
  mapConcurrent,
  normalizeDate: normalizeCbPortfolioDate,
} = require("./lib/cb-portfolio-data.js");

const { appendAuctionSample, buildAuctionSignalRows } = require("./lib/auction-signals.js");
const { createAuctionVolumeComparison } = require("./lib/auction-volume-comparison.js");
const enrichAuctionVolumes = createAuctionVolumeComparison(secidToTdxStockCode);
const { createPreferredLadderFeed } = require("./lib/limit-ladder-sources.js");
const fetchLimitLadder = createPreferredLadderFeed({ cacheDir: path.join(__dirname, "runtime", "limit-ladder-pools-v2") });
const { createBoardLadderService } = require("./lib/limit-ladder-board.js");
const { createLiveLadderFeed, loadBeijingLadderQuotes } = require("./lib/limit-ladder-live.js");
const fetchLiveLimitLadder = createLiveLadderFeed({
  loadHistory: fetchLimitLadder,
  loadQuotes: async (codes) => {
    const domestic = codes.filter((code) => !code.endsWith(".BJ"));
    const [payload, beijing] = await Promise.all([
      domestic.length ? fetchLocalJson(`/quotes?codes=${encodeURIComponent(domestic.join(","))}`, 10_000) : { quotes: [] },
      loadBeijingLadderQuotes(codes).catch(() => []),
    ]);
    return { ...payload, quotes: [...(payload.quotes || []), ...beijing] };
  },
});

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const serveStatic = createStaticFileServer({ root: ROOT });
const LOCAL_A_SHARE_LIST_PATH = path.join(ROOT, "data", "a-share-list.json");
const BOARD_STATE_PATH = path.join(ROOT, "data", "board-state.json");
const LADDER_MANIFEST_PATH = path.join(ROOT, "runtime", "limit-ladder-board.json");
const boardLadder = createBoardLadderService({
  loadPool: fetchLimitLadder,
  liveGrouping: true,
  readBoard: readBoardStateFile,
  writeBoard: (value) => writeJsonAtomic(BOARD_STATE_PATH, value),
  readManifest: () => readJsonFile(LADDER_MANIFEST_PATH).catch((error) => {
    if (error.code === "ENOENT") return {};
    throw error;
  }),
  writeManifest: (value) => writeJsonAtomic(LADDER_MANIFEST_PATH, value),
  backupBoard: async (value, date) => {
    const dir = path.join(ROOT, "runtime", "limit-ladder-backups");
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, `${date}.json`), JSON.stringify(value, null, 2), { flag: "wx" }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
  },
  withLock: withBoardStateMutationLock,
});
const TDX_FORMULA_SELECTION_PATH = path.join(ROOT, "runtime", "tdx-formula-selections.json");
const BOND_TAGS_PATH = path.join(ROOT, "data", "convertible-bond-tags.json");
const BOND_TAG_OVERRIDES_PATH = path.join(ROOT, "data", "convertible-bond-tag-overrides.json");
const BOND_HEATMAP_PATH = path.join(ROOT, "data", "convertible-bond-heatmap.json");
const BOND_LIFECYCLE_PATH = process.env.BOND_LIFECYCLE_PATH
  || path.join(ROOT, "runtime", "convertible-bond-lifecycle.json");
const BOND_LIFECYCLE_SYNC_SCRIPT = path.join(
  ROOT,
  "scripts",
  "sync-convertible-bond-lifecycle.py",
);
const BOND_LIFECYCLE_MAX_AGE_MS = Number(
  process.env.BOND_LIFECYCLE_MAX_AGE_MS || 30 * 60 * 1000,
);
const NEW_BOND_REFERENCE_OVERRIDES_PATH = path.join(
  ROOT,
  "data",
  "new-bond-reference-overrides.json",
);
const SW_INDUSTRY_MAP_PATH = process.env.SW_INDUSTRY_MAP_PATH
  || path.join(ROOT, "runtime", "sw-industry-map.json");
const SW_INDUSTRY_SYNC_SCRIPT = path.join(ROOT, "scripts", "sync-sw-industry-map.py");
const SW_INDUSTRY_MAX_AGE_MS = Number(
  process.env.SW_INDUSTRY_MAX_AGE_MS || 24 * 60 * 60 * 1000,
);
const AUCTION_CACHE_PATH = path.join(ROOT, "runtime", "auction-series.json");
const AUCTION_ARCHIVE_DIR = path.join(ROOT, "runtime", "auction-series-history");
const NEW_BOND_SECOND_DAY_TARGET_SECTOR =
  process.env.NEW_BOND_SECOND_DAY_TARGET_SECTOR || "小热次";
const NEW_BOND_AUTO_SCAN_START = process.env.NEW_BOND_AUTO_SCAN_START || "08:30:00";
const NEW_BOND_AUTO_SCAN_END = process.env.NEW_BOND_AUTO_SCAN_END || "09:29:30";
const NEW_BOND_AUTO_SCAN_INTERVAL_MS = Number(
  process.env.NEW_BOND_AUTO_SCAN_INTERVAL_MS || 60_000,
);
const NEW_BOND_RECONCILIATION_LOOKBACK_DAYS = Number(
  process.env.NEW_BOND_RECONCILIATION_LOOKBACK_DAYS || 45,
);
const NEW_BOND_RECONCILIATION_START =
  process.env.NEW_BOND_RECONCILIATION_START || "15:12:00";
const NEW_BOND_RECONCILIATION_END =
  process.env.NEW_BOND_RECONCILIATION_END || "18:00:00";
const NEW_BOND_UNIVERSE_PATH =
  process.env.NEW_BOND_UNIVERSE_PATH
  || path.join(ROOT, "runtime", "new-bond-universe.json");
const CB_PAPER_STATE_PATH =
  process.env.CB_PAPER_STATE_PATH
  || path.join(ROOT, "runtime", "cb-paper-account.json");
const TRADING_AUDIT_PATH = path.join(ROOT, "runtime", "trading-audit.jsonl");
const NEW_BOND_UNIVERSE_RETENTION_DAYS = Number(
  process.env.NEW_BOND_UNIVERSE_RETENTION_DAYS || 45,
);
const AUCTION_SAMPLE_INTERVAL_MS = 3000;
const AUCTION_PERSIST_INTERVAL_MS = 30000;
const AUCTION_MAX_SAMPLES = 210;
const AUCTION_RESPONSE_SAMPLES = 64;
const AUCTION_SIGNAL_RESPONSE_LIMIT = 200;
const EASTMONEY_SEARCH_TOKEN = "D43BF722C8E33BD69D955A7E7361F5D9";
const EASTMONEY_TRENDS_TOKEN = "fa5fd1943c7b386f172d6893dbfba10b";
const EASTMONEY_SEARCH_TIMEOUT_MS = 2500;
const GLOBAL_INDEX_SPARK_CACHE_MS = 60_000;
const { QuoteSnapshotStore } = require("./lib/quote-snapshot-store.js");
const quoteSnapshots = new QuoteSnapshotStore(path.join(ROOT, "runtime", "board-quote-snapshot.json"));
const { createUs10yFeed } = require("./lib/us10y-feed.js");
const fetchUs10yQuote = createUs10yFeed();
const TDX_OPEN_ENABLED = process.env.TDX_OPEN_ENABLED !== "0";
const TDX_VM_NAME = process.env.TDX_VM_NAME || "Windows 11";
const TDX_PRLCTL_PATH = process.env.TDX_PRLCTL_PATH || "/usr/local/bin/prlctl";
const TDX_OPEN_TIMEOUT_MS = Number(process.env.TDX_OPEN_TIMEOUT_MS || 5000);
const MINIQMT_API_HOST = process.env.MINIQMT_API_HOST || "127.0.0.1";
const MINIQMT_API_PORT = Number(process.env.MINIQMT_API_PORT || 18890);
const MINIQMT_API_AUTOSTART = process.env.MINIQMT_API_AUTOSTART !== "0";
const MINIQMT_API_RESTART_BASE_MS = 1000;
const MINIQMT_API_RESTART_MAX_MS = 30_000;
const MINIQMT_PYTHON =
  process.env.MINIQMT_PYTHON || (process.platform === "win32" ? "python" : "/Users/seasnake/miniconda3/bin/python3");
const MINIQMT_API_SCRIPT = path.join(ROOT, "scripts", "miniqmt-dashboard-api.py");
const cbAiService = createCbAiService({ root: ROOT, python: MINIQMT_PYTHON,
  enrichmentLoader: ({ code, date }) => fetchLocalJson(`/bond-meta?${new URLSearchParams({ code, date, ai: "1" })}`, 60_000),
});
let miniqmtApiProcess = null;
let miniqmtApiRestartTimer = null;
let miniqmtApiRestartAttempts = 0;
let shuttingDown = false;
let auctionSamplerTimer = null;
let auctionSamplerRunning = false;
let auctionCacheDate = "";
let auctionCacheDirty = false;
let auctionLastPersistedAt = 0;
let auctionLastRejectedLogAt = 0;
let auctionBoardStateMtime = 0;
let auctionBondTagsMtime = 0;
let auctionBoardSecids = [];
let auctionBondPairs = [];
let newBondScanTimer = null;
let ladderScanTimer = null;
let newBondScanInFlight = null;
let swIndustrySyncInFlight = null;
let bondLifecycleSyncInFlight = null;
const newBondMetadataAttemptedAt = new Map();
let newBondLastResult = null;
let newBondLastReconciliationDate = "";
let cbPaperStateCache = null;
let cbPaperMutationChain = Promise.resolve();
let cbPaperCycleTimer = null;
let cbPaperCycleInFlight = null;
let boardStateMutationChain = Promise.resolve();
const auctionSeries = new Map();
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
let us10yRequest = null;

const allowedRemoteAddresses = new Set(String(process.env.FINANCE_ALLOWED_REMOTE_ADDRESSES || "").split(",").map(value => value.trim()).filter(Boolean));
const server = http.createServer(async (request, response) => {
  const remoteAddress = String(request.socket.remoteAddress || "").replace(/^::ffff:/, "");
  if (allowedRemoteAddresses.size && !["127.0.0.1", "::1"].includes(remoteAddress) && !allowedRemoteAddresses.has(remoteAddress)) {
    sendJson(response, 403, { error: "This device is not allowed to access this installation" });
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (url.pathname === "/api/limit-ladder/board") {
      if (!["GET", "POST"].includes(request.method)) {
        sendJson(response, 405, { error: "method not allowed" });
      } else if (request.method === "POST" && (!isLoopbackRequest(request) || !isSameOriginRequest(request))) {
        sendJson(response, 403, { error: "请从本机看板更新连板分组" });
      } else {
        try {
          const result = request.method === "POST" ? await boardLadder.scan()
            : url.searchParams.get("preview") === "1" ? await boardLadder.scan({ apply: false }) : await boardLadder.status();
          sendJson(response, 200, result);
        } catch (error) { sendJson(response, 503, { error: error.message }); }
      }
      return;
    }
    if (url.pathname === "/api/limit-ladder" || url.pathname === "/api/limit-ladder/live") {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "method not allowed" });
        return;
      }
      try {
        sendJson(response, 200, url.pathname.endsWith("/live") ? await fetchLiveLimitLadder() : await fetchLimitLadder(url.searchParams.get("date") || ""));
      } catch (error) {
        sendJson(response, error.statusCode || 503, { error: error.message });
      }
      return;
    }
    if (url.pathname.startsWith("/api/cb-ai/")) {
      await handleCbAi(request, response, url);
      return;
    }
    if (url.pathname === "/api/quote-snapshot" && request.method === "GET") {
      sendJson(response, 200, quoteSnapshots.payload());
      return;
    }
    if (url.pathname === "/api/qmt-backends") {
      if (request.method === "GET") {
        await handleMiniQmtApi("/qmt-backends", response);
      } else if (request.method === "POST") {
        if (!isSameOriginRequest(request)) {
          sendJson(response, 403, { error: "请从看板页面切换行情源" });
          return;
        }
        try {
          const body = await readJsonBody(request, 1024);
          const payload = await fetchLocalJsonPost("/qmt-backends", body, 35_000);
          sendJson(response, 200, payload);
        } catch (error) {
          sendJson(response, error.statusCode || 503, { error: error.message });
        }
      } else {
        sendJson(response, 405, { error: "method not allowed" });
      }
      return;
    }
    if (url.pathname === "/api/quotes") {
      await handleQuotes(url, response);
      return;
    }

    if (url.pathname === "/api/indices") {
      await handleIndices(response);
      return;
    }

    if (url.pathname === "/api/us10y") {
      us10yRequest ||= fetchUs10yQuote().finally(() => { us10yRequest = null; });
      sendJson(response, 200, await us10yRequest);
      return;
    }

    if (url.pathname === "/api/auction") {
      await handleAuction(url, response);
      return;
    }

    if (url.pathname === "/api/auction/signals") {
      await handleAuctionSignals(url, response);
      return;
    }

    if (url.pathname === "/api/auction/series") {
      await handleAuctionSeries(url, response);
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

    if (url.pathname === "/api/miniqmt/intraday-backfill") {
      if (request.method === "POST") {
        try {
          const body = await readJsonBody(request, 16 * 1024);
          const payload = await fetchLocalJsonPost(
            "/intraday-backfill",
            body,
            12_000,
          );
          sendJson(response, 202, payload);
        } catch (error) {
          const message = error instanceof Error ? error.message : "QMT backfill unavailable";
          const status = Number(error?.statusCode) || Number(message.match(/HTTP (\d+)/)?.[1]) || 503;
          sendJson(response, status, { error: message.replace(/^HTTP \d+:\s*/, ""), service: "miniqmt-dashboard" });
        }
        return;
      }
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET, POST" });
        response.end("Method not allowed");
        return;
      }
      const query = new URLSearchParams();
      for (const key of ["job_id", "code", "date", "trading_date"]) {
        const value = url.searchParams.get(key);
        if (value) query.set(key, value);
      }
      await handleMiniQmtApi(`/intraday-backfill?${query}`, response);
      return;
    }

    if (url.pathname === "/api/miniqmt/bond") {
      const query = new URLSearchParams();
      for (const key of ["code", "date", "fast"]) {
        const value = url.searchParams.get(key);
        if (value) query.set(key, value);
      }
      await handleMiniQmtApi(`/bond?${query}`, response);
      return;
    }

    if (url.pathname === "/api/miniqmt/bond-meta") {
      const query = new URLSearchParams();
      const code = url.searchParams.get("code");
      if (code) query.set("code", code);
      const date = url.searchParams.get("date");
      if (date) query.set("date", date);
      await handleMiniQmtApi(`/bond-meta?${query}`, response, 60_000);
      return;
    }

    if (url.pathname === "/api/miniqmt/daily") {
      const query = new URLSearchParams();
      for (const key of ["code", "count", "reference"]) {
        const value = url.searchParams.get(key);
        if (value) query.set(key, value);
      }
      await handleMiniQmtApi(`/daily?${query}`, response);
      return;
    }

    if (url.pathname === "/api/miniqmt/new-bond-performance") {
      const query = new URLSearchParams();
      for (const key of ["window", "interval", "codes"]) {
        const value = url.searchParams.get(key);
        if (value) query.set(key, value);
      }
      await handleMiniQmtApi(`/new-bond-performance?${query}`, response, 120_000);
      return;
    }

    if (url.pathname === "/api/miniqmt/events") {
      const query = new URLSearchParams();
      for (const key of [
        "scope",
        "after_id",
        "limit",
        "codes",
        "types",
        "min_daily_amount",
        "min_daily_amplitude",
        "trading_date",
      ]) {
        const value = url.searchParams.get(key);
        if (value) query.set(key, value);
      }
      await handleMiniQmtApi(`/events?${query}`, response);
      return;
    }

    if (url.pathname === "/api/miniqmt/quotes") {
      const query = new URLSearchParams();
      const codes = url.searchParams.get("codes");
      if (codes) query.set("codes", codes);
      // Allow the dashboard's 28s quote budget to finish before this proxy,
      // which in turn finishes before the browser's 35s batch deadline.
      await handleMiniQmtApi(`/quotes?${query}`, response, 32_000);
      return;
    }

    if (url.pathname === "/api/miniqmt/order-book") {
      const query = new URLSearchParams();
      const code = url.searchParams.get("code");
      if (code) query.set("code", code);
      await handleMiniQmtApi(`/order-book?${query}`, response);
      return;
    }

    if (url.pathname === "/api/miniqmt/trading") {
      await handleMiniQmtApi("/trading", response, 20_000);
      return;
    }

    if (url.pathname === "/api/miniqmt/trading/capabilities") {
      await handleTradingCapabilities(request, response);
      return;
    }

    const tradingMutationPath = {
      "/api/miniqmt/trading/unlock": "/trading/unlock",
      "/api/miniqmt/trading/order-preview": "/trading/order-preview",
      "/api/miniqmt/trading/order-execute": "/trading/order-execute",
      "/api/miniqmt/trading/cancel-preview": "/trading/cancel-preview",
      "/api/miniqmt/trading/cancel-execute": "/trading/cancel-execute",
    }[url.pathname];
    if (tradingMutationPath) {
      await handleTradingMutation(request, response, tradingMutationPath);
      return;
    }

    if (url.pathname === "/api/active-index/live") {
      await handleMiniQmtApi("/active-index", response, 55_000);
      return;
    }

    if (url.pathname === "/api/miniqmt/tags") {
      if (request.method === "POST") {
        await handleBondTagsUpdate(request, response);
        return;
      }
      await handleBondTagsGet(url, response);
      return;
    }

    if (url.pathname === "/api/new-bond-universe") {
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" });
        response.end("Method not allowed");
        return;
      }
      const universe = await readJsonFile(NEW_BOND_UNIVERSE_PATH).catch((error) => {
        if (error?.code === "ENOENT") return {};
        throw error;
      });
      sendJson(response, 200, publicNewBondUniverse(universe));
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

    if (url.pathname === "/api/tdx-formula-selections") {
      await handleTdxFormulaSelections(request, response);
      return;
    }

    if (url.pathname === "/api/new-bond-second-day") {
      await handleNewBondSecondDay(request, response, url);
      return;
    }

    if (url.pathname.startsWith("/api/cb-quant/")) {
      await handleCbQuant(request, response, url);
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

function startServer() {
  server.listen(PORT, process.env.FINANCE_BIND_HOST || undefined, () => {
    console.log(`Finance board running at http://localhost:${PORT}`);
    scheduleBoardLadderScan(3000);
    void ensureMiniQmtApi().finally(async () => {
      void ensureSwIndustryMapSync().catch((error) => {
        console.warn(`SW industry map sync unavailable: ${error.message}`);
      });
      try {
        const lifecyclePayload = await ensureBondLifecycleSync();
        const pruned = await pruneInactiveBondsFromBoard(lifecyclePayload);
        if (pruned.removed.length > 0) {
          console.log(
            `Bond lifecycle filter removed ${pruned.removed.length} inactive board rows: `
              + pruned.removed.map((row) => row.name || row.code).join("、"),
          );
        }
      } catch (error) {
        console.warn(`Bond lifecycle sync unavailable: ${error.message}`);
      }
      await loadAuctionCache();
      scheduleAuctionSampler(1000);
      scheduleNewBondSecondDayScan(2500);
    });
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      shuttingDown = true;
      cbAiService.stop();
      if (miniqmtApiRestartTimer) clearTimeout(miniqmtApiRestartTimer);
      if (auctionSamplerTimer) clearTimeout(auctionSamplerTimer);
      if (newBondScanTimer) clearTimeout(newBondScanTimer);
      if (ladderScanTimer) clearTimeout(ladderScanTimer);
      if (cbPaperCycleTimer) clearTimeout(cbPaperCycleTimer);
      await persistAuctionCache(true).catch((error) => {
        console.warn(`Auction cache final persist failed: ${error.message}`);
      });
      stopMiniQmtApi();
      server.close(() => process.exit(0));
    });
  }
}

async function ensureSwIndustryMapSync({ force = false } = {}) {
  if (swIndustrySyncInFlight) return swIndustrySyncInFlight;
  swIndustrySyncInFlight = (async () => {
    if (!force) {
      const [stat, current] = await Promise.all([
        fs.promises.stat(SW_INDUSTRY_MAP_PATH).catch(() => null),
        readJsonFile(SW_INDUSTRY_MAP_PATH).catch(() => null),
      ]);
      const stockCount = Number(current?.stockCount || Object.keys(current?.stocks || {}).length);
      const maxAge = Number.isFinite(SW_INDUSTRY_MAX_AGE_MS)
        ? Math.max(60_000, SW_INDUSTRY_MAX_AGE_MS)
        : 24 * 60 * 60 * 1000;
      if (stat && Date.now() - stat.mtimeMs < maxAge && stockCount >= 1000) {
        return current;
      }
    }
    if (!fs.existsSync(SW_INDUSTRY_SYNC_SCRIPT)) {
      throw new Error(`missing sync script: ${SW_INDUSTRY_SYNC_SCRIPT}`);
    }
    const python = process.env.PYTHON_BIN || (process.platform === "win32" ? MINIQMT_PYTHON : "python3");
    await execFileAsync(
      python,
      [
        SW_INDUSTRY_SYNC_SCRIPT,
        "--host",
        process.env.QMT_BRIDGE_HOST || "127.0.0.1",
        "--port",
        String(process.env.QMT_BRIDGE_PORT || 18889),
        "--output",
        SW_INDUSTRY_MAP_PATH,
        "--tags",
        BOND_TAGS_PATH,
      ],
      { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const payload = await readJsonFile(SW_INDUSTRY_MAP_PATH);
    const stockCount = Number(payload?.stockCount || Object.keys(payload?.stocks || {}).length);
    if (stockCount < 1000) {
      throw new Error(
        `invalid SW industry map: stocks=${stockCount}`,
      );
    }
    return payload;
  })().finally(() => {
    swIndustrySyncInFlight = null;
  });
  return swIndustrySyncInFlight;
}

function bondLifecyclePayloadUsable(payload) {
  const qmtActiveCount = Number(payload?.qmtActiveCount || 0);
  return payload?.qualityStatus === "ok"
    && qmtActiveCount >= 250
    && qmtActiveCount <= 500
    && payload?.bonds
    && typeof payload.bonds === "object"
    && !Array.isArray(payload.bonds);
}

async function ensureBondLifecycleSync({ force = false } = {}) {
  if (bondLifecycleSyncInFlight) return bondLifecycleSyncInFlight;
  bondLifecycleSyncInFlight = (async () => {
    if (!force) {
      const [stat, current] = await Promise.all([
        fs.promises.stat(BOND_LIFECYCLE_PATH).catch(() => null),
        readJsonFile(BOND_LIFECYCLE_PATH).catch(() => null),
      ]);
      const maxAge = Number.isFinite(BOND_LIFECYCLE_MAX_AGE_MS)
        ? Math.max(60_000, BOND_LIFECYCLE_MAX_AGE_MS)
        : 30 * 60 * 1000;
      if (
        stat
        && Date.now() - stat.mtimeMs < maxAge
        && bondLifecyclePayloadUsable(current)
      ) {
        return current;
      }
    }
    if (!fs.existsSync(BOND_LIFECYCLE_SYNC_SCRIPT)) {
      throw new Error(`missing sync script: ${BOND_LIFECYCLE_SYNC_SCRIPT}`);
    }
    const python = process.env.PYTHON_BIN || (process.platform === "win32" ? MINIQMT_PYTHON : "python3");
    await execFileAsync(
      python,
      [
        BOND_LIFECYCLE_SYNC_SCRIPT,
        "--host",
        process.env.QMT_BRIDGE_HOST || "127.0.0.1",
        "--port",
        String(process.env.QMT_BRIDGE_PORT || 18889),
        "--output",
        BOND_LIFECYCLE_PATH,
        "--tags",
        BOND_TAGS_PATH,
        "--board",
        BOARD_STATE_PATH,
        "--heatmap",
        BOND_HEATMAP_PATH,
        "--new-bond-universe",
        NEW_BOND_UNIVERSE_PATH,
      ],
      { timeout: 75_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const payload = await readJsonFile(BOND_LIFECYCLE_PATH);
    if (!bondLifecyclePayloadUsable(payload)) {
      throw new Error(
        `invalid bond lifecycle map: qmtActiveCount=${Number(payload?.qmtActiveCount || 0)}`,
      );
    }
    return payload;
  })().finally(() => {
    bondLifecycleSyncInFlight = null;
  });
  return bondLifecycleSyncInFlight;
}

async function loadBondLifecycleWithRefresh(options = {}) {
  if (options.staleWhileRevalidate && !options.force) {
    const cached = await readJsonFile(BOND_LIFECYCLE_PATH).catch(() => null);
    if (bondLifecyclePayloadUsable(cached)) {
      void ensureBondLifecycleSync().catch((error) => {
        console.warn(`Bond lifecycle background refresh skipped: ${error.message}`);
      });
      return cached;
    }
  }
  try {
    return await ensureBondLifecycleSync(options);
  } catch (error) {
    console.warn(`Bond lifecycle refresh skipped: ${error.message}`);
    return readJsonFile(BOND_LIFECYCLE_PATH).catch(() => ({}));
  }
}

if (require.main === module) {
  startServer();
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

  await quoteSnapshots.update(quotes.filter((quote) => quote.secid?.startsWith("116.")))
    .catch((error) => console.warn("Quote snapshot save failed:", error.message));
  sendJson(response, 200, {
    source: "新浪实时",
    time: new Date().toISOString(),
    quotes,
    failedGroups: failedGroups.length,
  });
}

async function handleIndices(response) {
  let miniQmtIndices = [];
  try {
    miniQmtIndices = await fetchMiniQmtIndexQuotes();
  } catch (error) {
    console.warn(
      `QMT index request failed, using Sina fallback: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }

  const sinaIndices = await fetchSinaGlobalIndices({
    includeDomestic: miniQmtIndices.length < 3,
  });
  const miniQmtByKey = new Map(miniQmtIndices.map((item) => [item.key, item]));
  const sinaByKey = new Map(sinaIndices.map((item) => [item.key, item]));
  const orderedKeys = [
    ...DOMESTIC_INDEXES.map((item) => item.key),
    ...sinaIndices.map((item) => item.key),
  ];
  const indices = [...new Set(orderedKeys)]
    .map((key) => miniQmtByKey.get(key) || sinaByKey.get(key))
    .filter(Boolean);

  sendJson(response, 200, {
    source: miniQmtIndices.length === 3 ? "QMT gateway full_tick + 新浪实时" : "新浪实时（QMT优先）",
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

async function handleAuctionSeries(url, response) {
  const secids = Array.from(
    new Set(
      (url.searchParams.get("secids") || "")
        .split(",")
        .map((value) => value.trim())
        .map(normalizeSecidInput)
        .filter((secid) => /^[01]\.\d{6}$/.test(secid)),
    ),
  ).slice(0, 160);
  if (secids.length === 0) {
    sendJson(response, 400, { error: "missing secids" });
    return;
  }

  const after = Math.max(0, Number(url.searchParams.get("after")) || 0);
  const current = currentChinaDateTimeParts();
  const tradingDate = current.date.replaceAll("-", "");
  const rows = [];
  let cursor = after;
  for (const secid of secids) {
    const cached = auctionSeries.get(secid);
    if (!cached || cached.date !== tradingDate) continue;
    let samples = cached.samples;
    if (after > 0) {
      samples = samples.filter((sample) => sample.capturedAt > after);
    } else {
      samples = downsampleAuctionSamples(samples, AUCTION_RESPONSE_SAMPLES);
    }
    cursor = Math.max(cursor, ...samples.map((sample) => Number(sample.capturedAt) || 0));
    rows.push({
      secid,
      date: cached.date,
      previousClose: cached.previousClose,
      source: cached.source || "QMT竞价采样",
      latestAmount: cached.samples.at(-1)?.amount || 0,
      samples,
    });
  }

  sendJson(response, 200, {
    source: "QMT竞价采样",
    date: tradingDate,
    phase: auctionClockPhase(current.time),
    sampleIntervalMs: AUCTION_SAMPLE_INTERVAL_MS,
    requested: secids.length,
    returned: rows.length,
    cursor,
    series: rows,
  });
}

async function handleAuctionSignals(url, response) {
  const current = currentChinaDateTimeParts();
  const tradingDate = current.date.replaceAll("-", "");
  const secidFilter = new Set(
    (url.searchParams.get("secids") || "")
      .split(",")
      .map((value) => normalizeSecidInput(value))
      .filter((secid) => /^[01]\.\d{6}$/.test(secid)),
  );

  await loadAuctionBoardSecids();
  const pairs = secidFilter.size
    ? auctionBondPairs.filter((pair) => secidFilter.has(pair.bondSecid))
    : auctionBondPairs;
  const result = buildAuctionSignalRows(pairs, auctionSeries, tradingDate, { asOf: Date.now() });

  const signals = result.signals.slice(0, AUCTION_SIGNAL_RESPONSE_LIMIT);
  enrichAuctionVolumes(signals, tradingDate);
  sendJson(response, 200, {
    source: "QMT竞价采样",
    mode: "read_only",
    date: tradingDate,
    phase: auctionClockPhase(current.time),
    sampleIntervalMs: AUCTION_SAMPLE_INTERVAL_MS,
    requestedPairs: result.coverage.requested,
    sampledPairs: result.sampledPairs,
    returned: Math.min(result.signals.length, AUCTION_SIGNAL_RESPONSE_LIMIT),
    totalSignals: result.signals.length,
    latestQuoteTime: result.latestQuoteTime,
    generatedAt: Date.now(),
    rules: result.rules,
    coverage: result.coverage,
    amountCoverage: result.amountCoverage,
    amountReady: result.amountReady,
    signals,
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

async function handleCbAi(request, response, url) {
  try {
    if (!isLoopbackRequest(request)) {
      sendJson(response, 403, { error: "请在运行看板的本机使用 AI 分析" });
      return;
    }
    if (["POST", "DELETE"].includes(request.method) && !isSameOriginRequest(request)) {
      sendJson(response, 403, { error: "请从看板分析页面发起操作" });
      return;
    }
    const route = url.pathname.slice("/api/cb-ai".length);
    if (request.method === "GET" && route === "/status") {
      sendJson(response, 200, await cbAiService.status());
    } else if (request.method === "GET" && route === "/context") {
      sendJson(response, 200, await cbAiService.context(Object.fromEntries(url.searchParams)));
    } else if (request.method === "GET" && route === "/prompt") {
      sendJson(response, 200, await cbAiService.getPrompt(url.searchParams.get("context_id"), url.searchParams.get("focus") || ""));
    } else if (request.method === "GET" && route === "/reports") {
      sendJson(response, 200, { reports: await cbAiService.list() });
    } else if (request.method === "POST" && route === "/analyze") {
      sendJson(response, 202, await cbAiService.start(await readJsonBody(request, 12 * 1024)));
    } else if (/^\/jobs\/[a-f0-9-]+$/.test(route) && request.method === "GET") {
      sendJson(response, 200, await cbAiService.get(route.split("/").at(-1), url.searchParams.get("full") === "1"));
    } else if (/^\/jobs\/[a-f0-9-]+$/.test(route) && request.method === "DELETE") {
      sendJson(response, 200, await cbAiService.cancel(route.split("/").at(-1)));
    } else {
      sendJson(response, 404, { error: "未找到分析接口" });
    }
  } catch (error) {
    sendJson(response, error.statusCode || 400, { error: String(error.message || "分析服务不可用").slice(0, 500) });
  }
}

async function handleMiniQmtApi(pathname, response, timeout = 12_000) {
  try {
    const payload = pathname.startsWith("/quotes?")
      ? await fetchBoardQmtQuotes(new URLSearchParams(pathname.split("?")[1]).get("codes") || "", timeout)
      : await fetchLocalJson(pathname, timeout);
    if (pathname.startsWith("/quotes?")) {
      await quoteSnapshots.update(payload.quotes, payload.quote_backend)
        .catch((error) => console.warn("Quote snapshot save failed:", error.message));
    }
    miniqmtApiRestartAttempts = 0;
    sendJson(response, 200, payload);
  } catch (error) {
    void ensureMiniQmtApi();
    const message = error instanceof Error ? error.message : "QMT API unavailable";
    const status = /\bHTTP 4\d\d\b/.test(message) ? Number(message.match(/HTTP (\d+)/)?.[1]) : 503;
    sendJson(response, status, {
      error: message,
      service: "miniqmt-dashboard",
    });
  }
}

async function handleTradingCapabilities(request, response) {
  try {
    const payload = await fetchLocalJson("/trading/capabilities", 12_000);
    sendJson(response, 200, {
      ...payload,
      local_access: isLoopbackRequest(request),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "QMT API unavailable";
    sendJson(response, 503, { error: message, service: "miniqmt-dashboard" });
  }
}

async function handleTradingMutation(request, response, pathname) {
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" });
    response.end("Method not allowed");
    return;
  }
  if (!isLoopbackRequest(request)) {
    sendJson(response, 403, { error: "实盘操作仅允许在运行看板的本机执行" });
    return;
  }
  if (!isSameOriginRequest(request)) {
    sendJson(response, 403, { error: "实盘操作要求同源页面确认" });
    return;
  }
  try {
    const body = await readJsonBody(request, 64 * 1024);
    const payload = await fetchLocalJsonPost(pathname, body, 20_000);
    sendJson(response, 200, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "QMT API unavailable";
    const status = Number(error?.statusCode) || Number(message.match(/HTTP (\d+)/)?.[1]) || 503;
    sendJson(response, status, { error: message.replace(/^HTTP \d+:\s*/, ""), service: "miniqmt-dashboard" });
  }
}

function cbQuantErrorStatus(error) {
  const message = String(error?.message || error || "");
  return /ECONN|QMT|QMT|东方财富|数据报告|HTTP 5\d\d|request timeout|unavailable/i.test(message)
    ? 503
    : 400;
}

function normalizedCbQuantCodes(input) {
  const values = Array.isArray(input) ? input : String(input || "").split(/[\s,，;；]+/);
  const output = [];
  for (const value of values) {
    if (!String(value || "").trim()) continue;
    const code = normalizeConvertibleBondCode(value);
    if (!output.includes(code)) output.push(code);
  }
  if (output.length > 8) throw new Error("模拟盘单次最多监控8只可转债");
  return output;
}

function completedCbDailyRows(payload, completedBarsOnly = true) {
  const rows = Array.isArray(payload?.rows) ? [...payload.rows] : [];
  if (!completedBarsOnly || !rows.length) {
    return { rows, droppedProvisional: false };
  }
  const clock = currentChinaDateTimeParts();
  const currentDate = clock.date.replaceAll("-", "");
  const lastDate = String(rows.at(-1)?.date || "").replaceAll("-", "");
  const droppedProvisional = lastDate === currentDate && clock.time < "15:05:00";
  if (droppedProvisional) rows.pop();
  return { rows, droppedProvisional };
}

async function fetchCbDailyPayload(code, count = 500) {
  const normalizedCode = normalizeConvertibleBondCode(code);
  const query = new URLSearchParams({
    code: normalizedCode,
    count: String(Math.max(30, Math.min(500, Number(count) || 500))),
  });
  const [primary, localReference] = await Promise.all([
    fetchLocalJson(`/daily?${query.toString()}`, 120_000),
    fetchLocalJson(`/daily?${query.toString()}&reference=1`, 30_000).catch(() => null),
  ]);
  const rowsByDate = new Map();
  for (const row of Array.isArray(primary?.rows) ? primary.rows : []) {
    if (row?.date) rowsByDate.set(String(row.date), row);
  }
  let localFilledDates = 0;
  for (const row of Array.isArray(localReference?.rows) ? localReference.rows : []) {
    const date = String(row?.date || "");
    if (!date || rowsByDate.has(date)) continue;
    rowsByDate.set(date, row);
    localFilledDates += 1;
  }
  const rows = [...rowsByDate.values()]
    .sort((left, right) => String(left.date).localeCompare(String(right.date)))
    .slice(-Math.max(30, Math.min(500, Number(count) || 500)));
  return {
    ...primary,
    rows,
    count: rows.length,
    returned_count: rows.length,
    source: localFilledDates
      ? `${primary.source} + 本地监控分钟聚合补缺`
      : primary.source,
    auto_local_reference_fill_count: localFilledDates,
  };
}

async function fetchCbQuotes(codes) {
  const normalized = normalizedCbQuantCodes(codes);
  if (!normalized.length) return [];
  const query = new URLSearchParams({ codes: normalized.join(",") });
  const payload = await fetchLocalJson(`/quotes?${query.toString()}`, 20_000);
  return Array.isArray(payload?.quotes) ? payload.quotes : [];
}

function normalizeCbTradingDate(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  return /^\d{8}$/.test(digits) ? digits : "";
}

function cbMinutePayloadComplete(payload) {
  return payload?.complete_session === true
    || (Array.isArray(payload?.rows) && payload.rows.length >= 240);
}

async function waitForCbIntradayBackfill(code, tradingDate, maximumWaitMs = 15_000) {
  let state;
  try {
    state = await fetchLocalJsonPost("/intraday-backfill", {
      code,
      trading_date: tradingDate,
    }, 20_000);
  } catch (error) {
    return {
      attempted: true,
      status: "request_failed",
      error: error.message,
    };
  }
  const jobId = String(state?.job_id || state?.job?.job_id || "");
  const startedAt = Date.now();
  const terminal = new Set([
    "ready", "partial", "failed", "interrupted", "not_applicable", "idle",
  ]);
  const isDeferred = () => [
    "waiting_for_market_close", "waiting_for_bridge_cooldown",
  ].includes(String(state?.phase || ""));
  while (jobId && !terminal.has(String(state?.status || "")) && !isDeferred()) {
    const remaining = maximumWaitMs - (Date.now() - startedAt);
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, remaining)));
    const query = new URLSearchParams({ job_id: jobId });
    try {
      state = await fetchLocalJson(`/intraday-backfill?${query.toString()}`, 8_000);
    } catch (error) {
      state = { ...state, status: "status_failed", error: error.message };
      break;
    }
  }
  return {
    attempted: true,
    job_id: jobId || null,
    status: String(state?.status || "unknown"),
    phase: String(state?.phase || ""),
    row_count_before: Number(state?.row_count_before || 0),
    row_count_after: Number(state?.row_count_after || state?.row_count || 0),
    missing_after: Number(state?.missing_after || 0),
    wait_reason: String(state?.wait_reason || ""),
    error: String(state?.error || ""),
    deferred: isDeferred(),
    timed_out: Boolean(
      jobId
      && !terminal.has(String(state?.status || ""))
      && !isDeferred(),
    ),
  };
}

async function fetchCbMinutePayload(code, tradingDate, options = {}) {
  const normalizedCode = normalizeConvertibleBondCode(code);
  const query = new URLSearchParams({ code: normalizedCode, date: tradingDate });
  let payload = await fetchLocalJson(`/bond?${query.toString()}`, 120_000);
  const readThroughFill = Boolean(
    cbMinutePayloadComplete(payload)
    && payload?.history_backfill?.local_gap_detected
    && String(payload?.source || "").includes("补齐"),
  );
  let autoBackfill = readThroughFill
    ? {
      attempted: true,
      status: "read_through_cache",
      row_count_after: Array.isArray(payload?.rows) ? payload.rows.length : 0,
      source: payload.source,
    }
    : {
      attempted: false,
      status: cbMinutePayloadComplete(payload) ? "not_needed" : "not_requested",
    };
  if (!cbMinutePayloadComplete(payload) && options.autoBackfill !== false) {
    autoBackfill = await waitForCbIntradayBackfill(
      normalizedCode,
      tradingDate,
      Number(options.maximumWaitMs || 15_000),
    );
    payload = await fetchLocalJson(`/bond?${query.toString()}`, 120_000);
  }
  return { payload, autoBackfill };
}

function cbDailyRowFromMinutes(bondPayload, tradingDate) {
  const rows = Array.isArray(bondPayload?.rows) ? bondPayload.rows : [];
  if (!rows.length) return null;
  const valid = rows.filter((row) => [row.open, row.high, row.low, row.close]
    .every((value) => Number.isFinite(Number(value)) && Number(value) > 0));
  if (!valid.length) return null;
  return {
    date: tradingDate,
    time: Number(valid.at(-1)?.minute_ms || 0),
    open: Number(valid[0].open),
    high: Math.max(...valid.map((row) => Number(row.high))),
    low: Math.min(...valid.map((row) => Number(row.low))),
    close: Number(valid.at(-1).close),
    volume: valid.reduce((total, row) => total + (Number(row.volume) || 0), 0),
    amount: valid.reduce((total, row) => total + (Number(row.amount) || 0), 0),
    suspend: 0,
    source: "自动补齐分钟聚合日K",
  };
}

async function fetchCbDailyPayloadWithAutoFill(code, count, health) {
  let dailyPayload = await fetchCbDailyPayload(code, count);
  const expectedCompletedDate = expectedCompletedCbDate(health) || "";
  let latestDayAutoBackfill = { attempted: false, status: "not_needed" };
  const currentDailyEnd = normalizeCbTradingDate(dailyPayload?.rows?.at(-1)?.date);
  if (expectedCompletedDate && (!currentDailyEnd || currentDailyEnd < expectedCompletedDate)) {
    try {
      const minuteResult = await fetchCbMinutePayload(code, expectedCompletedDate);
      latestDayAutoBackfill = minuteResult.autoBackfill;
      const filledDailyRow = cbDailyRowFromMinutes(minuteResult.payload, expectedCompletedDate);
      if (filledDailyRow) {
        const rowsByDate = new Map(
          (dailyPayload.rows || []).map((row) => [String(row.date), row]),
        );
        rowsByDate.set(expectedCompletedDate, filledDailyRow);
        const maximum = Math.max(30, Math.min(500, Number(count) || 500));
        const rows = [...rowsByDate.values()]
          .sort((left, right) => String(left.date).localeCompare(String(right.date)))
          .slice(-maximum);
        dailyPayload = {
          ...dailyPayload,
          rows,
          count: rows.length,
          returned_count: rows.length,
          source: `${dailyPayload.source} + 自动补齐分钟聚合日K`,
        };
      }
    } catch (error) {
      latestDayAutoBackfill = {
        attempted: true,
        status: "failed",
        error: error.message,
      };
    }
  }
  return { dailyPayload, expectedCompletedDate, latestDayAutoBackfill };
}

async function loadCbAuctionPair(code, tradingDate) {
  await loadAuctionBoardSecids();
  const normalizedCode = normalizeConvertibleBondCode(code);
  const bareCode = normalizedCode.split(".")[0];
  const pair = auctionBondPairs.find((item) => item.bondCode === bareCode) || null;
  let parsed = null;
  try {
    parsed = await readJsonFile(AUCTION_CACHE_PATH);
  } catch {
    parsed = null;
  }
  if (parsed?.date !== tradingDate) {
    try {
      parsed = await readJsonFile(path.join(AUCTION_ARCHIVE_DIR, `${tradingDate}.json`));
    } catch {
      parsed = null;
    }
  }
  const series = new Map();
  if (parsed?.date === tradingDate && Array.isArray(parsed.series)) {
    for (const item of parsed.series) series.set(item.secid, item);
  } else if (auctionCacheDate === tradingDate) {
    for (const [secid, item] of auctionSeries.entries()) series.set(secid, item);
  }
  const auction = summarizeCbAuctionPair({
    bondSeries: pair ? series.get(pair.bondSecid) : null,
    stockSeries: pair ? series.get(pair.stockSecid) : null,
  });
  return {
    pair,
    auction,
    source_date: parsed?.date || auctionCacheDate || null,
    source: "runtime/auction-series.json / auction-series-history · QMT full_tick L1近似",
  };
}

async function loadCbAccountExecutionReview(code, tradingDate) {
  const normalizedCode = normalizeConvertibleBondCode(code);
  const normalizedDate = normalizeCbTradingDate(tradingDate);
  let records = [];
  try {
    const content = await fs.promises.readFile(TRADING_AUDIT_PATH, "utf8");
    records = content
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch {
    records = [];
  }
  const matchingRecords = records.filter((item) => {
    let itemCode = "";
    try {
      itemCode = normalizeConvertibleBondCode(item.stock_code || item.code || "");
    } catch {
      return false;
    }
    const itemDate = normalizeCbTradingDate(item.time || item.timestamp || item.order_time || "");
    return itemCode === normalizedCode && (!normalizedDate || itemDate === normalizedDate);
  });
  return {
    available: matchingRecords.length > 0,
    source: "runtime/trading-audit.jsonl",
    matching_record_count: matchingRecords.length,
    records: matchingRecords.slice(-20),
    reason: matchingRecords.length
      ? "找到本看板留存的操作审计；它只能证明本地预览/提交记录，不能替代券商成交回报。"
      : "本地操作审计没有该标的当日记录；QMT Bridge当前成交接口也不提供昨日历史成交，无法据此还原你的真实买卖点。",
  };
}

async function fetchCbIntradayBundle(code, requestedDate = "") {
  const normalizedCode = normalizeConvertibleBondCode(code);
  const health = await fetchLocalJson("/health", 8_000).catch(() => null);
  const tradingDate = normalizeCbTradingDate(requestedDate)
    || normalizeCbTradingDate(health?.latest_trading_date);
  if (!tradingDate) throw new Error("无法确定可用交易日");
  const eventQuery = new URLSearchParams({
    scope: "all",
    codes: normalizedCode,
    trading_date: tradingDate,
    limit: "5000",
  });
  const [minuteResult, eventPayload, auctionBundle] = await Promise.all([
    fetchCbMinutePayload(normalizedCode, tradingDate),
    fetchLocalJson(`/events?${eventQuery.toString()}`, 30_000),
    loadCbAuctionPair(normalizedCode, tradingDate),
  ]);
  let refreshedEventPayload = eventPayload;
  if (minuteResult.autoBackfill.attempted) {
    refreshedEventPayload = await fetchLocalJson(
      `/events?${eventQuery.toString()}`,
      30_000,
    ).catch(() => eventPayload);
  }
  return {
    code: normalizedCode,
    tradingDate,
    health,
    bond: minuteResult.payload,
    autoBackfill: minuteResult.autoBackfill,
    events: Array.isArray(refreshedEventPayload?.events) ? refreshedEventPayload.events : [],
    eventPayload: refreshedEventPayload,
    auctionBundle,
  };
}

function cbQuoteExecutionState(quote, now = Date.now()) {
  const clock = chinaDateTimeParts(now);
  const currentDate = clock.date.replaceAll("-", "");
  const quoteDate = String(quote?.date || quote?.timetag || "").replace(/\D/g, "").slice(0, 8);
  const weekday = chinaWeekday(clock);
  const marketOpen = weekday >= 1 && weekday <= 5 && (
    (clock.time >= "09:30:00" && clock.time <= "11:30:30")
    || (clock.time >= "13:00:00" && clock.time <= "15:00:30")
  );
  const timestamp = Number(quote?.timestamp || 0);
  const ageSeconds = timestamp > 0 ? Math.max(0, (now - timestamp) / 1000) : null;
  if (!marketOpen) {
    return { executable: false, quality: "market_closed_last_quote", reason: "当前不在连续交易时段" };
  }
  if (quoteDate !== currentDate) {
    return { executable: false, quality: "stale_trading_date", reason: `报价日期${quoteDate || "未知"}不是今日${currentDate}` };
  }
  if (ageSeconds === null || ageSeconds > 180) {
    return { executable: false, quality: "stale_quote", reason: `报价延迟${ageSeconds === null ? "未知" : `${Math.round(ageSeconds)}秒`}` };
  }
  return { executable: true, quality: "live_miniqmt_quote", reason: "QMT交易时段有效报价" };
}

function expectedCompletedCbDate(health, now = Date.now()) {
  const clock = chinaDateTimeParts(now);
  const currentDate = clock.date.replaceAll("-", "");
  const dates = [...new Set(
    (Array.isArray(health?.available_dates) ? health.available_dates : [])
      .map((value) => String(value || "").replace(/\D/g, "").slice(0, 8))
      .filter((value) => /^\d{8}$/.test(value)),
  )].sort().reverse();
  const currentDayIncomplete = clock.time < "15:05:00";
  return dates.find((date) => (
    currentDayIncomplete && date === currentDate ? false : date <= currentDate
  )) || "";
}

async function loadCbPaperState() {
  if (cbPaperStateCache) return cbPaperStateCache;
  let raw;
  try {
    raw = await readJsonFile(CB_PAPER_STATE_PATH);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    raw = createPaperState();
  }
  cbPaperStateCache = normalizePaperState(raw);
  if (cbPaperStateCache.runtime.running) {
    cbPaperStateCache.runtime.running = false;
    cbPaperStateCache.runtime.stopped_reason = "服务重启后已安全停止，请手动恢复模拟轮询";
  }
  return cbPaperStateCache;
}

async function saveCbPaperState(state) {
  cbPaperStateCache = normalizePaperState(state);
  await fs.promises.mkdir(path.dirname(CB_PAPER_STATE_PATH), { recursive: true });
  await writeJsonAtomic(CB_PAPER_STATE_PATH, cbPaperStateCache);
  return cbPaperStateCache;
}

function withCbPaperMutation(mutator) {
  const task = cbPaperMutationChain.then(async () => {
    const current = await loadCbPaperState();
    const next = await mutator(normalizePaperState(current));
    return saveCbPaperState(next);
  });
  cbPaperMutationChain = task.catch(() => {});
  return task;
}

function applyCbPaperSettings(state, body = {}) {
  const strategy = String(body.strategy || state.settings.strategy || "ma20_cross");
  const supportedStrategies = new Set([
    "intraday_confluence_kelly",
    "atr_dynamic_grid",
    ...listCbQuantStrategies().map((item) => item.name),
  ]);
  if (!supportedStrategies.has(strategy)) throw new Error(`未知模拟策略: ${strategy}`);
  const codes = body.codes === undefined
    ? normalizedCbQuantCodes(state.settings.codes)
    : normalizedCbQuantCodes(body.codes);
  state.settings = {
    ...state.settings,
    codes,
    strategy,
    allocation_pct: Math.max(1, Math.min(100, Number(body.allocation_pct ?? state.settings.allocation_pct) || 20)),
    commission_rate: Math.max(0, Math.min(0.01, Number(body.commission_rate ?? state.settings.commission_rate) || 0)),
    slippage_bps: Math.max(0, Math.min(100, Number(body.slippage_bps ?? state.settings.slippage_bps) || 0)),
    cycle_seconds: Math.max(5, Math.min(3600, Number(body.cycle_seconds ?? state.settings.cycle_seconds) || 60)),
    win_rate: Math.max(0.01, Math.min(0.99, Number(body.win_rate ?? state.settings.win_rate) || 0.52)),
    kelly_discount: Math.max(0, Math.min(1, Number(body.kelly_discount ?? state.settings.kelly_discount) || 0.25)),
    max_risk_pct: Math.max(0.0005, Math.min(0.03, Number(body.max_risk_pct ?? state.settings.max_risk_pct) || 0.005)),
    max_position_pct: Math.max(0.01, Math.min(1, Number(body.max_position_pct ?? state.settings.max_position_pct) || 0.2)),
    take1_r: Math.max(0.5, Math.min(3, Number(body.take1_r ?? state.settings.take1_r) || 1)),
    take2_r: Math.max(1, Math.min(6, Number(body.take2_r ?? state.settings.take2_r) || 2)),
    max_stop_pct: Math.max(0.005, Math.min(0.03, Number(body.max_stop_pct ?? state.settings.max_stop_pct) || 0.02)),
    grid_position_size: Math.max(10, Math.min(
      100_000,
      Math.floor((Number(body.grid_position_size ?? state.settings.grid_position_size) || 100) / 10) * 10,
    )),
    grid_max_position: Math.max(10, Math.min(
      10_000_000,
      Math.floor((Number(body.grid_max_position ?? state.settings.grid_max_position) || 500) / 10) * 10,
    )),
    grid_atr_period: Math.max(2, Math.min(120, Math.floor(Number(body.grid_atr_period ?? state.settings.grid_atr_period) || 14))),
    grid_atr_multiplier: Math.max(0.01, Math.min(10, Number(body.grid_atr_multiplier ?? state.settings.grid_atr_multiplier) || 0.5)),
    grid_min_spacing_pct: Math.max(0.01, Math.min(10, Number(body.grid_min_spacing_pct ?? state.settings.grid_min_spacing_pct) || 0.1)),
    grid_max_spacing_pct: Math.max(0.01, Math.min(20, Number(body.grid_max_spacing_pct ?? state.settings.grid_max_spacing_pct) || 0.8)),
    grid_ma_period: Math.max(2, Math.min(500, Math.floor(Number(body.grid_ma_period ?? state.settings.grid_ma_period) || 20))),
    grid_trend_threshold_pct: Math.max(0, Math.min(20, Number(body.grid_trend_threshold_pct ?? state.settings.grid_trend_threshold_pct) || 0.3)),
  };
  state.settings.take2_r = Math.max(state.settings.take1_r, state.settings.take2_r);
  state.settings.grid_max_position = Math.max(
    state.settings.grid_position_size,
    state.settings.grid_max_position,
  );
  state.settings.grid_max_spacing_pct = Math.max(
    state.settings.grid_min_spacing_pct,
    state.settings.grid_max_spacing_pct,
  );
  return state;
}

async function refreshCbPaperMarks() {
  return withCbPaperMutation(async (state) => {
    const codes = new Set([
      ...Object.keys(state.positions || {}),
      ...normalizedCbQuantCodes(state.settings.codes),
    ]);
    if (!codes.size) return state;
    const quotes = await fetchCbQuotes([...codes]);
    return markPaperState(state, quotes);
  });
}

async function runCbAtrGridPaperCode(state, code, quote, quoteState, dailyHealth) {
  if (!quote || !quoteState.executable || !(Number(quote.price) > 0)) return state;
  const tradingDate = normalizeCbTradingDate(quote.date || quote.timetag)
    || normalizeCbTradingDate(dailyHealth?.latest_trading_date);
  if (!tradingDate) throw new Error("ATR网格无法确定当前交易日");

  const { dailyPayload } = await fetchCbDailyPayloadWithAutoFill(code, 500, dailyHealth);
  const atr = calculateCbPriorDailyAtr(
    dailyPayload?.rows,
    tradingDate,
    state.settings.grid_atr_period,
  );
  const price = Number(quote.price);
  const quoteKey = `${tradingDate}|${quote.timetag || quote.timestamp || ""}|${price}`;
  const atrGridStates = state.strategy_state?.atr_grid || {};
  const previous = atrGridStates[code] && typeof atrGridStates[code] === "object"
    ? atrGridStates[code]
    : {};
  if (previous.last_quote_key === quoteKey) return state;

  const history = Array.isArray(previous.price_history)
    ? previous.price_history.slice(-499)
    : [];
  history.push({ key: quoteKey, price });
  const maPeriod = state.settings.grid_ma_period;
  const maValues = history.slice(-maPeriod).map((item) => Number(item.price)).filter(Number.isFinite);
  const ma = maValues.reduce((total, value) => total + value, 0) / Math.max(1, maValues.length);
  const initialized = Number(previous.base_price) > 0;
  let basePrice = initialized ? Number(previous.base_price) : price;
  if (ma > 0 && Math.abs(price - ma) / ma * 100 > state.settings.grid_trend_threshold_pct) {
    basePrice = ma;
  }
  const rawSpacing = atr.value > 0
    ? atr.value / price * 100 * state.settings.grid_atr_multiplier
    : state.settings.grid_min_spacing_pct;
  const spacingPct = Math.max(
    state.settings.grid_min_spacing_pct,
    Math.min(state.settings.grid_max_spacing_pct, rawSpacing),
  );
  const gridState = {
    ...previous,
    base_price: Number(basePrice.toFixed(4)),
    last_trigger_price: Number(previous.last_trigger_price) > 0
      ? Number(previous.last_trigger_price)
      : null,
    price_history: history,
    current_atr: atr.value,
    atr_complete: atr.complete,
    atr_sample_count: atr.sample_count,
    atr_last_completed_date: atr.last_completed_date,
    grid_spacing_pct: Number(spacingPct.toFixed(4)),
    ma: Number(ma.toFixed(4)),
    last_quote_key: quoteKey,
    updated_at: new Date().toISOString(),
  };
  state.strategy_state.atr_grid[code] = gridState;
  if (!initialized) return state;

  const referencePrice = Number(gridState.last_trigger_price) > 0
    ? Number(gridState.last_trigger_price)
    : basePrice;
  let side = "";
  if (price <= referencePrice * (1 - spacingPct / 100)) side = "buy";
  else if (price >= referencePrice * (1 + spacingPct / 100)) side = "sell";
  if (!side) return state;

  const signalKey = `${quoteKey}|${code}|atr_dynamic_grid|${side}`;
  if (state.processed_signal_keys.includes(signalKey)) return state;
  const position = state.positions[code];
  const currentQuantity = Number(position?.quantity || 0);
  let quantity = state.settings.grid_position_size;
  let status = "pending_paper_fill";
  let error = null;
  if (side === "buy") {
    quantity = Math.min(quantity, state.settings.grid_max_position - currentQuantity);
    quantity = Math.floor(quantity / 10) * 10;
    const requiredCash = quantity * price * (1 + state.settings.commission_rate);
    if (quantity < 10) {
      status = "grid_max_position";
      error = `持仓已达ATR网格上限 ${state.settings.grid_max_position}张`;
    } else if (requiredCash > state.cash) {
      status = "paper_cash_insufficient";
      error = `纸面现金不足以买入固定网格数量 ${quantity}张`;
    }
  } else {
    quantity = Math.floor(Math.min(quantity, Number(position?.available_quantity || 0)) / 10) * 10;
    if (quantity < 10) {
      status = "grid_position_unavailable";
      error = "没有足够纸面持仓执行本次网格卖出";
    }
  }

  const signalRecord = {
    time: new Date().toISOString(),
    signal_key: signalKey,
    signal_date: `${tradingDate} ${quote.timetag || ""}`,
    code,
    strategy: "atr_dynamic_grid",
    side,
    reason: `价格${side === "buy" ? "下穿" : "上穿"}参考价一个ATR网格（${spacingPct.toFixed(3)}%）`,
    values: {
      price,
      reference_price: Number(referencePrice.toFixed(4)),
      base_price: Number(basePrice.toFixed(4)),
      ma: Number(ma.toFixed(4)),
      atr: atr.value,
      atr_complete: atr.complete,
      grid_spacing_pct: Number(spacingPct.toFixed(4)),
    },
    data_source: `${dailyPayload?.source || "QMT日K"} + ${quote.source || "QMT full_tick"}`,
    quote_quality: quoteState.quality,
    status,
    error,
  };
  state.signals.push(signalRecord);
  state.processed_signal_keys.push(signalKey);
  if (status !== "pending_paper_fill") return state;

  const next = executePaperOrder(state, {
    code,
    name: quote.name,
    side,
    quantity,
    price,
    commissionRate: state.settings.commission_rate,
    slippageBps: state.settings.slippage_bps,
    strategy: "atr_dynamic_grid",
    reason: signalRecord.reason,
    timestamp: quote.timetag || new Date().toISOString(),
    quoteSource: quote.source,
    quoteQuality: quoteState.quality,
    entrySignalKey: signalKey,
  });
  const filledPrice = Number(next.fills.at(-1)?.price || price);
  next.strategy_state.atr_grid[code] = {
    ...gridState,
    last_trigger_price: filledPrice,
    last_trade_at: quote.timetag || new Date().toISOString(),
  };
  const updatedRecord = next.signals.find((item) => item.signal_key === signalKey);
  if (updatedRecord) {
    updatedRecord.status = "paper_filled";
    updatedRecord.error = null;
  }
  return next;
}

async function runCbPaperCycle(options = {}) {
  if (cbPaperCycleInFlight) return cbPaperCycleInFlight;
  cbPaperCycleInFlight = withCbPaperMutation(async (state) => {
    const manual = options.manual === true;
    if (!manual && !state.runtime.running) return state;
    const codes = normalizedCbQuantCodes(state.settings.codes);
    if (!codes.length) throw new Error("请先设置至少一只模拟盘可转债");
    const quotes = await fetchCbQuotes(codes);
    const quoteMap = new Map(
      quotes.map((quote) => [normalizeConvertibleBondCode(quote.monitor_code || quote.code), quote]),
    );
    let next = markPaperState(state, quotes);
    const cycleErrors = [];
    const confluenceMode = next.settings.strategy === "intraday_confluence_kelly";
    const atrGridMode = next.settings.strategy === "atr_dynamic_grid";
    const intradayMode = confluenceMode || atrGridMode;
    const dailyHealth = confluenceMode
      ? null
      : await fetchLocalJson("/health", 8_000).catch(() => null);
    for (const code of codes) {
      try {
        if (!intradayMode) {
          const {
            dailyPayload,
            expectedCompletedDate,
          } = await fetchCbDailyPayloadWithAutoFill(code, 500, dailyHealth);
          const prepared = completedCbDailyRows(dailyPayload, true);
          const latestBar = prepared.rows.at(-1);
          if (!latestBar) throw new Error("没有可用于日线策略的已完成日K");
          const signal = evaluateStrategy(next.settings.strategy, prepared.rows);
          if (!signal || !["buy", "sell"].includes(signal.side)) continue;
          const signalKey = `${latestBar.date}|${code}|${next.settings.strategy}|${signal.side}`;
          if (next.processed_signal_keys.includes(signalKey)) continue;
          const quote = quoteMap.get(code);
          const quoteState = cbQuoteExecutionState(quote);
          const position = next.positions[code];
          const expectedDate = expectedCompletedDate || "";
          const historyFresh = !expectedDate || String(latestBar.date) >= expectedDate;
          const eligible = signal.side === "buy" ? !position : Boolean(position);
          let status = "pending_paper_fill";
          let error = null;
          if (!historyFresh) {
            status = "daily_history_stale";
            error = `日K只到${latestBar.date}，预期至少到${expectedDate}`;
          } else if (!eligible) {
            status = signal.side === "buy" ? "position_already_open" : "position_unavailable";
            error = signal.side === "buy" ? "已有模拟持仓，不重复买入" : "没有可卖模拟持仓";
          } else if (!quote) {
            status = "quote_unavailable";
            error = "QMT报价不可用";
          } else if (!quoteState.executable) {
            status = "market_closed_waiting";
            error = quoteState.reason;
          }
          let signalRecord = next.signals.find((item) => item.signal_key === signalKey);
          const recordValues = {
            time: new Date().toISOString(),
            signal_key: signalKey,
            signal_date: String(latestBar.date),
            code,
            strategy: next.settings.strategy,
            side: signal.side,
            reason: signal.reason,
            values: signal.values,
            data_source: dailyPayload.source,
            quote_quality: quoteState.quality,
            status,
            error,
          };
          if (signalRecord) Object.assign(signalRecord, recordValues);
          else {
            signalRecord = recordValues;
            next.signals.push(signalRecord);
          }
          if (status === "pending_paper_fill") {
            next = executePaperOrder(next, {
              code,
              side: signal.side,
              quantity: signal.side === "sell" ? position.available_quantity : undefined,
              price: quote.price,
              allocationPct: next.settings.allocation_pct,
              commissionRate: next.settings.commission_rate,
              slippageBps: next.settings.slippage_bps,
              strategy: next.settings.strategy,
              reason: signal.reason,
              timestamp: quote.timetag || new Date().toISOString(),
              quoteSource: quote.source,
              quoteQuality: quoteState.quality,
              entrySignalKey: signalKey,
            });
            const updatedRecord = next.signals.find((item) => item.signal_key === signalKey);
            if (updatedRecord) {
              updatedRecord.status = "paper_filled";
              updatedRecord.error = null;
            }
            next.processed_signal_keys.push(signalKey);
          }
          continue;
        }
        if (atrGridMode) {
          const quote = quoteMap.get(code);
          const quoteState = cbQuoteExecutionState(quote);
          next = await runCbAtrGridPaperCode(next, code, quote, quoteState, dailyHealth);
          continue;
        }
        const bundle = await fetchCbIntradayBundle(code);
        const analysis = findCbIntradayEntry({
          code,
          date: bundle.tradingDate,
          rows: bundle.bond?.rows,
          events: bundle.events,
          auction: bundle.auctionBundle.auction,
        });
        const quote = quoteMap.get(code);
        const quoteState = cbQuoteExecutionState(quote);
        const position = next.positions[code];
        if (position?.risk_plan) {
          const riskPlan = position.risk_plan;
          const mark = Number(quote?.price);
          let side = "";
          let quantity = 0;
          let reason = "";
          let exitKey = "";
          if (quoteState.executable && Number.isFinite(mark)) {
            if (mark <= Number(riskPlan.stop_price)) {
              side = "sell";
              quantity = position.available_quantity;
              reason = "触发结构/移动保护止损";
              exitKey = `${position.entry_signal_key}|stop`;
            } else if (mark >= Number(riskPlan.take2_price)) {
              side = "sell";
              quantity = position.available_quantity;
              reason = "达到目标R，退出剩余仓位";
              exitKey = `${position.entry_signal_key}|take2`;
            } else if (!riskPlan.take1_done && mark >= Number(riskPlan.take1_price)) {
              side = "sell";
              quantity = Math.floor((position.available_quantity / 2) / 10) * 10;
              reason = "达到1R，分步止盈一半";
              exitKey = `${position.entry_signal_key}|take1`;
            }
          }
          if (side && quantity >= 10 && !next.processed_signal_keys.includes(exitKey)) {
            next = executePaperOrder(next, {
              code,
              side,
              quantity,
              price: mark,
              commissionRate: next.settings.commission_rate,
              slippageBps: next.settings.slippage_bps,
              strategy: next.settings.strategy,
              reason,
              timestamp: quote.timetag || new Date().toISOString(),
              quoteSource: quote.source,
              quoteQuality: quoteState.quality,
            });
            if (next.positions[code] && exitKey.endsWith("|take1")) {
              next.positions[code].risk_plan = {
                ...riskPlan,
                take1_done: true,
                stop_price: Math.max(Number(riskPlan.stop_price), Number(riskPlan.entry_price)),
              };
            }
            next.processed_signal_keys.push(exitKey);
            next.signals.push({
              time: new Date().toISOString(),
              signal_key: exitKey,
              signal_date: `${bundle.tradingDate} ${quote.timetag || ""}`,
              code,
              strategy: next.settings.strategy,
              side,
              reason,
              status: "paper_filled",
              quote_quality: quoteState.quality,
            });
          }
          continue;
        }
        if (position) continue;

        const signal = analysis.entry_signal;
        if (!signal || next.processed_signal_keys.includes(signal.key)) continue;
        const plan = buildCbIntradayTradePlan({
          rows: analysis.rows,
          entrySignal: signal,
          initialCash: next.total_asset,
          commissionRate: next.settings.commission_rate,
          slippageBps: next.settings.slippage_bps,
          winRate: next.settings.win_rate,
          kellyDiscount: next.settings.kelly_discount,
          maxRiskPct: next.settings.max_risk_pct,
          maxPositionPct: next.settings.max_position_pct,
          maxStopPct: next.settings.max_stop_pct,
          take1R: next.settings.take1_r,
          take2R: next.settings.take2_r,
        });
        const signalDate = `${bundle.tradingDate.slice(0, 4)}-${bundle.tradingDate.slice(4, 6)}-${bundle.tradingDate.slice(6, 8)}`;
        const signalEpoch = Date.parse(`${signalDate}T${signal.signal_time}+08:00`);
        const signalAgeSeconds = Number.isFinite(signalEpoch) ? (Date.now() - signalEpoch) / 1000 : Infinity;
        const freshSignal = signalAgeSeconds >= 0 && signalAgeSeconds <= 180;
        const signalRecord = {
          time: new Date().toISOString(),
          signal_key: signal.key,
          signal_date: `${bundle.tradingDate} ${signal.signal_time}`,
          code,
          strategy: next.settings.strategy,
          side: "buy",
          reason: "竞价状态允许，紫线/均价、资金与动量完成组合确认",
          values: { score: signal.score, reason_codes: signal.reason_codes },
          data_source: bundle.bond?.source,
          quote_quality: quoteState.quality,
          signal_age_seconds: Math.round(signalAgeSeconds),
          status: !freshSignal
            ? "intraday_signal_expired"
            : !plan || plan.quantity < 10
              ? "kelly_size_rejected"
              : !quote
                ? "quote_unavailable"
                : !quoteState.executable
                  ? "market_closed_waiting"
                  : "pending_paper_fill",
          error: !freshSignal ? "日内信号超过180秒，不追单" : !quoteState.executable ? quoteState.reason : null,
        };
        next.signals.push(signalRecord);
        if (!freshSignal || !plan || plan.quantity < 10) {
          next.processed_signal_keys.push(signal.key);
        }
        if (freshSignal && plan?.quantity >= 10 && quote && quoteState.executable) {
          const riskDistance = Number(quote.price) * Number(plan.stop_pct);
          const liveRiskPlan = {
            ...plan,
            entry_price: Number(quote.price),
            stop_price: Number(quote.price) - riskDistance,
            take1_price: Number(quote.price) + riskDistance * Number(plan.take1_r),
            take2_price: Number(quote.price) + riskDistance * Number(plan.take2_r),
            take1_done: false,
          };
          next = executePaperOrder(next, {
            code,
            name: bundle.bond?.name,
            side: "buy",
            quantity: plan.quantity,
            price: quote.price,
            commissionRate: next.settings.commission_rate,
            slippageBps: next.settings.slippage_bps,
            strategy: next.settings.strategy,
            reason: signalRecord.reason,
            timestamp: quote.timetag || new Date().toISOString(),
            quoteSource: quote.source,
            quoteQuality: quoteState.quality,
            riskPlan: liveRiskPlan,
            entrySignalKey: signal.key,
          });
          const filledPosition = next.positions[code];
          const actualEntryPrice = Number(filledPosition?.average_cost);
          if (filledPosition && Number.isFinite(actualEntryPrice)) {
            const actualRiskDistance = actualEntryPrice * Number(plan.stop_pct);
            filledPosition.risk_plan = {
              ...liveRiskPlan,
              entry_price: actualEntryPrice,
              stop_price: actualEntryPrice - actualRiskDistance,
              take1_price: actualEntryPrice + actualRiskDistance * Number(plan.take1_r),
              take2_price: actualEntryPrice + actualRiskDistance * Number(plan.take2_r),
            };
          }
          signalRecord.status = "paper_filled";
          signalRecord.error = null;
          next.processed_signal_keys.push(signal.key);
        }
      } catch (error) {
        cycleErrors.push(`${code}: ${error.message}`);
      }
    }

    next.signals = next.signals.slice(-500);
    next.processed_signal_keys = next.processed_signal_keys.slice(-1000);
    next.runtime.cycle_count = Number(next.runtime.cycle_count || 0) + 1;
    next.runtime.last_cycle_at = new Date().toISOString();
    next.runtime.last_error = cycleErrors.length ? cycleErrors.join("；") : null;
    next.updated_at = new Date().toISOString();
    return next;
  }).finally(() => {
    cbPaperCycleInFlight = null;
  });
  return cbPaperCycleInFlight;
}

function scheduleCbPaperCycle(delay = 0) {
  if (cbPaperCycleTimer) clearTimeout(cbPaperCycleTimer);
  if (shuttingDown) return;
  cbPaperCycleTimer = setTimeout(async () => {
    cbPaperCycleTimer = null;
    try {
      const state = await loadCbPaperState();
      if (!state.runtime.running) return;
      await runCbPaperCycle();
    } catch (error) {
      console.warn(`CB paper cycle failed: ${error.message}`);
    }
    const state = await loadCbPaperState().catch(() => null);
    if (state?.runtime?.running) {
      scheduleCbPaperCycle(Number(state.settings.cycle_seconds || 60) * 1000);
    }
  }, Math.max(0, delay));
}

async function handleCbIntradayReplay(request, response) {
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" });
    response.end("Method not allowed");
    return;
  }
  const body = await readJsonBody(request, 128 * 1024);
  const bundle = await fetchCbIntradayBundle(body.code, body.date || body.trading_date);
  const payload = replayCbIntraday({
    code: bundle.code,
    name: bundle.bond?.name || bundle.code,
    date: bundle.tradingDate,
    rows: bundle.bond?.rows,
    events: bundle.events,
    auction: bundle.auctionBundle.auction,
    initialCash: body.initial_cash,
    commissionRate: body.commission_rate,
    slippageBps: body.slippage_bps,
    winRate: body.win_rate,
    kellyDiscount: body.kelly_discount,
    maxRiskPct: body.max_risk_pct,
    maxPositionPct: body.max_position_pct,
    calibrationSampleSize: body.calibration_sample_size,
    minStopPct: body.min_stop_pct,
    maxStopPct: body.max_stop_pct,
    stopBufferPct: body.stop_buffer_pct,
    take1R: body.take1_r,
    take2R: body.take2_r,
    trailingPurpleBufferPct: body.trailing_purple_buffer_pct,
  });
  payload.data_quality = {
    source: bundle.bond?.source || "QMT本地监控",
    trading_date: bundle.tradingDate,
    minute_bar_count: Array.isArray(bundle.bond?.rows) ? bundle.bond.rows.length : 0,
    complete_session: bundle.bond?.complete_session === true,
    event_count: bundle.events.length,
    indicator_warmup: bundle.health?.status?.indicator_warmup?.status || null,
    auction_quality: bundle.auctionBundle.auction.quality,
    auction_source_date: bundle.auctionBundle.source_date,
    auto_backfill: bundle.autoBackfill,
    missing_data: {
      minute_bars: bundle.bond?.complete_session === true
        ? "complete"
        : "incomplete_after_auto_backfill",
      monitor_events: bundle.events.length
        ? "available"
        : "monitor_generated_events_cannot_be_reconstructed_from_market_history",
      auction: bundle.auctionBundle.auction.status !== "unavailable"
        ? "available"
        : "historical_auction_snapshot_unavailable",
    },
    database_updated_at: bundle.bond?.database_updated_at || null,
    data_is_stale: bundle.bond?.realtime?.data_is_stale === true,
    l1_boundary: "主力资金、五档支撑与竞价均为QMT L1汇总/公式近似，不是Level-2逐笔主动买卖。",
  };
  payload.boundary = "历史日内回放与纸面模拟；不连接真实账户，不调用下单、撤单或修改实盘风控接口。";
  payload.account_execution_review = await loadCbAccountExecutionReview(
    bundle.code,
    bundle.tradingDate,
  );
  sendJson(response, 200, payload);
}

async function handleCbBacktest(request, response) {
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" });
    response.end("Method not allowed");
    return;
  }
  const body = await readJsonBody(request, 128 * 1024);
  const code = normalizeConvertibleBondCode(body.code);
  const health = await fetchLocalJson("/health", 5_000).catch(() => null);
  const {
    dailyPayload,
    expectedCompletedDate,
    latestDayAutoBackfill,
  } = await fetchCbDailyPayloadWithAutoFill(code, body.count || 500, health);
  const prepared = completedCbDailyRows(
    dailyPayload,
    body.completed_bars_only !== false,
  );
  const options = {
    code,
    bars: prepared.rows,
    startDate: body.start_date,
    endDate: body.end_date,
    initialCash: body.initial_cash,
    commissionRate: body.commission_rate,
    slippageBps: body.slippage_bps,
    positionPct: body.position_pct,
  };
  const payload = body.compare === true || body.strategy === "all"
    ? compareStrategies(options)
    : runCbBacktest({ ...options, strategy: body.strategy });
  payload.data_quality = {
    source: dailyPayload.source,
    generated_at: dailyPayload.generated_at,
    requested_count: dailyPayload.requested_count,
    returned_count: prepared.rows.length,
    start_date: prepared.rows[0]?.date || null,
    end_date: prepared.rows.at(-1)?.date || null,
    completed_bars_only: body.completed_bars_only !== false,
    provisional_bar_dropped: prepared.droppedProvisional,
    download_error: dailyPayload.download_error,
    live_tick_error: dailyPayload.live_tick_error,
    expected_completed_date: expectedCompletedDate || null,
    auto_local_reference_fill_count: Number(dailyPayload.auto_local_reference_fill_count || 0),
    latest_day_auto_backfill: latestDayAutoBackfill,
  };
  payload.data_quality.history_is_stale = Boolean(
    payload.data_quality.expected_completed_date
    && payload.data_quality.end_date
    && payload.data_quality.end_date < payload.data_quality.expected_completed_date
  );
  payload.data_quality.quality_status = payload.data_quality.history_is_stale
    ? "stale_history_gap"
    : "available_history_complete_to_expected_date";
  payload.boundary = "历史研究/纸面模拟，不连接真实账户，不调用下单或撤单接口";
  sendJson(response, 200, payload);
}

async function handleCbAtrGridBacktest(request, response) {
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" });
    response.end("Method not allowed");
    return;
  }
  const body = await readJsonBody(request, 128 * 1024);
  const code = normalizeConvertibleBondCode(body.code);
  const health = await fetchLocalJson("/health", 8_000).catch(() => null);
  const tradingDate = normalizeCbTradingDate(body.date || body.trading_date)
    || normalizeCbTradingDate(health?.latest_trading_date);
  if (!tradingDate) throw new Error("无法确定ATR网格回测交易日");

  const [minuteResult, dailyResult] = await Promise.all([
    fetchCbMinutePayload(code, tradingDate),
    fetchCbDailyPayloadWithAutoFill(code, body.count || 500, health),
  ]);
  const minutePayload = minuteResult.payload;
  const dailyPayload = dailyResult.dailyPayload;
  const payload = runCbAtrGridBacktest({
    code,
    name: minutePayload?.name || code,
    tradingDate,
    minuteBars: minutePayload?.rows,
    dailyBars: dailyPayload?.rows,
    initialCash: body.initial_cash,
    initialPosition: body.initial_position,
    positionSize: body.position_size,
    maxPosition: body.max_position,
    atrPeriod: body.atr_period,
    atrMultiplier: body.atr_multiplier,
    minGridSpacingPct: body.min_grid_spacing_pct,
    maxGridSpacingPct: body.max_grid_spacing_pct,
    maPeriod: body.ma_period,
    trendThresholdPct: body.trend_threshold_pct,
    commissionRate: body.commission_rate,
    slippageBps: body.slippage_bps,
  });
  payload.data_quality = {
    trading_date: tradingDate,
    minute_source: minutePayload?.source || "QMT本地分钟库",
    minute_bar_count: Array.isArray(minutePayload?.rows) ? minutePayload.rows.length : 0,
    complete_session: minutePayload?.complete_session === true,
    minute_auto_backfill: minuteResult.autoBackfill,
    daily_source: dailyPayload?.source || "QMT/QMT日K",
    daily_bar_count: Array.isArray(dailyPayload?.rows) ? dailyPayload.rows.length : 0,
    expected_completed_date: dailyResult.expectedCompletedDate || null,
    latest_day_auto_backfill: dailyResult.latestDayAutoBackfill,
    atr_last_completed_date: payload.atr.last_completed_date,
    atr_sample_count: payload.atr.sample_count,
    atr_complete: payload.atr.complete,
    quality_status: minutePayload?.complete_session === true && payload.atr.complete
      ? "complete_minute_and_prior_daily_atr"
      : "available_with_explicit_fallback",
    missing_data: {
      minute_bars: minutePayload?.complete_session === true
        ? "complete"
        : "incomplete_after_auto_backfill",
      prior_daily_atr: payload.atr.complete
        ? "complete"
        : "insufficient_completed_daily_bars_using_minimum_spacing",
      order_book: payload.trades.some((trade) => trade.quote_source !== "next_minute_open_fallback")
        ? "partially_available"
        : "ask1_bid1_unavailable_using_next_minute_open",
    },
  };
  payload.boundary = "ATR动态网格历史回放；只读获取日线和分钟数据，不连接真实账户，不调用下单、撤单或修改实盘风控接口。";
  sendJson(response, 200, payload);
}

async function handleCbPortfolioBacktest(request, response) {
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" });
    response.end("Method not allowed");
    return;
  }
  const body = await readJsonBody(request, 128 * 1024);
  const startDate = normalizeCbPortfolioDate(body.start_date);
  const endDate = normalizeCbPortfolioDate(body.end_date);
  if (!startDate || !endDate || startDate > endDate) throw new Error("组合回测开始/结束日期无效");

  const factorBundle = await loadCbPortfolioFactors({ startDate, endDate });
  const ranking = buildCbPortfolioRankings({
    strategy: body.strategy,
    factorRows: factorBundle.factorRows,
    names: factorBundle.names,
    startDate,
    endDate,
    topN: body.top_n,
    minPrice: body.min_price,
    maxPrice: body.max_price,
    minPremium: body.min_premium,
    maxPremium: body.max_premium,
    maxDoubleLow: body.max_double_low,
    maxBalanceBillion: body.max_balance_billion,
    minMaScore: body.min_ma_score,
  });
  if (!ranking.candidateCodes.length) throw new Error("严格字段与价格过滤后没有组合候选");

  const qmtFailures = [];
  const qmtChunks = await mapConcurrent(ranking.candidateCodes, 4, async (code) => {
    try {
      const daily = await fetchCbDailyPayload(code, 500);
      return (daily.rows || []).filter((row) => {
        const date = normalizeCbPortfolioDate(row.date);
        return date >= startDate && date <= endDate;
      }).map((row) => ({ ...row, code, source: daily.source || "QMT/QMT日K" }));
    } catch (error) {
      qmtFailures.push({ code, error: error.message });
      return [];
    }
  });
  const qmtRows = qmtChunks.flat();
  const eastmoney = await loadCbEastmoneyOpenRows(
    ranking.candidateCodes,
    startDate,
    endDate,
  );
  const openByKey = new Map();
  const qmtKeys = new Set(qmtRows.map((row) => `${normalizeCbPortfolioDate(row.date)}|${row.code}`));
  const eastmoneyFallbackRows = eastmoney.rows.filter((row) => !qmtKeys.has(`${row.date}|${row.code}`));
  const eastmoneyFallbackCodes = new Set(eastmoneyFallbackRows.map((row) => row.code));
  for (const row of eastmoney.rows) openByKey.set(`${row.date}|${row.code}`, row);
  for (const row of qmtRows) {
    const date = normalizeCbPortfolioDate(row.date);
    if (date) openByKey.set(`${date}|${row.code}`, { ...row, date, source: row.source || "QMT/QMT日K" });
  }

  const payload = runCbPortfolioBacktest({
    ranking,
    openRows: [...openByKey.values()],
    initialCash: body.initial_cash,
    commissionRate: body.commission_rate,
    slippageBps: body.slippage_bps,
    rebalanceEvery: body.rebalance_every,
  });
  const qmtCodes = new Set(qmtRows.map((row) => row.code));
  payload.data_quality = {
    ...factorBundle.status,
    factor_source: factorBundle.status.source,
    source: "东方财富历史转债截面 + QMT/QMT日K优先 + 东方财富日K自动补缺",
    strategy_dates: ranking.dates.length,
    strategy_candidate_codes: ranking.candidateCodes.length,
    qmt_requested_codes: ranking.candidateCodes.length,
    qmt_returned_codes: qmtCodes.size,
    qmt_returned_rows: qmtRows.length,
    qmt_failed_codes: qmtFailures,
    eastmoney_kline: eastmoney.status,
    eastmoney_fallback_codes: eastmoneyFallbackCodes.size,
    eastmoney_fallback_rows: eastmoneyFallbackRows.length,
    merged_open_rows: openByKey.size,
    strict_factor_policy: "必需字段缺失即排除；不以当前余额或中性常数倒填历史",
    premium_policy: "优先使用历史转股溢价率；缺失时仅用同日收盘/同日转股价值重算",
    balance_policy: "剩余余额只按该券历史已披露值向后结转，不向过去回填",
    event_limit: "尚未接入逐公告时点的强赎/下修事件过滤，结果不得视为生产级回测",
  };
  payload.data_quality.quality_status = qmtFailures.length || eastmoney.status.failed_codes.length
    ? "available_with_partial_daily_failures"
    : "available_with_strict_factor_filter";
  payload.boundary = "历史研究/纸面模拟；独立复现 EasyXT 策略规则，不复制其专有源码；不连接真实账户，不调用下单或撤单接口。";
  sendJson(response, 200, payload);
}

async function handleCbPaperMutation(request, response, pathname) {
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" });
    response.end("Method not allowed");
    return;
  }
  if (!isLoopbackRequest(request) || !isSameOriginRequest(request)) {
    sendJson(response, 403, { error: "模拟盘状态修改仅允许从本机同源页面执行" });
    return;
  }
  const body = await readJsonBody(request, 64 * 1024);
  let payload;
  if (pathname === "/api/cb-quant/paper/reset") {
    payload = await withCbPaperMutation(async (current) => {
      const next = createPaperState(body.initial_cash);
      next.settings = { ...next.settings, ...current.settings };
      applyCbPaperSettings(next, body);
      next.runtime.stopped_reason = "用户重置模拟账户";
      return next;
    });
  } else if (pathname === "/api/cb-quant/paper/start") {
    payload = await withCbPaperMutation(async (state) => {
      applyCbPaperSettings(state, body);
      if (!state.settings.codes.length) throw new Error("请先设置至少一只模拟盘可转债");
      state.runtime.running = true;
      state.runtime.last_error = null;
      state.runtime.stopped_reason = null;
      state.updated_at = new Date().toISOString();
      return state;
    });
    scheduleCbPaperCycle(50);
  } else if (pathname === "/api/cb-quant/paper/stop") {
    if (cbPaperCycleTimer) clearTimeout(cbPaperCycleTimer);
    cbPaperCycleTimer = null;
    payload = await withCbPaperMutation(async (state) => {
      state.runtime.running = false;
      state.runtime.stopped_reason = "用户停止模拟轮询";
      state.updated_at = new Date().toISOString();
      return state;
    });
  } else if (pathname === "/api/cb-quant/paper/cycle") {
    payload = await runCbPaperCycle({ manual: true });
  } else if (pathname === "/api/cb-quant/paper/order") {
    const code = normalizeConvertibleBondCode(body.code);
    const quotes = await fetchCbQuotes([code]);
    const quote = quotes[0];
    if (!quote) throw new Error(`${code} 暂无QMT实时价格，不能模拟成交`);
    const quoteState = cbQuoteExecutionState(quote);
    if (!quoteState.executable) {
      throw new Error(`${code} 当前不能模拟成交：${quoteState.reason}`);
    }
    payload = await withCbPaperMutation(async (state) => executePaperOrder(state, {
      code,
      side: body.side,
      quantity: body.quantity,
      price: quote.price,
      commissionRate: body.commission_rate ?? state.settings.commission_rate,
      slippageBps: body.slippage_bps ?? state.settings.slippage_bps,
      strategy: "manual",
      reason: body.reason || "页面手工模拟委托",
      timestamp: quote.timetag || new Date().toISOString(),
      quoteSource: quote.source,
      quoteQuality: quoteState.quality,
    }));
  } else {
    sendJson(response, 404, { error: "not found" });
    return;
  }
  sendJson(response, 200, payload);
}

async function handleCbQuant(request, response, url) {
  try {
    if (url.pathname === "/api/cb-quant/strategies") {
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" });
        response.end("Method not allowed");
        return;
      }
      sendJson(response, 200, {
        ok: true,
        strategies: listCbQuantStrategies(),
        portfolio_strategies: listCbPortfolioStrategies(),
        grid_strategies: [{
          name: "atr_dynamic_grid",
          label: "ATR动态网格（日内）",
          group: "日内网格",
          description: "前一交易日完成后的日线ATR决定网格宽度，日内MA动态调整基准价，下一分钟纸面成交。",
        }],
        intraday_strategies: [{
          name: "intraday_confluence_kelly",
          label: "日内组合确认 + 折扣凯利",
          group: "日内事件",
          description: "竞价定基调，紫线/分时均价为Setup，资金与动量共振触发，结构止损与R倍数分步止盈。",
        }],
        assumptions: {
          asset: "沪深可转债",
          lot_size: 10,
          settlement: "T+0",
          stamp_duty: 0,
          daily_signal_execution: "日线收盘出信号，下一根日K开盘成交",
          intraday_signal_execution: "日内事件确认，下一分钟开盘成交",
          l1_boundary: "主力资金和竞价信号是L1汇总/公式近似，不是Level-2逐笔事实",
        },
      });
      return;
    }
    if (url.pathname === "/api/cb-quant/replay") {
      await handleCbIntradayReplay(request, response);
      return;
    }
    if (url.pathname === "/api/cb-quant/atr-grid-backtest") {
      await handleCbAtrGridBacktest(request, response);
      return;
    }
    if (url.pathname === "/api/cb-quant/portfolio-backtest") {
      await handleCbPortfolioBacktest(request, response);
      return;
    }
    if (url.pathname === "/api/cb-quant/backtest") {
      await handleCbBacktest(request, response);
      return;
    }
    if (url.pathname === "/api/cb-quant/paper") {
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" });
        response.end("Method not allowed");
        return;
      }
      const payload = url.searchParams.get("refresh") === "1"
        ? await refreshCbPaperMarks()
        : await loadCbPaperState();
      sendJson(response, 200, payload);
      return;
    }
    if (url.pathname.startsWith("/api/cb-quant/paper/")) {
      await handleCbPaperMutation(request, response, url.pathname);
      return;
    }
    sendJson(response, 404, { error: "not found" });
  } catch (error) {
    sendJson(response, cbQuantErrorStatus(error), {
      error: error instanceof Error ? error.message : "可转债量化服务失败",
      service: "cb-quant",
    });
  }
}

async function handleBondTagsGet(url, response) {
  const [
    tagPayload,
    rawUniverse,
    overridePayload,
    swIndustryPayload,
    referenceOverrides,
    lifecyclePayload,
  ] = await Promise.all([
    readJsonFile(BOND_TAGS_PATH),
    readJsonFile(NEW_BOND_UNIVERSE_PATH).catch(() => ({})),
    readJsonFile(BOND_TAG_OVERRIDES_PATH).catch(() => ({ overrides: {} })),
    readJsonFile(SW_INDUSTRY_MAP_PATH).catch(() => ({ stocks: {} })),
    readJsonFile(NEW_BOND_REFERENCE_OVERRIDES_PATH).catch(() => ({ overrides: {} })),
    loadBondLifecycleWithRefresh({ staleWhileRevalidate: true }),
  ]);
  const enriched = await enrichNewBondUniverseMetadata(rawUniverse, {
    swIndustryPayload,
    referenceOverrides,
  });
  if (enriched.changed) {
    await writeJsonAtomic(NEW_BOND_UNIVERSE_PATH, enriched.universe);
  }
  const merged = mergeBondTagPayloadWithNewUniverse(
    tagPayload,
    publicNewBondUniverse(enriched.universe),
    overridePayload,
    swIndustryPayload,
    lifecyclePayload,
    {
      includeInactive: ["1", "true"].includes(
        String(url.searchParams.get("includeInactive") || "").toLowerCase(),
      ),
    },
  );
  const requestedCode = String(url.searchParams.get("code") || "").trim().toUpperCase();
  const requestedDigits = requestedCode.replace(/\D/g, "").slice(0, 6);
  const requestedTag = String(url.searchParams.get("tag") || "").trim();
  const rows = merged.rows.filter((row) => {
    if (requestedCode) {
      const rowCode = String(row.code || "").toUpperCase();
      const rowDigits = rowCode.replace(/\D/g, "").slice(0, 6);
      if (rowCode !== requestedCode && rowDigits !== requestedDigits) return false;
    }
    if (requestedTag && !(row.tags || []).includes(requestedTag)) return false;
    return true;
  });
  await enrichLifecycleSupplementalTagRows(rows, swIndustryPayload);
  sendJson(response, 200, { ...merged, count: rows.length, rows });
}

function isMissingBondIndustry(value) {
  const normalized = String(value || "").trim();
  return !normalized || normalized === "待分类" || normalized === "新上市转债";
}

function swIndustryLookup(payload, stockCode) {
  const code = String(stockCode || "").trim().toUpperCase();
  const row = payload?.stocks?.[code];
  return row && typeof row === "object" ? row : {};
}

function fillMissingBondIndustry(row, industry = {}) {
  const next = { ...row };
  for (const level of [1, 2, 3]) {
    const field = `industry${level}`;
    const value = String(industry?.[field] || "").trim();
    if (isMissingBondIndustry(next[field]) && value) next[field] = value;
  }
  return next;
}

function mergeBondTagPayloadWithNewUniverse(
  tagPayload,
  universePayload,
  overridePayload = {},
  swIndustryPayload = {},
  lifecyclePayload = {},
  options = {},
) {
  const tagOrder = Array.isArray(tagPayload?.tagOrder) ? tagPayload.tagOrder.map(String) : [];
  const universeByCode = new Map(
    (Array.isArray(universePayload?.bonds) ? universePayload.bonds : []).map((bond) => [
      String(bond?.code || "").trim().toUpperCase(),
      bond,
    ]),
  );
  const rows = (Array.isArray(tagPayload?.rows) ? tagPayload.rows : []).map((row) => {
    const universeBond = universeByCode.get(String(row?.code || "").trim().toUpperCase()) || {};
    const issueScaleBillion = Number(universeBond.issueScaleBillion);
    const rating = String(universeBond.rating || "").trim();
    const normalized = {
      ...row,
      ...(issueScaleBillion > 0 ? { issueScaleBillion } : {}),
      ...(rating ? { rating } : {}),
      tags: Array.isArray(row?.tags) ? row.tags.map(String) : [],
    };
    const filled = fillMissingBondIndustry(
      normalized,
      swIndustryLookup(swIndustryPayload, normalized.stockCode),
    );
    if (
      !isMissingBondIndustry(filled.industry2)
      && /行业资料按需补齐/.test(String(filled.dataQuality || ""))
    ) {
      filled.dataQuality = "自动新债池补充；正股与申万行业自动补齐";
    }
    return filled;
  });
  const baseCount = rows.length;
  const existingCodes = new Set(rows.map((row) => String(row.code || "").trim().toUpperCase()));
  const overrides = overridePayload?.overrides && typeof overridePayload.overrides === "object"
    ? overridePayload.overrides
    : {};
  let supplementalCount = 0;
  for (const bond of Array.isArray(universePayload?.bonds) ? universePayload.bonds : []) {
    const code = String(bond?.code || "").trim().toUpperCase();
    if (!/^\d{6}\.(SH|SZ)$/.test(code) || existingCodes.has(code)) continue;
    const override = overrides[code] || {};
    const removed = new Set(Array.isArray(override.remove) ? override.remove.map(String) : []);
    const added = new Set(Array.isArray(override.add) ? override.add.map(String) : []);
    const defaultTags = tagOrder.includes("次新债") ? ["次新债"] : [];
    const tags = tagOrder.filter((tag) =>
      (defaultTags.includes(tag) || added.has(tag)) && !removed.has(tag));
    const requestedPrimary = String(override.primaryTag || "");
    const listingDate = String(bond.listingDate || "").replace(
      /^(\d{4})(\d{2})(\d{2})$/,
      "$1-$2-$3",
    );
    const stockCode = String(bond.stockCode || "").toUpperCase();
    const industry = swIndustryLookup(swIndustryPayload, stockCode);
    const supplemental = fillMissingBondIndustry({
      code,
      name: String(bond.name || code),
      stockCode,
      stockName: String(bond.stockName || ""),
      listedDate: listingDate,
      industry1: String(bond.industry1 || "新上市转债"),
      industry2: String(bond.industry2 || "待分类"),
      industry3: String(bond.industry3 || "待分类"),
      ...(Number(bond.issueScaleBillion) > 0
        ? { issueScaleBillion: Number(bond.issueScaleBillion) }
        : {}),
      ...(String(bond.rating || "").trim()
        ? { rating: String(bond.rating).trim() }
        : {}),
      tags,
      primaryTag: tags.includes(requestedPrimary) ? requestedPrimary : "",
      supplemental: true,
      dataQuality: "自动新债池补充；正股与申万行业自动补齐",
    }, industry);
    if (isMissingBondIndustry(supplemental.industry2)) {
      supplemental.dataQuality = "自动新债池补充；正股与行业资料按需补齐";
    }
    rows.push(supplemental);
    existingCodes.add(code);
    supplementalCount += 1;
  }
  const lifecycleApplied = bondLifecyclePayloadUsable(lifecyclePayload);
  let lifecycleSupplementalCount = 0;
  if (lifecycleApplied) {
    for (const [code, lifecycle] of Object.entries(lifecyclePayload.bonds || {})) {
      if (
        (lifecycle?.isActive === false && !options?.includeInactive)
        || !/^\d{6}\.(SH|SZ)$/.test(code)
        || existingCodes.has(code)
      ) {
        continue;
      }
      rows.push({
        code,
        name: String(lifecycle?.name || code),
        stockCode: "",
        stockName: "",
        listedDate: "",
        industry1: "",
        industry2: "待分类",
        industry3: "待分类",
        tags: [],
        primaryTag: "",
        supplemental: true,
        lifecycleSupplemental: true,
        dataQuality: "QMT 当前存续债池兜底补充；正股与行业资料按需补齐",
      });
      existingCodes.add(code);
      lifecycleSupplementalCount += 1;
    }
  }
  const rowsWithLifecycle = lifecycleApplied
    ? rows.map((row) => applyBondLifecycle(row, lifecyclePayload))
    : rows;
  const activeRows = lifecycleApplied
    ? rowsWithLifecycle.filter((row) => row.isActive !== false)
    : rowsWithLifecycle;
  const inactiveRows = lifecycleApplied
    ? rowsWithLifecycle.filter((row) => row.isActive === false)
    : [];
  const visibleRows = options?.includeInactive ? rowsWithLifecycle : activeRows;
  const tagCounts = Object.fromEntries(
    tagOrder.map((tag) => [
      tag,
      activeRows.filter((row) => (row.tags || []).includes(tag)).length,
    ]),
  );
  const source = Array.isArray(tagPayload?.source)
    ? [...tagPayload.source, "finance 自动新债池"]
    : [tagPayload?.source || "可转债标签库", "finance 自动新债池"];
  return {
    ...tagPayload,
    ok: true,
    source: [...new Set(source.filter(Boolean))],
    tagOrder,
    tagCounts,
    count: visibleRows.length,
    activeCount: activeRows.length,
    inactiveCount: inactiveRows.length,
    totalKnownCount: rowsWithLifecycle.length,
    baseCount,
    supplementalCount,
    lifecycleSupplementalCount,
    newBondUniverseUpdatedAt: String(universePayload?.updatedAt || ""),
    lifecycle: {
      applied: lifecycleApplied,
      checkedAt: lifecycleApplied ? String(lifecyclePayload.checkedAt || "") : "",
      source: lifecycleApplied ? String(lifecyclePayload.source || "") : "",
      qmtActiveCount: lifecycleApplied ? Number(lifecyclePayload.qmtActiveCount || 0) : 0,
      hiddenCount: lifecycleApplied ? Number(lifecyclePayload.hiddenCount || inactiveRows.length) : 0,
    },
    rows: visibleRows,
  };
}

function applyBondLifecycle(row, lifecyclePayload) {
  const code = String(row?.code || "").trim().toUpperCase();
  const lifecycle = lifecyclePayload?.bonds?.[code];
  if (!lifecycle || typeof lifecycle !== "object") {
    return {
      ...row,
      lifecycleStatus: "unknown_unfiltered",
      isActive: true,
      visibility: "active",
      lifecycleReason: "missing_lifecycle_record",
      lifecycleCheckedAt: String(lifecyclePayload?.checkedAt || ""),
    };
  }
  return {
    ...row,
    lifecycleStatus: String(lifecycle.lifecycleStatus || "unknown"),
    isActive: lifecycle.isActive !== false,
    visibility: lifecycle.isActive === false ? "hidden" : "active",
    lifecycleReason: String(lifecycle.reason || ""),
    lifecycleCheckedAt: String(lifecycle.checkedAt || lifecyclePayload?.checkedAt || ""),
  };
}

async function enrichLifecycleSupplementalTagRows(rows, swIndustryPayload) {
  const targets = (Array.isArray(rows) ? rows : []).filter(
    (row) => row?.lifecycleSupplemental && (!row.stockCode || isMissingBondIndustry(row.industry2)),
  );
  for (const group of chunk(targets, 5)) {
    const metadataRows = await Promise.all(group.map((row) =>
      fetchLocalJson(`/bond-meta?code=${encodeURIComponent(row.code)}`, 20_000)
        .catch(() => null)));
    metadataRows.forEach((metadata, index) => {
      if (!metadata?.ok) return;
      const row = group[index];
      if (metadata.name) row.name = String(metadata.name);
      if (metadata.stock_code) row.stockCode = String(metadata.stock_code).toUpperCase();
      if (metadata.stock_name) row.stockName = String(metadata.stock_name);
      Object.assign(
        row,
        fillMissingBondIndustry(
          row,
          swIndustryLookup(swIndustryPayload, row.stockCode),
        ),
      );
      row.dataQuality = isMissingBondIndustry(row.industry2)
        ? "QMT 当前存续债池兜底补充；行业资料待补"
        : "QMT 当前存续债池兜底补充；正股与申万行业自动补齐";
    });
  }
}

async function handleBondTagsUpdate(request, response) {
  const body = await readJsonBody(request, 32 * 1024);
  const [tagPayload, overridePayload] = await Promise.all([
    readJsonFile(BOND_TAGS_PATH),
    readJsonFile(BOND_TAG_OVERRIDES_PATH).catch(() => ({
      description: "可转债标签人工修订。add 添加标签，remove 删除规则标签。",
      overrides: {},
    })),
  ]);
  const tagOrder = Array.isArray(tagPayload.tagOrder) ? tagPayload.tagOrder.map(String) : [];
  const rows = Array.isArray(tagPayload.rows) ? tagPayload.rows : [];
  const createTag = String(body?.createTag || "").trim();
  if (createTag) {
    const characters = [...createTag];
    const validCharacters = /^[\p{L}\p{N}][\p{L}\p{N}\s+&·._/-]*$/u.test(createTag);
    if (characters.length > 12 || !validCharacters) {
      sendJson(response, 400, { error: "标签需为 1–12 个中英文、数字或常用连接符" });
      return;
    }
    if (tagOrder.includes(createTag)) {
      sendJson(response, 409, { error: `标签“${createTag}”已存在` });
      return;
    }
    tagOrder.push(createTag);
    tagPayload.tagOrder = tagOrder;
    overridePayload.customTags = [...new Set([
      ...(Array.isArray(overridePayload.customTags) ? overridePayload.customTags : []),
      createTag,
    ])];
    recalculateBondTagCounts(tagPayload, tagOrder);
    await Promise.all([
      writeJsonAtomic(BOND_TAG_OVERRIDES_PATH, overridePayload),
      writeJsonAtomic(BOND_TAGS_PATH, tagPayload),
    ]);
    sendJson(response, 200, {
      ok: true,
      tag: createTag,
      tagOrder: tagPayload.tagOrder,
      tagCounts: tagPayload.tagCounts,
    });
    return;
  }
  const requestedCodes = Array.isArray(body?.codes)
    ? [...new Set(body.codes.map((value) => String(value).toUpperCase()).filter(Boolean))]
    : [];
  const removeTag = String(body?.removeTag || "").trim();

  if (requestedCodes.length > 0 || removeTag) {
    if (requestedCodes.length === 0 || !tagOrder.includes(removeTag)) {
      sendJson(response, 400, { error: "缺少批量转债代码或标签无效" });
      return;
    }
    const selected = new Set(requestedCodes.map((code) => code.replace(/\D/g, "").slice(0, 6)));
    const updatedRows = [];
    for (const row of rows) {
      const digits = String(row.code || "").replace(/\D/g, "").slice(0, 6);
      if (!selected.has(digits) || !(row.tags || []).includes(removeTag)) continue;
      const desiredTags = new Set((row.tags || []).filter((tag) => tag !== removeTag));
      const primaryWasRemoved = row.primaryTag === removeTag;
      const result = updateBondTagOverride({
        row,
        desiredTags,
        tagOrder,
        overridePayload,
        primarySpecified: primaryWasRemoved,
        requestedPrimaryTag: primaryWasRemoved ? "" : row.primaryTag,
      });
      updatedRows.push({ code: row.code, tags: row.tags, primaryTag: row.primaryTag, override: result });
    }
    if (updatedRows.length === 0) {
      sendJson(response, 404, { error: "所选转债中没有可移除的当前标签" });
      return;
    }
    recalculateBondTagCounts(tagPayload, tagOrder);
    await Promise.all([
      writeJsonAtomic(BOND_TAG_OVERRIDES_PATH, overridePayload),
      writeJsonAtomic(BOND_TAGS_PATH, tagPayload),
    ]);
    sendJson(response, 200, { ok: true, removeTag, updated: updatedRows.length, rows: updatedRows });
    return;
  }

  const requestedCode = String(body?.code || "").toUpperCase();
  const requestedTags = Array.isArray(body?.tags)
    ? [...new Set(body.tags.map((value) => String(value).trim()).filter(Boolean))]
    : null;
  if (!requestedCode || !requestedTags) {
    sendJson(response, 400, { error: "缺少转债代码或标签列表" });
    return;
  }
  const invalidTags = requestedTags.filter((tag) => !tagOrder.includes(tag));
  if (invalidTags.length) {
    sendJson(response, 400, { error: `未知标签：${invalidTags.join("、")}` });
    return;
  }
  const codeDigits = requestedCode.replace(/\D/g, "").slice(0, 6);
  let row = rows.find(
    (item) => String(item.code || "").toUpperCase() === requestedCode
      || String(item.code || "").replace(/\D/g, "").slice(0, 6) === codeDigits,
  );
  if (!row) {
    const [rawUniverse, swIndustryPayload, lifecyclePayload] = await Promise.all([
      readJsonFile(NEW_BOND_UNIVERSE_PATH).catch(() => ({})),
      readJsonFile(SW_INDUSTRY_MAP_PATH).catch(() => ({ stocks: {} })),
      loadBondLifecycleWithRefresh(),
    ]);
    const merged = mergeBondTagPayloadWithNewUniverse(
      tagPayload,
      publicNewBondUniverse(rawUniverse),
      overridePayload,
      swIndustryPayload,
      lifecyclePayload,
    );
    const supplementalRow = merged.rows.find(
      (item) => String(item.code || "").toUpperCase() === requestedCode
        || String(item.code || "").replace(/\D/g, "").slice(0, 6) === codeDigits,
    );
    if (supplementalRow?.supplemental) {
      row = { ...supplementalRow };
      try {
        const metadata = await fetchLocalJson(
          `/bond-meta?code=${encodeURIComponent(row.code)}`,
          12_000,
        );
        if (metadata?.name) row.name = String(metadata.name);
        if (metadata?.stock_code) row.stockCode = String(metadata.stock_code).toUpperCase();
        if (metadata?.stock_name) row.stockName = String(metadata.stock_name);
        row = fillMissingBondIndustry(
          row,
          swIndustryLookup(swIndustryPayload, row.stockCode),
        );
      } catch (error) {
        console.warn(`New bond tag metadata unavailable for ${row.code}: ${error.message}`);
      }
      rows.push(row);
      tagPayload.count = rows.length;
    }
  }
  if (!row) {
    sendJson(response, 404, { error: `标签库中未找到转债 ${requestedCode}` });
    return;
  }

  const desiredTags = new Set(requestedTags);
  const primarySpecified = Object.prototype.hasOwnProperty.call(body || {}, "primaryTag");
  const requestedPrimaryTag = String(body?.primaryTag || "").trim();
  if (primarySpecified && requestedPrimaryTag && !desiredTags.has(requestedPrimaryTag)) {
    sendJson(response, 400, { error: "主标签必须属于已选标签" });
    return;
  }
  const nextOverride = updateBondTagOverride({
    row,
    desiredTags,
    tagOrder,
    overridePayload,
    primarySpecified,
    requestedPrimaryTag,
  });
  recalculateBondTagCounts(tagPayload, tagOrder);

  await Promise.all([
    writeJsonAtomic(BOND_TAG_OVERRIDES_PATH, overridePayload),
    writeJsonAtomic(BOND_TAGS_PATH, tagPayload),
  ]);
  sendJson(response, 200, {
    ok: true,
    code: row.code,
    tags: row.tags,
    primaryTag: row.primaryTag || "",
    override: nextOverride,
  });
}

function updateBondTagOverride({
  row,
  desiredTags,
  tagOrder,
  overridePayload,
  primarySpecified,
  requestedPrimaryTag,
}) {
  const canonicalCode = String(row.code);
  const currentTags = new Set((row.tags || []).map(String));
  const existing = overridePayload.overrides?.[canonicalCode] || {};
  const add = new Set((existing.add || []).filter((tag) => tagOrder.includes(tag)));
  const remove = new Set((existing.remove || []).filter((tag) => tagOrder.includes(tag)));
  for (const tag of tagOrder) {
    if (currentTags.has(tag) === desiredTags.has(tag)) continue;
    if (desiredTags.has(tag)) {
      if (remove.has(tag)) remove.delete(tag);
      else add.add(tag);
    } else if (add.has(tag)) {
      add.delete(tag);
    } else {
      remove.add(tag);
    }
  }

  let primaryTag = desiredTags.has(row.primaryTag) ? String(row.primaryTag) : "";
  if (primarySpecified) primaryTag = desiredTags.has(requestedPrimaryTag) ? requestedPrimaryTag : "";
  const nextOverride = {
    add: tagOrder.filter((tag) => add.has(tag)),
    remove: tagOrder.filter((tag) => remove.has(tag)),
  };
  if (primarySpecified || Object.prototype.hasOwnProperty.call(existing, "primaryTag")) {
    nextOverride.primaryTag = primaryTag || null;
  }

  overridePayload.overrides ||= {};
  if (nextOverride.add.length || nextOverride.remove.length || Object.prototype.hasOwnProperty.call(nextOverride, "primaryTag")) {
    overridePayload.overrides[canonicalCode] = nextOverride;
  } else {
    delete overridePayload.overrides[canonicalCode];
  }
  row.tags = tagOrder.filter((tag) => desiredTags.has(tag));
  row.primaryTag = primaryTag;
  return nextOverride;
}

function recalculateBondTagCounts(tagPayload, tagOrder) {
  tagPayload.tagCounts = Object.fromEntries(
    tagOrder.map((tag) => [
      tag,
      (tagPayload.rows || []).filter((item) => (item.tags || []).includes(tag)).length,
    ]),
  );
}

async function ensureMiniQmtApi() {
  if (!MINIQMT_API_AUTOSTART || shuttingDown) return;
  try {
    await fetchLocalJson("/health", 1200);
    miniqmtApiRestartAttempts = 0;
    console.log(`QMT dashboard API already available on ${MINIQMT_API_HOST}:${MINIQMT_API_PORT}`);
    return;
  } catch {
    // The read-only helper is started below.
  }
  if (miniqmtApiProcess || miniqmtApiRestartTimer || !fs.existsSync(MINIQMT_API_SCRIPT)) return;
  const child = spawn(
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
  miniqmtApiProcess = child;
  child.once("error", (error) => {
    console.warn(`QMT dashboard API failed to start: ${error.message}`);
    handleMiniQmtApiExit(child);
  });
  child.once("exit", (code, signal) => {
    if (code && code !== 0) {
      console.warn(`QMT dashboard API exited: code=${code} signal=${signal || ""}`);
    }
    handleMiniQmtApiExit(child);
  });
}

function handleMiniQmtApiExit(child) {
  if (miniqmtApiProcess !== child) return;
  miniqmtApiProcess = null;
  scheduleMiniQmtApiRestart();
}

function scheduleMiniQmtApiRestart() {
  if (!MINIQMT_API_AUTOSTART || shuttingDown || miniqmtApiRestartTimer) return;
  const delay = Math.min(
    MINIQMT_API_RESTART_MAX_MS,
    MINIQMT_API_RESTART_BASE_MS * (2 ** miniqmtApiRestartAttempts),
  );
  miniqmtApiRestartAttempts += 1;
  console.warn(`QMT dashboard API will restart in ${Math.ceil(delay / 1000)}s`);
  miniqmtApiRestartTimer = setTimeout(() => {
    miniqmtApiRestartTimer = null;
    void ensureMiniQmtApi();
  }, delay);
}

function stopMiniQmtApi() {
  if (miniqmtApiRestartTimer) clearTimeout(miniqmtApiRestartTimer);
  miniqmtApiRestartTimer = null;
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
            reject(new Error("QMT API returned invalid JSON"));
            return;
          }
          if (result.statusCode && result.statusCode >= 400) {
            reject(new Error(`HTTP ${result.statusCode}: ${payload?.error || "QMT API error"}`));
            return;
          }
          resolve(payload);
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("QMT API timeout")));
    request.on("error", reject);
  });
}

function fetchLocalJsonPost(pathname, payload, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const request = http.request(
      {
        hostname: MINIQMT_API_HOST,
        port: MINIQMT_API_PORT,
        path: pathname,
        method: "POST",
        timeout,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Content-Length": body.length,
        },
      },
      (result) => {
        const chunks = [];
        result.on("data", (chunk) => chunks.push(chunk));
        result.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let responsePayload;
          try {
            responsePayload = raw ? JSON.parse(raw) : {};
          } catch {
            reject(new Error("QMT API returned invalid JSON"));
            return;
          }
          if (result.statusCode && result.statusCode >= 400) {
            const error = new Error(`HTTP ${result.statusCode}: ${responsePayload?.error || "QMT API error"}`);
            error.statusCode = result.statusCode;
            reject(error);
            return;
          }
          resolve(responsePayload);
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("QMT API timeout")));
    request.on("error", reject);
    request.end(body);
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

  const marketCodes = Array.from(
    new Set(secids.map(secidToMiniQmtMarketCode).filter(Boolean)),
  );
  const hongKongSecids = secids.filter(isHongKongSecid);
  const query = new URLSearchParams({ codes: marketCodes.join(",") });
  const [qmtResult, ...hongKongResults] = await Promise.allSettled([
    marketCodes.length > 0 ? fetchLocalJson(`/sparks?${query}`, 20_000) : Promise.resolve(null),
    ...hongKongSecids.map((secid) => fetchSecuritySparkline(secid)),
  ]);
  const hongKongSparks = hongKongResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => ({
      ...result.value,
      data_is_stale: result.value.date !== currentChinaDateKey(),
    }));
  const failedSecids = hongKongSecids.filter((_, index) => hongKongResults[index].status === "rejected");

  if (qmtResult.status === "fulfilled" || hongKongSparks.length > 0) {
    const payload = qmtResult.status === "fulfilled" ? qmtResult.value : null;
    const sources = new Set(hongKongSparks.map((spark) => spark.source));
    if (marketCodes.length > 0) {
      if (payload) sources.add(payload.source || "QMT 1m缓存 + full_tick实时采样");
      else failedSecids.push(...secids.filter((secid) => secidToMiniQmtMarketCode(secid)));
    }
    sendJson(response, 200, {
      ...payload,
      source: [...sources].join(" + ") || (hongKongSecids.length > 0 ? "港股分时" : "QMT"),
      time: new Date().toISOString(),
      sparks: [...(payload?.sparks || []), ...hongKongSparks],
      failedSecids,
    });
    return;
  }

  const error = qmtResult.reason;
  const message = error instanceof Error ? error.message : "QMT分时不可用";
  const status = Number(error?.statusCode) || Number(message.match(/HTTP (\d+)/)?.[1]) || 503;
  sendJson(response, status, {
    error: message.replace(/^HTTP \d+:\s*/, ""),
    service: "miniqmt-dashboard",
    source: "QMT",
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

function clockSeconds(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return hour * 3600 + minute * 60 + second;
}

function isNewBondAutoScanWindow(clock) {
  const nowSeconds = clockSeconds(clock);
  const start = clockSeconds(NEW_BOND_AUTO_SCAN_START);
  const end = clockSeconds(NEW_BOND_AUTO_SCAN_END);
  if (nowSeconds === null || start === null || end === null) return false;
  return nowSeconds >= start && nowSeconds <= end;
}

function isNewBondReconciliationWindow(clock) {
  const nowSeconds = clockSeconds(clock);
  const start = clockSeconds(NEW_BOND_RECONCILIATION_START);
  const end = clockSeconds(NEW_BOND_RECONCILIATION_END);
  if (nowSeconds === null || start === null || end === null) return false;
  return nowSeconds >= start && nowSeconds <= end;
}

function candidateSecid(candidate) {
  const value = String(candidate?.secid || candidate?.market_code || candidate?.code || "").trim();
  const marketCode = value.match(/^(\d{6})\.(SH|SZ)$/i);
  if (marketCode) return normalizeSecidInput(`${marketCode[2]}${marketCode[1]}`);
  return normalizeSecidInput(value);
}

function candidateMarketCode(candidate) {
  const direct = String(candidate?.market_code || "").trim().toUpperCase();
  if (/^\d{6}\.(SH|SZ)$/.test(direct)) return direct;
  const secid = candidateSecid(candidate);
  const match = String(secid || "").match(/^([01])\.(\d{6})$/);
  if (!match) return "";
  return `${match[2]}.${match[1] === "1" ? "SH" : "SZ"}`;
}

function addCompactDateDays(value, days) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return "";
  const moment = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(moment.getTime())) return "";
  moment.setUTCDate(moment.getUTCDate() + Math.max(0, Number(days) || 0));
  return moment.toISOString().slice(0, 10).replaceAll("-", "");
}

async function enrichNewBondUniverseMetadata(
  rawManifest,
  { swIndustryPayload = {}, referenceOverrides = {} } = {},
) {
  const bonds = Array.isArray(rawManifest?.bonds)
    ? rawManifest.bonds.map((row) => ({ ...row }))
    : [];
  const overrides = referenceOverrides?.overrides
    && typeof referenceOverrides.overrides === "object"
    ? referenceOverrides.overrides
    : {};
  let changed = false;
  let enrichedCount = 0;

  function applyFields(row, values) {
    const fields = ["stockCode", "stockName", "industry1", "industry2", "industry3"];
    let rowChanged = false;
    for (const field of fields) {
      const current = String(row[field] || "").trim();
      const next = String(values?.[field] || "").trim();
      const missing = field === "stockCode"
        ? !/^\d{6}\.(SH|SZ)$/.test(current.toUpperCase())
        : field === "stockName"
        ? !current || current === "待补正股"
        : isMissingBondIndustry(current);
      if (!next || !missing) continue;
      row[field] = field === "stockCode" ? next.toUpperCase() : next;
      rowChanged = true;
    }
    if (rowChanged) {
      changed = true;
      enrichedCount += 1;
    }
  }

  for (const row of bonds) {
    const code = String(row.code || "").trim().toUpperCase();
    applyFields(row, overrides[code]);
  }

  const now = Date.now();
  const missingStockRows = bonds.filter((row) => {
    const code = String(row.code || "").trim().toUpperCase();
    const lastAttempt = Number(newBondMetadataAttemptedAt.get(code) || 0);
    return /^\d{6}\.(SH|SZ)$/.test(code)
      && !/^\d{6}\.(SH|SZ)$/.test(String(row.stockCode || "").toUpperCase())
      && now - lastAttempt >= 15 * 60 * 1000;
  });
  const metadataRows = await mapWithConcurrency(missingStockRows, 4, async (row) => {
    const code = String(row.code || "").trim().toUpperCase();
    newBondMetadataAttemptedAt.set(code, now);
    try {
      const metadata = await fetchLocalJson(
        `/bond-meta?code=${encodeURIComponent(code)}`,
        12_000,
      );
      return { row, metadata };
    } catch (error) {
      console.warn(`New bond reference metadata unavailable for ${code}: ${error.message}`);
      return { row, metadata: null };
    }
  });
  for (const { row, metadata } of metadataRows) {
    applyFields(row, {
      stockCode: metadata?.stock_code,
      stockName: metadata?.stock_name,
    });
  }

  for (const row of bonds) {
    applyFields(row, swIndustryLookup(swIndustryPayload, row.stockCode));
  }

  return {
    changed,
    enrichedCount,
    universe: { ...rawManifest, bonds },
  };
}

function mergeNewBondUniverseManifest(
  rawManifest,
  candidates,
  targetDate,
  generatedAt = new Date().toISOString(),
) {
  const normalizedTargetDate = String(targetDate || "").replaceAll("-", "");
  const currentRows = Array.isArray(rawManifest?.bonds) ? rawManifest.bonds : [];
  const byCode = new Map();
  for (const row of currentRows) {
    const code = String(row?.code || "").trim().toUpperCase();
    const validThrough = String(row?.validThrough || "");
    if (!/^\d{6}\.(SH|SZ)$/.test(code)) continue;
    if (validThrough && normalizedTargetDate && validThrough < normalizedTargetDate) continue;
    byCode.set(code, { ...row, code });
  }

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const code = candidateMarketCode(candidate);
    if (!code) continue;
    const previous = byCode.get(code) || {};
    const listingDate = String(candidate.listing_date || previous.listingDate || "");
    const firstTargetDate = String(previous.firstTargetDate || normalizedTargetDate || "");
    byCode.set(code, {
      code,
      name: String(candidate.name || previous.name || code).trim(),
      stockCode: String(candidate.stock_code || previous.stockCode || "").trim(),
      stockName: String(candidate.stock_name || previous.stockName || "").trim(),
      industry1: String(candidate.industry1 || previous.industry1 || "").trim(),
      industry2: String(candidate.industry2 || previous.industry2 || "").trim(),
      industry3: String(candidate.industry3 || previous.industry3 || "").trim(),
      issueScaleBillion: candidate.issue_scale_billion !== null
        && candidate.issue_scale_billion !== undefined
        && Number.isFinite(Number(candidate.issue_scale_billion))
        ? Number(candidate.issue_scale_billion)
        : previous.issueScaleBillion ?? null,
      rating: String(candidate.rating || previous.rating || "").trim(),
      listingDate,
      firstTargetDate,
      lastTargetDate: normalizedTargetDate,
      firstDetectedAt: String(previous.firstDetectedAt || generatedAt),
      lastDetectedAt: generatedAt,
      validThrough: addCompactDateDays(
        normalizedTargetDate || firstTargetDate,
        NEW_BOND_UNIVERSE_RETENTION_DAYS,
      ),
      inMiniQmtList: Boolean(candidate.in_miniqmt_list),
      discovery: String(candidate.discovery || previous.discovery || ""),
      source: "finance-board-new-bond-discovery",
    });
  }

  const bonds = [...byCode.values()].sort((left, right) =>
    String(left.listingDate || "").localeCompare(String(right.listingDate || ""))
    || left.code.localeCompare(right.code));
  return {
    schemaVersion: 1,
    updatedAt: generatedAt,
    targetDate: normalizedTargetDate,
    retentionDays: NEW_BOND_UNIVERSE_RETENTION_DAYS,
    source: "finance-board-new-bond-discovery",
    bonds,
  };
}

function publicNewBondUniverse(rawManifest, targetDate = "") {
  const currentDate = String(
    targetDate || currentChinaDateTimeParts()?.date || "",
  ).replaceAll("-", "");
  const seen = new Set();
  const bonds = (Array.isArray(rawManifest?.bonds) ? rawManifest.bonds : [])
    .map((row) => {
      const code = String(row?.code || "").trim().toUpperCase();
      const listingDate = String(row?.listingDate || "").replaceAll("-", "");
      if (
        !/^\d{6}\.(SH|SZ)$/.test(code)
        || seen.has(code)
        || (listingDate && currentDate && listingDate > currentDate)
      ) {
        return null;
      }
      seen.add(code);
      return {
        code,
        name: String(row?.name || code).trim(),
        stockCode: String(row?.stockCode || "").trim().toUpperCase(),
        stockName: String(row?.stockName || "").trim(),
        industry1: String(row?.industry1 || "").trim(),
        industry2: String(row?.industry2 || "").trim(),
        industry3: String(row?.industry3 || "").trim(),
        issueScaleBillion: row?.issueScaleBillion !== null
          && row?.issueScaleBillion !== undefined
          && Number.isFinite(Number(row?.issueScaleBillion))
          ? Number(row.issueScaleBillion)
          : null,
        rating: String(row?.rating || "").trim(),
        listingDate,
        inMiniQmtList: Boolean(row?.inMiniQmtList),
        discovery: String(row?.discovery || ""),
        source: String(row?.source || rawManifest?.source || ""),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.listingDate.localeCompare(right.listingDate) || left.code.localeCompare(right.code));
  return {
    ok: true,
    mode: "read_only",
    updatedAt: String(rawManifest?.updatedAt || ""),
    source: String(rawManifest?.source || "finance-board-new-bond-discovery"),
    count: bonds.length,
    bonds,
  };
}

function mergeSecondDayBondsIntoState(rawState, candidates, targetSector) {
  const state = normalizeBoardState(rawState);
  const sector = state.sectors.find((item) => item.name === targetSector);
  if (!sector) {
    throw new Error(`目标板块不存在：${targetSector}`);
  }

  const existingCodes = new Set(
    sector.stocks
      .map((stock) => normalizeSecidInput(stock.secid))
      .filter(Boolean),
  );
  const added = [];
  const alreadyPresent = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const secid = candidateSecid(candidate);
    if (!secid) continue;
    if (existingCodes.has(secid)) {
      alreadyPresent.push(String(candidate.code || secid.split(".")[1]));
      continue;
    }
    const stock = {
      name: String(candidate.name || candidate.code || "").trim(),
      secid,
    };
    if (!stock.name) continue;
    sector.stocks.push(stock);
    existingCodes.add(secid);
    added.push({
      ...stock,
      code: secid.split(".")[1],
      listingDate: String(candidate.listing_date || ""),
      discovery: String(candidate.discovery || ""),
    });
  }
  return { state, added, alreadyPresent };
}

async function withBoardStateMutationLock(task) {
  const previous = boardStateMutationChain;
  let release;
  boardStateMutationChain = new Promise((resolve) => {
    release = resolve;
  });
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
  }
}

async function applySecondDayBonds(candidates, targetSector, targetDate) {
  return withBoardStateMutationLock(async () => {
    await ensureSwIndustryMapSync().catch((error) => {
      console.warn(`SW industry map refresh skipped during new-bond scan: ${error.message}`);
    });
    const currentState = await readBoardStateFile();
    const merged = candidates.length > 0
      ? mergeSecondDayBondsIntoState(currentState, candidates, targetSector)
      : { state: currentState, added: [], alreadyPresent: [] };
    const currentUniverse = await readJsonFile(NEW_BOND_UNIVERSE_PATH).catch((error) => {
      if (error?.code === "ENOENT") return {};
      throw error;
    });
    const mergedUniverse = mergeNewBondUniverseManifest(
      currentUniverse,
      candidates,
      targetDate,
    );
    const [swIndustryPayload, referenceOverrides] = await Promise.all([
      readJsonFile(SW_INDUSTRY_MAP_PATH).catch(() => ({ stocks: {} })),
      readJsonFile(NEW_BOND_REFERENCE_OVERRIDES_PATH).catch(() => ({ overrides: {} })),
    ]);
    const enriched = await enrichNewBondUniverseMetadata(mergedUniverse, {
      swIndustryPayload,
      referenceOverrides,
    });
    const universe = enriched.universe;
    await fs.promises.mkdir(path.dirname(NEW_BOND_UNIVERSE_PATH), { recursive: true });
    await writeJsonAtomic(NEW_BOND_UNIVERSE_PATH, universe);
    if (merged.added.length > 0) {
      await fs.promises.mkdir(path.dirname(BOARD_STATE_PATH), { recursive: true });
      await writeJsonAtomic(BOARD_STATE_PATH, merged.state);
    }
    await ensureBondLifecycleSync({ force: true }).catch((error) => {
      console.warn(`Bond lifecycle refresh skipped after new-bond scan: ${error.message}`);
    });
    return {
      ...merged,
      updated: merged.added.length > 0,
      boardUpdatedAt: merged.added.length > 0
        ? merged.state.updatedAt
        : currentState.updatedAt || "",
      supplementalUniverse: {
        updatedAt: universe.updatedAt,
        count: universe.bonds.length,
        codes: universe.bonds.map((row) => row.code),
      },
    };
  });
}

async function applyNewBondInventoryReconciliation(candidates, targetDate) {
  return withBoardStateMutationLock(async () => {
    await ensureSwIndustryMapSync().catch((error) => {
      console.warn(`SW industry map refresh skipped during inventory reconciliation: ${error.message}`);
    });
    const currentUniverse = await readJsonFile(NEW_BOND_UNIVERSE_PATH).catch((error) => {
      if (error?.code === "ENOENT") return {};
      throw error;
    });
    const currentCodes = new Set(
      (Array.isArray(currentUniverse?.bonds) ? currentUniverse.bonds : [])
        .map((row) => String(row?.code || "").trim().toUpperCase())
        .filter((code) => /^\d{6}\.(SH|SZ)$/.test(code)),
    );
    const mergedUniverse = mergeNewBondUniverseManifest(
      currentUniverse,
      candidates,
      targetDate,
    );
    const [swIndustryPayload, referenceOverrides] = await Promise.all([
      readJsonFile(SW_INDUSTRY_MAP_PATH).catch(() => ({ stocks: {} })),
      readJsonFile(NEW_BOND_REFERENCE_OVERRIDES_PATH).catch(() => ({ overrides: {} })),
    ]);
    const enriched = await enrichNewBondUniverseMetadata(mergedUniverse, {
      swIndustryPayload,
      referenceOverrides,
    });
    const universe = enriched.universe;
    await fs.promises.mkdir(path.dirname(NEW_BOND_UNIVERSE_PATH), { recursive: true });
    await writeJsonAtomic(NEW_BOND_UNIVERSE_PATH, universe);
    await ensureBondLifecycleSync({ force: true }).catch((error) => {
      console.warn(`Bond lifecycle refresh skipped after inventory reconciliation: ${error.message}`);
    });
    const added = universe.bonds
      .filter((row) => !currentCodes.has(row.code))
      .map((row) => ({
        code: row.code,
        name: row.name,
        listingDate: row.listingDate,
      }));
    const candidateCodes = new Set(
      candidates.map(candidateMarketCode).filter(Boolean),
    );
    return {
      updated: added.length > 0,
      added,
      alreadyPresent: [...candidateCodes]
        .filter((code) => currentCodes.has(code))
        .sort(),
      supplementalUniverse: {
        updatedAt: universe.updatedAt,
        count: universe.bonds.length,
        codes: universe.bonds.map((row) => row.code),
      },
    };
  });
}

function summarizeNewBondAutoScan(result) {
  if (!result) return null;
  return {
    autoScanDate: String(result.autoScanDate || ""),
    targetDate: String(result.target_date || ""),
    targetSector: String(result.targetSector || ""),
    updated: Boolean(result.updated),
    added: Array.isArray(result.added) ? result.added : [],
    alreadyPresent: Array.isArray(result.alreadyPresent) ? result.alreadyPresent : [],
    supplementalUniverse: result.supplementalUniverse || null,
    generatedAt: String(result.generated_at || ""),
  };
}

async function scanNewBondSecondDay({ targetSector, date = "", apply = false } = {}) {
  if (newBondScanInFlight) return newBondScanInFlight;
  newBondScanInFlight = (async () => {
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    const discovery = await fetchLocalJson(`/new-bond-candidates${query}`, 30_000);
    const candidates = Array.isArray(discovery?.candidates) ? discovery.candidates : [];
    let boardUpdatedAt = "";
    let added = [];
    let alreadyPresent = [];
    let updated = false;
    let supplementalUniverse = null;
    if (apply) {
      const result = await applySecondDayBonds(
        candidates,
        targetSector,
        discovery.target_date || date,
      );
      boardUpdatedAt = result.boardUpdatedAt;
      added = result.added;
      alreadyPresent = result.alreadyPresent;
      updated = result.updated;
      supplementalUniverse = result.supplementalUniverse;
    } else {
      const currentState = await readBoardStateFile().catch(() => ({}));
      boardUpdatedAt = String(currentState.updatedAt || "");
    }

    const result = {
      ...discovery,
      targetSector,
      applied: apply,
      updated,
      added,
      alreadyPresent,
      boardUpdatedAt,
      supplementalUniverse,
      lastAutoScan: summarizeNewBondAutoScan(newBondLastResult),
    };
    return result;
  })().finally(() => {
    newBondScanInFlight = null;
  });
  return newBondScanInFlight;
}

async function scanNewBondInventory({ date = "", apply = false } = {}) {
  if (newBondScanInFlight) return newBondScanInFlight;
  newBondScanInFlight = (async () => {
    const params = new URLSearchParams({
      scope: "recent",
      lookback_days: String(NEW_BOND_RECONCILIATION_LOOKBACK_DAYS),
    });
    if (date) params.set("date", date);
    const discovery = await fetchLocalJson(
      `/new-bond-candidates?${params.toString()}`,
      30_000,
    );
    const candidates = Array.isArray(discovery?.candidates) ? discovery.candidates : [];
    let added = [];
    let alreadyPresent = [];
    let updated = false;
    let supplementalUniverse = null;
    if (apply) {
      const result = await applyNewBondInventoryReconciliation(
        candidates,
        discovery.target_date || date,
      );
      added = result.added;
      alreadyPresent = result.alreadyPresent;
      updated = result.updated;
      supplementalUniverse = result.supplementalUniverse;
    }
    return {
      ...discovery,
      applied: apply,
      updated,
      added,
      alreadyPresent,
      supplementalUniverse,
    };
  })().finally(() => {
    newBondScanInFlight = null;
  });
  return newBondScanInFlight;
}

async function handleNewBondSecondDay(request, response, url) {
  if (request.method !== "GET" && request.method !== "POST") {
    response.writeHead(405, { Allow: "GET, POST" });
    response.end("Method not allowed");
    return;
  }
  if (request.method === "POST" && !isLoopbackRequest(request)) {
    sendJson(response, 403, { error: "新券自动归组仅允许在运行看板的本机执行" });
    return;
  }

  const body = request.method === "POST"
    ? await readJsonBody(request, 16 * 1024)
    : {};
  const targetSector = String(
    body?.targetSector
      || url.searchParams.get("sector")
      || NEW_BOND_SECOND_DAY_TARGET_SECTOR,
  ).trim();
  const date = String(body?.date || url.searchParams.get("date") || "").trim();
  const apply = request.method === "POST" && body?.dryRun !== true;
  const scope = String(
    body?.scope || url.searchParams.get("scope") || "second_day",
  ).trim().toLowerCase();
  const payload = scope === "recent"
    ? await scanNewBondInventory({ date, apply })
    : await scanNewBondSecondDay({ targetSector, date, apply });
  sendJson(response, 200, payload);
}

function scheduleBoardLadderScan(delay = 60_000) {
  if (shuttingDown || ladderScanTimer) return;
  ladderScanTimer = setTimeout(async () => {
    ladderScanTimer = null;
    try { await boardLadder.scan(); }
    catch (error) { console.warn(`Board ladder scan deferred: ${error.message}`); }
    scheduleBoardLadderScan();
  }, delay);
}

function scheduleNewBondSecondDayScan(delay = NEW_BOND_AUTO_SCAN_INTERVAL_MS) {
  if (shuttingDown || newBondScanTimer) return;
  newBondScanTimer = setTimeout(async () => {
    newBondScanTimer = null;
    const clock = currentChinaDateTimeParts();
    const date = clock.date.replaceAll("-", "");
    const weekday = chinaWeekday(clock);
    const alreadyScanned = newBondLastResult?.autoScanDate === date;
    const alreadyReconciled = newBondLastReconciliationDate === date;
    const inAutoScanWindow = isNewBondAutoScanWindow(clock.time);
    const inReconciliationWindow = (
      inAutoScanWindow || isNewBondReconciliationWindow(clock.time)
    );
    const shouldReconcile = !alreadyReconciled && inReconciliationWindow;
    const shouldScanSecondDay = !alreadyScanned && inAutoScanWindow;
    if (
      clock
      && weekday !== 0
      && weekday !== 6
      && (shouldReconcile || shouldScanSecondDay)
    ) {
      try {
        let reconciliation = null;
        if (shouldReconcile) {
          reconciliation = await scanNewBondInventory({ date, apply: true });
          newBondLastReconciliationDate = date;
          console.log(
            `New-bond inventory reconciliation ${date}: `
              + `${reconciliation.added.length} added, `
              + `${reconciliation.candidates?.length || 0} recent candidates`,
          );
        }
        if (!shouldScanSecondDay) {
          scheduleNewBondSecondDayScan(NEW_BOND_AUTO_SCAN_INTERVAL_MS);
          return;
        }
        const result = await scanNewBondSecondDay({
          targetSector: NEW_BOND_SECOND_DAY_TARGET_SECTOR,
          date,
          apply: true,
        });
        result.inventoryReconciliation = reconciliation;
        result.autoScanDate = date;
        newBondLastResult = result;
        console.log(
          `New-bond second-day scan ${date}: ${result.added.length} added to ${result.targetSector}`,
        );
      } catch (error) {
        console.warn(
          `New-bond second-day scan failed: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    scheduleNewBondSecondDayScan(NEW_BOND_AUTO_SCAN_INTERVAL_MS);
  }, Math.max(250, delay));
}

async function handleState(request, response) {
  if (request.method === "GET") {
    try {
      const [raw, lifecyclePayload] = await Promise.all([
        fs.promises.readFile(BOARD_STATE_PATH, "utf8"),
        loadBondLifecycleWithRefresh(),
      ]);
      const filtered = filterBoardStateByLifecycle(JSON.parse(raw), lifecyclePayload);
      sendJson(response, 200, {
        exists: true,
        ...filtered.state,
        limitLadder: await boardLadder.status(),
        lifecycleFilter: lifecycleFilterSummary(lifecyclePayload, filtered.removed),
      });
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
    const lifecyclePayload = await loadBondLifecycleWithRefresh();
    let persisted;
    try {
      persisted = await withBoardStateMutationLock(async () => {
        const currentState = await readBoardStateFile().catch(() => null);
        if (
          currentState?.updatedAt &&
          (!body?.baseUpdatedAt || body.baseUpdatedAt !== currentState.updatedAt)
        ) {
          return {
            conflict: true,
            updatedAt: currentState.updatedAt,
          };
        }

        const normalized = normalizeBoardState(body);
        const filtered = filterBoardStateByLifecycle(normalized, lifecyclePayload);
        const state = filtered.state;
        await fs.promises.mkdir(path.dirname(BOARD_STATE_PATH), { recursive: true });
        await writeJsonAtomic(BOARD_STATE_PATH, state);
        return { state, removed: filtered.removed };
      });
    } catch (error) {
      throw error;
    }
    if (persisted.conflict) {
      sendJson(response, 409, {
        error: "页面数据已过期，请刷新后再编辑",
        updatedAt: persisted.updatedAt,
      });
      return;
    }
    const state = persisted.state;
    sendJson(response, 200, {
      ok: true,
      updatedAt: state.updatedAt,
      sectorCount: state.sectors.length,
      stockCount: state.sectors.reduce((total, sector) => total + sector.stocks.length, 0),
      stackCount: state.stackGroups.length,
      lifecycleFilter: lifecycleFilterSummary(lifecyclePayload, persisted.removed),
    });
    return;
  }

  response.writeHead(405, {
    "Content-Type": "text/plain; charset=utf-8",
    Allow: "GET, POST",
  });
  response.end("Method not allowed");
}

function lifecycleFilterSummary(lifecyclePayload, removed = []) {
  return {
    applied: bondLifecyclePayloadUsable(lifecyclePayload),
    checkedAt: bondLifecyclePayloadUsable(lifecyclePayload)
      ? String(lifecyclePayload.checkedAt || "")
      : "",
    qmtActiveCount: bondLifecyclePayloadUsable(lifecyclePayload)
      ? Number(lifecyclePayload.qmtActiveCount || 0)
      : 0,
    removedCount: Array.isArray(removed) ? removed.length : 0,
    removed: Array.isArray(removed) ? removed : [],
  };
}

function filterBoardStateByLifecycle(state, lifecyclePayload) {
  if (!bondLifecyclePayloadUsable(lifecyclePayload)) {
    return { state, removed: [] };
  }
  const removed = [];
  const sectors = (Array.isArray(state?.sectors) ? state.sectors : []).map((sector) => ({
    ...sector,
    stocks: (Array.isArray(sector?.stocks) ? sector.stocks : []).filter((stock) => {
      const secid = normalizeSecidInput(stock?.secid);
      const codeDigits = secid.split(".")[1] || "";
      if (!isConvertibleBondCode(codeDigits)) return true;
      const marketCode = secidToMiniQmtMarketCode(secid);
      const lifecycle = lifecyclePayload?.bonds?.[marketCode];
      if (!lifecycle || lifecycle.isActive !== false) return true;
      removed.push({
        code: marketCode,
        name: String(stock?.name || lifecycle.name || marketCode),
        lifecycleStatus: String(lifecycle.lifecycleStatus || "inactive_or_exited"),
        reason: String(lifecycle.reason || "absent_from_qmt_current_list"),
      });
      return false;
    }),
  }));
  return {
    state: {
      ...state,
      sectors,
    },
    removed,
  };
}

async function pruneInactiveBondsFromBoard(lifecyclePayload) {
  return withBoardStateMutationLock(async () => {
    const current = await readBoardStateFile().catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (!current) return { state: current, removed: [] };
    const filtered = filterBoardStateByLifecycle(current, lifecyclePayload);
    if (filtered.removed.length === 0) return filtered;
    filtered.state.updatedAt = new Date().toISOString();
    await writeJsonAtomic(BOARD_STATE_PATH, filtered.state);
    return filtered;
  });
}

async function handleTdxFormulaSelections(request, response) {
  if (request.method !== "GET") {
    response.writeHead(405, {
      "Content-Type": "text/plain; charset=utf-8",
      Allow: "GET",
    });
    response.end("Method not allowed");
    return;
  }
  try {
    const raw = await fs.promises.readFile(TDX_FORMULA_SELECTION_PATH, "utf8");
    sendJson(response, 200, { exists: true, ...JSON.parse(raw) });
  } catch (error) {
    if (error?.code === "ENOENT") {
      sendJson(response, 200, { exists: false, status: "not_run", formulas: [] });
      return;
    }
    throw error;
  }
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
      const previousClose = Number(parts[3]);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(change)) continue;

      quotes.push({
        secid,
        price,
        change,
        amount: Number(parts[11]) || 0,
        date: String(parts[17] || "").replaceAll("/", "-"),
        time: parts[18] || "",
        previousClose: Number.isFinite(previousClose) && previousClose > 0 ? previousClose : null,
        source: "新浪港股",
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

async function fetchMiniQmtIndexQuotes() {
  const configs = DOMESTIC_INDEXES.filter((item) => item.source !== "tencent");
  const codes = configs.map((item) => item.secid.split(".")[1] + (item.secid.startsWith("1.") ? ".SH" : ".SZ"));
  const payload = await fetchLocalJson(`/quotes?codes=${codes.join(",")}`, 5000);
  const rows = Array.isArray(payload?.quotes) ? payload.quotes : [];
  const bySecid = new Map(rows.map((row) => [String(row?.secid || ""), row]));
  const quotes = [];

  for (const config of configs) {
    const row = bySecid.get(config.secid);
    const price = Number(row?.price);
    const previousClose = Number(row?.previousClose);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(previousClose) || previousClose <= 0) {
      continue;
    }
    const change = price - previousClose;
    const percent = Number.isFinite(Number(row?.change))
      ? Number(row.change)
      : (change / previousClose) * 100;
    const date = String(row?.date || "");
    const time = String(row?.time || "");
    const timeText = /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)} ${time}`.trim() : time;
    quotes.push({
      key: config.key,
      group: config.group || "A股",
      name: config.name,
      price,
      change,
      percent,
      secid: config.secid,
      date,
      time: timeText,
      timetag: row?.timetag || "",
      quoteSource: "QMT gateway full_tick",
    });
  }

  if (quotes.length !== configs.length) {
    throw new Error(`QMT指数返回不完整（${quotes.length}/${configs.length}）`);
  }

  return Promise.all(
    quotes.map(async (quote) => {
      const config = configs.find((item) => item.key === quote.key);
      return withDomesticIndexSparkline(quote, config);
    }),
  );
}

async function withDomesticIndexSparkline(quote, config) {
  try {
    const spark = await withTimeout(fetchTencentMinuteSparkline(config.symbol, 90), 2500);
    return {
      ...quote,
      points: spark.points,
      sparkTimes: spark.times,
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
        sparkTimes: spark.times,
        sparkChange: spark.change,
        sparkTime: spark.time,
        sparkSource: "新浪5分钟K线",
      };
    } catch {
      return quote;
    }
  }
}

async function fetchSinaGlobalIndices({ includeDomestic = true } = {}) {
  const sinaDomesticIndexes = includeDomestic
    ? DOMESTIC_INDEXES.filter((item) => item.source !== "tencent")
    : [];
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
      return withDomesticIndexSparkline(quote, config);
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
        date: parts[6] || "",
        time: parts[7] || parts[5] || "",
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
          sparkTimes: spark.times,
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
            sparkTimes: spark.times,
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
      sparkTimes: spark.times,
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
    sparkTimes: spark.times,
    sparkChange: spark.change,
    sparkTime: spark.time,
    sparkDate: spark.date,
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

  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const exchangeTimeZone = result?.meta?.exchangeTimezoneName || "Asia/Shanghai";
  const sampledRows = downsampleRows(
    closes
      .map((value, index) => ({ value: Number(value), timestamp: timestamps[index] }))
      .filter((row) => Number.isFinite(row.value) && row.value > 0),
    limit,
    (row) => row.value,
  );
  const points = sampledRows.map((row) => row.value);
  if (points.length < 2) {
    throw new Error(`invalid yahoo index sparkline: ${symbol}`);
  }

  const first = points[0];
  const last = points[points.length - 1];
  const lastTimestamp = sampledRows.at(-1)?.timestamp;

  return {
    points,
    times: sampledRows.map((row) => formatUnixTime(row.timestamp, exchangeTimeZone)),
    price: Number(result.meta?.regularMarketPrice),
    previousClose: Number(result.meta?.chartPreviousClose ?? result.meta?.previousClose),
    quoteTimestamp: Number(result.meta?.regularMarketTime),
    quoteTime: formatUnixTime(result.meta?.regularMarketTime, exchangeTimeZone),
    quoteDate: formatUnixDate(result.meta?.regularMarketTime, exchangeTimeZone),
    timeZone: exchangeTimeZone,
    change: first ? ((last - first) / first) * 100 : 0,
    time: formatUnixTime(lastTimestamp, exchangeTimeZone),
    date: formatUnixDate(lastTimestamp, exchangeTimeZone),
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

function formatUnixDate(seconds, timeZone) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value * 1000));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year || ""}-${map.month || ""}-${map.day || ""}`;
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
  const sampledRows = downsampleRows(
    rows.filter((item) => Number.isFinite(item.price) && item.price > 0),
    limit,
    (row) => row.price,
  );
  const points = sampledRows.map((row) => row.price);
  if (points.length < 2) {
    throw new Error(`empty tencent sparkline: ${symbol}`);
  }

  const first = points[0];
  const last = points[points.length - 1];
  return {
    points,
    times: sampledRows.map((row) => normalizedMinuteClock(row.time)),
    change: first ? ((last - first) / first) * 100 : 0,
    date: rows[rows.length - 1]?.date || currentChinaDateKey(),
    time: rows[rows.length - 1]?.time || "",
  };
}

async function fetchSecuritySparkline(secid) {
  const symbol = secidToTencentSymbol(secid);
  if (isHongKongSecid(secid)) {
    const providers = [
      async () => ({ ...await fetchTencentMinuteSparkline(symbol), secid, source: "腾讯港股分时" }),
      () => fetchEastmoneyMinuteSparkline(secid),
      () => fetchYahooHongKongSparkline(secid),
    ];
    for (const provider of providers) {
      try {
        return await withTimeout(provider(), 3500);
      } catch {
        // Keep this fallback within the Hong Kong data sources and the browser timeout.
      }
    }
    throw new Error(`港股分时不可用: ${secid}`);
  }
  try {
    const spark = await fetchTencentMinuteSparkline(symbol);
    return {
      ...spark,
      secid,
      source: "腾讯分时",
    };
  } catch {
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

  const sampledRows = downsampleRows(
    latestRows
      .map((row) => ({ row, value: Number(row?.close) }))
      .filter((item) => Number.isFinite(item.value) && item.value > 0),
    limit,
    (item) => item.value,
  );
  const points = sampledRows.map((item) => item.value);

  if (points.length < 2) {
    throw new Error(`invalid sparkline: ${secid}`);
  }

  const first = points[0];
  const last = points[points.length - 1];

  return {
    secid,
    points,
    times: sampledRows.map((item) => normalizedMinuteClock(item.row?.day)),
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

  const sampledRows = downsampleRows(
    latestTrends
      .map((line) => ({
        line,
        value: Number(String(line).split(",")[2]),
      }))
      .filter((item) => Number.isFinite(item.value) && item.value > 0),
    limit,
    (item) => item.value,
  );
  const points = sampledRows.map((item) => item.value);
  if (points.length < 2) {
    throw new Error(`invalid eastmoney sparkline: ${secid}`);
  }

  const first = points[0];
  const last = points[points.length - 1];
  return {
    secid,
    points,
    times: sampledRows.map((item) =>
      normalizedMinuteClock(String(item.line).split(",")[0]),
    ),
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
    process.platform === "win32" ? "powershell.exe" : TDX_PRLCTL_PATH,
    process.platform === "win32"
      ? ["-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")]
      : ["exec", TDX_VM_NAME, "--current-user", "powershell", "-NoProfile", "-Command", script],
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

function chinaDateTimeParts(value = Date.now()) {
  const moment = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(moment.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(moment);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}:${map.second}`,
  };
}

function currentChinaDateTimeParts() {
  return chinaDateTimeParts(Date.now());
}

function chinaWeekday(clock) {
  return new Date(`${clock.date}T00:00:00Z`).getUTCDay();
}

function normalizeAuctionDate(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  return /^\d{8}$/.test(digits) ? digits : "";
}

function normalizeAuctionTime(value) {
  const match = String(value || "").match(/(?:^|\s)(\d{2}):?(\d{2}):?(\d{2})(?:\D|$)/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) return "";
  return `${match[1]}:${match[2]}:${match[3]}`;
}

function auctionTimeSeconds(value) {
  const normalized = normalizeAuctionTime(value);
  if (!normalized) return null;
  const [hour, minute, second] = normalized.split(":").map(Number);
  return hour * 3600 + minute * 60 + second;
}

function quoteTimestampParts(value) {
  let timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  if (timestamp < 100_000_000_000) timestamp *= 1000;
  const parts = chinaDateTimeParts(timestamp);
  return parts ? { ...parts, timestamp } : null;
}

function validateAuctionQuote(quote, tradingDate, capturedAt = Date.now()) {
  const expectedDate = normalizeAuctionDate(tradingDate);
  const quoteDate = normalizeAuctionDate(quote?.date);
  const quoteTime = normalizeAuctionTime(quote?.time);
  if (!expectedDate || quoteDate !== expectedDate) {
    return { ok: false, reason: "quote_date_mismatch" };
  }
  if (!quoteTime || auctionClockPhase(quoteTime) !== "collecting") {
    return { ok: false, reason: "quote_time_outside_auction" };
  }

  const timetag = String(quote?.timetag || "").trim();
  if (timetag) {
    const timetagDate = normalizeAuctionDate(timetag);
    const timetagTime = normalizeAuctionTime(timetag);
    if (timetagDate !== expectedDate || timetagTime !== quoteTime) {
      return { ok: false, reason: "quote_timetag_mismatch" };
    }
  }

  const timestampParts = quoteTimestampParts(quote?.timestamp);
  if (!timestampParts || normalizeAuctionDate(timestampParts.date) !== expectedDate) {
    return { ok: false, reason: "quote_timestamp_date_mismatch" };
  }
  if (auctionClockPhase(timestampParts.time) !== "collecting") {
    return { ok: false, reason: "quote_timestamp_outside_auction" };
  }
  const quoteSeconds = auctionTimeSeconds(quoteTime);
  const timestampSeconds = auctionTimeSeconds(timestampParts.time);
  if (
    quoteSeconds === null
    || timestampSeconds === null
    || Math.abs(quoteSeconds - timestampSeconds) > 5
  ) {
    return { ok: false, reason: "quote_timestamp_time_mismatch" };
  }

  const capturedParts = quoteTimestampParts(capturedAt);
  if (!capturedParts || normalizeAuctionDate(capturedParts.date) !== expectedDate) {
    return { ok: false, reason: "capture_date_mismatch" };
  }
  if (timestampParts.timestamp > capturedParts.timestamp + 15_000) {
    return { ok: false, reason: "quote_timestamp_in_future" };
  }
  return {
    ok: true,
    date: expectedDate,
    time: quoteTime,
    timetag: timetag || `${expectedDate} ${quoteTime}`,
    timestamp: timestampParts.timestamp,
  };
}

function validateAuctionSample(sample, tradingDate) {
  const timestampParts = quoteTimestampParts(sample?.timestamp);
  const fallbackDate = timestampParts ? normalizeAuctionDate(timestampParts.date) : "";
  return validateAuctionQuote(
    {
      date: sample?.date || fallbackDate,
      time: sample?.time,
      timetag: sample?.timetag,
      timestamp: sample?.timestamp,
    },
    tradingDate,
    sample?.capturedAt,
  );
}

function filterAuctionCacheSeries(items, tradingDate, maxSamples = AUCTION_MAX_SAMPLES) {
  const series = [];
  let filteredSampleCount = 0;
  for (const item of Array.isArray(items) ? items : []) {
    if (!/^[01]\.\d{6}$/.test(item?.secid) || !Array.isArray(item.samples)) continue;
    const samples = item.samples.slice(-maxSamples).filter((sample) => {
      const valid = validateAuctionSample(sample, tradingDate).ok;
      if (!valid) filteredSampleCount += 1;
      return valid;
    });
    if (samples.length === 0) continue;
    series.push({
      secid: item.secid,
      date: normalizeAuctionDate(tradingDate),
      previousClose: Number(item.previousClose) || null,
      source: item.source || "QMT竞价采样",
      samples,
    });
  }
  return { series, filteredSampleCount };
}

function auctionClockPhase(time) {
  if (time >= "09:15:00" && time < "09:25:30") return "collecting";
  if (time >= "09:25:30" && time < "09:30:00") return "frozen";
  return "closed";
}

function nextAuctionSamplerDelay() {
  const time = currentChinaDateTimeParts().time;
  if (auctionClockPhase(time) === "collecting") {
    return AUCTION_SAMPLE_INTERVAL_MS;
  }
  if (time >= "09:14:30" && time < "09:15:00") {
    return 1000;
  }
  return 30000;
}

function scheduleAuctionSampler(delayMs = 30000) {
  if (auctionSamplerTimer) clearTimeout(auctionSamplerTimer);
  auctionSamplerTimer = setTimeout(async () => {
    if (!auctionSamplerRunning) {
      auctionSamplerRunning = true;
      try {
        const clock = currentChinaDateTimeParts();
        const weekday = chinaWeekday(clock);
        const isWeekday = weekday >= 1 && weekday <= 5;
        const phase = isWeekday ? auctionClockPhase(clock.time) : "closed";
        if (phase === "collecting") {
          await sampleAuctionQuotes(clock);
          await persistAuctionCache();
        } else if (phase === "frozen") {
          await persistAuctionCache(true);
        }
      } catch (error) {
        console.warn(`QMT auction sampler failed: ${error.message}`);
      } finally {
        auctionSamplerRunning = false;
      }
    }
    scheduleAuctionSampler(nextAuctionSamplerDelay());
  }, Math.max(250, delayMs));
}

async function fetchBoardQmtQuotes(codesInput, timeout = 12_000) {
  const codes = String(codesInput).split(",").filter(Boolean);
  if (!codes.some((code) => code.endsWith(".BJ"))) return fetchLocalJson(`/quotes?${new URLSearchParams({ codes: codesInput })}`, timeout);
  const domestic = codes.filter((code) => !code.endsWith(".BJ"));
  const [main, beijing] = await Promise.allSettled([
    domestic.length ? fetchLocalJson(`/quotes?${new URLSearchParams({ codes: domestic.join(",") })}`, timeout) : Promise.resolve({ quotes: [] }),
    loadBeijingLadderQuotes(codes),
  ]);
  const payload = main.status === "fulfilled" ? main.value : { quotes: [], quote_backend: { active: "unavailable" } };
  const quotes = [...(payload.quotes || []), ...(beijing.status === "fulfilled" ? beijing.value : [])];
  if (!quotes.length) throw new Error("QMT未返回有效报价");
  return { ...payload, quotes, failed: main.status === "rejected" || beijing.status === "rejected" };
}

async function sampleAuctionQuotes(clock = currentChinaDateTimeParts()) {
  const tradingDate = clock.date.replaceAll("-", "");
  if (auctionCacheDate !== tradingDate) {
    auctionCacheDate = tradingDate;
    auctionSeries.clear();
    auctionCacheDirty = true;
  }
  const secids = await loadAuctionBoardSecids();
  if (secids.length === 0) return;

  const capturedAt = Date.now();
  const rejectedReasons = new Map();
  for (const secidGroup of chunk(secids, 100)) {
    const marketCodes = secidGroup.map(secidToTdxStockCode);
    let payload;
    try {
      payload = await fetchBoardQmtQuotes(marketCodes.join(","), 12000);
    } catch (error) {
      console.warn(`QMT auction batch failed (${secidGroup[0]}): ${error.message}`);
      continue;
    }
    const batchCapturedAt = Date.now();
    const quotes = Array.isArray(payload?.quotes) ? payload.quotes : [];
    for (const quote of quotes) {
      const secid = normalizeSecidInput(quote.secid);
      const price = Number(quote.price);
      const amount = Number(quote.amount);
      if (!/^[01]\.\d{6}$/.test(secid) || !Number.isFinite(price) || price <= 0) continue;
      const validation = validateAuctionQuote(quote, tradingDate, batchCapturedAt);
      if (!validation.ok) {
        rejectedReasons.set(
          validation.reason,
          Number(rejectedReasons.get(validation.reason) || 0) + 1,
        );
        continue;
      }

      let cached = auctionSeries.get(secid);
      if (!cached || cached.date !== tradingDate) {
        cached = {
          secid,
          date: tradingDate,
          previousClose: Number(quote.previousClose) || null,
          samples: [],
        };
        auctionSeries.set(secid, cached);
      }
      const timestamp = validation.timestamp;
      cached.previousClose ||= Number(quote.previousClose) || null;
      cached.source = quote.source || payload.source || "QMT竞价采样";
      const changed = appendAuctionSample(cached, {
        capturedAt: batchCapturedAt,
        date: validation.date,
        timestamp,
        time: validation.time,
        timetag: validation.timetag,
        price,
        change: quote.change == null ? null : Number(quote.change),
        amount: Number.isFinite(amount) ? amount : 0,
        volume: Number(quote.volume) > 0 ? Number(quote.volume) : null,
      }, AUCTION_MAX_SAMPLES);
      if (changed) auctionCacheDirty = true;
    }
  }
  if (rejectedReasons.size > 0 && capturedAt - auctionLastRejectedLogAt >= 30_000) {
    console.warn(
      `QMT auction rejected stale/invalid quotes: ${[...rejectedReasons]
        .map(([reason, count]) => `${reason}=${count}`)
        .join(",")}`,
    );
    auctionLastRejectedLogAt = capturedAt;
  }
}

async function loadAuctionBoardSecids() {
  try {
    const [boardStat, tagsStat] = await Promise.all([
      fs.promises.stat(BOARD_STATE_PATH),
      fs.promises.stat(BOND_TAGS_PATH).catch(() => ({ mtimeMs: 0 })),
    ]);
    if (
      boardStat.mtimeMs === auctionBoardStateMtime
      && tagsStat.mtimeMs === auctionBondTagsMtime
      && auctionBoardSecids.length > 0
    ) {
      return auctionBoardSecids;
    }
    const boardState = await readBoardStateFile();
    const boardStocks = (boardState.sectors || [])
      .flatMap((sector) => sector.stocks || [])
      .map((stock) => ({
        name: String(stock?.name || "").trim(),
        secid: normalizeSecidInput(stock?.secid),
      }))
      .filter((stock) => /^[01]\.\d{6}$/.test(stock.secid));
    const boardNames = new Map(boardStocks.map((stock) => [stock.secid, stock.name]));
    const boardSecidSet = new Set(boardStocks.map((stock) => stock.secid));
    const tagPayload = await readJsonFile(BOND_TAGS_PATH).catch(() => ({ rows: [] }));
    const tagRows = Array.isArray(tagPayload?.rows) ? tagPayload.rows : [];
    const tagsByBondSecid = new Map(
      tagRows
        .map((row) => [normalizeTagSecid(row?.code), row])
        .filter(([secid]) => /^[01]\.\d{6}$/.test(secid)),
    );
    auctionBondPairs = [];
    const auctionPairKeys = new Set();
    for (const bond of boardStocks) {
      if (!isConvertibleBondCode(bond.secid.split(".")[1])) continue;
      const row = tagsByBondSecid.get(bond.secid);
      const stockSecid = normalizeTagSecid(row?.stockCode);
      if (!/^[01]\.\d{6}$/.test(stockSecid) || /^[89]/.test(stockSecid.split(".")[1])) continue;
      boardSecidSet.add(stockSecid);
      const pairKey = `${bond.secid}:${stockSecid}`;
      if (auctionPairKeys.has(pairKey)) continue;
      auctionPairKeys.add(pairKey);
      auctionBondPairs.push({
        bondSecid: bond.secid,
        bondCode: bond.secid.split(".")[1],
        bondName: bond.name || String(row?.name || bond.secid),
        stockSecid,
        stockCode: stockSecid.split(".")[1],
        stockName: boardNames.get(stockSecid) || String(row?.stockName || stockSecid),
      });
    }
    auctionBoardSecids = [...boardSecidSet];
    auctionBoardStateMtime = boardStat.mtimeMs;
    auctionBondTagsMtime = tagsStat.mtimeMs;
  } catch (error) {
    console.warn(`Auction watchlist unavailable: ${error.message}`);
  }
  return auctionBoardSecids;
}

function downsampleAuctionSamples(samples, limit) {
  if (samples.length <= limit) return samples;
  const lastIndex = samples.length - 1;
  const result = [];
  for (let index = 0; index < limit; index += 1) {
    result.push(samples[Math.round((index / (limit - 1)) * lastIndex)]);
  }
  return result;
}

async function loadAuctionCache() {
  const today = currentChinaDateTimeParts().date.replaceAll("-", "");
  try {
    const parsed = JSON.parse(await fs.promises.readFile(AUCTION_CACHE_PATH, "utf8"));
    if (parsed?.date && Array.isArray(parsed.series)) {
      await persistAuctionArchive(parsed);
    }
    if (parsed?.date !== today || !Array.isArray(parsed.series)) return;
    auctionCacheDate = today;
    const filtered = filterAuctionCacheSeries(parsed.series, today);
    for (const item of filtered.series) {
      auctionSeries.set(item.secid, item);
    }
    if (filtered.filteredSampleCount > 0) {
      auctionCacheDirty = true;
      console.warn(
        `Auction cache filtered ${filtered.filteredSampleCount} stale/invalid samples`,
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(`Auction cache unavailable: ${error.message}`);
    }
  }
}

async function persistAuctionArchive(payload) {
  const tradingDate = normalizeCbTradingDate(payload?.date);
  if (!tradingDate || !Array.isArray(payload?.series) || !payload.series.length) return;
  await fs.promises.mkdir(AUCTION_ARCHIVE_DIR, { recursive: true });
  const archivePath = path.join(AUCTION_ARCHIVE_DIR, `${tradingDate}.json`);
  const temporaryPath = `${archivePath}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporaryPath, `${JSON.stringify(payload)}\n`);
  await fs.promises.rename(temporaryPath, archivePath);
}

async function persistAuctionCache(force = false) {
  if (!auctionCacheDirty || !auctionCacheDate) return;
  if (!force && Date.now() - auctionLastPersistedAt < AUCTION_PERSIST_INTERVAL_MS) return;
  const payload = {
    date: auctionCacheDate,
    updatedAt: new Date().toISOString(),
    series: [...auctionSeries.values()],
  };
  await fs.promises.mkdir(path.dirname(AUCTION_CACHE_PATH), { recursive: true });
  const temporaryPath = `${AUCTION_CACHE_PATH}.tmp`;
  await fs.promises.writeFile(temporaryPath, `${JSON.stringify(payload)}\n`);
  await fs.promises.rename(temporaryPath, AUCTION_CACHE_PATH);
  await persistAuctionArchive(payload);
  auctionLastPersistedAt = Date.now();
  auctionCacheDirty = false;
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
    process.platform === "win32" ? "powershell.exe" : TDX_PRLCTL_PATH,
    process.platform === "win32"
      ? ["-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")]
      : ["exec", TDX_VM_NAME, "--current-user", "powershell", "-NoProfile", "-Command", script],
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

function normalizedMinuteClock(value) {
  const match = String(value || "").match(/(\d{2}):?(\d{2})(?::\d{2})?$/);
  return match ? `${match[1]}:${match[2]}` : "";
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

function downsampleRows(rows, limit, valueAccessor) {
  if (rows.length <= limit) return rows;
  if (limit < 4) return [rows[0], rows[rows.length - 1]].slice(0, limit);

  const sampled = [rows[0]];
  const bucketCount = Math.max(1, Math.floor((limit - 2) / 2));
  const bucketSize = (rows.length - 2) / bucketCount;

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = 1 + Math.floor(bucket * bucketSize);
    const end = Math.min(rows.length - 1, 1 + Math.floor((bucket + 1) * bucketSize));
    if (start >= end) continue;

    let minIndex = start;
    let maxIndex = start;
    for (let index = start + 1; index < end; index += 1) {
      if (valueAccessor(rows[index]) < valueAccessor(rows[minIndex])) minIndex = index;
      if (valueAccessor(rows[index]) > valueAccessor(rows[maxIndex])) maxIndex = index;
    }

    if (minIndex === maxIndex) {
      sampled.push(rows[minIndex]);
    } else if (minIndex < maxIndex) {
      sampled.push(rows[minIndex], rows[maxIndex]);
    } else {
      sampled.push(rows[maxIndex], rows[minIndex]);
    }
  }

  sampled.push(rows[rows.length - 1]);
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

  try {
    const bondPayload = JSON.parse(fs.readFileSync(BOND_TAGS_PATH, "utf8"));
    for (const bond of Array.isArray(bondPayload?.rows) ? bondPayload.rows : []) {
      addLocalSearchStock(
        stockBySecid,
        bond.name,
        normalizeTagSecid(bond.code),
        "转债",
        "Bond",
      );
    }
  } catch (error) {
    console.warn(`Local convertible-bond list unavailable: ${error.message}`);
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

module.exports = {
  buildAuctionSignalRows,
  auctionClockPhase,
  cbQuoteExecutionState,
  expectedCompletedCbDate,
  filterAuctionCacheSeries,
  filterBoardStateByLifecycle,
  mergeSecondDayBondsIntoState,
  mergeNewBondUniverseManifest,
  mergeBondTagPayloadWithNewUniverse,
  publicNewBondUniverse,
  isNewBondAutoScanWindow,
  isNewBondReconciliationWindow,
  normalizeAuctionDate,
  normalizeAuctionTime,
  quoteTimestampParts,
  validateAuctionQuote,
  validateAuctionSample,
};
