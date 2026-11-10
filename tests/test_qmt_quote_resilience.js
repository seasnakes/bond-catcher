const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
function extract(start, end) {
  return app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
}
const stocks = Array.from({ length: 150 }, (_, i) => ({ secid: `1.${600000 + i}` }));
function fixture(respond) {
  const calls = [];
  let now = 0;
  const context = vm.createContext({
    URLSearchParams,
    Date: { now: () => now },
    chunk: (rows, size) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size)),
    fetchJson: async (url, timeout) => {
      const codes = new URLSearchParams(url.split("?")[1]).get("codes").split(",");
      calls.push({ codes, timeout });
      const quotes = codes.map((code) => ({ secid: `1.${code.slice(0, 6)}`, price: 123, change: 1 }));
      return respond({ index: calls.length - 1, codes, quotes, timeout, advance: (ms) => { now += ms; } });
    },
  });
  vm.runInContext(extract("async function fetchLocalQuotes(", "\nasync function fetchLocalSparklines("), context);
  vm.runInContext(extract("function marketFeedPresentation(", "\nfunction marketStatusItem("), context);
  return { context, calls };
}

test("a failed middle batch preserves earlier quotes and still fetches later batches", async () => {
  const { context, calls } = fixture(({ index, quotes }) => {
    if (index === 1) throw new Error("timed out");
    return { quote_backend: { active: "bigqmt" }, quotes };
  });
  const result = await context.fetchPreferredQuotes(stocks);
  assert.equal(calls.length, 3);
  assert.equal(result.quotes.size, 100);
  assert.equal(result.quotes.has(stocks[0].secid), true);
  assert.equal(result.quotes.has(stocks[70].secid), false);
  assert.equal(result.quotes.has(stocks[149].secid), true);
  assert.equal(result.feed.active, "bigqmt");
  assert.equal(result.feed.partial, true);
  assert.equal(result.feed.failedSecids.length, 50);
  assert.match(result.source, /100\/150.*50只报价缺失/);
  const badge = context.marketFeedPresentation(result.feed);
  assert.equal(badge.label, "大 QMT");
  assert.equal(badge.mode, "缺50只");
  assert.equal(badge.className, "is-fallback");
});

test("the whole-refresh deadline limits repeated failures and identifies all missing symbols", async () => {
  const { context, calls } = fixture(({ index, quotes, timeout, advance }) => {
    if (index === 0) {
      advance(30_000);
      return { quote_backend: { active: "bigqmt" }, quotes };
    }
    advance(timeout);
    throw new Error("timed out");
  });
  const result = await context.fetchPreferredQuotes(stocks);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.timeout), [35_000, 15_000]);
  assert.equal(result.quotes.size, 50);
  assert.equal(result.feed.failedSecids.length, 100);
  assert.equal(result.feed.returned, 50);
});

test("short or invalid-price responses are partial even when HTTP succeeds", async () => {
  const { context } = fixture(({ quotes }) => ({
    quote_backend: { active: "bigqmt" },
    quotes: [quotes[0], { ...quotes[1], price: 0 }],
  }));
  const result = await context.fetchPreferredQuotes(stocks.slice(0, 3));
  assert.equal(result.feed.returned, 1);
  assert.equal(result.feed.failedSecids.length, 2);
  assert.equal(result.feed.partial, true);
});

test("a later successful refresh clears the missing-quote status", async () => {
  let failing = true;
  const { context } = fixture(({ index, quotes }) => {
    if (failing && index === 0) throw new Error("offline");
    return { quote_backend: { active: "bigqmt" }, quotes };
  });
  assert.equal((await context.fetchPreferredQuotes(stocks)).feed.partial, true);
  failing = false;
  const result = await context.fetchPreferredQuotes(stocks);
  assert.equal(result.quotes.size, 150);
  assert.equal(result.feed.partial, false);
  assert.equal(result.feed.failedSecids.length, 0);
  assert.equal(context.marketFeedPresentation(result.feed).mode, "行情");
});
