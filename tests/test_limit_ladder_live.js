const test = require("node:test");
const assert = require("node:assert/strict");
const { overlayLiveLadder, createLiveLadderFeed, chinaClock } = require("../lib/limit-ladder-live.js");
const { buildGroups } = require("../limit-ladder-core.js");
const time = (s) => Date.parse(`2026-09-07T${s}+08:00`);
const base = {
  asOf: "2026-09-04", stocks: [
    { symbol: "605577.SH", code: "605577", name: "龙版传媒", actualBoards: 5, targetBoards: 5, previousBoards: 4, status: "limit_up", changePct: 9.97 },
    { symbol: "601086.SH", code: "601086", name: "国芳集团", actualBoards: 0, targetBoards: 6, previousBoards: 5, status: "failed", changePct: 3.60 },
    { symbol: "920075.BJ", code: "920075", name: "柏星龙", actualBoards: 1, targetBoards: 1, previousBoards: 0, status: "limit_up", changePct: 30 },
  ],
};
const quote = (overrides = {}) => ({ monitor_code: "605577.SH", price: 16.33, previousClose: 15.55, date: "20260907", time: "09:20:00", ...overrides });
const payload = (quotes = [quote()]) => ({ quote_backend: { active: "bigqmt" }, quotes });

test("Monday auction uses Friday's actual limit-ups, rolls board targets forward and uses QMT current baseline", () => {
  const d = overlayLiveLadder(base, payload(), { now: time("09:20:03") });
  assert.equal(d.baseDate, "2026-09-04");
  assert.equal(d.asOf, "2026-09-07");
  assert.equal(d.stocks.length, 2);
  const s = d.stocks[0];
  assert.equal(s.previousBoards, 5);
  assert.equal(s.targetBoards, 6);
  assert.equal(s.actualBoards, null);
  assert.equal(s.status, "auction");
  assert.ok(Math.abs(s.changePct - 5.01607717) < 1e-7);
  assert.equal(s.quoteTime, "09:20:00");
  assert.equal(d.covered, 1);
  assert.equal(d.fresh, 1);
  assert.equal(d.stocks[1].changePct, null);
  assert.equal(d.stocks[1].status, "pending");
});

test("old dates, missing timestamps, future quotes, invalid prices and previous close never masquerade as today", () => {
  for (const overrides of [{ date: "20260904" }, { time: "" }, { time: "09:25:00" }, { price: 0 }, { previousClose: 0 }, { previousClose: Infinity }, { price: "16.33" }]) {
    const d = overlayLiveLadder(base, payload([quote(overrides)]), { now: time("09:20:03") });
    assert.equal(d.stocks[0].changePct, null);
    assert.equal(d.stocks[0].quoteTime, null);
    assert.equal(d.covered, 0);
  }
});

test("stale auction quote is explicit; 09:25 fixing stays valid until 09:30 instead of falsely aging out", () => {
  const old = overlayLiveLadder(base, payload(), { now: time("09:22:00") });
  assert.equal(old.stocks[0].quoteStale, true);
  assert.equal(old.fresh, 0);
  const final = overlayLiveLadder(base, payload([quote({ time: "09:25:00" })]), { now: time("09:29:00") });
  assert.equal(final.phase, "auction_final");
  assert.equal(final.stocks[0].status, "auction_final");
  assert.equal(final.stocks[0].quoteStale, false);
  const afterOpen = overlayLiveLadder(base, payload([quote({ time: "09:25:00" })]), { now: time("09:31:00") });
  assert.equal(afterOpen.phase, "trading");
  assert.equal(afterOpen.stocks[0].quoteStale, true);
});

test("live yesterday-height view preserves candidates and current changes without declaring today's limit-ups", () => {
  const d = overlayLiveLadder(base, payload(), { now: time("09:20:03") });
  const groups = buildGroups(d.stocks, { live: true, view: "height" });
  assert.deepEqual(groups.map((g) => g.boards), [5, 1]);
  assert.equal(groups[0].stocks[0].changePct, d.stocks[0].changePct);
  assert.equal(groups[0].promoted, 0);
  assert.equal(buildGroups(d.stocks, { view: "height" }).length, 0);
});

test("a BJ quote maps by its full symbol and does not become Shenzhen", () => {
  const q = quote({ monitor_code: "920075.BJ", price: 23, previousClose: 21.32 });
  const d = overlayLiveLadder(base, payload([q]), { now: time("09:20:03") });
  assert.equal(d.stocks[1].symbol, "920075.BJ");
  assert.ok(Math.abs(d.stocks[1].changePct - 7.879924953) < 1e-8);
  assert.equal(d.stocks[0].changePct, null);
});

test("calendar, baseline and concurrent quote requests are shared, while refreshed prices really change", async () => {
  let clock = time("09:20:03"); let calls = 0; let days = 0; let histories = 0;
  const feed = createLiveLadderFeed({ now: () => clock,
    calendar: async () => { days++; return { previousDate: "2026-09-04", isTrading: true }; },
    loadHistory: async (date) => { histories++; assert.equal(date, "2026-09-04"); return base; },
    loadQuotes: async (codes) => { calls++; assert.deepEqual(codes, ["605577.SH", "920075.BJ"]); return payload([quote({ price: 16 + calls / 10 })]); },
  });
  const [a, b] = await Promise.all([feed(), feed()]);
  assert.equal(a, b);
  clock += 3000;
  const c = await feed();
  clock += 3000;
  const d = await feed();
  assert.ok(a.stocks[0].changePct < c.stocks[0].changePct && c.stocks[0].changePct < d.stocks[0].changePct);
  assert.equal(calls, 3);
  assert.equal(days, 1);
  assert.equal(histories, 1);
});

test("quote failure keeps the candidate pool but clears prices; missing prior-day data fails explicitly", async () => {
  const feed = createLiveLadderFeed({ now: () => time("09:20:03"), calendar: async () => ({ previousDate: "2026-09-04", isTrading: true }), loadHistory: async () => base, loadQuotes: async () => { throw new Error("offline"); } });
  const d = await feed();
  assert.equal(d.refreshFailed, true);
  assert.equal(d.stocks.length, 2);
  assert.ok(d.stocks.every((s) => s.changePct === null));
  const missing = createLiveLadderFeed({ calendar: async () => ({ previousDate: "2026-09-04", isTrading: true }), loadHistory: async () => ({ asOf: "2026-09-03", stocks: [] }) });
  await assert.rejects(missing(), /底表尚未就绪/);
});

test("preopen and holidays never switch to auction by weekday heuristics; current session is Beijing time", () => {
  assert.equal(chinaClock(time("09:20:00")).time, "09:20:00");
  const preopen = overlayLiveLadder(base, payload([]), { now: time("09:10:00") });
  assert.equal(preopen.phase, "preopen");
  assert.equal(preopen.refreshIntervalMs, 30000);
  const holiday = overlayLiveLadder(base, payload([]), { now: time("09:20:00"), isTrading: false });
  assert.equal(holiday.phase, "closed");
  assert.equal(holiday.refreshIntervalMs, 30000);
});
