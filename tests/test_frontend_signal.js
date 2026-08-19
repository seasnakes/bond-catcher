const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const APP_SOURCE = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const BOND_SOURCE = fs.readFileSync(path.join(__dirname, "..", "bond.js"), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing source markers: ${startMarker}`);
  return source.slice(start, end);
}

function signalState(overrides = {}) {
  return {
    signalScope: "focus",
    signalTypes: new Set(),
    signalMinDailyAmount: 0,
    signalMinDailyAmplitude: 0,
    signalCodeSignature: "*",
    signalCodeCount: 0,
    signalLoading: false,
    signalRequestGeneration: 0,
    signalLatestId: 0,
    signalTradingDate: "",
    signalEvents: [],
    signalStatusPayload: null,
    signalHealth: null,
    ...overrides,
  };
}

function signalRefreshContext(state, fetchJson) {
  const renders = [];
  const context = vm.createContext({
    state,
    fetchJson,
    URLSearchParams,
    SIGNAL_EVENT_LIMIT: 80,
    monitoredSignalCodes: () => [],
    renderSignalFeed: (ids = new Set()) => renders.push({
      loading: state.signalLoading,
      count: state.signalEvents.length,
      ids: [...ids],
    }),
    ensureSignalSparklines: async () => {},
    updateSignalMonitorStatus: () => {},
    console: { warn() {} },
  });
  vm.runInContext(
    sourceBetween(
      APP_SOURCE,
      "async function refreshSignalFeed(options = {})",
      "\nfunction createDemoQuotes",
    ),
    context,
  );
  return { context, renders };
}

const HEALTHY = {
  ok: true,
  degraded: false,
  monitor_alive: true,
  status: { last_returned_codes: 3 },
};

test("null signal speed falls back instead of rendering 0.00%", () => {
  const context = vm.createContext({ Number, Math });
  vm.runInContext(
    sourceBetween(APP_SOURCE, "function signalMetric(event)", "\nfunction signalTierLabel"),
    context,
  );
  assert.equal(
    vm.runInContext(
      "signalMetric({ speed_1m: null, amount_1m: null, score: 7.5 })",
      context,
    ),
    "评分 7.5",
  );
  assert.equal(
    vm.runInContext(
      "signalMetric({ speed_1m: 0, amount_1m: null, score: 7.5 })",
      context,
    ),
    "1分钟 0.00%",
  );
});

test("board rows rerender once when auction display time ends", () => {
  const classes = new Set(["is-auction"]);
  const state = { auctionPresentationActive: true };
  let renders = 0;
  const context = vm.createContext({
    state,
    grid: {
      classList: {
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
      },
    },
    isAuctionDisplaySession: () => false,
    renderAfterBackgroundUpdate() {
      renders += 1;
      state.auctionPresentationActive = false;
    },
  });
  vm.runInContext(
    sourceBetween(
      APP_SOURCE,
      "function syncAuctionDisplayPresentation",
      "\nfunction updateStatus",
    ),
    context,
  );

  assert.equal(vm.runInContext("syncAuctionDisplayPresentation(false)", context), true);
  assert.equal(classes.has("is-auction"), false);
  assert.equal(renders, 1);
  assert.equal(vm.runInContext("syncAuctionDisplayPresentation(false)", context), false);
  assert.equal(renders, 1);
});

test("health verdict controls live and error states without flagging off-hours", () => {
  const classes = new Map();
  const state = { signalPaused: false, signalEvents: [] };
  const signalMonitor = {
    classList: {
      toggle(name, enabled) {
        classes.set(name, Boolean(enabled));
      },
    },
  };
  const signalMonitorStatus = { textContent: "" };
  const context = vm.createContext({
    state,
    signalMonitor,
    signalMonitorStatus,
    Date,
    Number,
    String,
    Boolean,
    Math,
  });
  vm.runInContext(
    sourceBetween(
      APP_SOURCE,
      "function signalHealthState(payload, health)",
      "\nfunction monitoredSignalCodes",
    ),
    context,
  );
  context.payloadArg = {
    active_monitor_code_count: 320,
    trading_date: "20260812",
    data_is_stale: false,
  };
  context.healthArg = {
    ok: false,
    degraded: true,
    reason: "miniqmt_returned_zero_quotes",
    monitor_alive: true,
    calendar_date: "20260812",
    latest_trading_date: "20260812",
    last_returned_codes: 0,
    status_age_seconds: 1,
    status_max_age_seconds: 30,
    status: {
      trading_date: "20260812",
      updated_at: new Date().toISOString(),
      indicator_warmup: { requested_codes: 320 },
    },
  };
  vm.runInContext("updateSignalMonitorStatus(payloadArg, healthArg)", context);
  assert.equal(classes.get("is-live"), false);
  assert.equal(classes.get("is-error"), true);
  assert.match(signalMonitorStatus.textContent, /MiniQMT未返回有效行情/);

  context.healthArg = {
    ok: true,
    degraded: false,
    reason: "healthy_outside_market_session",
    monitor_alive: true,
    calendar_date: "20260812",
    latest_trading_date: "20260811",
    last_returned_codes: 0,
    status_age_seconds: 999,
    status_max_age_seconds: 30,
    status: {
      trading_date: "20260811",
      updated_at: "2026-08-11T15:00:00",
      indicator_warmup: { requested_codes: 320 },
    },
  };
  vm.runInContext("updateSignalMonitorStatus(payloadArg, healthArg)", context);
  assert.equal(classes.get("is-live"), false);
  assert.equal(classes.get("is-error"), false);
  assert.match(signalMonitorStatus.textContent, /非交易时段/);
});

test("cursor reset replaces old-day rows and carries the cursor date", async () => {
  const state = signalState({
    signalLatestId: 900,
    signalTradingDate: "20260811",
    signalEvents: [{ id: 900 }],
  });
  const urls = [];
  const { context } = signalRefreshContext(state, async (url) => {
    urls.push(url);
    return url.includes("/events?")
      ? {
        trading_date: "20260812",
        cursor_reset: true,
        latest_id: 3,
        events: [{ id: 3 }, { id: 2 }],
      }
      : HEALTHY;
  });
  await vm.runInContext("refreshSignalFeed()", context);
  assert.match(urls[0], /after_id=900/);
  assert.match(urls[0], /trading_date=20260811/);
  assert.deepEqual(state.signalEvents.map((event) => event.id), [3, 2]);
  assert.equal(state.signalLatestId, 3);
  assert.equal(state.signalTradingDate, "20260812");
});

test("date change refetches from zero when an older API omits cursor_reset", async () => {
  const state = signalState({
    signalLatestId: 10,
    signalTradingDate: "20260811",
    signalEvents: [{ id: 10 }],
  });
  const urls = [];
  let eventCall = 0;
  const payloads = [
    {
      trading_date: "20260812",
      cursor_reset: false,
      latest_id: 99,
      events: [{ id: 99 }],
    },
    {
      trading_date: "20260812",
      cursor_reset: false,
      latest_id: 5,
      events: [{ id: 5 }, { id: 4 }],
    },
  ];
  const { context } = signalRefreshContext(state, async (url) => {
    urls.push(url);
    return url.includes("/events?") ? payloads[eventCall++] : HEALTHY;
  });
  await vm.runInContext("refreshSignalFeed()", context);
  const eventUrls = urls.filter((url) => url.includes("/events?"));
  assert.equal(eventUrls.length, 2);
  assert.match(eventUrls[0], /after_id=10/);
  assert.doesNotMatch(eventUrls[1], /after_id=/);
  assert.match(eventUrls[1], /trading_date=20260812/);
  assert.deepEqual(state.signalEvents.map((event) => event.id), [5, 4]);
});

test("a stale in-flight response cannot overwrite a reset request", async () => {
  const state = signalState();
  let resolveOldEvents;
  let resolveOldHealth;
  const oldEvents = new Promise((resolve) => { resolveOldEvents = resolve; });
  const oldHealth = new Promise((resolve) => { resolveOldHealth = resolve; });
  let eventCall = 0;
  let healthCall = 0;
  const { context } = signalRefreshContext(state, (url) => {
    if (url.includes("/events?")) {
      eventCall += 1;
      return eventCall === 1
        ? oldEvents
        : Promise.resolve({ trading_date: "20260812", latest_id: 22, events: [{ id: 22 }] });
    }
    healthCall += 1;
    return healthCall === 1 ? oldHealth : Promise.resolve(HEALTHY);
  });
  const oldRequest = vm.runInContext("refreshSignalFeed()", context);
  state.signalScope = "all";
  const newRequest = vm.runInContext("refreshSignalFeed({ reset: true })", context);
  await newRequest;
  resolveOldEvents({ trading_date: "20260812", latest_id: 999, events: [{ id: 999 }] });
  resolveOldHealth(HEALTHY);
  await oldRequest;
  assert.deepEqual(state.signalEvents.map((event) => event.id), [22]);
  assert.equal(state.signalLatestId, 22);
});

test("an empty response rerenders after loading is cleared", async () => {
  const state = signalState();
  const { context, renders } = signalRefreshContext(
    state,
    async (url) => url.includes("/events?")
      ? { trading_date: "20260812", latest_id: 0, events: [] }
      : HEALTHY,
  );
  await vm.runInContext("refreshSignalFeed()", context);
  assert.equal(state.signalLoading, false);
  assert.equal(renders.at(-1).loading, false);
  assert.equal(renders.at(-1).count, 0);
});

test("one-day intraday renders without waiting for daily reference data", async () => {
  let dailyLoads = 0;
  const context = vm.createContext({
    state: { intradayDays: 1 },
    loadReferenceDailyPayload: async () => {
      dailyLoads += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { rows: [] };
    },
    URLSearchParams,
    fetchJson: async () => {
      throw new Error("unexpected historical request");
    },
  });
  vm.runInContext(
    sourceBetween(
      BOND_SOURCE,
      "function intradayAvailableDates(mainPayload, dayCount)",
      "\nfunction setView",
    ),
    context,
  );
  const payload = { trading_date: "20260812", rows: [{ close: 100 }] };
  context.payloadArg = payload;
  const started = performance.now();
  const result = await vm.runInContext("loadIntradayPayloads(payloadArg, 1)", context);
  const elapsed = performance.now() - started;
  assert.equal(result.length, 1);
  assert.equal(result[0], payload);
  assert.equal(dailyLoads, 0);
  assert.ok(elapsed < 25, `one-day path unexpectedly waited ${elapsed.toFixed(1)}ms`);
  assert.doesNotMatch(
    sourceBetween(
      BOND_SOURCE,
      "function intradayAvailableDates(mainPayload, dayCount)",
      "\nfunction setView",
    ),
    /loadReferenceDailyPayload/,
  );
  assert.doesNotMatch(BOND_SOURCE, /loadReferenceDailyInBackground/);
});

test("five-day intraday uses available dates without loading daily K-lines", async () => {
  let dailyLoads = 0;
  const fetched = [];
  const context = vm.createContext({
    state: {
      intradayDays: 5,
      requestId: 7,
      referenceDailyPayload: null,
      intradayPayloadCache: new Map(),
      intradayPayloadRequests: new Map(),
      intradayPayloadRetryAt: new Map(),
    },
    requestedCode: "123104",
    loadReferenceDailyPayload: async () => {
      dailyLoads += 1;
      throw new Error("unexpected daily request");
    },
    URLSearchParams,
    Number,
    String,
    Math,
    Date,
    INTRADAY_HISTORY_FAILURE_RETRY_MS: 60_000,
    fetchJson: async (url) => {
      fetched.push(url);
      const tradingDate = new URL(url, "http://finance.local").searchParams.get("date");
      return { trading_date: tradingDate, rows: [{ close: 100 }] };
    },
  });
  vm.runInContext(
    sourceBetween(
      BOND_SOURCE,
      "function intradayAvailableDates(mainPayload, dayCount)",
      "\nfunction setView",
    ),
    context,
  );
  const payload = {
    trading_date: "20260812",
    available_dates: [
      "20260812",
      "20260811",
      "20260810",
      "20260807",
      "20260806",
      "20260805",
      "20260813",
      "invalid",
      "20260810",
    ],
    rows: [{ close: 101 }],
  };
  context.payloadArg = payload;
  const result = await vm.runInContext("loadIntradayPayloads(payloadArg, 7)", context);
  assert.equal(dailyLoads, 0);
  assert.deepEqual(
    Array.from(result, (item) => item.trading_date),
    ["20260806", "20260807", "20260810", "20260811", "20260812"],
  );
  assert.deepEqual(fetched, [
    "/api/miniqmt/bond?code=123104&date=20260811",
    "/api/miniqmt/bond?code=123104&date=20260810",
    "/api/miniqmt/bond?code=123104&date=20260807",
    "/api/miniqmt/bond?code=123104&date=20260806",
  ]);

  fetched.length = 0;
  const refreshed = await vm.runInContext("loadIntradayPayloads(payloadArg, 7)", context);
  assert.deepEqual(
    Array.from(refreshed, (item) => item.trading_date),
    ["20260806", "20260807", "20260810", "20260811", "20260812"],
  );
  assert.deepEqual(fetched, []);

  context.state.intradayDays = 3;
  context.historicalPayload = {
    ...payload,
    trading_date: "20260807",
    rows: [{ close: 99 }],
  };
  fetched.length = 0;
  const historical = await vm.runInContext(
    "loadIntradayPayloads(historicalPayload, 7)",
    context,
  );
  assert.deepEqual(
    Array.from(historical, (item) => item.trading_date),
    ["20260805", "20260806", "20260807"],
  );
  assert.deepEqual(fetched, ["/api/miniqmt/bond?code=123104&date=20260805"]);
});

test("five-day intraday skips a missing candidate and continues to an older date", async () => {
  const fetchedDates = [];
  const context = vm.createContext({
    state: {
      intradayDays: 5,
      requestId: 9,
      referenceDailyPayload: null,
      intradayPayloadCache: new Map(),
      intradayPayloadRequests: new Map(),
      intradayPayloadRetryAt: new Map(),
    },
    requestedCode: "123104",
    URLSearchParams,
    Number,
    String,
    Math,
    Date,
    INTRADAY_HISTORY_FAILURE_RETRY_MS: 60_000,
    fetchJson: async (url) => {
      const tradingDate = new URL(url, "http://finance.local").searchParams.get("date");
      fetchedDates.push(tradingDate);
      if (tradingDate === "20260811") throw new Error("HTTP 404");
      return { trading_date: tradingDate, rows: [{ close: 100 }] };
    },
  });
  vm.runInContext(
    sourceBetween(
      BOND_SOURCE,
      "function intradayAvailableDates(mainPayload, dayCount)",
      "\nfunction setView",
    ),
    context,
  );
  context.payloadArg = {
    trading_date: "20260812",
    available_dates: [
      "20260812",
      "20260811",
      "20260810",
      "20260807",
      "20260806",
      "20260805",
    ],
    rows: [{ close: 101 }],
  };
  const result = await vm.runInContext("loadIntradayPayloads(payloadArg, 9)", context);
  assert.deepEqual(
    Array.from(result, (item) => item.trading_date),
    ["20260805", "20260806", "20260807", "20260810", "20260812"],
  );
  assert.deepEqual(
    fetchedDates,
    ["20260811", "20260810", "20260807", "20260806", "20260805"],
  );
});

test("historical multi-day view never selects dates after the clicked trading day", async () => {
  const fetchedDates = [];
  const context = vm.createContext({
    state: {
      intradayDays: 3,
      requestId: 11,
      referenceDailyPayload: null,
      intradayPayloadCache: new Map(),
      intradayPayloadRequests: new Map(),
      intradayPayloadRetryAt: new Map(),
    },
    requestedCode: "123104",
    URLSearchParams,
    Number,
    String,
    Math,
    Date,
    INTRADAY_HISTORY_FAILURE_RETRY_MS: 60_000,
    fetchJson: async (url) => {
      const tradingDate = new URL(url, "http://finance.local").searchParams.get("date");
      fetchedDates.push(tradingDate);
      return { trading_date: tradingDate, rows: [{ close: 100 }] };
    },
  });
  vm.runInContext(
    sourceBetween(
      BOND_SOURCE,
      "function intradayAvailableDates(mainPayload, dayCount)",
      "\nfunction setView",
    ),
    context,
  );
  context.payloadArg = {
    trading_date: "20260807",
    available_dates: [
      "20260812",
      "20260811",
      "20260810",
      "20260807",
      "20260806",
      "20260805",
    ],
    rows: [{ close: 101 }],
  };
  const result = await vm.runInContext("loadIntradayPayloads(payloadArg, 11)", context);
  assert.deepEqual(
    Array.from(result, (item) => item.trading_date),
    ["20260805", "20260806", "20260807"],
  );
  assert.deepEqual(fetchedDates, ["20260806", "20260805"]);
});

function referenceDailyContext(overrides = {}) {
  const scheduled = [];
  const calls = { fetch: [], draw: 0 };
  const state = {
    view: "intraday",
    panelActive: true,
    intradayRows: [{ close: 100 }],
    referenceDailyPayload: null,
    referenceDailyRequest: null,
    referenceDailyTimer: 0,
    referenceDailyFailureCount: 0,
    referenceDailyNextAllowedAt: 0,
    ...overrides.state,
  };
  const context = vm.createContext({
    state,
    isPanel: true,
    document: { hidden: false },
    requestedCode: "123104",
    URLSearchParams,
    Date,
    Math,
    REFERENCE_DAILY_INITIAL_DELAY_MS: 0,
    REFERENCE_DAILY_FAILURE_BASE_MS: 15_000,
    REFERENCE_DAILY_FAILURE_MAX_MS: 120_000,
    window: {
      clearTimeout() {},
      setTimeout(callback, delay) {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
    },
    fetchJson: async (url) => {
      calls.fetch.push(url);
      if (overrides.fetchError) throw overrides.fetchError;
      return overrides.responsePayload || {
        rows: Array.from({ length: 10 }, (_, index) => ({
          date: `202607${String(index + 1).padStart(2, "0")}`,
          close: 100 + index,
        })),
      };
    },
    drawChart() { calls.draw += 1; },
  });
  vm.runInContext(
    sourceBetween(
      BOND_SOURCE,
      "function referenceDailyLoadAllowed()",
      "\nfunction currentBondMarketCode",
    ),
    context,
  );
  return { context, state, calls, scheduled };
}

test("reference daily data loads asynchronously from the local-only endpoint and only redraws", async () => {
  const { context, state, calls, scheduled } = referenceDailyContext();
  vm.runInContext("scheduleReferenceDailyLoad()", context);
  assert.equal(calls.fetch.length, 0);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 0);

  await vm.runInContext("loadReferenceDailyPayload()", context);
  assert.deepEqual(calls.fetch, [
    "/api/miniqmt/daily?code=123104&count=30&reference=1",
  ]);
  assert.equal(calls.draw, 1);
  assert.equal(state.referenceDailyPayload.rows.length, 10);
  assert.equal(state.referenceDailyRequest, null);
  assert.equal(state.referenceDailyFailureCount, 0);
});

test("reference daily failures clear the request and back off 15 then 30 seconds", async () => {
  const { context, state, calls, scheduled } = referenceDailyContext({
    fetchError: new Error("local reference unavailable"),
  });
  await vm.runInContext("loadReferenceDailyPayload()", context);
  assert.equal(calls.fetch.length, 1);
  assert.equal(state.referenceDailyRequest, null);
  assert.equal(state.referenceDailyFailureCount, 1);
  assert.equal(scheduled.length, 1);
  assert.ok(scheduled[0].delay >= 14_900 && scheduled[0].delay <= 15_000);

  vm.runInContext("clearReferenceDailyTimer()", context);
  await vm.runInContext("loadReferenceDailyPayload()", context);
  assert.equal(calls.fetch.length, 2);
  assert.equal(state.referenceDailyRequest, null);
  assert.equal(state.referenceDailyFailureCount, 2);
  assert.ok(scheduled[1].delay >= 29_900 && scheduled[1].delay <= 30_000);

  context.document.hidden = true;
  vm.runInContext("clearReferenceDailyTimer(); scheduleReferenceDailyLoad()", context);
  assert.equal(scheduled.length, 2);
});

test("pending history backfill gets one fast follow-up even off hours", () => {
  const scheduled = [];
  const context = vm.createContext({
    state: {
      view: "intraday",
      refreshTimer: 0,
      payload: { history_backfill: { status: "pending" } },
    },
    isPanel: false,
    document: { hidden: false },
    window: {
      clearTimeout() {},
      setTimeout(callback, delay) {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
    },
    loadBond: async () => {},
    manualBackfillActiveForCurrentView: () => false,
  });
  vm.runInContext(
    sourceBetween(BOND_SOURCE, "function scheduleRefresh()", "\nfunction chartGeometry"),
    context,
  );
  vm.runInContext("scheduleRefresh()", context);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 1000);
});

test("panel bond requests opt into the Bridge-free fast path", () => {
  assert.match(
    BOND_SOURCE,
    /if \(isPanel && !date\) query\.set\("fast", "1"\)/,
  );
  assert.match(BOND_SOURCE, /"极速预览 · 后台补齐中"/);
  assert.match(BOND_SOURCE, /"极速预览 · 分时已补齐"/);
  assert.match(BOND_SOURCE, /完成后将自动重绘/);
  assert.match(BOND_SOURCE, /finance:bond-panel-active/);
  assert.match(BOND_SOURCE, /if \(isPanel && \(!state\.panelActive \|\| document\.hidden\)\) return/);
});

test("an active panel retries a transient empty fast preview after two seconds", () => {
  const scheduled = [];
  const context = vm.createContext({
    state: {
      panelActive: true,
      manualDate: false,
      refreshTimer: 0,
    },
    isPanel: true,
    document: { hidden: false },
    PANEL_LOAD_ERROR_RETRY_MS: 2_000,
    marketRefreshWindow: () => ({ active: true }),
    loadBond: () => {},
    window: {
      clearTimeout() {},
      setTimeout(callback, delay) {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
    },
  });
  vm.runInContext(
    sourceBetween(
      BOND_SOURCE,
      "function schedulePanelLoadErrorRetry()",
      "\nasync function loadBond",
    ),
    context,
  );

  assert.equal(context.schedulePanelLoadErrorRetry(), true);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 2_000);

  context.document.hidden = true;
  assert.equal(context.schedulePanelLoadErrorRetry(), false);
  assert.equal(scheduled.length, 1);
});

function panelHistoryBackfillContext(overrides = {}) {
  const scheduled = [];
  const calls = { fetch: [], render: 0, refresh: 0, status: 0 };
  const state = {
    payload: {
      trading_date: "20260812",
      rows: [{ time: "09:30", close: 100 }],
      history_backfill: { status: "pending", required: true },
    },
    intradayPayloads: [],
    intradayRows: [],
    selectedIndex: -1,
    view: "intraday",
    manualDate: false,
    intradayDays: 1,
    panelActive: true,
    panelHistoryBackfillTimer: 0,
    panelHistoryBackfillLoading: false,
    panelHistoryBackfillFailureCount: 0,
    panelHistoryBackfillNextAllowedAt: 0,
    panelHistoryBackfillTradingDate: "",
    ...overrides.state,
  };
  const context = vm.createContext({
    state,
    isPanel: true,
    document: { hidden: false },
    requestedCode: "123104",
    URLSearchParams,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    PANEL_HISTORY_BACKFILL_INITIAL_DELAY_MS: 1_500,
    PANEL_HISTORY_BACKFILL_PENDING_DELAY_MS: 5_000,
    PANEL_HISTORY_BACKFILL_PARTIAL_DELAY_MS: 30_000,
    PANEL_HISTORY_BACKFILL_FAILURE_BASE_MS: 15_000,
    PANEL_HISTORY_BACKFILL_FAILURE_MAX_MS: 120_000,
    PANEL_HISTORY_BACKFILL_SUCCESS_COOLDOWN_MS: 60_000,
    window: {
      clearTimeout() {},
      setTimeout(callback, delay) {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
    },
    fetchJson: async (url) => {
      calls.fetch.push(url);
      if (overrides.fetchError) throw overrides.fetchError;
      return overrides.responsePayload || {
        trading_date: "20260812",
        rows: [
          { time: "09:30", close: 100 },
          { time: "09:31", close: 101 },
        ],
        history_backfill: { status: "ready", required: false },
      };
    },
    renderPayload() { calls.render += 1; },
    setStatus() { calls.status += 1; },
    statusText: () => "ready",
    statusTone: () => "",
    scheduleRefresh() { calls.refresh += 1; },
    ...overrides.context,
  });
  vm.runInContext(
    sourceBetween(BOND_SOURCE, "function applyBondPayload", "\nfunction currentBondMarketCode"),
    context,
  );
  return { context, state, scheduled, calls };
}

test("panel history backfill scheduler is visible-only and deduplicated", () => {
  const { context, state, scheduled } = panelHistoryBackfillContext();
  vm.runInContext("schedulePanelHistoryBackfill()", context);
  vm.runInContext("schedulePanelHistoryBackfill()", context);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 1_500);

  context.document.hidden = true;
  vm.runInContext("schedulePanelHistoryBackfill()", context);
  assert.equal(state.panelHistoryBackfillTimer, 0);
  assert.equal(scheduled.length, 1);

  context.document.hidden = false;
  state.panelActive = false;
  vm.runInContext("schedulePanelHistoryBackfill()", context);
  assert.equal(scheduled.length, 1);
});

test("panel history backfill uses ordinary GET and redraws only non-regressing rows", async () => {
  const { context, state, calls, scheduled } = panelHistoryBackfillContext();
  await vm.runInContext("loadPanelHistoryBackfill()", context);
  assert.deepEqual(calls.fetch, ["/api/miniqmt/bond?code=123104"]);
  assert.doesNotMatch(calls.fetch[0], /(?:^|[?&])fast=/);
  assert.equal(state.payload.rows.length, 2);
  assert.equal(state.intradayRows.length, 2);
  assert.equal(calls.render, 1);
  assert.equal(calls.status, 1);
  assert.equal(calls.refresh, 1);
  assert.equal(scheduled.length, 0);
  assert.ok(state.panelHistoryBackfillNextAllowedAt - Date.now() > 59_000);

  state.payload = {
    trading_date: "20260812",
    rows: [{}, {}, {}],
    history_backfill: { status: "pending", required: true },
  };
  state.panelHistoryBackfillNextAllowedAt = 0;
  await vm.runInContext("loadPanelHistoryBackfill()", context);
  assert.equal(calls.fetch.length, 2);
  assert.equal(state.payload.rows.length, 3);
  assert.equal(calls.render, 1);
});

test("pending panel history backfill waits five seconds before another ordinary GET", async () => {
  const { context, scheduled } = panelHistoryBackfillContext({
    responsePayload: {
      trading_date: "20260812",
      rows: [{ time: "09:30", close: 100 }],
      history_backfill: { status: "pending", required: true },
    },
  });
  await vm.runInContext("loadPanelHistoryBackfill()", context);
  assert.equal(scheduled.length, 1);
  assert.ok(scheduled[0].delay >= 4_900, `unexpected retry ${scheduled[0].delay}`);
  assert.ok(scheduled[0].delay <= 5_000);
  assert.notEqual(scheduled[0].delay, 2_000);
});

test("partial panel history backfill honors the server retry interval", async () => {
  const { context, scheduled } = panelHistoryBackfillContext({
    responsePayload: {
      trading_date: "20260812",
      rows: [{ time: "09:30", close: 100 }],
      history_backfill: {
        status: "partial",
        required: true,
        retry_in_seconds: 30,
      },
    },
  });
  await vm.runInContext("loadPanelHistoryBackfill()", context);
  assert.equal(scheduled.length, 1);
  assert.ok(scheduled[0].delay >= 29_900, `unexpected retry ${scheduled[0].delay}`);
  assert.ok(scheduled[0].delay <= 30_000);
  assert.notEqual(scheduled[0].delay, 5_000);
});

test("panel history backfill failures retry at 15 seconds, never two seconds", async () => {
  const { context, state, calls, scheduled } = panelHistoryBackfillContext({
    fetchError: new Error("bridge busy"),
  });
  await vm.runInContext("loadPanelHistoryBackfill()", context);
  assert.equal(state.panelHistoryBackfillFailureCount, 1);
  assert.equal(calls.fetch.length, 1);
  assert.equal(scheduled.length, 1);
  assert.ok(scheduled[0].delay >= 14_900, `unexpected retry ${scheduled[0].delay}`);
  assert.ok(scheduled[0].delay <= 15_000);
  assert.notEqual(scheduled[0].delay, 2_000);

  vm.runInContext("clearPanelHistoryBackfillTimer()", context);
  await vm.runInContext("loadPanelHistoryBackfill()", context);
  assert.equal(state.panelHistoryBackfillFailureCount, 2);
  assert.ok(scheduled[1].delay >= 29_900, `unexpected retry ${scheduled[1].delay}`);
  assert.ok(scheduled[1].delay <= 30_000);
});

function manualBackfillContext(overrides = {}) {
  const scheduled = [];
  const calls = { post: [], fetch: [], load: [], status: [], clearPanel: 0 };
  let nextTimerId = 1;
  const state = {
    payload: { trading_date: "20260812" },
    view: "intraday",
    manualDate: false,
    panelActive: true,
    manualBackfillJob: null,
    manualBackfillGeneration: 0,
    manualBackfillPollTimer: 0,
    manualBackfillPollToken: "",
    manualBackfillPollFailureCount: 0,
    manualBackfillReloadedJobKey: "",
    manualBackfillRedrawJobKey: "",
    manualBackfillRedrawRequest: null,
    manualBackfillRedrawFailureCount: 0,
    intradayPayloadCache: new Map(),
    intradayPayloadRetryAt: new Map(),
    ...overrides.state,
  };
  const nodes = {
    refreshButton: { textContent: "立即刷新", disabled: false },
    dateSelect: { value: "20260812" },
    ...overrides.nodes,
  };
  const document = { hidden: false, ...overrides.document };
  const context = vm.createContext({
    state,
    nodes,
    document,
    isPanel: Boolean(overrides.isPanel),
    requestedCode: "123104",
    URLSearchParams,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    MANUAL_BACKFILL_MIN_POLL_MS: 3_000,
    MANUAL_BACKFILL_DEFAULT_POLL_MS: 5_000,
    MANUAL_BACKFILL_POLL_FAILURE_MAX_MS: 30_000,
    MANUAL_BACKFILL_MARKET_WAIT_POLL_MS: 30_000,
    MANUAL_BACKFILL_REDRAW_RETRY_BASE_MS: 5_000,
    MANUAL_BACKFILL_REDRAW_RETRY_MAX_MS: 30_000,
    window: {
      clearTimeout(id) {
        const timer = scheduled.find((item) => item.id === id);
        if (timer) timer.cleared = true;
      },
      setTimeout(callback, delay) {
        const timer = { id: nextTimerId++, callback, delay, cleared: false };
        scheduled.push(timer);
        return timer.id;
      },
    },
    clearPanelHistoryBackfillTimer() { calls.clearPanel += 1; },
    setStatus(text, tone = "") { calls.status.push({ text, tone }); },
    loadBond: async (options) => {
      calls.load.push(options);
      if (overrides.loadBond) return overrides.loadBond(options);
      return true;
    },
    postJson: async (url, body) => {
      calls.post.push({ url, body });
      if (overrides.postJson) return overrides.postJson(url, body);
      return overrides.postPayload || {
        job_id: "job-1",
        code: "123104",
        date: "20260812",
        status: "queued",
        poll_after_seconds: 5,
      };
    },
    fetchJson: async (url) => {
      calls.fetch.push(url);
      if (overrides.fetchJson) return overrides.fetchJson(url);
      return overrides.pollPayload || {
        job_id: "job-1",
        code: "123104",
        date: "20260812",
        status: "running",
        poll_after_seconds: 5,
      };
    },
  });
  vm.runInContext(
    sourceBetween(
      BOND_SOURCE,
      "function normalizeManualBackfillStatus(value)",
      "\nfunction referenceDailyLoadAllowed",
    ),
    context,
  );
  const activeTimers = () => scheduled.filter((timer) => !timer.cleared);
  return { context, state, nodes, document, calls, scheduled, activeTimers };
}

test("intraday refresh submits one manual backfill job while the normal chart refresh starts", async () => {
  let resolvePost;
  const postResponse = new Promise((resolve) => { resolvePost = resolve; });
  const { context, state, nodes, calls, activeTimers } = manualBackfillContext({
    postJson: () => postResponse,
  });
  const first = vm.runInContext("startManualIntradayRefresh()", context);
  const duplicate = vm.runInContext("startManualIntradayRefresh()", context);

  assert.equal(calls.load.length, 1);
  assert.equal(calls.post.length, 1);
  assert.equal(calls.clearPanel, 1);
  assert.equal(nodes.refreshButton.disabled, true);
  assert.equal(nodes.refreshButton.textContent, "提交中…");
  assert.equal(calls.status.at(-1).text, "正在提交补齐任务");
  assert.match(
    BOND_SOURCE,
    /nodes\.refreshButton\.addEventListener\("click"[\s\S]*startManualIntradayRefresh/,
  );

  resolvePost({
    job_id: "job-1",
    code: "123104",
    date: "20260812",
    status: "queued",
    queue_position: 2,
    poll_after_seconds: 1,
  });
  await first;
  await duplicate;

  assert.equal(state.manualBackfillJob.status, "queued");
  assert.equal(calls.status.at(-1).text, "已排队 · 第2位");
  assert.equal(nodes.refreshButton.textContent, "排队中…");
  assert.equal(activeTimers().length, 1);
  assert.equal(activeTimers()[0].delay, 3_000);
});

test("manual backfill polls the pure status endpoint at the server interval", async () => {
  const { context, calls, activeTimers } = manualBackfillContext({
    postPayload: {
      job_id: "job-9",
      code: "123104",
      date: "20260812",
      status: "queued",
      poll_after_seconds: 3,
    },
    pollPayload: {
      job_id: "job-9",
      code: "123104",
      date: "20260812",
      status: "running",
      after_bar_count: 120,
      expected_bar_count: 241,
      poll_after_seconds: 9,
    },
  });
  await vm.runInContext("startManualIntradayRefresh()", context);
  vm.runInContext("clearManualBackfillPollTimer()", context);
  await vm.runInContext("pollManualBackfill()", context);

  assert.deepEqual(calls.fetch, [
    "/api/miniqmt/intraday-backfill?job_id=job-9",
  ]);
  assert.equal(calls.status.at(-1).text, "正在补齐 · 已获取120/241分钟");
  assert.equal(activeTimers().length, 1);
  assert.equal(activeTimers()[0].delay, 9_000);
  assert.ok(activeTimers()[0].delay >= 3_000);
});

test("manual backfill distinguishes after-close and Bridge-cooldown queues", async () => {
  const afterClose = manualBackfillContext({
    postPayload: {
      job_id: "after-close",
      code: "123104",
      date: "20260812",
      status: "queued",
      phase: "waiting_for_market_close",
      wait_reason: "waiting_for_monitor_to_stop",
      poll_after_seconds: 1,
    },
  });
  await vm.runInContext("startManualIntradayRefresh()", afterClose.context);
  assert.equal(afterClose.state.manualBackfillJob.status, "queued");
  assert.equal(afterClose.calls.status.at(-1).text, "已排队 · 盘后执行");
  assert.equal(afterClose.activeTimers()[0].delay, 30_000);

  const cooldown = manualBackfillContext({
    postPayload: {
      job_id: "cooldown",
      code: "123104",
      date: "20260812",
      status: "queued",
      phase: "waiting_for_bridge_cooldown",
      wait_reason: "bridge_failure_cooldown",
      poll_after_seconds: 1,
      retry_in_seconds: 12,
    },
  });
  await vm.runInContext("startManualIntradayRefresh()", cooldown.context);
  assert.equal(cooldown.calls.status.at(-1).text, "已排队 · Bridge冷却");
  assert.equal(cooldown.activeTimers()[0].delay, 12_000);

  assert.equal(
    vm.runInContext('normalizeManualBackfillStatus("persisting")', cooldown.context),
    "running",
  );
  assert.equal(
    vm.runInContext('normalizeManualBackfillStatus("interrupted")', cooldown.context),
    "failed",
  );
});

test("an old in-flight status request cannot consume the new job poll", async () => {
  let resolveOldPoll;
  const oldPollPayload = new Promise((resolve) => { resolveOldPoll = resolve; });
  let pollCall = 0;
  const manual = manualBackfillContext({
    fetchJson: () => {
      pollCall += 1;
      if (pollCall === 1) return oldPollPayload;
      return Promise.resolve({
        job_id: "new-job",
        code: "123104",
        date: "20260811",
        status: "running",
        poll_after_seconds: 5,
      });
    },
  });
  manual.state.manualBackfillGeneration = 1;
  manual.state.manualBackfillJob = {
    job_id: "old-job",
    code: "123104",
    date: "20260812",
    status: "running",
    generation: 1,
  };
  const oldPoll = vm.runInContext("pollManualBackfill()", manual.context);
  assert.equal(manual.state.manualBackfillPollToken, "1:old-job");

  manual.state.manualDate = true;
  manual.nodes.dateSelect.value = "20260811";
  manual.state.manualBackfillGeneration = 2;
  manual.state.manualBackfillJob = {
    job_id: "new-job",
    code: "123104",
    date: "20260811",
    status: "queued",
    generation: 2,
  };
  await vm.runInContext("pollManualBackfill()", manual.context);
  assert.equal(manual.calls.fetch.length, 2);
  assert.equal(manual.state.manualBackfillJob.job_id, "new-job");
  assert.equal(manual.activeTimers().length, 1);

  resolveOldPoll({
    job_id: "old-job",
    code: "123104",
    date: "20260812",
    status: "ready",
  });
  await oldPoll;
  assert.equal(manual.state.manualBackfillJob.job_id, "new-job");
  assert.equal(manual.activeTimers().length, 1);
});

test("manual backfill polling pauses while hidden and resumes with one immediate status check", async () => {
  const { context, document, calls, activeTimers } = manualBackfillContext();
  await vm.runInContext("startManualIntradayRefresh()", context);
  vm.runInContext("clearManualBackfillPollTimer()", context);
  document.hidden = true;
  vm.runInContext("resumeManualBackfillForView()", context);
  assert.equal(activeTimers().length, 0);
  assert.equal(calls.fetch.length, 0);

  document.hidden = false;
  vm.runInContext("resumeManualBackfillForView()", context);
  assert.equal(activeTimers().length, 1);
  assert.equal(activeTimers()[0].delay, 0);
  assert.equal(calls.fetch.length, 0);
});

test("panel backfill polling pauses while its preview is inactive", async () => {
  const panel = manualBackfillContext({ isPanel: true });
  await vm.runInContext("startManualIntradayRefresh()", panel.context);
  vm.runInContext("clearManualBackfillPollTimer()", panel.context);
  panel.state.panelActive = false;
  vm.runInContext("resumeManualBackfillForView()", panel.context);
  assert.equal(panel.activeTimers().length, 0);

  panel.state.panelActive = true;
  vm.runInContext("resumeManualBackfillForView()", panel.context);
  assert.equal(panel.activeTimers().length, 1);
  assert.equal(panel.activeTimers()[0].delay, 0);
});

test("ready manual backfill clears the target cache and redraws exactly once", async () => {
  const { context, state, nodes, calls, activeTimers } = manualBackfillContext();
  state.intradayPayloadCache.set("20260812", { stale: true });
  await vm.runInContext("startManualIntradayRefresh()", context);
  context.readyPayload = {
    job_id: "job-1",
    code: "123104",
    date: "20260812",
    status: "ready",
    row_count_before: 120,
    row_count_after: 241,
  };
  context.targetArg = { code: "123104", date: "20260812" };
  await vm.runInContext(
    "applyManualBackfillPayload(readyPayload, 1, targetArg)",
    context,
  );
  await vm.runInContext(
    "applyManualBackfillPayload(readyPayload, 1, targetArg)",
    context,
  );

  assert.equal(calls.load.length, 2, "one initial refresh plus one completed-job redraw");
  assert.equal(state.intradayPayloadCache.has("20260812"), false);
  assert.equal(nodes.refreshButton.disabled, false);
  assert.equal(nodes.refreshButton.textContent, "立即刷新");
  assert.equal(calls.status.at(-1).text, "补齐完成 · 已获取241分钟");
  assert.equal(activeTimers().length, 0);
});

test("ready redraw is marked only after the refreshed payload is applied", async () => {
  let redrawAttempt = 0;
  const manual = manualBackfillContext({
    loadBond: async () => {
      redrawAttempt += 1;
      return redrawAttempt > 1;
    },
  });
  manual.state.manualBackfillGeneration = 1;
  manual.context.readyPayload = {
    job_id: "retry-ready",
    code: "123104",
    date: "20260812",
    status: "ready",
    row_count_after: 241,
  };
  manual.context.targetArg = { code: "123104", date: "20260812" };
  await vm.runInContext(
    "applyManualBackfillPayload(readyPayload, 1, targetArg)",
    manual.context,
  );
  assert.equal(manual.state.manualBackfillReloadedJobKey, "");
  assert.equal(manual.activeTimers().length, 1);
  assert.equal(manual.activeTimers()[0].delay, 5_000);

  vm.runInContext("clearManualBackfillPollTimer()", manual.context);
  await vm.runInContext(
    "redrawReadyManualBackfill(state.manualBackfillJob, 1)",
    manual.context,
  );
  assert.equal(redrawAttempt, 2);
  assert.equal(manual.state.manualBackfillReloadedJobKey, "retry-ready");
  await vm.runInContext(
    "redrawReadyManualBackfill(state.manualBackfillJob, 1)",
    manual.context,
  );
  assert.equal(redrawAttempt, 2);
});

test("a ready redraw cancelled by daily mode retries after returning to intraday", async () => {
  let resolveCancelledRedraw;
  const cancelledRedraw = new Promise((resolve) => { resolveCancelledRedraw = resolve; });
  let redrawAttempt = 0;
  const manual = manualBackfillContext({
    loadBond: async () => {
      redrawAttempt += 1;
      if (redrawAttempt === 1) return cancelledRedraw;
      return true;
    },
  });
  manual.state.manualBackfillGeneration = 1;
  manual.context.readyPayload = {
    job_id: "mode-race",
    code: "123104",
    date: "20260812",
    status: "ready",
    row_count_after: 241,
  };
  manual.context.targetArg = { code: "123104", date: "20260812" };
  const applying = vm.runInContext(
    "applyManualBackfillPayload(readyPayload, 1, targetArg)",
    manual.context,
  );
  manual.state.view = "daily";
  resolveCancelledRedraw(true);
  await applying;
  assert.equal(manual.state.manualBackfillReloadedJobKey, "");

  manual.state.view = "intraday";
  await vm.runInContext(
    "redrawReadyManualBackfill(state.manualBackfillJob, 1)",
    manual.context,
  );
  assert.equal(redrawAttempt, 2);
  assert.equal(manual.state.manualBackfillReloadedJobKey, "mode-race");
});

test("partial and failed manual jobs restore the button without automatic rapid retries", async () => {
  const partial = manualBackfillContext({
    postPayload: {
      job_id: "partial-1",
      code: "123104",
      date: "20260812",
      status: "partial",
      missing_after: 7,
    },
  });
  await vm.runInContext("startManualIntradayRefresh()", partial.context);
  assert.equal(partial.nodes.refreshButton.disabled, false);
  assert.equal(partial.calls.status.at(-1).text, "本次补齐结束 · 还缺7分钟");
  assert.equal(partial.calls.load.length, 1);
  assert.equal(partial.activeTimers().length, 0);
  partial.context.zeroGapCount = { status: "partial", missing_after: 0 };
  assert.equal(
    vm.runInContext(
      "manualBackfillStatusPresentation(zeroGapCount).text",
      partial.context,
    ),
    "本次补齐结束 · 仍有缺口",
  );

  const failed = manualBackfillContext({
    postPayload: {
      job_id: "failed-1",
      code: "123104",
      date: "20260812",
      status: "failed",
      error: "Bridge忙碌",
    },
  });
  await vm.runInContext("startManualIntradayRefresh()", failed.context);
  assert.equal(failed.nodes.refreshButton.disabled, false);
  assert.equal(
    failed.calls.status.at(-1).text,
    "补齐失败：Bridge忙碌 · 点击重试",
  );
  assert.equal(failed.calls.load.length, 1);
  assert.equal(failed.activeTimers().length, 0);
});

test("a completed job from the prior trading date cannot redraw the new date", async () => {
  let resolvePost;
  const postResponse = new Promise((resolve) => { resolvePost = resolve; });
  const { context, state, nodes, calls } = manualBackfillContext({
    postJson: () => postResponse,
  });
  const submission = vm.runInContext("startManualIntradayRefresh()", context);
  state.manualDate = true;
  nodes.dateSelect.value = "20260811";
  resolvePost({
    job_id: "old-date-job",
    code: "123104",
    date: "20260812",
    status: "ready",
    before_bar_count: 120,
    after_bar_count: 241,
  });
  await submission;

  assert.equal(calls.load.length, 1);
  assert.equal(
    calls.status.some((item) => item.text.startsWith("补齐完成")),
    false,
  );
  assert.equal(state.manualBackfillJob.date, "20260812");
});

test("a completed intraday job cannot redraw while the page is in daily mode", async () => {
  const manual = manualBackfillContext();
  await vm.runInContext("startManualIntradayRefresh()", manual.context);
  manual.state.view = "daily";
  manual.context.readyPayload = {
    job_id: "intraday-only",
    code: "123104",
    date: "20260812",
    status: "ready",
    row_count_before: 120,
    row_count_after: 241,
  };
  manual.context.targetArg = { code: "123104", date: "20260812" };
  await vm.runInContext(
    "applyManualBackfillPayload(readyPayload, 1, targetArg)",
    manual.context,
  );
  assert.equal(manual.calls.load.length, 1);
  assert.equal(
    manual.calls.status.some((item) => item.text.startsWith("补齐完成")),
    false,
  );
});

test("order-book failures back off to 15 then 30 seconds", () => {
  const context = vm.createContext({
    state: { bookFailureCount: 0 },
    ORDER_BOOK_REFRESH_INTERVAL_MS: 1000,
    ORDER_BOOK_FAILURE_RETRY_BASE_MS: 15_000,
    ORDER_BOOK_FAILURE_RETRY_MAX_MS: 30_000,
    Math,
  });
  vm.runInContext(
    sourceBetween(BOND_SOURCE, "function orderBookRefreshDelay()", "\nfunction scheduleOrderBookRefresh"),
    context,
  );
  assert.equal(vm.runInContext("orderBookRefreshDelay()", context), 1000);
  context.state.bookFailureCount = 1;
  assert.equal(vm.runInContext("orderBookRefreshDelay()", context), 15_000);
  context.state.bookFailureCount = 2;
  assert.equal(vm.runInContext("orderBookRefreshDelay()", context), 30_000);
  context.state.bookFailureCount = 9;
  assert.equal(vm.runInContext("orderBookRefreshDelay()", context), 30_000);
  assert.match(BOND_SOURCE, /at_up_limit:\s*"触及涨停"/);
});

test("order-book polling wakes at the next market window", () => {
  const scheduled = [];
  const context = vm.createContext({
    state: { bookFailureCount: 0, bookTimer: 0 },
    ORDER_BOOK_REFRESH_INTERVAL_MS: 1000,
    ORDER_BOOK_FAILURE_RETRY_BASE_MS: 15_000,
    ORDER_BOOK_FAILURE_RETRY_MAX_MS: 30_000,
    Math,
    isPanel: false,
    document: { hidden: false },
    marketRefreshWindow: () => ({ active: false, nextDelayMs: 5_400_000 }),
    loadOrderBook: async () => {},
    window: {
      clearTimeout() {},
      setTimeout(callback, delay) {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
    },
  });
  vm.runInContext(
    sourceBetween(
      BOND_SOURCE,
      "function orderBookRefreshDelay()",
      "\nasync function loadOrderBook",
    ),
    context,
  );
  vm.runInContext("scheduleOrderBookRefresh()", context);
  assert.equal(scheduled.at(-1).delay, 5_400_000);

  context.marketRefreshWindow = () => ({ active: true, nextDelayMs: 0 });
  context.state.bookFailureCount = 1;
  vm.runInContext("scheduleOrderBookRefresh()", context);
  assert.equal(scheduled.at(-1).delay, 15_000);
});

test("quick trading rejects a stale lunch order book after 13:00", () => {
  const context = vm.createContext({
    Date,
    Number,
    String,
    ORDER_BOOK_MAX_AGE_MS: 15_000,
    ORDER_BOOK_FUTURE_TOLERANCE_MS: 5_000,
    shanghaiDateKey: () => "20260812",
    shanghaiInstant: (year, month, day, hour, minute) =>
      Date.UTC(year, month - 1, day, hour - 8, minute),
  });
  vm.runInContext(
    sourceBetween(
      BOND_SOURCE,
      "function orderBookTimestamp(payload)",
      "\nfunction quickTradeSessionActive",
    ),
    context,
  );
  const afternoon = new Date("2026-08-12T05:00:05Z");
  context.payloadArg = {
    date: "20260812",
    time: "11:30:00",
    timestamp: Date.parse("2026-08-12T03:30:00Z"),
  };
  context.nowArg = afternoon;
  assert.equal(vm.runInContext("orderBookIsFresh(payloadArg, nowArg)", context), false);
  context.payloadArg = {
    date: "20260812",
    time: "13:00:00",
    timestamp: Date.parse("2026-08-12T05:00:00Z"),
  };
  assert.equal(vm.runInContext("orderBookIsFresh(payloadArg, nowArg)", context), true);

  context.state = {
    tradingCapabilities: {
      local_access: true,
      bridge_enabled: true,
      bridge_connected: true,
    },
    view: "intraday",
    manualDate: false,
    bookFailureCount: 0,
    orderBook: {
      date: "20260812",
      time: "11:30:00",
      timestamp: Date.parse("2026-08-12T03:30:00Z"),
    },
  };
  context.marketRefreshWindow = () => ({ active: true, nextDelayMs: 0 });
  vm.runInContext(
    sourceBetween(
      BOND_SOURCE,
      "function quickTradeContextReason(now = new Date())",
      "\nfunction renderQuickTradeAccess",
    ),
    context,
  );
  assert.equal(
    vm.runInContext("quickTradeContextReason(nowArg)", context),
    "盘口已过期，等待实时刷新",
  );
  context.state.bookFailureCount = 1;
  assert.equal(
    vm.runInContext("quickTradeContextReason(nowArg)", context),
    "盘口连接中断，等待重试",
  );
});

test("order-book keeps the exchange suffix after the bond payload loads", () => {
  const context = vm.createContext({
    state: { payload: { monitor_code: "118072" } },
    requestedCode: "118072",
    String,
  });
  vm.runInContext(
    sourceBetween(BOND_SOURCE, "function currentBondMarketCode()", "\nfunction shanghaiDateKey"),
    context,
  );
  assert.equal(vm.runInContext("currentBondMarketCode()", context), "118072.SH");
  context.state.payload.monitor_code = "123273";
  assert.equal(vm.runInContext("currentBondMarketCode()", context), "123273.SZ");
  context.state.payload.monitor_code = "118072.SH";
  assert.equal(vm.runInContext("currentBondMarketCode()", context), "118072.SH");
});
