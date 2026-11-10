"use strict";

const $ = id => document.getElementById(id);
const escapeHtml = CbAiRender.escape;
const params = new URLSearchParams(location.search);
const ui = { context: null, job: null, provider: null, loading: false, dirty: false, saved: false, timer: null, prompt: null, loadId: 0, chartRows: {} };
const ACTIVE_STATES = new Set(["queued", "generating"]);
function n(value) { return value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value); }
function fmt(value, digits = 3) { const v = n(value); return v === null ? "—" : v.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function pct(value) { return n(value) === null ? "—" : `${value > 0 ? "+" : ""}${fmt(value, 2)}%`; }
function dateText(value) { return /^\d{8}$/.test(String(value)) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : String(value || "—"); }
function amount(value) { return n(value) === null ? "—" : value >= 1e8 ? `${fmt(value / 1e8, 2)}亿元` : `${fmt(value / 1e4, 1)}万元`; }
function modelLabel(value) {
  const effort = { none: "无", minimal: "最低", low: "低", medium: "中", high: "高", xhigh: "超高", max: "最高", ultra: "极高" }[value.reasoning_effort] || value.reasoning_effort;
  return `${value.model}${effort ? ` · 推理强度：${effort}` : ""}`;
}
function message(text, error = false) { $("pageStatus").textContent = text; $("pageStatus").classList.toggle("is-error", error); }
function codeValue(text) { const match = String(text).match(/\d{6}(?:\.(?:SH|SZ))?/i); return match ? match[0].toUpperCase() : text.trim(); }
async function api(route, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), route.startsWith("/context") ? 90_000 : 35_000);
  try {
    const response = await fetch(`/api/cb-ai${route}`, { ...options, headers: { "Content-Type": "application/json", ...options.headers }, signal: controller.signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "分析请求未完成");
    return result;
  } catch (error) { if (error.name === "AbortError") throw new Error("读取超时，请稍后再试"); throw error; }
  finally { clearTimeout(timer); }
}
function setButtons() {
  const busy = Boolean(ui.job && ACTIVE_STATES.has(ui.job.status));
  $("generateButton").disabled = ui.loading || busy || ui.dirty || ui.saved || !ui.provider?.configured || !ui.context || ui.context.quality.status === "unavailable";
  $("loadButton").disabled = ui.loading || busy;
  $("cancelButton").hidden = !busy;
  $("codeInput").disabled = busy || ui.loading; $("dateInput").disabled = busy || ui.loading; $("daysInput").disabled = busy || ui.loading; $("focusInput").disabled = busy;
  for (const chip of document.querySelectorAll("[data-focus]")) chip.disabled = busy;
  $("generationHint").textContent = busy ? "通常需要约1–3分钟；离开页面后任务继续" : ui.saved ? "查看历史快照；更新数据后可重新分析" : ui.dirty ? "选择已更改，请先更新分析数据" : ui.context ? "使用上方这份数据快照，点击才会调用模型" : "先读取数据，再生成报告";
}
function renderSources(sources) {
  $("theorySources").innerHTML = sources.map(s => `<div class="theory-source" id="theory-${escapeHtml(s.id)}"><div><b>${escapeHtml(s.id)}</b>${s.url ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)} ↗</a>` : escapeHtml(s.title)}</div><p>${escapeHtml(s.date || s.kind)}</p><details><summary>查看框架要点</summary>${s.principles.map(p => `<p>${escapeHtml(p)}</p>`).join("")}</details></div>`).join("");
}
function renderContext(context) {
  ui.context = context; ui.prompt = null;
  $("snapshotPanel").hidden = false;
  $("instrumentName").textContent = context.name;
  $("instrumentCode").textContent = context.code;
  $("instrumentPrice").textContent = fmt(context.price);
  $("quoteChange").textContent = pct(context.quote?.change_pct);
  $("quoteChange").className = context.quote?.change_pct > 0 ? "up" : context.quote?.change_pct < 0 ? "down" : "";
  $("detailLink").href = `./bond.html?${new URLSearchParams({ code: context.code, name: context.name, date: context.date, days: String(context.sessions.length || 1) })}`;
  $("snapshotStamp").textContent = `${context.snapshot_mode} · 行情截至 ${dateText(context.date)} ${context.as_of_time} · 参考位取该日之前的日线 · ${ui.saved ? "报告保存时的数据" : "不会随行情自动改变"}`;
  $("referenceCards").innerHTML = context.nodes.map(node => `<div class="reference-card" data-key="${escapeHtml(node.key)}"><div class="reference-label"><span>${escapeHtml(node.label)}</span><span>${node.distance_pct === null ? "" : `现价 ${pct(node.distance_pct)}`}</span></div><strong>${fmt(node.price)}</strong><small>${node.key.startsWith("ma") ? "此前已完成交易日收盘均值" : "此前五日高低点 · 非强度评级"}</small></div>`).join("");
  $("intradayRange").textContent = `${context.sessions.length}日`;
  const q = context.quality;
  $("qualityBadge").textContent = q.status === "unavailable" ? "暂无有效数据" : q.warnings.length ? "含数据限制" : "数据已备齐";
  $("qualityBadge").classList.toggle("is-limited", q.status !== "ready");
  $("coverageSummary").innerHTML = `<div class="coverage-row"><span>日 K</span><strong>${q.daily_count} 根</strong></div><div class="coverage-row"><span>原始日线 / 聚合补充</span><span>${q.official_daily_count} / ${q.aggregated_dates.length}</span></div><div class="coverage-row"><span>日期范围</span><span>${dateText(q.daily_start)} — ${dateText(q.daily_end)}</span></div>${context.sessions.map(s => `<div class="coverage-row"><span>${dateText(s.date)} 分时</span><span>${s.coverage.bars} 根 · ${fmt(s.coverage.coverage_pct, 1)}%</span></div>`).join("")}<div class="coverage-row"><span>正股同日报价</span><span>${context.stock.quote ? `${escapeHtml(context.stock.name)} ${fmt(context.stock.quote.price, 2)}` : "缺失"}</span></div>`;
  $("qualityWarnings").innerHTML = q.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("");
  $("valuationSummary").innerHTML = context.valuation.calculation_usable
    ? `正股 <strong>${fmt(context.stock.quote.price, 2)}</strong> 元（${pct(context.stock.quote.change_pct)}）<br />转股价 <strong>${fmt(context.valuation.conversion_price || context.terms.conversion_price, 2)}</strong> 元 · 转股价值 <strong>${fmt(context.valuation.conversion_value)}</strong> 元<br />溢价率 <strong>${pct(context.valuation.premium_rate_pct)}</strong><br />转股价依据日期 ${dateText(context.valuation.terms_date)}${context.valuation.conversion_price_reference?.verified_by_announcement ? " · 公告正文已核验" : ""}`
    : `转股估值：待核对<br />转股价观察：${dateText(context.valuation.terms_date)}`;
  const redeem = context.redeem, announcement = redeem?.announcement;
  const noticeLink = announcement?.url && /^https:\/\//.test(announcement.url) ? `<a href="${escapeHtml(announcement.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(announcement.title)} ↗</a>` : "";
  $("valuationSummary").innerHTML += `<br />${escapeHtml(redeem ? `强赎：${redeem.status || "观察中"} · ${redeem.progress || ""}（${dateText(redeem.trade_date)}）` : "强赎：缺少有效观察")}${noticeLink ? `<br />${noticeLink}` : ""}${context.stock.intraday?.length ? `<br />正股同日分时 ${context.stock.intraday.length} 根` : ""}`;
  const terms = context.terms || {};
  for (const [label, value] of [["上市日", terms.listing_date], ["转股开始日", terms.conversion_start_date], ["合同到期日", terms.maturity_date]]) {
    if (value) $("valuationSummary").innerHTML += `<br />${label} ${escapeHtml(dateText(value))}`;
  }
  if (terms.maturity_redemption_price) $("valuationSummary").innerHTML += `<br />到期赎回价 ${fmt(terms.maturity_redemption_price, 2)} 元/张`;
  if (terms.rating) $("valuationSummary").innerHTML += `<br />${escapeHtml(terms.rating_kind || "来源评级")} ${escapeHtml(terms.rating)}（${dateText(terms.as_of)}）`;
  const termNotice = terms.announcements?.[0];
  if (termNotice?.url && /^https:\/\//.test(termNotice.url)) $("valuationSummary").innerHTML += `<br /><a href="${escapeHtml(termNotice.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(termNotice.title)} ↗</a>`;
  $("redeemAlert").hidden = redeem?.risk !== "triggered";
  $("redeemAlert").innerHTML = redeem?.risk === "triggered" ? `<strong>${escapeHtml(redeem.status || "强赎风险")}</strong><span>${redeem.stop_trading_date ? `停止交易 ${dateText(redeem.stop_trading_date)} · ` : ""}${redeem.stop_conversion_date ? `停止转股 ${dateText(redeem.stop_conversion_date)} · ` : ""}${redeem.redeem_date ? `赎回 ${dateText(redeem.redeem_date)} · ` : ""}${redeem.redeem_price ? `赎回价 ${fmt(redeem.redeem_price)} 元/张` : "以公司公告为准"}</span>${noticeLink ? `<small>依据 ${dateText(announcement.notice_date)} 公告 · ${noticeLink}</small>` : ""}` : "";
  const current = context.sessions.find(s => s.date === context.date);
  const events = current?.observations || [];
  $("nodeObservations").innerHTML = events.length ? events.slice(-4).reverse().map(e => `<div class="node-event"><strong>${escapeHtml(e.confirmed_at)} · ${escapeHtml(e.type)}</strong>${escapeHtml(e.level_name)} ${fmt(e.level)}<br />${escapeHtml(e.amount_confirmation)}${e.amount_vs_prior20 !== null ? ` · ${fmt(e.amount_vs_prior20, 2)}倍` : ""}</div>`).join("") : "分析日没有满足当前连续分钟条件的节点事件。仍可结合图形和数据判断，不能据此断言没有机会。";
  renderSources(context.theory_sources);
  requestAnimationFrame(drawCharts); setButtons();
}
async function loadContext(event) {
  event?.preventDefault();
  if (ui.job && ACTIVE_STATES.has(ui.job.status)) return;
  const id = ++ui.loadId; ui.loading = true; ui.dirty = true; setButtons();
  message("正在读取日线、分时，并从已有接口补齐正股、转股价与强赎公告…");
  try {
    let code = codeValue($("codeInput").value);
    if (!/\d{6}/.test(code)) {
      const response = await fetch(`/api/search?q=${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("名称查询暂不可用，请输入六位转债代码");
      const result = await response.json();
      const matches = (result.results || []).filter(r => r.type === "Bond" || /转债/.test(r.name || ""));
      const exact = matches.find(r => r.name === code);
      if (!exact && matches.length !== 1) throw new Error("请从名称建议中选择一只转债，或输入六位代码");
      code = String((exact || matches[0]).code);
    }
    const query = new URLSearchParams({ code, days: $("daysInput").value });
    if ($("dateInput").value) query.set("date", $("dateInput").value.replaceAll("-", ""));
    const context = await api(`/context?${query}`);
    if (id !== ui.loadId) return;
    ui.saved = false; ui.dirty = false; ui.job = null;
    $("codeInput").value = `${context.name} ${context.code.slice(0, 6)}`;
    $("dateInput").value = dateText(context.date);
    $("reportContent").replaceChildren(); $("reportEmpty").hidden = false; $("reportToolbar").hidden = true; $("jobProgress").hidden = true;
    renderContext(context);
    message(`已备齐 ${context.quality.daily_count} 根日 K、${context.sessions.length} 日分时。请先核对数据范围，再生成报告。`);
    localStorage.setItem("finance.cb-ai.code", context.code);
    history.replaceState(null, "", `./bond-ai.html?${new URLSearchParams({ code: context.code, date: context.date, days: $("daysInput").value })}`);
  } catch (error) { message(error.message, true); }
  finally { if (id === ui.loadId) { ui.loading = false; setButtons(); } }
}
async function loadHistory() {
  try {
    const result = await api("/reports");
    $("historyList").replaceChildren();
    if (!result.reports.length) { $("historyList").textContent = "还没有分析记录。"; return; }
    for (const report of result.reports) {
      const button = document.createElement("button"); button.type = "button"; button.className = "history-item";
      const status = { done: "已完成", queued: "排队中", generating: "分析中", cancelled: "已取消", error: "未完成" }[report.status] || report.status;
      button.innerHTML = `<strong>${escapeHtml(report.name)} <span class="muted">${status}</span></strong><small>${dateText(report.date)} · ${escapeHtml(report.focus || "完整分析").slice(0, 60)}</small>`;
      button.addEventListener("click", () => openJob(report.id)); $("historyList").append(button);
    }
  } catch { $("historyList").textContent = "历史暂不可用，稍后点击刷新。"; }
}
function paintJob(job) {
  ui.job = job;
  const active = ACTIVE_STATES.has(job.status);
  $("jobProgress").hidden = !active;
  if (active) { $("reportContent").replaceChildren(); $("reportEmpty").hidden = true; $("reportToolbar").hidden = true; }
  $("jobStage").textContent = job.stage || "正在分析";
  const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(job.created_at)) / 1000));
  $("jobElapsed").textContent = `已用时 ${Math.floor(elapsed / 60)}分${elapsed % 60}秒 · ${modelLabel(job)} · 完成后显示全文`;
  if (job.status === "done") {
    $("reportContent").innerHTML = CbAiRender.markdown(job.content);
    $("reportEmpty").hidden = true; $("reportToolbar").hidden = false;
    $("reportStamp").textContent = `${dateText(job.date)} 数据 · ${modelLabel(job)} · 已保存`;
    message(job.error || "分析完成。报告和本次数据快照已保存，可从右侧历史再次打开。", Boolean(job.error));
  } else if (job.status === "error" || job.status === "cancelled") {
    $("reportContent").replaceChildren(); $("reportEmpty").hidden = false; $("reportToolbar").hidden = true;
    message(job.error || "本次分析已取消，可以重新生成。", job.status === "error");
  }
  setButtons();
}
function schedulePoll(id) {
  clearTimeout(ui.timer);
  ui.timer = setTimeout(async () => {
    try {
      const job = await api(`/jobs/${id}`);
      if (ui.job?.id !== id) return;
      paintJob(job);
      if (ACTIVE_STATES.has(job.status)) schedulePoll(id);
      else { localStorage.removeItem("finance.cb-ai.active-job"); await loadHistory(); }
    } catch (error) {
      if (ui.job?.id !== id) return;
      message(`暂时无法读取进度：${error.message}。正在重试，后台任务不会因此重新提交。`, true); schedulePoll(id);
    }
  }, document.hidden ? 6000 : 2000);
}
async function generate() {
  if (!ui.context || $("generateButton").disabled) return;
  $("generateButton").disabled = true;
  try {
    const job = await api("/analyze", { method: "POST", body: JSON.stringify({ context_id: ui.context.id, focus: $("focusInput").value.trim() }) });
    $("reportContent").replaceChildren(); $("reportEmpty").hidden = true; $("reportToolbar").hidden = true;
    localStorage.setItem("finance.cb-ai.active-job", job.id); paintJob(job); schedulePoll(job.id); void loadHistory();
    message("分析已开始，使用刚才预览的数据快照。可离开页面，稍后从历史查看。");
  } catch (error) { message(error.message, true); setButtons(); }
}
async function openJob(id) {
  const requestId = ++ui.loadId;
  try {
    const job = await api(`/jobs/${id}?full=1`);
    if (requestId !== ui.loadId) return;
    clearTimeout(ui.timer); ui.saved = true; ui.dirty = false; ui.loading = false;
    if (job.context) { renderContext(job.context); $("codeInput").value = `${job.name} ${job.code.slice(0, 6)}`; $("dateInput").value = dateText(job.date); $("daysInput").value = String(job.context.requested_days || 5); }
    $("focusInput").value = job.focus || ""; ui.prompt = { prompt: job.prompt, system: null };
    paintJob(job);
    if (ACTIVE_STATES.has(job.status)) schedulePoll(job.id);
    history.replaceState(null, "", `./bond-ai.html?job=${encodeURIComponent(id)}`);
  } catch (error) { if (requestId === ui.loadId) { ui.loading = false; message(error.message, true); setButtons(); } }
}
function download(filename, text, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function showRules(full = false) {
  try {
    if (ui.saved && ui.job) {
      const saved = await api(`/jobs/${ui.job.id}?full=1`);
      ui.prompt = { prompt: saved.prompt, system: saved.prompt?.match(/<system>\n([\s\S]*?)\n<\/system>/)?.[1] || saved.prompt };
    } else if (ui.context) ui.prompt = await api(`/prompt?${new URLSearchParams({ context_id: ui.context.id, focus: $("focusInput").value.trim() })}`);
    else { const response = await fetch("./docs/prompts/cb-ai-analysis.md"); if (!response.ok) throw new Error("规则暂不可用"); ui.prompt = { system: await response.text(), prompt: "请先读取一只转债的数据，才能查看完整输入。" }; }
    $("promptText").value = full ? ui.prompt.prompt : ui.prompt.system;
    if (!$("rulesDialog").open) $("rulesDialog").showModal();
  } catch (error) { message(error.message, true); }
}

function prepareCanvas(canvas, values) {
  const rect = canvas.getBoundingClientRect(), width = rect.width, height = rect.height;
  const dpr = window.devicePixelRatio || 1; canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  const finite = values.filter(v => n(v) !== null);
  if (!finite.length || width < 20) { ctx.fillStyle = "#81959d"; ctx.font = "12px sans-serif"; ctx.fillText("本次暂无可用图形数据", 20, 80); return null; }
  const minimum = Math.min(...finite), maximum = Math.max(...finite), pad = Math.max((maximum - minimum) * .15, maximum * .0015);
  const left = 48, right = width - 12, top = 14, bottom = height - 25;
  const low = minimum - pad, high = maximum + pad;
  const y = v => bottom - (v - low) / (high - low) * (bottom - top);
  ctx.font = "9px sans-serif"; ctx.fillStyle = "#8b9ba3"; ctx.strokeStyle = "#edf1f3"; ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) { const v = low + (high - low) * i / 3, p = y(v); ctx.beginPath(); ctx.moveTo(left, p); ctx.lineTo(right, p); ctx.stroke(); ctx.fillText(v.toFixed(1), 1, p + 3); }
  return { ctx, width, height, left, right, top, bottom, y };
}
function drawDaily() {
  const rows = ui.context?.daily.slice(-60) || [], canvas = $("dailyChart");
  const g = prepareCanvas(canvas, rows.flatMap(r => [r.low, r.high, r.ma5, r.ma10])); if (!g) return;
  const { ctx, left, right, bottom, y } = g, slot = (right - left) / Math.max(rows.length, 1), x = i => left + slot * (i + .5);
  rows.forEach((r, i) => { ctx.strokeStyle = ctx.fillStyle = r.close >= r.open ? "#d9635c" : "#3e9f86"; ctx.beginPath(); ctx.moveTo(x(i), y(r.low)); ctx.lineTo(x(i), y(r.high)); ctx.stroke(); ctx.fillRect(x(i) - Math.min(slot * .3, 4), Math.min(y(r.open), y(r.close)), Math.max(1, Math.min(slot * .6, 8)), Math.max(1, Math.abs(y(r.open) - y(r.close)))); });
  for (const [key, color] of [["ma5", "#c4a13d"], ["ma10", "#a179b4"]]) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.15; ctx.beginPath(); let begun = false;
    rows.forEach((r, i) => { if (n(r[key]) === null) { begun = false; return; } if (!begun) ctx.moveTo(x(i), y(r[key])); else ctx.lineTo(x(i), y(r[key])); begun = true; }); ctx.stroke();
  }
  ctx.fillStyle = "#899ba3"; for (const i of [0, Math.floor(rows.length / 2), rows.length - 1]) if (rows[i]) ctx.fillText(dateText(rows[i].date).slice(5), Math.min(right - 30, Math.max(left, x(i) - 15)), bottom + 19);
  ui.chartRows.daily = { rows, left, right };
}
function drawIntraday() {
  const sessions = ui.context?.sessions || [], rows = sessions.flatMap((s, day) => s.rows.map(r => ({ ...r, day, date: s.date })));
  const canvas = $("intradayChart"), g = prepareCanvas(canvas, rows.flatMap(r => [r.close, r.average_approx, r.purple])); if (!g) return;
  const { ctx, left, right, top, bottom, y } = g, dayWidth = (right - left) / Math.max(1, sessions.length);
  const slot = r => { const [h, m] = r.time.split(":").map(Number), minute = h * 60 + m; return minute <= 690 ? minute - 570 : minute - 780 + 121; };
  const x = r => left + dayWidth * (r.day + slot(r) / 242);
  sessions.forEach((s, i) => { if (i % 2) { ctx.fillStyle = "#7fba9c0b"; ctx.fillRect(left + i * dayWidth, top, dayWidth, bottom - top); } ctx.strokeStyle = "#dfe7e8"; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(left + i * dayWidth, top); ctx.lineTo(left + i * dayWidth, bottom); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = "#899ba3"; ctx.fillText(dateText(s.date).slice(5), left + i * dayWidth + dayWidth / 2 - 15, bottom + 19); });
  for (const [key, color, lineWidth] of [["average_approx", "#c4a13d", 1], ["purple", "#a179b4", 1], ["close", "#395b70", 1.35]]) {
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.beginPath(); let previous = null;
    for (const row of rows) { if (n(row[key]) === null) { previous = null; continue; } if (!previous || previous.day !== row.day || row.minute_ms - previous.minute_ms !== 60_000) ctx.moveTo(x(row), y(row[key])); else ctx.lineTo(x(row), y(row[key])); previous = row; } ctx.stroke();
  }
  ui.chartRows.intraday = { rows, x };
}
function drawCharts() { if (ui.context && !$("snapshotPanel").hidden) { drawDaily(); drawIntraday(); } }
$("dailyChart").addEventListener("pointermove", event => {
  const chart = ui.chartRows.daily; if (!chart?.rows.length) return; const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
  const index = Math.max(0, Math.min(chart.rows.length - 1, Math.floor((x - chart.left) / (chart.right - chart.left) * chart.rows.length))), r = chart.rows[index];
  $("dailyHint").textContent = `${dateText(r.date)} · 收 ${fmt(r.close)} · 高 ${fmt(r.high)} · 低 ${fmt(r.low)} · MA5 ${fmt(r.ma5)} · MA10 ${fmt(r.ma10)}${r.quality === "minute_aggregate" ? " · 分钟聚合" : ""}`;
});
$("intradayChart").addEventListener("pointermove", event => {
  const chart = ui.chartRows.intraday; if (!chart?.rows.length) return; const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
  const row = chart.rows.reduce((best, r) => Math.abs(chart.x(r) - x) < Math.abs(chart.x(best) - x) ? r : best);
  $("intradayHint").textContent = `${dateText(row.date)} ${row.time} · 价格 ${fmt(row.close)} · 均价≈ ${fmt(row.average_approx)} · 紫线 ${fmt(row.purple)} · 成交额 ${amount(row.amount_yuan)}`;
});

$("contextForm").addEventListener("submit", loadContext);
$("generateButton").addEventListener("click", generate);
$("cancelButton").addEventListener("click", async () => { if (!ui.job) return; try { const job = await api(`/jobs/${ui.job.id}`, { method: "DELETE" }); paintJob(job); clearTimeout(ui.timer); localStorage.removeItem("finance.cb-ai.active-job"); void loadHistory(); } catch (error) { message(error.message, true); } });
$("refreshHistoryButton").addEventListener("click", loadHistory);
$("rulesButton").addEventListener("click", () => showRules());
$("systemTab").addEventListener("click", () => showRules(false));
$("fullPromptTab").addEventListener("click", () => showRules(true));
$("closeRulesButton").addEventListener("click", () => $("rulesDialog").close());
$("downloadPromptButton").addEventListener("click", () => { if (ui.prompt) download(`转债分析完整输入-${ui.context?.code || "规则"}.txt`, ui.prompt.prompt || ui.prompt.system); });
$("downloadButton").addEventListener("click", () => { if (ui.job?.content) download(`${ui.job.name}-${ui.job.date}-AI分析.md`, ui.job.content, "text/markdown;charset=utf-8"); });
$("snapshotButton").addEventListener("click", () => { if (ui.context) download(`${ui.context.name}-${ui.context.date}-分析数据.json`, JSON.stringify(ui.context, null, 2), "application/json"); });
$("copyButton").addEventListener("click", async () => { try { await navigator.clipboard.writeText(ui.job?.content || ""); message("报告已复制。"); } catch { message("复制未完成，请使用下载报告。", true); } });
for (const button of document.querySelectorAll("[data-focus]")) button.addEventListener("click", () => { $("focusInput").value = button.dataset.focus; });
for (const id of ["codeInput", "dateInput", "daysInput"]) $(id).addEventListener("input", () => { ui.dirty = true; setButtons(); });
let searchTimer;
$("codeInput").addEventListener("input", () => {
  clearTimeout(searchTimer); const query = $("codeInput").value.trim(); if (query.length < 2) return;
  searchTimer = setTimeout(async () => {
    try { const result = await (await fetch(`/api/search?q=${encodeURIComponent(query)}`)).json(); if ($("codeInput").value.trim() !== query) return;
      const rows = Array.isArray(result) ? result : result.results || result.items || result.stocks || [];
      $("bondSuggestions").replaceChildren();
      for (const r of rows.filter(r => r.type === "Bond" || /转债/.test(r.name || ""))) { const option = document.createElement("option"); option.value = `${r.name} ${String(r.code || r.secid || "").replace(/^[01]\./, "")}`; $("bondSuggestions").append(option); }
    } catch { /* Direct code entry remains available. */ }
  }, 250);
});
window.addEventListener("resize", drawCharts);

async function initialize() {
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10); $("dateInput").max = today;
  $("codeInput").value = params.get("code") || localStorage.getItem("finance.cb-ai.code") || "123247";
  if (params.get("date")) $("dateInput").value = dateText(params.get("date"));
  $("daysInput").value = String(Math.max(1, Math.min(5, Number(params.get("days")) || 5)));
  const statusRequest = api("/status").then(status => { ui.provider = status; $("providerStatus").textContent = status.configured ? `● ${modelLabel(status)} · 本机 Codex` : status.message; $("providerStatus").classList.toggle("is-error", !status.configured); renderSources(status.sources); setButtons(); }).catch(error => { $("providerStatus").textContent = "AI 服务暂不可用"; $("providerStatus").classList.add("is-error"); message(error.message, true); });
  void loadHistory();
  if (params.get("job")) await openJob(params.get("job"));
  else {
    const activeId = !params.get("code") && localStorage.getItem("finance.cb-ai.active-job");
    if (activeId) { try { const job = await api(`/jobs/${activeId}`); if (ACTIVE_STATES.has(job.status)) await openJob(activeId); else { localStorage.removeItem("finance.cb-ai.active-job"); await loadContext(); } } catch { await loadContext(); } }
    else await loadContext();
  }
  await statusRequest;
}
void initialize();
