const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "bond-tags.js"), "utf8");
function section(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}

function fixture() {
  const requests = [];
  const state = { rows: [], quotes: new Map(), searchAliases: new Map() };
  const nodes = {
    status: {}, quoteStatus: {}, refresh: {}, empty: {}, search: { value: "" },
  };
  let renders = 0;
  const context = vm.createContext({
    state, nodes, URLSearchParams,
    fetchJson: (url) => new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
    renderTable: () => { renders += 1; },
    renderFilters: () => {}, renderQuickAdd: () => {},
  });
  vm.runInContext(section("async function enrichSupplementalRows()", "\nfunction filteredRows()"), context);
  vm.runInContext(section("async function loadQuotes()", '\nnodes.search.addEventListener("input"'), context);
  return { context, state, nodes, requests, renders: () => renders };
}

test("tags become editable while aliases and quotes remain pending", async () => {
  const f = fixture();
  const loading = f.context.initialize();
  f.requests.find(r => r.url === "/api/miniqmt/tags").resolve({
    rows: [{ code: "123001.SZ" }], tagOrder: [], tagCounts: {},
  });
  await loading;
  assert.match(f.nodes.status.textContent, /标签已就绪/);
  assert.equal(f.renders(), 1);
  assert.equal(f.state.rows.length, 1);
  assert.equal(f.state.quotesLoading, true);
  assert.match(f.nodes.quoteStatus.textContent, /可继续编辑/);

  f.requests.find(r => r.url.includes("/quotes?")).reject(new Error("gateway timeout"));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(f.nodes.status.textContent, /标签已就绪/);
  assert.match(f.nodes.quoteStatus.textContent, /行情暂不可用，标签仍可编辑/);
  assert.equal(f.nodes.refresh.disabled, false);
});

test("complete supplemental rows require no metadata requests", async () => {
  const f = fixture();
  f.state.rows = [{ supplemental: true, code: "123001.SZ", stockCode: "300001.SZ", stockName: "正股" }];
  await f.context.enrichSupplementalRows();
  assert.equal(f.requests.length, 0);
  assert.equal(f.renders(), 0);
});

test("only missing supplemental stock mappings are enriched without changing tags", async () => {
  const f = fixture();
  f.state.rows = [
    { supplemental: true, code: "123001.SZ", stockName: "待补正股", tags: ["人工标签"] },
    { supplemental: true, code: "123002.SZ", stockCode: "300002.SZ", stockName: "已知正股" },
  ];
  const loading = f.context.enrichSupplementalRows();
  assert.equal(f.requests.length, 1);
  assert.match(f.requests[0].url, /123001/);
  f.requests[0].resolve({ ok: true, stock_code: "300001.SZ", stock_name: "补充正股" });
  await loading;
  assert.equal(f.state.rows[0].stockName, "补充正股");
  assert.deepEqual(f.state.rows[0].tags, ["人工标签"]);
  assert.equal(f.renders(), 1);
});

test("duplicate quote refreshes are ignored and failed refresh keeps prior quotes", async () => {
  const f = fixture();
  f.state.rows = [{ code: "123001.SZ" }];
  f.state.quotes.set("123001.SZ", { price: 100 });
  const loading = f.context.loadQuotes();
  await f.context.loadQuotes();
  assert.equal(f.requests.length, 1);
  f.requests[0].reject(new Error("unavailable"));
  await loading;
  assert.equal(f.state.quotes.get("123001.SZ").price, 100);
  assert.match(f.nodes.quoteStatus.textContent, /保留上次行情/);
  assert.equal(f.state.quotesLoading, false);
});
