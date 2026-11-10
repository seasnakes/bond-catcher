const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const frontend = fs.readFileSync(path.join(__dirname, "..", "bond-heatmap.js"), "utf8");
const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}

function fixture() {
  const timers = new Map();
  let timerId = 0;
  const requests = [];
  const state = {
    rows: [], tagOrder: [], loading: false, tagRefreshing: false,
    lastTagVersion: 0, pendingTagVersion: 0, pendingTagRows: new Map(),
    pendingTagNeedsFetch: false, tagWarning: "", statusMessage: "",
  };
  const nodes = { refresh: {}, status: {}, empty: { hidden: true } };
  const context = vm.createContext({
    state, nodes, URLSearchParams, Map, Set, performance, Date,
    DATA_URL: "snapshot", TAG_DATA_URL: "live-tags", TAG_SNAPSHOT_URL: "tags",
    TAG_RETRY_DELAY_MS: 30000,
    window: {
      BondLandscape: {}, location: { search: "" },
      setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
      clearTimeout: (id) => timers.delete(id),
    },
    fetchJson: (url) => new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
    storedTagUpdateVersion: () => 0,
    supplementalRowsFromUniverse: () => [],
    applyCachedSupplementalMetadata: () => {},
    recomputeLandscapePositions: () => {},
    updateTagOptions: () => {}, updateSectorOptions: () => {},
    refreshMiniQmtQuotes: async () => {},
    render: () => { nodes.empty.hidden = state.rows.length > 0; },
  });
  for (const [start, end] of [
    ["function setMarketStatus(", "\nfunction svgElement("],
    ["function tagMetadataMap(", "\nfunction applyInlineTagRows("],
    ["async function refreshTagAnalysis(", "\nfunction requestTagAnalysisRefresh("],
    ["async function load()", "\nnodes.view.addEventListener("],
  ]) vm.runInContext(section(frontend, start, end), context);
  return { state, nodes, context, requests, timers };
}

const rows = [{ code: "113001.SH", price: 100 }, { code: "113002.SH", price: 110 }];
async function loadSnapshot(f) {
  const loading = f.context.load();
  f.requests.find((r) => r.url === "snapshot").resolve({ asOf: "2026-07-30", rows });
  f.requests.find((r) => r.url === "tags").resolve({ rows });
  await loading;
}

test("snapshot renders while live tags are pending; failures preserve it and retry after a delay", async () => {
  const f = fixture();
  await loadSnapshot(f);
  assert.equal(f.state.rows.length, 2);
  assert.equal(f.nodes.empty.hidden, true);
  assert.equal(f.nodes.refresh.disabled, false);
  f.requests.find((r) => r.url === "live-tags").reject(new Error("请求超时"));
  await new Promise(setImmediate);
  assert.equal(f.state.rows.length, 2);
  assert.match(f.nodes.status.textContent, /保留已有星图/);
  assert.equal(f.timers.size, 1);
  const retry = [...f.timers.values()][0];
  assert.equal(retry.delay, 30000);
  const recovering = retry.fn();
  f.requests.at(-1).resolve({ rows: [{ ...rows[0], tags: ["半导体"] }] });
  await recovering;
  assert.equal(f.state.rows.length, 1);
  assert.equal(f.state.rows[0].tags[0], "半导体");
  assert.equal(f.state.tagWarning, "");
  assert.equal(f.timers.size, 0);
});

test("an empty live response cannot erase an already displayed snapshot", async () => {
  const f = fixture();
  await loadSnapshot(f);
  f.requests.find((r) => r.url === "live-tags").resolve({ rows: [] });
  await new Promise(setImmediate);
  assert.equal(f.state.rows.length, 2);
  assert.equal(f.nodes.empty.hidden, true);
  assert.match(f.nodes.status.textContent, /标签数据暂不可用/);
});

