const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isNewBondAutoScanWindow,
  mergeNewBondUniverseManifest,
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

test("新债候选写入统一补充债池并淘汰过期记录", () => {
  const manifest = mergeNewBondUniverseManifest(
    {
      bonds: [
        {
          code: "123001.SZ",
          name: "过期转债",
          validThrough: "20260819",
        },
        {
          code: "113709.SH",
          name: "振26转债",
          listingDate: "20260817",
          firstTargetDate: "20260818",
          firstDetectedAt: "2026-08-18T08:31:00.000Z",
          validThrough: "20261001",
        },
      ],
    },
    [
      {
        code: "118075",
        market_code: "118075.SH",
        name: "奥普转债",
        listing_date: "20260819",
        in_miniqmt_list: false,
        discovery: "动态上市资料（MiniQMT列表尚未更新）",
      },
      {
        code: "123280",
        secid: "0.123280",
        name: "三鑫转债",
        listing_date: "20260819",
        in_miniqmt_list: false,
      },
    ],
    "20260820",
    "2026-08-20T08:31:00.000Z",
  );

  assert.deepEqual(
    manifest.bonds.map((row) => row.code),
    ["113709.SH", "118075.SH", "123280.SZ"],
  );
  assert.equal(manifest.bonds[0].firstDetectedAt, "2026-08-18T08:31:00.000Z");
  assert.equal(manifest.bonds[1].validThrough, "20261004");
  assert.equal(manifest.bonds[1].source, "finance-board-new-bond-discovery");
});
