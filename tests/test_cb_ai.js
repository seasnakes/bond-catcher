"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const core = require("../lib/cb-ai-context.js");
const { createCbAiService, reconcileReportFacts } = require("../lib/cb-ai-service.js");
const provider = require("../lib/codex-text-provider.js");
const render = require("../cb-ai-render.js");
const root = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-09-04T15:30:00+08:00");
const stamp = time => Date.parse(`2026-09-04T${time}:00+08:00`);
const minute = (time, close, more = {}) => ({ time, minute_ms: stamp(time), open: close, high: close + .1, low: close - .1, close, amount_yuan: 1000, ...more });
const daily = Array.from({ length: 10 }, (_, i) => ({ date: `202608${20 + i}`, open: 100 + i, high: 102 + i, low: 98 + i, close: 100 + i, amount_yuan: 100000, quality: "qmt_daily_none", bar_count: 242, missing_bars: 0 }));
function raw() { return { code: "123247.SZ", name: "测试转债", date: "20260904", daily, reference_daily: daily, sessions: [{ date: "20260904", rows: [minute("09:31", 108), minute("09:32", 110), minute("09:33", 111)] }], requested_days: 1, monitor_status: "stopped", terms: { as_of: "20260904", conversion_price: 10 }, stock_code: "301216.SZ", tags_as_of: "20260905", tags: ["未来标签"] }; }
const knowledge = { version: "test", sources: [] };
function quote(price, time = "15:00") { return { date: "2026-09-04", price, time, timestamp: stamp(time), fetchedAt: "bad-date" }; }

test("numeric nulls, code validation and calendar dates remain distinct", () => {
  for (const value of [null, undefined, "", " ", false, NaN, Infinity]) assert.equal(core.number(value), null);
  assert.equal(core.number(0), 0);
  assert.equal(core.normalizeCode("0.123247"), "123247.SZ");
  assert.equal(core.normalizeCode("SH113709"), "113709.SH");
  assert.throws(() => core.normalizeCode("123247.SH"));
  assert.throws(() => core.normalizeCode("600000"));
  assert.equal(core.dateKey("2026-02-30"), "");
});

test("reference levels match the existing bond page and strictly exclude the analysis day", async () => {
  const source = await fs.readFile(path.join(root, "bond.js"), "utf8");
  const start = source.indexOf("function dailyRowsBefore(");
  assert.ok(start >= 0);
  const fn = source.slice(start, source.indexOf("function distanceToRange(", start));
  // The original function consumes the page's referenceDailyPayload daily rows.
  const fixture = [...daily, { ...daily[0], date: "20260904", close: 9999, low: 1, high: 9999 }];
  const computed = core.referenceLevels(fixture, "20260904");
  assert.equal(computed.ma5, 107);
  assert.equal(computed.ma10, 104.5);
  assert.equal(computed.support5, 103);
  assert.equal(computed.resistance5, 111);
  const pageLevels = vm.runInNewContext(`${fn}\nreferenceLevelsForDate('20260904')`, { state: { referenceDailyPayload: { rows: fixture } } });
  for (const item of pageLevels) assert.equal(computed[item.key], item.value);
  assert.equal(computed.source_dates.length, 10);
});

test("unfinished minutes, future daily bars, future quotes and future terms cannot enter analysis", () => {
  const data = raw();
  data.daily = [...daily, { ...daily[0], date: "20260904" }, { ...daily[0], date: "20260905" }];
  data.sessions[0].rows.push(minute("09:34", 112));
  data.quote = quote(500, "09:34");
  data.terms = { as_of: "20260905", conversion_price: 2 };
  data.redeem = { trade_date: "20260905", status: "future" };
  const context = core.buildContext(data, knowledge, stamp("09:34") + 30_000);
  assert.equal(context.daily.at(-1).date, "20260904");
  assert.equal(context.daily.at(-1).completed, false);
  assert.equal(context.sessions[0].rows.at(-1).time, "09:33");
  assert.equal(context.terms.conversion_price, undefined);
  assert.equal(context.redeem, null);
  assert.deepEqual(context.tags, []);
  assert.equal(core.eligibleQuote(quote(100, "09:35"), "20260904", stamp("09:34")), null);
  assert.equal(core.eligibleQuote({ ...quote(100), timestamp: Date.parse("2026-09-05T15:00:00+08:00") }, "20260904", NOW + 86400_000), null);
});

