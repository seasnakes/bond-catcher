const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const APP = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing ${startMarker}`);
  return source.slice(start, end);
}

const HK = "116.00700";
const CN = "1.600519";
const BJ = "0.920001";

function quotesContext({ failQmt = false, failHk = false } = {}) {
  const calls = [];
  const context = vm.createContext({
    URLSearchParams,
    chunk: (rows, size) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size)),
    fetchJson: async (url) => {
      calls.push(url);
      if (url.startsWith("/api/miniqmt/quotes?")) {
        if (failQmt) throw new Error("QMT unavailable");
        return { quote_backend: { active: "bigqmt" }, quotes: [{ secid: CN, price: 1500, change: 1, source: "bigqmt" }, ...(url.includes("920001.BJ") ? [{ secid: BJ, price: 23, change: 2, source: "QMT full_tick · 北交所" }] : [])] };
      }
      assert.equal(url, `/api/quotes?secids=${HK}`);
      if (failHk) throw new Error("Sina unavailable");
      return { source: "新浪实时", quotes: [{ secid: HK, price: 444.8, previousClose: 433, change: 2.725, source: "新浪港股", date: "2026-09-04", time: "10:47:33" }] };
    },
  });
  vm.runInContext(between(APP, "async function fetchLocalQuotes(", "\nasync function fetchLocalSparklines("), context);
  return { context, calls };
}

test("mixed board routes only HK to Sina and keeps QMT coverage separate", async () => {
  const { context, calls } = quotesContext();
  const result = await context.fetchPreferredQuotes([{ secid: CN }, { secid: HK }, { secid: BJ }]);
  assert.equal(result.quotes.size, 3);
  assert.equal(result.quotes.get(HK).previousClose, 433);
  assert.equal(result.quotes.get(HK).source, "新浪港股");
  assert.equal(result.feed.requested, 2);
  assert.equal(result.feed.returned, 2);
  assert.equal(result.feed.hongKongReturned, 1);
  assert.match(result.source, /大 QMT实时 2\/2 · 新浪港股 1\/1/);
  assert.equal(result.quotes.get(BJ).price, 23);
  assert.ok(calls[0].includes("920001.BJ"));
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("600519.SH"));
  assert.ok(!calls[0].includes("00700"));
});

test("HK-only board loads without any QMT network call", async () => {
  const { context, calls } = quotesContext({ failQmt: true });
  const result = await context.fetchPreferredQuotes([{ secid: HK }]);
  assert.equal(result.quotes.size, 1);
  assert.equal(result.feed.requested, 0);
  assert.equal(result.source, "新浪港股 1/1");
  assert.deepEqual(calls, [`/api/quotes?secids=${HK}`]);
});

test("QMT failure still returns HK quotes without requesting mainland external quotes", async () => {
  const { context, calls } = quotesContext({ failQmt: true });
  const result = await context.fetchPreferredQuotes([{ secid: CN }, { secid: HK }]);
  assert.equal(result.quotes.has(CN), false);
  assert.equal(result.quotes.has(HK), true);
  assert.equal(result.feed.active, "unavailable");
  assert.match(result.source, /QMT行情不可用 · 新浪港股 1\/1/);
  assert.equal(calls.length, 2);
});

test("Sina failure preserves QMT quotes and reports missing HK coverage", async () => {
  const { context } = quotesContext({ failHk: true });
  const result = await context.fetchPreferredQuotes([{ secid: CN }, { secid: HK }]);
  assert.equal(result.quotes.has(CN), true);
  assert.equal(result.quotes.has(HK), false);
  assert.match(result.source, /新浪港股 0\/1 暂不可用/);
});

test("total quote failure rejects instead of creating demo prices", async () => {
  const { context } = quotesContext({ failQmt: true, failHk: true });
  await assert.rejects(context.fetchPreferredQuotes([{ secid: CN }, { secid: HK }]), /未返回有效报价/);
});

test("HK-only feed badge identifies Sina and marks retained quotes unavailable after failure", () => {
  const context = vm.createContext({});
  vm.runInContext(between(APP, "function marketFeedPresentation(", "\nfunction marketStatusItem("), context);
  const feed = { active: "unknown", requested: 0, hongKongRequested: 6, hongKongReturned: 6 };
  assert.equal(context.marketFeedPresentation(feed).label, "新浪");
  assert.equal(context.marketFeedPresentation(feed).coverage, "6/6");
  const failed = context.marketFeedPresentation({ ...feed, active: "unavailable" });
  assert.equal(failed.mode, "异常");
  assert.equal(failed.coverage, "0/6");
});

test("Sina HK parsing retains actual previous close, date, time, amount and rejects empty prices", () => {
  const context = vm.createContext({ isHongKongSecid: (secid) => secid.startsWith("116.") });
  vm.runInContext(between(SERVER, "function parseSinaResponse(", "\nasync function fetchMiniQmtIndexQuotes("), context);
  const fields = ["TENCENT", "腾讯控股", 438, 433, 446, 436, 444.8, 11.8, 2.725, 444.6, 444.8, 3513093482.8, 7900000, 0, 0, 0, 0, "2026/09/04", "10:47:33"];
  const raw = `var hq_str_rt_hk00700="${fields.join(",")}";var hq_str_rt_hk00000="";`;
  const result = context.parseSinaResponse(raw, new Map([["rt_hk00700", HK], ["rt_hk00000", "116.00000"]]));
  assert.equal(result.length, 1);
  assert.equal(result[0].price, 444.8);
  assert.equal(result[0].previousClose, 433);
  assert.equal(result[0].amount, 3513093482.8);
  assert.equal(result[0].date, "2026-09-04");
  assert.equal(result[0].time, "10:47:33");
  assert.equal(result[0].source, "新浪港股");
  fields[6] = 0;
  assert.throws(() => context.parseSinaResponse(`var hq_str_rt_hk00700="${fields.join(",")}";`, new Map([["rt_hk00700", HK]])), /empty/);
});

function sparksContext({ failQmt = false, failHk = false, hkDate = "2026-09-04" } = {}) {
  const calls = [];
  let response;
  const context = vm.createContext({
    URLSearchParams, Error,
    currentChinaDateKey: () => "2026-09-04",
    fetchLocalJson: async (url) => {
      calls.push(url);
      if (failQmt) throw Object.assign(new Error("HTTP 503: QMT down"), { statusCode: 503 });
      return { source: "QMT cache", sparks: [{ secid: CN, points: [1490, 1500] }], trading_date: "2026-09-04" };
    },
    fetchSecuritySparkline: async (secid) => {
      calls.push(secid);
      assert.equal(secid, HK);
      if (failHk) throw new Error("Sina down");
      return { secid, source: "腾讯港股分时", points: [440, 444.8], date: hkDate, time: "10:47" };
    },
    sendJson: (_, status, payload) => { response = { status, payload }; },
  });
  vm.runInContext(between(SERVER, "function isHongKongSecid(", "\nfunction marketFromCode("), context);
  vm.runInContext(between(SERVER, "async function handleSparks(", "\nasync function handleResolve("), context);
  return { context, calls, response: () => response };
}

test("mixed sparklines merge QMT and HK and preserve QMT metadata", async () => {
  const fixture = sparksContext();
  await fixture.context.handleSparks(new URL(`http://localhost/api/sparks?secids=${CN},${HK},${HK}`), {});
  const { status, payload } = fixture.response();
  assert.equal(status, 200);
  assert.equal(payload.sparks.length, 2);
  assert.equal(payload.trading_date, "2026-09-04");
  assert.equal(payload.sparks[1].data_is_stale, false);
  assert.deepEqual(fixture.calls, ["/sparks?codes=600519.SH", HK]);
});

