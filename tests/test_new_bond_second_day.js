const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isNewBondAutoScanWindow,
  mergeSecondDayBondsIntoState,
} = require("../server.js");

test("上市第二日自动扫描窗口只覆盖开盘前", () => {
  assert.equal(isNewBondAutoScanWindow("08:29:59"), false);
  assert.equal(isNewBondAutoScanWindow("08:30:00"), true);
  assert.equal(isNewBondAutoScanWindow("09:29:30"), true);
  assert.equal(isNewBondAutoScanWindow("09:30:00"), false);
});

test("振26转债候选可幂等加入指定板块", () => {
  const state = {
    version: "test",
    updatedAt: "2026-08-18T00:00:00.000Z",
    sectors: [
      { name: "小热次", stocks: [] },
      { name: "其他", stocks: [{ name: "振26转债", secid: "1.113709" }] },
    ],
    stackGroups: [],
  };
  const candidate = {
    code: "113709",
    market_code: "113709.SH",
    name: "振26转债",
    listing_date: "20260817",
    discovery: "动态上市资料（MiniQMT列表尚未更新）",
  };

  const first = mergeSecondDayBondsIntoState(state, [candidate], "小热次");
  assert.deepEqual(first.added, [{
    name: "振26转债",
    secid: "1.113709",
    code: "113709",
    listingDate: "20260817",
    discovery: "动态上市资料（MiniQMT列表尚未更新）",
  }]);
  assert.equal(first.state.sectors[0].stocks.length, 1);

  const second = mergeSecondDayBondsIntoState(first.state, [candidate], "小热次");
  assert.deepEqual(second.added, []);
  assert.deepEqual(second.alreadyPresent, ["113709"]);
  assert.equal(second.state.sectors[0].stocks.length, 1);
});