test("valuation requires same-day bond/stock prices and a dated recent conversion price", () => {
  const data = { ...raw(), quote: quote("120"), stock_quote: quote(12) };
  let context = core.buildContext(data, knowledge, NOW);
  assert.equal(context.price, 120);
  assert.equal(context.quote.fetched_at, null);
  assert.equal(context.valuation.conversion_value, 120);
  assert.equal(context.valuation.premium_rate_pct, 0);
  context = core.buildContext({ ...data, stock_quote: null }, knowledge, NOW);
  assert.equal(context.valuation.conversion_value, null);
  context = core.buildContext({ ...data, terms: { as_of: "20260730", conversion_price: 10 } }, knowledge, NOW);
  assert.equal(context.valuation.calculation_usable, false);
  assert.equal(context.valuation.premium_rate_pct, null);
});

function metadata() { return { ok: true, code: "123247", monitor_code: "123247.SZ", generated_at: "2026-09-07T01:00:00+08:00",
  source: "existing bond-meta", stock_code: "301216.SZ", stock_trading_date: "20260904",
  bond_tick: { timetag: "20260904 15:00:00", lastPrice: 137.016, lastClose: 135 },
  stock_tick: { timetag: "20260904 15:00:00", lastPrice: 8.79, lastClose: 8.69 }, conversion_price: 6.43,
  conversion_price_reference: { as_of: "20260904", effective_from: "20260713", verified_by_announcement: true, source: "公告" },
  circulating_face_value: 161722800, circulating_source: "QMT FloatVolume",
  stock_intraday: [{ date: "20260904", time: "15:00", timestamp: stamp("15:00"), price: 8.79 }],
  redeem: { status: "公告强赎", risk: "triggered", progress: "22/15|30", record: { trade_date: "20260904", path: "/private/file" },
    announcement: { notice_date: "20260904", type: "redeem", title: "提前赎回公告", content_text: "公告原文", facts: { redeem_price: 101.332, redeem_date: "20260917", stop_trading_date: "20260914" } } } }; }

test("existing metadata supplies dated stock quotes, announcement terms and deadlines despite old base terms", () => {
  const data = { ...raw(), terms: { as_of: "20260730", conversion_price: 9.13, rating: "AA-" } };
  const context = core.buildContext(core.mergeMetadata(data, metadata(), NOW), knowledge, NOW);
  assert.equal(context.stock.quote.price, 8.79);
  assert.equal(context.stock.intraday.length, 1);
  assert.equal(context.valuation.calculation_usable, true);
  assert.equal(context.valuation.conversion_value, 136.703);
  assert.equal(context.valuation.premium_rate_pct, .229);
  assert.equal(context.valuation.base_terms_date, "20260730");
  assert.equal(context.valuation.terms_date, "20260904");
  assert.equal(context.redeem.status, "公告强赎");
  assert.equal(context.redeem.progress, "22/15|30");
  assert.equal(context.redeem.redeem_date, "20260917");
  assert.equal(context.redeem.record.path, undefined);
  assert.equal(context.capital_observation.historical_usable, false);
  assert.ok(!context.quality.warnings.some(w => /缺少.*正股报价|强赎观察缺失/.test(w)));
  assert.match(JSON.stringify(core.modelContext(context)), /公告原文/);
});

test("later quotes and announcements cannot leak into historical enrichment", () => {
  const meta = metadata();
  meta.stock_tick.timetag = "20260907 15:00:00";
  meta.conversion_price_reference.as_of = "20260907";
  meta.redeem.announcement.notice_date = "20260907";
  const context = core.buildContext(core.mergeMetadata({ ...raw(), terms: { as_of: "20260730", conversion_price: 9.13 } }, meta, NOW + 4 * 86400000), knowledge, NOW + 4 * 86400000);
  // The later quote is rejected; valid historical minutes can still supply a price.
  assert.equal(context.stock.quote.price, 8.79);
  assert.equal(context.stock.quote.quality, "local_completed_minute");
  assert.equal(context.valuation.calculation_usable, false);
  assert.equal(context.redeem.announcement, null);
  assert.equal(context.redeem.progress, "22/15|30");
  const unverified = metadata(); unverified.conversion_price_reference = { as_of: "20260730", verified_by_announcement: false };
  assert.equal(core.buildContext(core.mergeMetadata({ ...raw(), terms: { as_of: "20260730", conversion_price: 10 } }, unverified, NOW), knowledge, NOW).valuation.calculation_usable, false);
  const oldAnnouncement = metadata(); oldAnnouncement.conversion_price_reference.as_of = "20260708";
  const oldContext = core.buildContext(core.mergeMetadata({ ...raw(), terms: { as_of: "20260730", conversion_price: 11.15 } }, oldAnnouncement, NOW), knowledge, NOW);
  assert.equal(oldContext.terms.conversion_price, 11.15);
  assert.equal(oldContext.valuation.calculation_usable, false);
  assert.throws(() => core.mergeMetadata(raw(), { ...meta, monitor_code: "123112.SZ" }), /代码不匹配/);
});

