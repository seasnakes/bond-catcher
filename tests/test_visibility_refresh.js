const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const APP_SOURCE = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

function helperSource() {
  const start = APP_SOURCE.indexOf("function refreshVisibleDataImmediately()");
  const end = APP_SOURCE.indexOf("\nfunction scheduleIndexRefresh()", start);
  assert.ok(start >= 0 && end > start, "missing visibility refresh helper");
  return APP_SOURCE.slice(start, end);
}

function fixture(overrides = {}) {
  const calls = { quotes: [], indices: [], signals: 0 };
  const context = vm.createContext({
    document: { hidden: false },
    state: { boardUpdatesPaused: false, signalPaused: false },
    marketSession: () => ({ canAutoRefresh: true }),
    refreshQuotes: (options) => { calls.quotes.push(options); },
    refreshIndices: (options) => { calls.indices.push(options); },
    refreshSignalFeed: () => { calls.signals += 1; },
    ...overrides,
  });
  vm.runInContext(helperSource(), context);
  return { calls, context };
}

test("returning to a visible trading page refreshes live data immediately", () => {
  const { calls, context } = fixture();

  assert.equal(context.refreshVisibleDataImmediately(), true);
  assert.equal(calls.quotes.length, 1);
  assert.equal(calls.quotes[0].force, true);
  assert.equal(calls.indices.length, 1);
  assert.equal(calls.indices[0].force, true);
  assert.equal(calls.signals, 1);
});

test("visibility refresh stays idle while hidden or an overlay pauses the board", () => {
  const hidden = fixture({ document: { hidden: true } });
  assert.equal(hidden.context.refreshVisibleDataImmediately(), false);
  assert.equal(hidden.calls.quotes.length, 0);

  const paused = fixture({
    state: { boardUpdatesPaused: true, signalPaused: false },
  });
  assert.equal(paused.context.refreshVisibleDataImmediately(), false);
  assert.equal(paused.calls.quotes.length, 0);
});
