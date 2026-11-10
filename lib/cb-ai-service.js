"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { buildContext, modelContext, normalizeCode, dateKey, mergeMetadata } = require("./cb-ai-context.js");
const codex = require("./codex-text-provider.js");
const PROMPT_VERSION = "cb-ai-prompt-2026-09-11.2";
const ACTIVE = new Set(["queued", "generating"]);

function makeError(message, statusCode = 400) { const error = new Error(message); error.statusCode = statusCode; return error; }
function validId(id) { return typeof id === "string" && /^[a-f0-9-]{16,64}$/.test(id); }
function reconcileReportFacts(content, snapshot) {
  const terms = snapshot.terms || {}, scale = Number(terms.issue_scale_billion);
  if (Number.isFinite(scale) && scale > 0 && dateKey(terms.as_of) && dateKey(terms.as_of) <= snapshot.date) {
    content = content.replace(/((?:发行规模|发行总额)(?:为|约|[：:]|人民币|\s)*)([\d,.]+)\s*(?:亿元|万元|元)/g,
      (match, label) => `${label}${scale}亿元`);
  }
  const start = dateKey(terms.conversion_start_date), date = dateKey(snapshot.date);
  if (start && date && start >= date) {
    const utc = s => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6)));
    const days = Math.round((utc(start) - utc(date)) / 86400000);
    content = content.replace(/((?:开始转股|转股开始)[^。\n]{0,35}?距分析日(?:尚有|还有|剩余)?\s*)\d+\s*天/g, (match, label) => `${label}${days}天`);
    content = content.replace(/((?:分析日距此|距开始转股)\s*)\d+\s*天/g, (match, label) => `${label}${days}天`);
  }
  return content;
}
function reportWithProvenance(content, snapshot) {
  content = reconcileReportFacts(content, snapshot);
  const day = value => String(value || "未知").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
  const generated = new Date(Date.parse(snapshot.generated_at) + 8 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
  const q = snapshot.quality;
  const header = `**${snapshot.name}（${snapshot.code}）** · ${snapshot.snapshot_mode}\n\n> 行情截至 ${day(snapshot.date)} ${snapshot.as_of_time}；分析快照生成于 ${generated}（北京时间）。`;
  const dates = q.aggregated_dates.map(day).join("、");
  const gaps = snapshot.sessions.filter(s => s.coverage.missing_bars).map(s => `${day(s.date)} 缺 ${s.coverage.missing_bars} 根已完成分钟`).join("；");
  const footer = `---\n\n**数据记录（系统生成）**\n\n日 K 共 ${q.daily_count} 根：原始日线 ${q.official_daily_count} 根，分钟聚合补充 ${q.aggregated_dates.length} 根。${dates ? `聚合日期：${dates}；可能不含完整集合竞价或遗漏分钟。` : ""}\n\n分时 ${snapshot.sessions.length} 日。${gaps ? `${gaps}。` : snapshot.sessions.length ? "所读取日期的已完成分钟未见缺口。" : "缺少可用分时。"}条款快照：${day(snapshot.valuation.terms_date)}；同日可靠转股估值：${snapshot.valuation.calculation_usable ? "具备计算输入，仍需核对公告" : "无法确认"}。`;
  const redemption = snapshot.redeem, notice = redemption?.announcement;
  const alert = redemption?.risk === "triggered" && notice ? `\n\n> **强赎提示：${redemption.status}**。依据 ${day(notice.notice_date)} 公告${redemption.stop_trading_date ? `，停止交易日 ${day(redemption.stop_trading_date)}` : ""}${redemption.stop_conversion_date ? `，停止转股日 ${day(redemption.stop_conversion_date)}` : ""}${redemption.redeem_date ? `，赎回日 ${day(redemption.redeem_date)}` : ""}${redemption.redeem_price ? `，赎回价 ${redemption.redeem_price} 元/张` : ""}。` : "";
  return `${header}${alert}\n\n${content.trim()}\n\n${footer}`;
}
async function atomicWrite(filename, data) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temp = `${filename}.${crypto.randomUUID()}.tmp`;
  try { await fs.writeFile(temp, JSON.stringify(data), { mode: 0o600 }); await fs.rename(temp, filename); }
  finally { await fs.rm(temp, { force: true }); }
}
function readSnapshot(script, python, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" } });
    let output = "", settled = false;
    const timer = setTimeout(() => { child.kill("SIGTERM"); finish(makeError("本地数据读取超时，请稍后重试", 503)); }, 25_000);
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(result); };
    child.stdout.on("data", chunk => { output += chunk.toString(); if (Buffer.byteLength(output) > 4 * 1024 * 1024) { child.kill(); finish(makeError("数据量超过分析上限", 413)); } });
    child.stderr.on("data", () => {});
    child.on("error", () => finish(makeError("本地数据读取程序不可用", 503)));
    child.on("close", code => {
      if (settled) return;
      try { const result = JSON.parse(output); if (code || result.error) finish(makeError(result.error || "本地数据读取失败", 503)); else finish(null, result); }
      catch { finish(makeError("本地数据返回格式异常", 503)); }
    });
    child.stdin.on("error", () => {}); child.stdin.end(JSON.stringify(payload));
  });
}

