const test = require("node:test");
const assert = require("node:assert/strict");

const {
  filterBoardStateByLifecycle,
  isNewBondAutoScanWindow,
  isNewBondReconciliationWindow,
  mergeBondTagPayloadWithNewUniverse,
  mergeNewBondUniverseManifest,
  mergeSecondDayBondsIntoState,
  publicNewBondUniverse,
} = require("../server.js");

test("上市第二日自动扫描窗口只覆盖开盘前", () => {
  assert.equal(isNewBondAutoScanWindow("08:29:59"), false);
  assert.equal(isNewBondAutoScanWindow("08:30:00"), true);
  assert.equal(isNewBondAutoScanWindow("09:29:30"), true);
  assert.equal(isNewBondAutoScanWindow("09:30:00"), false);
});

test("每日存量对账的收盘后维护窗口为15:12至18:00", () => {
  assert.equal(isNewBondReconciliationWindow("15:11:59"), false);
  assert.equal(isNewBondReconciliationWindow("15:12:00"), true);
  assert.equal(isNewBondReconciliationWindow("18:00:00"), true);
  assert.equal(isNewBondReconciliationWindow("18:00:01"), false);
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

test("星图补充债池只公开已上市新债并保留可用元数据", () => {
  const payload = publicNewBondUniverse({
    updatedAt: "2026-08-28T00:30:57.062Z",
    bonds: [
      {
        code: "111026.SH",
        name: "派克转债",
        stockCode: "605123.SH",
        stockName: "派克新材",
        issueScaleBillion: 15.8,
        rating: "AA+",
        listingDate: "20260825",
        inMiniQmtList: true,
      },
      {
        code: "118099.SH",
        name: "未来转债",
        listingDate: "20260901",
      },
    ],
  }, "20260830");
  assert.equal(payload.count, 1);
  assert.deepEqual(payload.bonds[0], {
    code: "111026.SH",
    name: "派克转债",
    stockCode: "605123.SH",
    stockName: "派克新材",
    industry1: "",
    industry2: "",
    industry3: "",
    issueScaleBillion: 15.8,
    rating: "AA+",
    listingDate: "20260825",
    inMiniQmtList: true,
    discovery: "",
    source: "",
  });
});

test("标签管理把自动新债池合并进静态标签库并应用人工覆盖", () => {
  const payload = mergeBondTagPayloadWithNewUniverse(
    {
      asOf: "2026-07-31",
      tagOrder: ["次新债", "半导体"],
      rows: [{ code: "110001.SH", name: "旧债", tags: ["半导体"] }],
    },
    {
      updatedAt: "2026-08-28T00:30:57.062Z",
      bonds: [{ code: "111026.SH", name: "派克转债", listingDate: "20260825" }],
    },
    {
      overrides: {
        "111026.SH": { add: ["半导体"], remove: ["次新债"], primaryTag: "半导体" },
      },
    },
    {
      stocks: {
        "605123.SH": {
          industry1: "国防军工",
          industry2: "航空装备Ⅱ",
          industry3: "航空装备Ⅲ",
        },
      },
    },
  );
  assert.equal(payload.count, 2);
  assert.equal(payload.baseCount, 1);
  assert.equal(payload.supplementalCount, 1);
  assert.deepEqual(payload.rows[1], {
    code: "111026.SH",
    name: "派克转债",
    stockCode: "",
    stockName: "",
    listedDate: "2026-08-25",
    industry1: "新上市转债",
    industry2: "待分类",
    industry3: "待分类",
    tags: ["半导体"],
    primaryTag: "半导体",
    supplemental: true,
    dataQuality: "自动新债池补充；正股与行业资料按需补齐",
  });
  assert.deepEqual(payload.tagCounts, { 次新债: 0, 半导体: 2 });
});

test("已进入标签库的新债继续继承自动债池的发行规模和评级", () => {
  const payload = mergeBondTagPayloadWithNewUniverse(
    {
      tagOrder: ["次新债"],
      rows: [{
        code: "111026.SH",
        name: "派克转债",
        tags: ["次新债"],
        supplemental: true,
      }],
    },
    {
      bonds: [{
        code: "111026.SH",
        name: "派克转债",
        issueScaleBillion: 15.8,
        rating: "AA",
        listingDate: "20260825",
      }],
    },
  );
  assert.equal(payload.rows[0].issueScaleBillion, 15.8);
  assert.equal(payload.rows[0].rating, "AA");
});

test("申万行业映射会补齐新债和静态库中的待分类记录", () => {
  const industryMap = {
    stocks: {
      "605123.SH": {
        industry1: "国防军工",
        industry2: "航空装备Ⅱ",
        industry3: "航空装备Ⅲ",
      },
      "688605.SH": {
        industry1: "电子",
        industry2: "半导体",
        industry3: "半导体设备",
      },
    },
  };
  const payload = mergeBondTagPayloadWithNewUniverse(
    {
      tagOrder: ["次新债"],
      rows: [{
        code: "118076.SH",
        name: "先锋转债",
        stockCode: "688605.SH",
        industry1: "新上市转债",
        industry2: "待分类",
        industry3: "待分类",
        tags: ["次新债"],
      }],
    },
    {
      bonds: [{
        code: "111026.SH",
        name: "派克转债",
        stockCode: "605123.SH",
        stockName: "派克新材",
        listingDate: "20260825",
      }],
    },
    {},
    industryMap,
  );

  assert.equal(payload.rows[0].industry1, "电子");
  assert.equal(payload.rows[0].industry2, "半导体");
  assert.equal(payload.rows[0].industry3, "半导体设备");
  assert.equal(payload.rows[1].industry1, "国防军工");
  assert.equal(payload.rows[1].industry2, "航空装备Ⅱ");
  assert.equal(payload.rows[1].industry3, "航空装备Ⅲ");
  assert.match(payload.rows[1].dataQuality, /申万行业自动补齐/);
});

test("生命周期会从当前标签池隐藏已退出转债并保留审计字段", () => {
  const lifecycle = {
    qualityStatus: "ok",
    checkedAt: "2026-08-31T01:00:00Z",
    source: "QMT Bridge /api/cb/list",
    qmtActiveCount: 320,
    bonds: {
      "118053.SH": {
        lifecycleStatus: "inactive_or_exited",
        isActive: false,
        reason: "absent_from_qmt_current_list",
        checkedAt: "2026-08-31T01:00:00Z",
      },
      "111026.SH": {
        lifecycleStatus: "active_listed",
        isActive: true,
        reason: "present_in_qmt_current_list",
        checkedAt: "2026-08-31T01:00:00Z",
      },
    },
  };
  const source = {
    tagOrder: ["半导体"],
    rows: [
      { code: "118053.SH", name: "正帆转债", tags: ["半导体"] },
      { code: "111026.SH", name: "派克转债", tags: ["半导体"] },
    ],
  };

  const visible = mergeBondTagPayloadWithNewUniverse(source, {}, {}, {}, lifecycle);
  assert.equal(visible.count, 1);
  assert.equal(visible.activeCount, 1);
  assert.equal(visible.inactiveCount, 1);
  assert.equal(visible.totalKnownCount, 2);
  assert.equal(visible.rows[0].code, "111026.SH");
  assert.deepEqual(visible.tagCounts, { 半导体: 1 });

  const audited = mergeBondTagPayloadWithNewUniverse(
    source,
    {},
    {},
    {},
    lifecycle,
    { includeInactive: true },
  );
  const exited = audited.rows.find((row) => row.code === "118053.SH");
  assert.equal(audited.count, 2);
  assert.equal(exited.lifecycleStatus, "inactive_or_exited");
  assert.equal(exited.isActive, false);
  assert.equal(exited.visibility, "hidden");
  assert.equal(exited.lifecycleReason, "absent_from_qmt_current_list");
});

test("看板生命周期过滤只移除明确退出的转债", () => {
  const state = {
    version: "test",
    updatedAt: "2026-08-31T00:00:00.000Z",
    sectors: [{
      name: "观察",
      stocks: [
        { name: "正帆转债", secid: "1.118053" },
        { name: "派克转债", secid: "1.111026" },
        { name: "正帆科技", secid: "1.688596" },
      ],
    }],
    stackGroups: [],
  };
  const lifecycle = {
    qualityStatus: "ok",
    qmtActiveCount: 320,
    bonds: {
      "118053.SH": { isActive: false, lifecycleStatus: "inactive_or_exited" },
      "111026.SH": { isActive: true, lifecycleStatus: "active_listed" },
    },
  };

  const result = filterBoardStateByLifecycle(state, lifecycle);
  assert.deepEqual(
    result.state.sectors[0].stocks.map((row) => row.name),
    ["派克转债", "正帆科技"],
  );
  assert.deepEqual(result.removed.map((row) => row.code), ["118053.SH"]);
});

test("QMT当前池里漏出静态标签库的存续债会作为未打标签兜底补充", () => {
  const payload = mergeBondTagPayloadWithNewUniverse(
    { tagOrder: ["ST"], rows: [] },
    {},
    {},
    {},
    {
      qualityStatus: "ok",
      checkedAt: "2026-08-31T01:00:00Z",
      qmtActiveCount: 316,
      bonds: {
        "113575.SH": {
          name: "东时转债",
          lifecycleStatus: "active_listed",
          isActive: true,
          reason: "present_in_qmt_current_list",
        },
      },
    },
  );

  assert.equal(payload.count, 1);
  assert.equal(payload.lifecycleSupplementalCount, 1);
  assert.deepEqual(payload.rows[0].tags, []);
  assert.equal(payload.rows[0].name, "东时转债");
  assert.equal(payload.rows[0].lifecycleSupplemental, true);
  assert.equal(payload.rows[0].isActive, true);
});
