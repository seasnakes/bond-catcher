const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "bond.js"), "utf8");
function section(start, end) {
  const index = source.indexOf(start);
  assert.ok(index >= 0);
  const stop = source.indexOf(end, index);
  assert.ok(stop > index);
  return source.slice(index, stop);
}

function fixture() {
  const requests = [];
  const canvas = { content: "intraday chart" };
  const status = { text: "intraday" };
  const state = { view: "daily", requestId: 0, dailyPayload: null };
  const nodes = {
    dailyRangeSelect: { value: "120" },
    dataAlert: { hidden: false },
    refreshButton: { disabled: false },
    canvas: {},
  };
  const context = vm.createContext({
    requestedCode: "123247", state, nodes, URLSearchParams,
    setStatus: (text, tone) => Object.assign(status, { text, tone }),
    fetchJson: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    setupCanvas: () => ({
      clearRect: () => { canvas.content = ""; },
      fillText: (text) => { canvas.content = text; },
    }),
    dailyChartGeometry: () => ({ width: 1000, height: 600 }),
    renderDailyPayload: () => { canvas.content = "daily chart"; },
  });
  vm.runInContext(section("async function loadDaily()", "\nfunction displayDailyDate("), context);
  vm.runInContext(section("function drawDailyChart(", "\nfunction "), context);
  return { context, state, nodes, canvas, status, requests };
}

test("failed daily request clears the intraday chart and can recover on refresh", async () => {
  const f = fixture();
  const pending = f.context.loadDaily();
  assert.notEqual(f.canvas.content, "intraday chart");
  assert.equal(f.nodes.refreshButton.disabled, true);
  f.requests[0].reject(new Error("QMT pipe unavailable"));
  await pending;
  assert.match(f.canvas.content, /日 K 暂不可用/);
  assert.equal(f.status.tone, "is-error");
  assert.equal(f.nodes.refreshButton.disabled, false);

  const retry = f.context.loadDaily();
  f.requests[1].resolve({ source: "QMT", rows: [{ date: "20261030", close: 168.044 }] });
  await retry;
  assert.equal(f.canvas.content, "daily chart");
  assert.equal(f.state.dailyPayload.rows[0].date, "20261030");
  assert.equal(f.status.tone, undefined);
});

test("a late daily failure cannot replace the intraday view after switching back", async () => {
  const f = fixture();
  const pending = f.context.loadDaily();
  f.state.view = "intraday";
  f.canvas.content = "restored intraday chart";
  f.status.text = "intraday ready";
  f.requests[0].reject(new Error("late timeout"));
  await pending;
  assert.equal(f.canvas.content, "restored intraday chart");
  assert.equal(f.status.text, "intraday ready");
});

test("an older daily request cannot overwrite a newer successful range", async () => {
  const f = fixture();
  const oldRequest = f.context.loadDaily();
  f.nodes.dailyRangeSelect.value = "250";
  const newRequest = f.context.loadDaily();
  f.requests[1].resolve({ source: "QMT", requested_count: 250, rows: [{ date: "20261030" }] });
  await newRequest;
  f.requests[0].reject(new Error("older request failed"));
  await oldRequest;
  assert.equal(f.state.dailyPayload.requested_count, 250);
  assert.equal(f.canvas.content, "daily chart");
  assert.equal(f.status.tone, undefined);
});