test("bonds discovered during a quote request get a follow-up quote refresh", async () => {
  const f = fixture();
  Object.assign(f.context, {
    console, QUOTE_BATCH_SIZE: 100,
    marketCode: (code) => code || "",
    secidFromCode: (code) => code,
    chunk: (codes) => [codes],
    supplementalRowsFromUniverse: (bonds) => bonds,
    refreshSupplementalMetadata: async () => {},
  });
  vm.runInContext(section(frontend, "async function refreshMiniQmtQuotes(", "\nfunction supplementalRowsFromUniverse("), f.context);
  f.state.rows = [{ ...rows[0] }];
  f.state.snapshot = { asOf: "2026-07-30" };
  const firstQuotes = f.context.refreshMiniQmtQuotes();
  f.state.pendingTagNeedsFetch = true;
  const tagRefresh = f.context.refreshTagAnalysis();
  f.requests.find((r) => r.url === "live-tags").resolve({ rows: [
    rows[0], { ...rows[1], supplemental: true },
  ] });
  await tagRefresh;
  assert.equal(f.state.quoteRefreshPending, true);
  f.requests[0].resolve({ quotes: [{ secid: rows[0].code, price: 101 }] });
  await firstQuotes;
  const followUp = f.requests.at(-1);
  assert.ok(new URLSearchParams(followUp.url.split("?")[1]).get("codes").includes(rows[1].code));
  assert.equal(f.nodes.refresh.disabled, true);
  followUp.resolve({ quotes: rows.map((row) => ({ secid: row.code, price: 120 })) });
  await new Promise(setImmediate);
  assert.equal(f.state.rows[1].price, 120);
  assert.equal(f.state.quoteRefreshPending, false);
  assert.equal(f.nodes.refresh.disabled, false);
});

test("failed snapshot loads can be retried without reloading the browser", async () => {
  const f = fixture();
  const failed = f.context.load();
  f.requests[0].reject(new Error("请求超时"));
  f.requests[1].resolve({ rows });
  await failed;
  assert.equal(f.nodes.refresh.textContent, "重新加载星图");
  assert.equal(f.nodes.refresh.disabled, false);
  assert.equal(f.state.loading, false);
  f.requests.length = 0;
  await loadSnapshot(f);
  assert.equal(f.nodes.empty.hidden, true);
  assert.equal(f.nodes.refresh.textContent, "刷新 QMT 行情");
});

test("fetch aborts produce a readable timeout and clear their timer", async () => {
  let fireTimeout;
  let cleared = false;
  const context = vm.createContext({
    AbortController, Error, TypeError,
    window: { setTimeout: (fn) => { fireTimeout = fn; return 1; }, clearTimeout: () => { cleared = true; } },
    fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    }),
  });
  vm.runInContext(section(frontend, "async function fetchJson(", "\nfunction setMarketStatus("), context);
  const request = context.fetchJson("tags");
  fireTimeout();
  await assert.rejects(request, /请求超时，请稍后重试/);
  assert.equal(cleared, true);
});

test("cached lifecycle data returns without waiting for a slow QMT refresh", async () => {
  const cached = { qualityStatus: "ok", qmtActiveCount: 312, bonds: {} };
  let refreshCalls = 0;
  let finishRefresh;
  const context = vm.createContext({
    BOND_LIFECYCLE_PATH: "lifecycle", console,
    readJsonFile: async () => cached,
    ensureBondLifecycleSync: () => {
      refreshCalls += 1;
      return new Promise((resolve) => { finishRefresh = resolve; });
    },
  });
  vm.runInContext(section(server, "function bondLifecyclePayloadUsable(", "\nasync function ensureBondLifecycleSync("), context);
  vm.runInContext(section(server, "async function loadBondLifecycleWithRefresh(", "\nif (require.main"), context);
  assert.equal(await context.loadBondLifecycleWithRefresh({ staleWhileRevalidate: true }), cached);
  assert.equal(refreshCalls, 1);
  finishRefresh(cached);
  const forced = context.loadBondLifecycleWithRefresh({ staleWhileRevalidate: true, force: true });
  const fresh = { ...cached, refreshed: true };
  finishRefresh(fresh);
  assert.equal(await forced, fresh);
});
