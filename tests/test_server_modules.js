const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const secid = require("../src/domain/secid.js");
const { normalizeBoardState } = require("../src/domain/board-state.js");
const { chunk, mapWithConcurrency, withTimeout } = require("../src/shared/async.js");
const { readJsonFile, writeJsonAtomic } = require("../src/infrastructure/json-file-store.js");
const { parseLastJsonObject } = require("../src/infrastructure/process-exec.js");
const { isLoopbackRequest, isSameOriginRequest } = require("../src/interfaces/http/http-io.js");
const { createStaticFileServer, resolvePublicStaticPath } = require("../src/interfaces/http/static-files.js");

const ROOT = path.join(__dirname, "..");

test("secid normalization covers A-share, Beijing and Hong Kong inputs", () => {
  assert.equal(secid.normalizeSecidInput("sh600519"), "1.600519");
  assert.equal(secid.normalizeSecidInput("113050"), "1.113050");
  assert.equal(secid.normalizeSecidInput("123100"), "0.123100");
  assert.equal(secid.normalizeSecidInput("bj920001"), "0.920001");
  assert.equal(secid.normalizeSecidInput("hk700"), "116.00700");
  assert.equal(secid.normalizeSecidInput("rt_hk00700"), "116.00700");
  assert.equal(secid.normalizeTagSecid("600519.SH"), "1.600519");
  assert.equal(secid.secidToMiniQmtMarketCode("0.000001"), "000001.SZ");
  assert.equal(secid.secidToMiniQmtMarketCode("0.920001"), "");
  assert.equal(secid.secidToTdxStockCode("0.920001"), "920001.BJ");
  assert.equal(secid.secidToSinaSymbol("116.00700"), "rt_hk00700");
  assert.equal(secid.secidToTencentSymbol("116.00700"), "hk00700");
  assert.equal(secid.typeForSecid("1.113050"), "Bond");
  assert.equal(secid.marketNameForSecid("1.510300"), "ETF");
});

test("board state normalization drops invalid rows and orphaned stack names", () => {
  const state = normalizeBoardState({
    sectors: [
      { name: " 转债 ", stocks: [{ name: "测试转债", secid: "113050" }, { name: "", secid: "1.600000" }] },
      { name: "" },
    ],
    stackGroups: [{ name: "组", sectorNames: ["转债", "转债", "缺失"], expandedSectorNames: ["转债", "缺失"] }],
  });
  assert.deepEqual(state.sectors, [{ name: "转债", stocks: [{ name: "测试转债", secid: "1.113050" }] }]);
  assert.deepEqual(state.stackGroups, [{ name: "组", sectorNames: ["转债"], expandedSectorNames: ["转债"] }]);
  assert.equal(state.version, "server-state-v1");
});

test("async helpers keep order, limit concurrency and clear timeout timers", async () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);

  let active = 0;
  let peak = 0;
  const results = await mapWithConcurrency([30, 10, 20, 5], 2, async (delay, index) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, delay));
    active -= 1;
    return index;
  });
  assert.deepEqual(results, [0, 1, 2, 3]);
  assert.equal(peak, 2);

  assert.equal(await withTimeout(Promise.resolve("ok"), 60_000), "ok");
  await assert.rejects(withTimeout(new Promise(() => {}), 10), /operation timeout after 10ms/);
});

test("atomic JSON writes survive concurrent writers and leave no temp files", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "finance-json-store-"));
  const filePath = path.join(dir, "state.json");
  await Promise.all(Array.from({ length: 8 }, (_, index) => writeJsonAtomic(filePath, { index })));
  const saved = await readJsonFile(filePath);
  assert.equal(typeof saved.index, "number");
  assert.deepEqual(await fs.promises.readdir(dir), ["state.json"]);
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test("last JSON object is recovered from noisy process output", () => {
  assert.deepEqual(parseLastJsonObject('warning\n{"ok":true}\n'), { ok: true });
  assert.deepEqual(parseLastJsonObject("no json"), {});
});

test("request origin helpers accept only loopback and same-origin callers", () => {
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: "::ffff:127.0.0.1" } }), true);
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: "192.168.1.8" } }), false);
  assert.equal(isSameOriginRequest({ headers: { origin: "http://localhost:5173", host: "localhost:5173" } }), true);
  assert.equal(isSameOriginRequest({ headers: { origin: "http://evil.test", host: "localhost:5173" } }), false);
  assert.equal(isSameOriginRequest({ headers: { host: "localhost:5173" } }), false);
});

test("static files expose browser assets and public data only", () => {
  for (const pathname of [
    "/",
    "/app.js",
    "/styles.css",
    "/quant.html",
    "/data/convertible-bond-tags.json",
    "/docs/prompts/cb-ai-analysis.md",
    "/docs/assets/finance-board.png",
  ]) {
    assert.ok(resolvePublicStaticPath(ROOT, pathname), `${pathname} should be public`);
  }

  for (const pathname of [
    "/server.js",
    "/package.json",
    "/README.md",
    "/finance-board.log",
    "/.git/config",
    "/.env",
    "/data/board-state.json",
    "/data/recovered/board.json",
    "/runtime/trading-audit.jsonl",
    "/runtime/convertible-bond-market.sqlite3",
    "/scripts/miniqmt-dashboard-api.py",
    "/lib/cb-ai-service.js",
    "/tests/test_server_modules.js",
    "/docs/../server.js",
    "//etc/passwd",
  ]) {
    assert.equal(resolvePublicStaticPath(ROOT, pathname), null, `${pathname} should be private`);
  }
});

test("static paths cannot climb into sibling directories sharing the root prefix", () => {
  const root = path.join(os.tmpdir(), "finance");
  assert.equal(resolvePublicStaticPath(root, "/../finance-other/index.html"), null);
});

test("static server returns 404 for private paths and serves public files", async () => {
  const serveStatic = createStaticFileServer({ root: ROOT });
  const call = async (pathname) => {
    const response = {
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(body) { this.body = body; },
    };
    await serveStatic(pathname, response);
    return response;
  };

  const page = await call("/");
  assert.equal(page.status, 200);
  assert.equal(page.headers["Content-Type"], "text/html; charset=utf-8");
  assert.equal(page.headers["X-Content-Type-Options"], "nosniff");

  assert.equal((await call("/server.js")).status, 404);
  assert.equal((await call("/missing-page.html")).status, 404);
});
