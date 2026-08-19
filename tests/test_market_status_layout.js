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

test("MiniQMT coverage details stay in the tooltip instead of changing header width", () => {
  assert.equal(
    context.compactMarketStatusSource(
      "MiniQMT实时 574/575 · 港股6只/北交所2只未接入",
    ),
    "MiniQMT 574/575",
  );
  assert.equal(
    context.compactMarketStatusSource("MiniQMT实时 139/140"),
    "MiniQMT 139/140",
  );
});

test("non-MiniQMT status messages remain visible", () => {
  assert.equal(context.compactMarketStatusSource("MiniQMT行情不可用"), "MiniQMT行情不可用");
  assert.equal(context.compactMarketStatusSource(""), "连接中");
});