test("HK-only sparklines normalize short codes and never call QMT", async () => {
  const fixture = sparksContext({ failQmt: true });
  await fixture.context.handleSparks(new URL("http://localhost/api/sparks?secids=hk700"), {});
  assert.equal(fixture.response().payload.sparks.length, 1);
  assert.deepEqual(fixture.calls, [HK]);
});

test("mixed sparklines isolate either provider failure and flag stale HK dates", async () => {
  for (const failQmt of [true, false]) {
    const fixture = sparksContext({ failQmt, failHk: !failQmt, hkDate: "2026-09-03" });
    await fixture.context.handleSparks(new URL(`http://localhost/api/sparks?secids=${CN},${HK}`), {});
    const { status, payload } = fixture.response();
    assert.equal(status, 200);
    assert.equal(payload.sparks.length, 1);
    assert.equal(payload.failedSecids[0], failQmt ? CN : HK);
    if (failQmt) assert.equal(payload.sparks[0].data_is_stale, true);
  }
});

test("mainland-only spark failures keep the existing HTTP error without external fallback", async () => {
  const fixture = sparksContext({ failQmt: true });
  await fixture.context.handleSparks(new URL(`http://localhost/api/sparks?secids=${CN}`), {});
  assert.equal(fixture.response().status, 503);
  assert.deepEqual(fixture.calls, ["/sparks?codes=600519.SH"]);
});

test("Hong Kong refresh continues past mainland lunch and close, and respects HK lunch/weekends", () => {
  const context = vm.createContext({ UPDATE_INTERVAL_MS: 15000, AUCTION_UPDATE_INTERVAL_MS: 3000 });
  vm.runInContext(between(APP, "function marketSession(", "\nfunction updateNextRefreshAt("), context);
  for (const time of ["11:45", "15:30", "16:09"]) {
    const now = new Date(`2026-09-04T${time}:00`);
    assert.equal(context.marketSession(now, true).canAutoRefresh, true, time);
    assert.equal(context.marketSession(now, true).phase, "hongkong", time);
    assert.equal(context.marketSession(now, false).canAutoRefresh, false, time);
  }
  for (const timestamp of ["2026-09-04T12:30:00", "2026-09-04T16:11:00", "2026-09-05T10:00:00"]) {
    assert.equal(context.marketSession(new Date(timestamp), true).canAutoRefresh, false, timestamp);
  }
});