test("new listing terms retain dates and support valuation beyond seven days only after checking subsequent notices", () => {
  const data = { ...raw(), terms: {}, quote: null };
  const meta = metadata(); meta.name = "新券测试";
  meta.ai_terms = { source: "上市公告正文", as_of: "20260820", errors: [],
    facts: { conversion_price: 10, listing_date: "20260824", conversion_start_date: "20270224", maturity_date: "20320817", maturity_redemption_price: 110, rating: "AA-", put_trigger_ratio_pct: 70 },
    announcements: [{ notice_date: "20260820", title: "上市公告书", content_complete: true }],
    conversion_price_reference: { price: 10, as_of: "20260820", effective_from: "20260818", verified_by_announcement: true, supersession_checked: true, verified_through: "20260904" } };
  meta.bond_tick = {}; meta.stock_tick = {}; meta.redeem = {};
  const context = core.buildContext(core.mergeMetadata(data, meta, NOW), knowledge, NOW);
  assert.equal(context.name, "新券测试");
  assert.equal(context.quote.price, 111);
  assert.equal(context.stock.quote.price, 8.79);
  assert.equal(context.valuation.calculation_usable, true);
  assert.equal(context.valuation.conversion_value, 87.9);
  assert.equal(context.terms.maturity_date, "20320817");
  assert.equal(context.terms.put_trigger_price, 7);
  assert.equal(context.redeem.status, "未进入转股期");
  assert.equal(context.redeem.price_hit_count, null);
  meta.ai_terms.conversion_price_reference.verified_through = "20260905";
  assert.equal(core.buildContext(core.mergeMetadata(data, meta, NOW), knowledge, NOW).valuation.calculation_usable, false);
  meta.ai_terms.conversion_price_reference = { ...meta.ai_terms.conversion_price_reference, as_of: "20260904", verification_incomplete: true };
  assert.equal(core.buildContext(core.mergeMetadata(data, meta, NOW), knowledge, NOW).valuation.calculation_usable, false);
});

test("stock minutes with a future timestamp cannot masquerade as the analysis date", () => {
  const data = raw();
  data.stock_intraday = [{ date: "20260904", time: "15:00", timestamp: stamp("15:00") + 86400000, price: 999 }];
  const context = core.buildContext(data, knowledge, NOW + 86400000);
  assert.equal(context.stock.quote, null);
  assert.equal(context.stock.intraday.length, 0);
});

test("metadata outage preserves local data and makes the failed enrichment explicit", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cb-ai-enrichment-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let requested;
  const service = createCbAiService({ root, directory, snapshotLoader: async () => raw(), enrichmentLoader: async params => { requested = params; throw new Error("offline"); } });
  const context = await service.context({ code: "123247" });
  assert.deepEqual(requested, { code: "123247.SZ", date: "20260904" });
  assert.equal(context.daily.length, 10);
  assert.equal(context.enrichment.status, "failed");
  assert.ok(context.quality.warnings.some(w => /补充失败/.test(w)));
});

