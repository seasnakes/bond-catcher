const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}
function context(extra = {}) {
  const ctx = vm.createContext({
    formatSignedPercent: (n) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`,
    ...extra,
  });
  vm.runInContext(between("function auctionSignalMetric(", "function renderAuctionSignalSparkline("), ctx);
  vm.runInContext(between("function formatAuctionAmount(", "function sparklinePath("), ctx);
  return ctx;
}

test("the visible metric displays an exact monetary amount instead of a percentile", () => {
  const ctx = context();
  const text = vm.runInContext('auctionSignalMetric({change: 1.5, amount: 24521600, amountStatus: "final", amountPercentile: 0.95})', ctx);
  assert.equal(text, "+1.50% · 成交额 2452.16万");
  assert.doesNotMatch(text, /P95/);
  assert.equal(vm.runInContext('auctionSignalMetric({change: 0, amount: null, amountStatus: "pending"})', ctx), "0.00% · 成交额待撮合");
  assert.equal(vm.runInContext('auctionSignalMetric({change: -1, amount: null, amountStatus: "unavailable"})', ctx), "-1.00% · 成交额暂缺");
  assert.equal(vm.runInContext('auctionSignalMetric(null)', ctx), "暂无采样");
});

test("chart uses clock spacing, a zero baseline and breaks gaps instead of inventing intermediate movement", () => {
  const ctx = context({ points: [
    { time: "09:20:00", timestamp: 1000, change: -1 },
    { time: "09:21:00", timestamp: 61000, change: 1 },
    { time: "09:24:00", timestamp: 241000, change: 2 },
  ] });
  const geometry = vm.runInContext("auctionChartGeometry(points, 630, 32)", ctx);
  assert.match(geometry.path, /^M300\.00 .* L360\.00 .* M540\.00 /);
  assert.equal(geometry.phaseX, 300);
  assert.ok(geometry.baseline > geometry.lastY && geometry.baseline < 30);
});

test("flat positive indicative prices remain above yesterday close", () => {
  const ctx = context({ points: [
    { time: "09:20:00", timestamp: 1000, change: 3 },
    { time: "09:21:00", timestamp: 61000, change: 3 },
  ] });
  const geometry = vm.runInContext("auctionChartGeometry(points, 180, 32)", ctx);
  assert.ok(geometry.lastY < geometry.baseline);
  assert.ok(Number.isFinite(geometry.lastY));
});

test("auction mode opens at the first auction refresh even if intraday mode was saved, and respects a later manual switch", () => {
  const state = { signalMode: "intraday", auctionAutoSwitchDate: "", signalRequestGeneration: 0, signalLoading: true };
  const ctx = context({ state, signalMode: {}, marketSession: () => ({ phase: "auction" }), updateSignalModeView() {} });
  vm.runInContext(between("function syncAuctionSignalMode(", "function scheduleSignalRefresh("), ctx);
  vm.runInContext("syncAuctionSignalMode()", ctx);
  assert.equal(state.signalMode, "auction");
  assert.equal(state.signalLoading, false);
  state.signalMode = "intraday";
  vm.runInContext("syncAuctionSignalMode()", ctx);
  assert.equal(state.signalMode, "intraday");
});

test("switching away while an auction request is in flight does not overwrite the new feed", async () => {
  let resolveRequest;
  let renders = 0;
  const state = { signalMode: "auction", signalLoading: false, signalRequestGeneration: 0, auctionSignals: [] };
  const ctx = context({
    state, fetchJson: () => new Promise((resolve) => { resolveRequest = resolve; }),
    renderAuctionSignalFeed: () => { renders += 1; }, updateAuctionMonitorStatus() {},
  });
  vm.runInContext(between("async function refreshAuctionSignalFeed(", "async function ensureSignalSparklines("), ctx);
  const request = vm.runInContext("refreshAuctionSignalFeed()", ctx);
  state.signalMode = "intraday";
  state.signalRequestGeneration += 1;
  resolveRequest({ signals: [{ id: "old" }] });
  await request;
  assert.equal(state.auctionSignals.length, 0);
  assert.equal(renders, 1);
});

test("each auction leg shows the volume percentage or its availability", () => {
  const ctx = context();
  assert.equal(vm.runInContext('auctionVolumeComparisonText({auctionVolumePct:2.367})', ctx), "竞价昨比 2.37%");
  assert.equal(vm.runInContext('auctionVolumeComparisonText({stage:"indicative"}, "collecting")', ctx), "竞价昨比待撮合");
  assert.equal(vm.runInContext('auctionVolumeComparisonText({stage:"indicative"}, "closed")', ctx), "竞价昨比暂缺");
  assert.equal(vm.runInContext('auctionVolumeComparisonText({auctionVolumePct:null})', ctx), "竞价昨比暂缺");
});
