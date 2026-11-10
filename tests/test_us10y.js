const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createUs10yFeed, parseSnapshot, sampledChart } = require("../lib/us10y-feed.js");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const BASE = Date.parse("2026-09-04T10:45:00Z");
const payload = (price = 4.764, time = BASE / 1000, session = BASE / 1000 - 3600) => ({
  data: [{ s: "TVC:US10Y", d: [price, (price - 4.772) / 4.772 * 100, price - 4.772, time, session, "bond", ["government", "yield", "benchmark"]] }],
});
function between(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}

test("yield, same-source prior close, percentage points to bp and source timezone", () => {
  const quote = parseSnapshot(payload(), BASE);
  assert.equal(quote.price, 4.764);
  assert.equal(quote.previousClose, 4.772);
  assert.ok(Math.abs(quote.changeBps + 0.8) < 1e-8);
  assert.equal(quote.date, "2026-09-04");
  assert.equal(quote.time, "18:45:00");
  assert.equal(quote.priceDecimals, 3);
  assert.equal(quote.symbol, "TVC:US10Y");
});

test("invalid instruments, missing values and incompatible units are rejected", () => {
  const wrong = payload(); wrong.data[0].s = "TVC:US30Y";
  assert.throws(() => parseSnapshot(wrong, BASE), /暂不可用/);
  for (const [index, value] of [[0, null], [0, "4.764"], [1, null], [1, 42], [2, null], [2, 9], [5, "fund"], [6, ["price"]]]) {
    const p = payload(); p.data[0].d[index] = value;
    assert.throws(() => parseSnapshot(p, BASE), /暂不可用/);
  }
});

test("missing or future source time never becomes the current retrieval time", () => {
  for (const time of [null, 0, BASE / 1000 + 3600]) {
    const quote = parseSnapshot(payload(4.764, time), BASE);
    assert.equal(quote.timetag, null);
    assert.equal(quote.time, "");
  }
});

test("concurrent calls coalesce, cache expires and actual new values reach the card", async () => {
  let now = BASE; let calls = 0;
  const feed = createUs10yFeed({ now: () => now, fetchSnapshot: async () => { calls++; return payload(4.764 + calls * 0.001, now / 1000); } });
  const [first, same] = await Promise.all([feed(), feed()]);
  assert.equal(first, same);
  assert.equal(await feed(), first);
  assert.equal(calls, 1);
  now += 30_000;
  const next = await feed();
  assert.equal(calls, 2);
  assert.ok(next.price > first.price);
  assert.equal(next.timetag - first.timetag, 30);
  assert.equal(next.fetchedAt - first.fetchedAt, 30_000);
  assert.deepEqual(next.points, [first.price, next.price]);
});

test("transport failure retries once, then preserves timestamps and recovers", async () => {
  let now = BASE; let mode = "ok"; let calls = 0;
  const feed = createUs10yFeed({ now: () => now, fetchSnapshot: async () => {
    calls++;
    if (mode === "offline") throw new Error("offline");
    return payload(4.764, now / 1000);
  } });
  const first = await feed();
  now += 30_000; mode = "offline";
  const failed = await feed();
  assert.equal(calls, 3);
  assert.equal(failed.refreshFailed, true);
  assert.equal(failed.fetchedAt, first.fetchedAt);
  assert.equal(failed.timetag, first.timetag);
  assert.equal(failed.points.length, 1);
  assert.equal(await feed(), failed);
  assert.equal(calls, 3);
  now += 70_000; mode = "ok";
  const recovered = await feed();
  assert.equal(recovered.refreshFailed, false);
  assert.equal(recovered.sparkBreaks[1], true);
});

test("denials and rate limits are not retried; first load failure stays unavailable", async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0;
    const feed = createUs10yFeed({ fetchSnapshot: async () => { calls++; throw Object.assign(new Error("denied"), { status }); } });
    await assert.rejects(feed(), /denied/);
    assert.equal(calls, 1);
  }
});