test("missing minute cannot be counted as confirmation or hidden by session anchor bars", () => {
  const full = [];
  for (let m = 570; m <= 900; m++) if (m <= 690 || m >= 780) full.push(minute(`${String(m / 60 | 0).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, 100));
  assert.equal(core.coverageFor(full, "20260904", NOW).coverage_pct, 100);
  const missing = full.filter(r => r.time !== "11:30");
  const coverage = core.coverageFor(missing, "20260904", NOW);
  assert.equal(coverage.bars, 241);
  assert.equal(coverage.missing_bars, 1);
  assert.deepEqual(coverage.missing_times, ["11:30"]);
  const rows = [minute("09:31", 100), minute("09:32", 101), minute("09:33", 101.2)];
  assert.equal(core.observeLevels(rows, { ma5: 100 }).length, 1);
  assert.equal(core.observeLevels([rows[0], rows[1], minute("09:34", 102)], { ma5: 100 }).length, 0);
  const refs = core.referenceLevels([...daily.slice(0, -1), { ...daily.at(-1), bar_count: 241, missing_bars: 1 }], "20260904");
  assert.deepEqual(refs.partial_source_dates, ["20260829"]);
});

test("absent amount remains null in compressed bars and model context", () => {
  const data = raw(); data.sessions[0].rows[1].amount_yuan = null;
  const context = core.buildContext(data, knowledge, NOW);
  assert.equal(context.sessions[0].summary.amount_yuan, null);
  assert.equal(context.sessions[0].summary.missing_amount_bars, 1);
  const compact = core.modelContext(context);
  assert.equal(compact.sessions[0].five_minute_bars[0].amount_yuan, null);
  assert.match(JSON.stringify(compact.units), /1手=10张/);
});

test("model issue amount has an unambiguous yuan unit and report facts cannot drift tenfold", () => {
  const data = raw();
  data.date = "20260910";
  data.terms = { as_of: "20260907", issue_scale_billion: 6.075298, conversion_start_date: "20270224",
    announcements: [{ facts: { issue_scale_billion: 6.075298 } }] };
  const context = core.buildContext(data, knowledge, NOW + 7 * 86400000);
  const input = core.modelContext(context);
  assert.equal(input.terms.issue_amount_yuan, 607529800);
  assert.equal(input.terms.issue_scale_text, "6.075298亿元");
  assert.ok(!JSON.stringify(input).includes("issue_scale_billion"));
  assert.equal(input.terms.days_to_conversion_start, 167);
  const text = "2027年2月24日开始转股，分析日距此165天。发行规模60.753亿元，当前成交额27.42亿元。";
  assert.equal(reconcileReportFacts(text, context), "2027年2月24日开始转股，分析日距此167天。发行规模6.075298亿元，当前成交额27.42亿元。");
  assert.equal(reconcileReportFacts("2027年2月25日才开始转股，距分析日尚有166天。", { ...context, terms: { conversion_start_date: "20270225" } }), "2027年2月25日才开始转股，距分析日尚有168天。");
  assert.equal(reconcileReportFacts(text, { ...context, terms: {} }), text);
});

test("report renderer escapes markup and rejects script links while retaining citations and tables", () => {
  const content = render.markdown('<img src=x onerror=alert(1)>\n[x](javascript:alert(1))\n[P1] **事实** `a < b`\n[link](https://example.com/\"onmouseover=evil)\n\n|节点|价格|\n|---|---|\n|MA5|107|');
  assert.ok(!content.includes("<img"));
  assert.ok(!content.includes('href="javascript:'));
  assert.ok(!content.includes('href="https://example.com/"onmouseover'));
  assert.match(content, /href="#theory-P1"/);
  assert.match(content, /<strong>事实<\/strong>/);
  assert.match(content, /<table>/);
  assert.equal(render.inline('[P1](https://example.com/[P2])'), '<a href="https://example.com/[P2]" target="_blank" rel="noopener noreferrer">P1</a>');
});

async function until(fn, predicate) {
  for (let i = 0; i < 150; i++) { const value = await fn(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error("test job did not settle");
}
test("service freezes inputs, coalesces concurrent starts, limits jobs, cancels and restores saved reports", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cb-ai-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let reads = 0, calls = 0;
  const pending = [];
  const fake = {
    status: async () => ({ configured: true, model: "fake", provider: "test", reasoning_effort: "test" }),
    generateText: async (prompt, { signal }) => new Promise((resolve, reject) => {
      calls++; pending.push({ resolve, reject, prompt });
      signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true });
    }),
  };
  const service = createCbAiService({ root, directory, provider: fake, snapshotLoader: async () => { reads++; return raw(); } });
  t.after(() => service.stop());
  const [a, b] = await Promise.all([service.context({ code: "123247" }), service.context({ code: "123247" })]);
  assert.equal(a.id, b.id); assert.equal(reads, 1);
  const [first, duplicate] = await Promise.all([service.start({ context_id: a.id, focus: "支撑" }), service.start({ context_id: a.id, focus: "支撑" })]);
  assert.equal(first.id, duplicate.id);
  const second = await service.start({ context_id: a.id, focus: "压力" });
  await assert.rejects(service.start({ context_id: a.id, focus: "第三份" }), error => error.statusCode === 429);
  await until(async () => calls, x => x === 2);
  await service.cancel(second.id);
  pending[0].resolve({ content: "### 分析\n已完成的研究正文", model: "fake" });
  const finished = await until(() => service.get(first.id, true), job => job.status === "done");
  assert.equal(finished.context_sha256, a.context_sha256);
  assert.match(finished.content, /北京时间/);
  assert.match(finished.content, /原始日线 10 根，分钟聚合补充 0 根/);
  assert.equal(finished.raw_model_content, "### 分析\n已完成的研究正文");
  assert.match(finished.prompt, /支撑/);
  assert.match(finished.prompt, /分钟/);
  await until(async () => JSON.parse(await fs.readFile(path.join(directory, `${first.id}.json`), "utf8")), job => job.status === "done");
  await until(async () => JSON.parse(await fs.readFile(path.join(directory, `${second.id}.json`), "utf8")), job => job.status === "cancelled");
  const restored = createCbAiService({ root, directory, provider: fake });
  assert.equal((await restored.get(first.id, true)).content, finished.content);
  assert.equal((await restored.get(second.id)).status, "cancelled");
  await assert.rejects(service.get("../../auth"), error => error.statusCode === 404);
  await assert.rejects(service.start({ context_id: a.id, focus: "x".repeat(2001) }), /最多2000/);
});

test("interrupted jobs become explicit errors after restart", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cb-ai-restart-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const id = "11111111-1111-4111-8111-111111111111";
  await fs.writeFile(path.join(directory, `${id}.json`), JSON.stringify({ id, status: "generating", created_at: new Date().toISOString() }));
  const service = createCbAiService({ root, directory, provider: {} });
  const job = await service.get(id);
  assert.equal(job.status, "error"); assert.match(job.error, /重启/);
});

test("Codex adapter uses isolated configuration, passes stdin and cleans up on success and timeout", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cb-ai-provider-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "auth.json"), '{"fake":true}');
  const binary = path.join(directory, "fake-codex");
  await fs.writeFile(binary, `#!${process.execPath}\nconst fs=require('node:fs');const path=require('node:path');let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{const home=process.env.CODEX_HOME;const config=fs.readFileSync(path.join(home,'config.toml'),'utf8');if(!config.includes('shell_tool = false')||!config.includes('web_search = "disabled"')||fs.readdirSync(process.cwd()).length)process.exit(2);if(input==='slow'){setInterval(()=>{},1000);return;}fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],input+'研究正文'.repeat(40));});\n`, { mode: 0o700 });
  // Windows does not execute POSIX shebang fixtures. Use the same Node script
  // through a native executable while retaining the adapter's real child I/O.
  let testProvider = provider;
  if (process.platform === "win32") {
    const childProcess = require("node:child_process");
    const spawn = childProcess.spawn;
    t.mock.method(childProcess, "spawn", (file, args, options) =>
      file === binary ? spawn(process.execPath, [binary, ...args], options) : spawn(file, args, options));
    const modulePath = require.resolve("../lib/codex-text-provider.js");
    delete require.cache[modulePath];
    testProvider = require(modulePath);
  }
  const before = new Set((await fs.readdir(os.tmpdir())).filter(s => s.startsWith("finance-cb-ai-")));
  const result = await testProvider.generateText("真实传入的测试内容", { binaryOverride: binary, homeOverride: directory, timeoutMs: 2000 });
  assert.match(result.content, /^真实传入的测试内容/);
  await assert.rejects(testProvider.generateText("slow", { binaryOverride: binary, homeOverride: directory, timeoutMs: 100 }), /超过/);
  const after = new Set((await fs.readdir(os.tmpdir())).filter(s => s.startsWith("finance-cb-ai-")));
  assert.deepEqual(after, before);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(testProvider.generateText("cancel", { signal: abort.signal }), error => error.name === "AbortError");
  for (const key of ["NO_PROXY", "no_proxy"]) assert.match(provider.processEnvironment(directory)[key], /127\.0\.0\.1,localhost,::1/);
});
