const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const APP_SOURCE = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

function helperSource() {
  const start = APP_SOURCE.indexOf("function compactMarketStatusSource(");
  const end = APP_SOURCE.indexOf("\nfunction marketStatusItem(", start);
  assert.ok(start >= 0 && end > start, "missing market status source helper");
  return APP_SOURCE.slice(start, end);
}

const context = vm.createContext({});
vm.runInContext(helperSource(), context);

test("QMT coverage details stay in the tooltip instead of changing header width", () => {
  assert.equal(
    context.compactMarketStatusSource(
      "QMT实时 574/575 · 港股6只/北交所2只未接入",
    ),
    "QMT 574/575",
  );
  assert.equal(
    context.compactMarketStatusSource("QMT实时 139/140"),
    "QMT 139/140",
  );
});

test("market feed badge only recognizes the active Big QMT route", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.marketFeedPresentation(
      { active: "bigqmt", requested: 140, returned: 139 },
      "",
    ))),
    {
      icon: "Q",
      label: "大 QMT",
      mode: "行情",
      coverage: "139/140",
      className: "is-bigqmt",
    },
  );
  const fallback = context.marketFeedPresentation(
    { active: "miniqmt", fallbackActive: true, requested: 140, returned: 140 },
    "",
  );
  assert.equal(fallback.label, "QMT");
  assert.equal(fallback.mode, "连接中");
  assert.equal(fallback.className, "is-unknown");
});

test("stale big QMT reference metadata is visible without hiding the feed", () => {
  const stale = context.marketFeedPresentation(
    {
      active: "bigqmt",
      requested: 140,
      returned: 140,
      bigQmtReferenceStatus: "stale",
    },
    "",
  );
  assert.equal(stale.icon, "Q");
  assert.equal(stale.label, "大 QMT");
  assert.equal(stale.mode, "行情·昨收修复");
  assert.equal(stale.className, "is-fallback");
});

test("non-QMT status messages remain visible", () => {
  assert.equal(context.compactMarketStatusSource("QMT行情不可用"), "QMT行情不可用");
  assert.equal(context.compactMarketStatusSource(""), "连接中");
});
