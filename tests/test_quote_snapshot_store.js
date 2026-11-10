const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { QuoteSnapshotStore } = require("../lib/quote-snapshot-store.js");

const friday = { secid: "0.123247", price: 208.5, previousClose: 211.888, change: -1.599, date: "20260904", time: "15:00:00" };
test("persisted quotes survive a server restart and partial/older responses keep valid data", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "finance-snapshot-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "quotes.json");
  const store = new QuoteSnapshotStore(filename);
  await store.update([friday, { ...friday, secid: "1.000001", price: 3930.1 }], { active: "bigqmt" });
  await Promise.all([
    store.update([{ ...friday, date: "20260903", price: 211.888 }]),
    store.update([{ ...friday, secid: "1.000001", price: 0 }]),
  ]);
  const loaded = new QuoteSnapshotStore(filename).payload();
  assert.equal(loaded.quotes.length, 2);
  assert.equal(loaded.quotes[0].price, 208.5);
  assert.equal(loaded.quotes[0].previousClose, 211.888);
  assert.equal(loaded.quotes[0].date, "20260904");
  assert.equal(loaded.quotes[0].cached, true);
  assert.equal(loaded.quote_backend.active, "bigqmt");
});

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const helper = app.slice(app.indexOf("function mergeBoardQuoteSnapshot("), app.indexOf("\nfunction updateStatus("));
test("a missing live quote remains dated cache, removed symbols stay removed, and recovery clears the cache flag", () => {
  const context = vm.createContext({ Map, Date });
  vm.runInContext(helper, context);
  const previous = new Map([[friday.secid, friday], ["1.600000", { ...friday, secid: "1.600000" }]]);
  const stocks = [{ secid: friday.secid }];
  const retained = context.mergeBoardQuoteSnapshot(previous, new Map(), stocks);
  assert.equal(retained.size, 1);
  assert.equal(retained.get(friday.secid).date, "20260904");
  assert.equal(retained.get(friday.secid).cached, true);
  const recovered = context.mergeBoardQuoteSnapshot(retained, new Map([[friday.secid, { ...friday, price: 210 }]]), stocks);
  assert.equal(recovered.get(friday.secid).cached, false);
  assert.equal(recovered.get(friday.secid).price, 210);
  const olderSource = context.mergeBoardQuoteSnapshot(recovered, new Map([[friday.secid, { ...friday, date: "20260903", price: 211.888 }]]), stocks);
  assert.equal(olderSource.get(friday.secid).price, 210);
  assert.equal(olderSource.get(friday.secid).cached, true);
});

test("closed-market cache suppresses repeat pulls only while complete and recent; open market always refreshes", () => {
  let open = false;
  const state = { quotes: new Map([[friday.secid, { ...friday, fetchedAt: 1000 }]]) };
  const context = vm.createContext({ Map, Date, state, marketSession: () => ({ canAutoRefresh: open }), miniQmtMarketCode: () => "123247.SZ" });
  vm.runInContext(helper, context);
  assert.equal(context.canReuseClosedSnapshot([{ secid: friday.secid }], 2000), true);
  assert.equal(context.canReuseClosedSnapshot([{ secid: friday.secid }], 1000000), false);
  assert.equal(context.canReuseClosedSnapshot([{ secid: "0.123999" }], 2000), false);
  open = true;
  assert.equal(context.canReuseClosedSnapshot([{ secid: friday.secid }], 2000), false);
});