test("regressed quotes cannot replace newer data; stale quotes do not grow the chart", async () => {
  let now = BASE; let time = BASE / 1000;
  const feed = createUs10yFeed({ now: () => now, fetchSnapshot: async () => payload(4.764, time) });
  const first = await feed();
  now += 30_000; time -= 60;
  const regressed = await feed();
  assert.equal(regressed.refreshFailed, true);
  assert.equal(regressed.timetag, first.timetag);
  now += 20 * 60_000; time = BASE / 1000;
  const stale = await feed();
  assert.equal(stale.refreshFailed, false);
  assert.equal(stale.points.length, 1);
  assert.equal(stale.timetag, first.timetag);
});

test("source trading session rollover resets samples", async () => {
  let now = BASE; let session = BASE / 1000 - 3600;
  const feed = createUs10yFeed({ now: () => now, fetchSnapshot: async () => payload(4.764, now / 1000, session) });
  await feed(); now += 30_000; await feed();
  now += 24 * 3600_000; session += 24 * 3600;
  const next = await feed();
  assert.equal(next.points.length, 1);
  assert.equal(next.sparkStartDate, "2026-09-05");
});

test("sample reduction preserves endpoints and marks missing periods", () => {
  const samples = Array.from({ length: 600 }, (_, i) => ({ at: BASE + i * 30_000 + (i >= 300 ? 600_000 : 0), price: 4.7 + i * 0.0001 }));
  const chart = sampledChart(samples);
  assert.equal(chart.points.length, 180);
  assert.equal(chart.points[0], samples[0].price);
  assert.equal(chart.points.at(-1), samples.at(-1).price);
  assert.equal(chart.sparkBreaks.filter(Boolean).length, 1);
});

function node() {
  return { children: [], attributes: {}, textContent: "", classList: { add() {} },
    replaceChildren() { this.children = []; }, append(...children) { this.children.push(...children); },
    setAttribute(key, value) { this.attributes[key] = value; },
  };
}
function renderer() {
  const context = vm.createContext({ document: { createElement: node, createElementNS: node }, quoteClass: value => value < 0 ? "down" : "up" });
  vm.runInContext(between(app, "function renderNativeMarketChart(", "function renderIndexSparkline("), context);
  return context.renderNativeMarketChart;
}
test("card separates source and retrieval times and labels observed samples", () => {
  const now = Date.now();
  const quote = { ...parseSnapshot(payload(4.764, Math.floor(now / 1000)), now), ...sampledChart([{ at: now, price: 4.764 }]), fetchedAt: now };
  const target = node(); renderer()(target, quote, { isYield: true });
  assert.equal(target.children[0].children[0].textContent, "4.764%");
  assert.equal(target.children[0].children[1].textContent, "-0.8 bp");
  assert.match(target.children[1].children[0].textContent, /本次采样/);
  assert.match(target.children[1].children[1].textContent, /积累采样点/);
  assert.match(target.children[2].children[0].textContent, /报价/);
  assert.match(target.children[2].children[1].textContent, /获取 .*30秒刷新/);
  assert.match(target.children[2].title, /非全天分时/);
  renderer()(target, { ...quote, timetag: Math.floor(now / 1000) - 3600 }, { isYield: true });
  assert.match(target.children[2].children[1].textContent, /距今 60 分钟/);
  renderer()(target, { ...quote, timetag: null }, { isYield: true });
  assert.equal(target.children[2].children[0].textContent, "源报价时间未提供");
});

test("API fallback and network failure both show refresh failure on the retained quote", async () => {
  for (const networkFailure of [false, true]) {
    const oldQuote = { price: 4.764, changeBps: -0.8, refreshFailed: true };
    let rendered;
    const context = vm.createContext({ us10yMarketChart: {}, document: { hidden: false },
      state: { us10yQuote: oldQuote, us10yLoading: false },
      fetchJson: async () => { if (networkFailure) throw new Error("offline"); return oldQuote; }, console: { warn() {} },
      renderNativeMarketChart: (target, quote, options) => { rendered = { quote, options }; },
    });
    vm.runInContext(between(app, "async function refreshUs10y(", "async function boot("), context);
    await context.refreshUs10y();
    assert.equal(rendered.quote, oldQuote);
    assert.equal(rendered.options.failed, true);
  }
});