function createCbAiService({ root, python, provider = codex, snapshotLoader, enrichmentLoader, directory } = {}) {
  root ||= path.resolve(__dirname, "..");
  python ||= process.env.MINIQMT_PYTHON || "/Users/seasnake/miniconda3/bin/python3";
  directory ||= path.join(root, "runtime", "cb-ai");
  const snapshots = new Map(), jobs = new Map(), controllers = new Map(), snapshotRequests = new Map(), writes = new Map();
  let knowledge, template, loaded = false;
  async function init() {
    if (loaded) return;
    knowledge = JSON.parse(await fs.readFile(path.join(root, "data/cb-ai-knowledge.json"), "utf8"));
    template = await fs.readFile(path.join(root, "docs/prompts/cb-ai-analysis.md"), "utf8");
    await fs.mkdir(directory, { recursive: true });
    for (const filename of await fs.readdir(directory)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(filename)) continue;
      try {
        const job = JSON.parse(await fs.readFile(path.join(directory, filename), "utf8"));
        if (!validId(job.id)) continue;
        if (ACTIVE.has(job.status)) { job.status = "error"; job.error = "服务已重启，上次分析已中断，请重新生成"; job.finished_at = new Date().toISOString(); await atomicWrite(path.join(directory, filename), job); }
        jobs.set(job.id, job);
      } catch { /* One damaged report must not prevent all other reports from loading. */ }
    }
    loaded = true;
  }
  let initRequest;
  async function ensureInit() { initRequest ||= init().catch(error => { initRequest = null; throw error; }); return initRequest; }
  function summary(job) {
    return { id: job.id, code: job.code, name: job.name, date: job.date, focus: job.focus, status: job.status, stage: job.stage,
      created_at: job.created_at, finished_at: job.finished_at, error: job.error, model: job.model, reasoning_effort: job.reasoning_effort, snapshot_id: job.snapshot_id,
      prompt_version: job.prompt_version, knowledge_version: job.knowledge_version, content: job.content || "" };
  }
  async function persist(job) {
    const frozen = JSON.parse(JSON.stringify(job));
    const pending = (writes.get(job.id) || Promise.resolve()).catch(() => {}).then(() => atomicWrite(path.join(directory, `${job.id}.json`), frozen));
    writes.set(job.id, pending);
    try { await pending; } finally { if (writes.get(job.id) === pending) writes.delete(job.id); }
  }
  async function prune() {
    const completed = [...jobs.values()].filter(j => !ACTIVE.has(j.status)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const old of completed.slice(50)) { jobs.delete(old.id); await fs.rm(path.join(directory, `${old.id}.json`), { force: true }); }
  }
  async function context(params) {
    await ensureInit();
    const code = normalizeCode(params.code), date = params.date ? dateKey(params.date) : "";
    if (params.date && !date) throw makeError("分析日期无效");
    const days = Math.max(1, Math.min(5, Math.trunc(Number(params.days)) || 5));
    const requestKey = `${code}:${date}:${days}`;
    // Coalesce duplicate UI reads; never silently reuse an earlier snapshot for a new analysis.
    if (snapshotRequests.has(requestKey)) return snapshotRequests.get(requestKey);
    const request = (async () => {
      let raw = await (snapshotLoader ? snapshotLoader({ code, date, days }) : readSnapshot(path.join(root, "scripts/cb_ai_snapshot.py"), python, { code, date, days }));
      if (enrichmentLoader) {
        try { raw = mergeMetadata(raw, await enrichmentLoader({ code, date: raw.date })); }
        catch { raw = { ...raw, enrichment: { status: "failed" }, errors: [...(raw.errors || []), "已有个债资料接口本次不可用，正股、转股价与公告补充失败；保留本地数据"] }; }
      }
      const result = buildContext(raw, knowledge);
      const hash = crypto.createHash("sha256").update(JSON.stringify(result)).digest("hex");
      result.id = hash.slice(0, 32); result.context_sha256 = hash;
      snapshots.set(result.id, { at: Date.now(), context: result });
      while (snapshots.size > 12) snapshots.delete(snapshots.keys().next().value);
      return result;
    })().finally(() => snapshotRequests.delete(requestKey));
    snapshotRequests.set(requestKey, request); return request;
  }
  function promptFor(snapshot, focus) {
    return [
      "You are Finance Board's text-only convertible-bond research provider. The working directory is intentionally empty.",
      "Use only the supplied data. Do not inspect files, use tools, browse, or modify anything. Return only the final report.",
      `<system>\n${template}\n</system>`,
      `<user_focus>\n${JSON.stringify(focus || "未指定，按完整结构分析")}\n</user_focus>`,
      `<market_context_json>\n${JSON.stringify(modelContext(snapshot))}\n</market_context_json>`,
    ].join("\n\n");
  }
  async function getPrompt(id, focus = "") {
    await ensureInit();
    const snapshot = snapshots.get(id)?.context;
    if (!snapshot) throw makeError("该数据快照已过期，请重新读取数据", 404);
    return { prompt_version: PROMPT_VERSION, knowledge_version: knowledge.version, system: template, prompt: promptFor(snapshot, String(focus).slice(0, 2000)) };
  }
  async function start({ context_id: id, focus = "" } = {}) {
    await ensureInit();
    if (!validId(id)) throw makeError("请先读取分析数据");
    const record = snapshots.get(id);
    if (!record || Date.now() - record.at > 30 * 60_000) throw makeError("数据预览已过期，请重新读取后分析");
    if (record.context.quality.status === "unavailable") throw makeError("分析日没有可用价格，请选择有数据的交易日", 422);
    if (typeof focus !== "string" || focus.length > 2000) throw makeError("关注点最多2000字");
    const existing = [...jobs.values()].find(j => j.snapshot_id === id && j.focus === focus && ACTIVE.has(j.status));
    if (existing) return summary(existing);
    if ([...jobs.values()].filter(j => ACTIVE.has(j.status)).length >= 2) throw makeError("已有两份分析正在进行，请等待完成或取消", 429);
    const ready = await provider.status();
    if (!ready.configured) throw makeError(ready.message || "Codex 尚未登录", 503);
    // Recheck after asynchronous status so concurrent requests cannot exceed the limit.
    const duplicate = [...jobs.values()].find(j => j.snapshot_id === id && j.focus === focus && ACTIVE.has(j.status));
    if (duplicate) return summary(duplicate);
    if ([...jobs.values()].filter(j => ACTIVE.has(j.status)).length >= 2) throw makeError("已有两份分析正在进行", 429);
    const snapshot = record.context;
    const job = { id: crypto.randomUUID(), status: "queued", stage: "准备调用 Codex", code: snapshot.code, name: snapshot.name, date: snapshot.date,
      focus, snapshot_id: id, context: snapshot, context_sha256: snapshot.context_sha256, prompt_version: PROMPT_VERSION, knowledge_version: knowledge.version,
      model: ready.model, reasoning_effort: ready.reasoning_effort, provider: ready.provider, created_at: new Date().toISOString(),
      prompt: promptFor(snapshot, focus), content: "", error: "" };
    const controller = new AbortController(); controllers.set(job.id, controller); jobs.set(job.id, job);
    try { await persist(job); } catch (error) { jobs.delete(job.id); controllers.delete(job.id); throw error; }
    void run(job, controller);
    return summary(job);
  }
  async function run(job, controller) {
    try {
      if (controller.signal.aborted) return;
      job.status = "generating"; job.stage = "Codex 正在分析，完成后显示全文"; await persist(job);
      const result = await provider.generateText(job.prompt, { signal: controller.signal });
      if (controller.signal.aborted) return;
      job.raw_model_content = result.content; job.content = reportWithProvenance(result.content, job.context); job.model = result.model; job.status = "done"; job.stage = "分析完成，报告已保存";
    } catch (error) {
      if (controller.signal.aborted || error.name === "AbortError") { job.status = "cancelled"; job.stage = "分析已取消"; }
      else { job.status = "error"; job.stage = "分析未完成"; job.error = String(error.message || "模型调用失败").slice(0, 500); }
    } finally {
      if (controller.signal.aborted) { job.status = "cancelled"; job.stage = "分析已取消"; }
      job.finished_at = new Date().toISOString(); controllers.delete(job.id);
      try { await persist(job); await prune(); } catch { job.error = "报告文件保存失败，请下载本次正文留存"; }
    }
  }
  async function get(id, full = false) {
    await ensureInit();
    if (!validId(id) || !jobs.has(id)) throw makeError("分析记录不存在", 404);
    const job = jobs.get(id); return full ? { ...job } : summary(job);
  }
  async function cancel(id) {
    await ensureInit(); await get(id);
    const job = jobs.get(id);
    if (!ACTIVE.has(job.status)) return summary(job);
    job.status = "cancelled"; job.stage = "正在停止分析"; job.finished_at = new Date().toISOString(); controllers.get(id)?.abort(); await persist(job);
    return summary(job);
  }
  async function list() { await ensureInit(); return [...jobs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50).map(j => ({ ...summary(j), content: undefined })); }
  async function serviceStatus() { await ensureInit(); return { ...await provider.status(), prompt_version: PROMPT_VERSION, knowledge_version: knowledge.version, sources: knowledge.sources }; }
  function stop() { for (const controller of controllers.values()) controller.abort(); }
  return { context, getPrompt, start, get, cancel, list, status: serviceStatus, stop };
}

module.exports = { createCbAiService, readSnapshot, reportWithProvenance, reconcileReportFacts, PROMPT_VERSION };
