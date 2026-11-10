"use strict";

const state = {
  activeTab: "daily",
  daily: null,
  portfolio: null,
  replay: null,
  grid: null,
  paper: null,
  dailyStrategies: [],
  gridStrategies: [],
  paperFormSynced: false,
  paperTimer: null,
};

const ids = [
  "serviceStatus", "dailyTab", "replayTab", "gridTab", "paperTab", "dailyPanel", "replayPanel", "gridPanel", "paperPanel",
  "dailyForm", "dailyCode", "dailyStrategy", "dailyStart", "dailyEnd", "dailyCash",
  "dailyPosition", "dailyCommission", "dailySlippage", "runDailyButton", "dailyEmpty",
  "dailyResult", "dailyTitle", "dailyQuality", "dailyMetricCards", "dailyEquityCanvas",
  "dailyCompareCard", "dailyCompareBody", "dailyTradeCaption", "dailyTradeBody", "dailyNotes",
  "portfolioForm", "portfolioStrategy", "portfolioStart", "portfolioEnd", "portfolioCash",
  "portfolioTopN", "portfolioMaxPrice", "portfolioMaxPremium", "portfolioMaxBalance",
  "portfolioRebalance", "portfolioCommission", "portfolioSlippage", "runPortfolioButton",
  "portfolioEmpty", "portfolioResult", "portfolioTitle", "portfolioQuality",
  "portfolioMetricCards", "portfolioEquityCanvas", "portfolioRankCaption",
  "portfolioRankBody", "portfolioTradeCaption", "portfolioTradeBody", "portfolioNotes",
  "replayForm", "replayCode", "replayDate", "replayCash", "replayWinRate",
  "replayKellyFraction", "replayRiskCap", "replayPositionCap", "replayMaxStop",
  "replayTake1R", "replayTake2R", "replayCommission", "replaySlippage",
  "runReplayButton", "replayEmpty", "replayResult", "replayTitle", "replayQuality",
  "replayMetricCards", "auctionCard", "kellyCard", "intradayCanvas",
  "decisionTimeline", "replayFillCaption", "replayFillBody", "replayNotes",
  "gridForm", "gridCode", "gridDate", "gridCash", "gridInitialPosition",
  "gridPositionSize", "gridMaxPosition", "gridAtrPeriod", "gridAtrMultiplier",
  "gridMinSpacing", "gridMaxSpacing", "gridMaPeriod", "gridTrendThreshold",
  "gridCommission", "gridSlippage", "runGridButton", "gridEmpty", "gridResult",
  "gridTitle", "gridQuality", "gridMetricCards", "gridPriceCanvas", "gridEquityCanvas",
  "gridTradeCaption", "gridTradeBody", "gridNotes",
  "paperForm", "paperCodes", "paperStrategy", "paperCycleSeconds", "paperAllocation",
  "paperGridPositionSize", "paperGridMaxPosition", "paperGridAtrPeriod", "paperGridAtrMultiplier",
  "paperGridMinSpacing", "paperGridMaxSpacing", "paperGridMaPeriod", "paperGridTrendThreshold",
  "paperWinRate", "paperKellyFraction",
  "paperRiskCap", "paperPositionCap", "paperMaxStop", "paperTake1R", "paperTake2R",
  "paperCommission", "paperSlippage", "paperInitialCash", "paperResetButton",
  "paperStopButton", "paperCycleButton", "paperStartButton", "paperRuntimeDot",
  "paperRuntimeText", "paperCycleText", "paperMetricCards", "paperSource",
  "paperEquityCanvas", "manualPaperOrder", "manualCode", "manualSide", "manualQuantity",
  "positionCaption", "paperPositionBody", "fillCaption", "paperFillBody",
  "signalCaption", "paperSignalBody", "toast",
];
const nodes = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function number(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "--";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }) : "--";
}

function money(value) {
  if (value === null || value === undefined || value === "") return "--";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `¥${number(parsed, 2)}` : "--";
}

function percent(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "--";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${number(parsed * 100, digits)}%` : "--";
}

function dateText(value) {
  const text = String(value || "");
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  if (/^\d{8}\s/.test(text)) return `${dateText(text.slice(0, 8))} ${text.slice(9)}`;
  return text.replace("T", " ").replace(/\.\d{3}Z$/, "");
}

function toneClass(value) {
  const parsed = Number(value);
  return parsed > 0 ? "is-up" : parsed < 0 ? "is-down" : "";
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

function showToast(message, isError = false) {
  nodes.toast.textContent = message;
  nodes.toast.classList.toggle("is-error", isError);
  nodes.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { nodes.toast.hidden = true; }, 4200);
}

function bondCodeFromSuggestion(item) {
  const code = String(item?.code || "").replace(/\D/g, "").slice(-6);
  if (!/^(110|111|113|118|123|127|128)\d{3}$/.test(code)) return "";
  const market = String(item?.secid || "").startsWith("1.") || /^(110|111|113|118)/.test(code)
    ? "SH"
    : "SZ";
  return `${code}.${market}`;
}

function bondCodeValue(input) {
  return input.dataset.bondCode || input.value.trim();
}

function attachBondAutocomplete(input) {
  if (!input || input.dataset.bondAutocompleteBound === "1") return;
  const list = document.getElementById(`${input.id}Suggestions`);
  if (!list) return;
  input.dataset.bondAutocompleteBound = "1";
  let timer = null;
  let requestId = 0;
  let activeIndex = -1;
  let items = [];

  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    activeIndex = -1;
  };

  const setActive = (index) => {
    const options = [...list.querySelectorAll("[role='option']")];
    if (!options.length) return;
    activeIndex = (index + options.length) % options.length;
    options.forEach((option, optionIndex) => {
      const selected = optionIndex === activeIndex;
      option.classList.toggle("is-active", selected);
      option.setAttribute("aria-selected", String(selected));
      if (selected) {
        input.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
      }
    });
  };

  const select = (item) => {
    const code = bondCodeFromSuggestion(item);
    if (!code) return;
    input.value = code;
    input.dataset.bondCode = code;
    close();
    input.focus();
  };

  const render = (message = "") => {
    list.replaceChildren();
    activeIndex = -1;
    if (!input.value.trim()) {
      close();
      return;
    }
    if (!items.length) {
      const empty = document.createElement("span");
      empty.className = "bond-code-suggestion-empty";
      empty.textContent = message || "没有匹配的可转债";
      list.append(empty);
    } else {
      items.forEach((item, index) => {
        const code = bondCodeFromSuggestion(item);
        const option = document.createElement("button");
        option.id = `${input.id}Suggestion${index}`;
        option.className = "bond-code-suggestion";
        option.type = "button";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        const name = document.createElement("strong");
        name.textContent = item.name || code;
        const meta = document.createElement("span");
        meta.textContent = `${code} · ${item.market || "转债"}`;
        option.append(name, meta);
        option.addEventListener("mousedown", (event) => event.preventDefault());
        option.addEventListener("click", () => select(item));
        list.append(option);
      });
    }
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const search = () => {
    window.clearTimeout(timer);
    delete input.dataset.bondCode;
    const keyword = input.value.trim();
    requestId += 1;
    if (!keyword) {
      items = [];
      close();
      return;
    }
    const currentRequest = requestId;
    timer = window.setTimeout(async () => {
      items = [];
      render("正在搜索转债…");
      try {
        const payload = await fetchJson(`/api/search?q=${encodeURIComponent(keyword)}`);
        if (currentRequest !== requestId) return;
        items = (Array.isArray(payload?.results) ? payload.results : [])
          .filter((item) => item?.type === "Bond" || bondCodeFromSuggestion(item))
          .filter((item) => bondCodeFromSuggestion(item))
          .slice(0, 8);
        const normalizedKeyword = keyword.replace(/\s+/g, "").toLowerCase();
        const exact = items.find((item) => item.name?.replace(/\s+/g, "").toLowerCase() === normalizedKeyword)
          || items.find((item) => bondCodeFromSuggestion(item).toLowerCase() === normalizedKeyword);
        const resolved = exact || (items.length === 1 ? items[0] : null);
        if (resolved) input.dataset.bondCode = bondCodeFromSuggestion(resolved);
        render();
      } catch (error) {
        if (currentRequest !== requestId) return;
        render(error.message || "转债联想暂不可用");
      }
    }, 180);
  };

  input.addEventListener("input", search);
  input.addEventListener("keydown", (event) => {
    if (list.hidden) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(activeIndex - 1);
    } else if (event.key === "Enter" && items.length && (activeIndex >= 0 || items.length === 1)) {
      event.preventDefault();
      select(items[activeIndex >= 0 ? activeIndex : 0]);
    } else if (event.key === "Escape") {
      close();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!list.contains(event.target) && event.target !== input) close();
  });
}

function metricCard(label, value, note, tone = "") {
  return `<article class="metric-card ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note || "")}</small></article>`;
}

function setupCanvas(canvas, minimumWidth = 420) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(minimumWidth, Math.floor(rect.width || canvas.parentElement?.clientWidth || 900));
  const height = Math.max(
    1,
    Number(canvas.dataset.logicalHeight)
      || Math.floor(rect.height)
      || Number(canvas.getAttribute("height"))
      || 280,
  );
  canvas.dataset.logicalHeight = String(height);
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * scale);
  canvas.height = Math.floor(height * scale);
  const context = canvas.getContext("2d");
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

function drawLineChart(canvas, points, color = "#b849ba") {
  const { context, width, height } = setupCanvas(canvas);
  const rows = (points || []).filter((point) => Number.isFinite(Number(point.value)));
  if (!rows.length) {
    context.fillStyle = "#788078";
    context.font = "12px Arial";
    context.fillText("暂无权益数据", 16, 26);
    return;
  }
  const values = rows.map((point) => Number(point.value));
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  if (maximum === minimum) { minimum *= 0.999; maximum *= 1.001; }
  const padding = { left: 64, right: 18, top: 18, bottom: 28 };
  const x = (index) => padding.left + index / Math.max(1, rows.length - 1) * (width - padding.left - padding.right);
  const y = (value) => padding.top + (maximum - value) / (maximum - minimum) * (height - padding.top - padding.bottom);
  context.strokeStyle = "#e2e7dc";
  context.fillStyle = "#748075";
  context.font = "10px Arial";
  for (let index = 0; index <= 4; index += 1) {
    const lineY = padding.top + index / 4 * (height - padding.top - padding.bottom);
    const value = maximum - index / 4 * (maximum - minimum);
    context.beginPath(); context.moveTo(padding.left, lineY); context.lineTo(width - padding.right, lineY); context.stroke();
    context.fillText(number(value, 2), 5, lineY + 3);
  }
  context.beginPath(); context.strokeStyle = color; context.lineWidth = 2;
  rows.forEach((point, index) => { const px = x(index); const py = y(Number(point.value)); if (index) context.lineTo(px, py); else context.moveTo(px, py); });
  context.stroke();
  context.fillText(dateText(rows[0].label), padding.left, height - 7);
  context.textAlign = "right"; context.fillText(dateText(rows.at(-1).label), width - padding.right, height - 7); context.textAlign = "left";
}

function drawDailyEquity(result) {
  const selected = result.mode === "strategy_comparison" ? result.best : result;
  const strategyRows = selected?.equity_curve || [];
  const benchmarkRows = selected?.benchmark_curve || [];
  const canvas = nodes.dailyEquityCanvas;
  const { context, width, height } = setupCanvas(canvas, 560);
  if (!strategyRows.length) {
    context.fillStyle = "#788078";
    context.fillText("暂无日线回测权益数据", 16, 26);
    return;
  }
  const initialValue = Number(selected?.params?.initial_cash)
    || Number(strategyRows[0]?.total_asset)
    || 1;
  const strategyPoints = strategyRows.map((row) => ({ label: row.date, value: Number(row.total_asset) / initialValue - 1 }));
  const benchmarkPoints = benchmarkRows.map((row) => ({ label: row.date, value: Number(row.nav) / initialValue - 1 }));
  const values = [...strategyPoints, ...benchmarkPoints].map((row) => row.value).filter(Number.isFinite);
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  if (maximum === minimum) { minimum *= 0.999; maximum *= 1.001; }
  const padding = { left: 64, right: 18, top: 24, bottom: 30 };
  const x = (index, length) => padding.left + index / Math.max(1, length - 1) * (width - padding.left - padding.right);
  const y = (value) => padding.top + (maximum - value) / (maximum - minimum) * (height - padding.top - padding.bottom);
  context.font = "10px Arial";
  for (let index = 0; index <= 4; index += 1) {
    const lineY = padding.top + index / 4 * (height - padding.top - padding.bottom);
    context.strokeStyle = "#e2e7dc";
    context.beginPath(); context.moveTo(padding.left, lineY); context.lineTo(width - padding.right, lineY); context.stroke();
    context.fillStyle = "#748075";
    context.fillText(percent(maximum - index / 4 * (maximum - minimum), 1), 5, lineY + 3);
  }
  const line = (rows, color) => {
    if (!rows.length) return;
    context.beginPath(); context.strokeStyle = color; context.lineWidth = 2;
    rows.forEach((row, index) => { const px = x(index, rows.length); const py = y(row.value); if (index) context.lineTo(px, py); else context.moveTo(px, py); });
    context.stroke();
  };
  line(benchmarkPoints, "#9ba598");
  line(strategyPoints, "#b849ba");
  context.fillStyle = "#b849ba"; context.fillText("策略", padding.left, 12);
  context.fillStyle = "#7a8478"; context.fillText("基准", padding.left + 42, 12);
  context.fillText(dateText(strategyPoints[0].label), padding.left, height - 7);
  context.textAlign = "right"; context.fillText(dateText(strategyPoints.at(-1).label), width - padding.right, height - 7); context.textAlign = "left";
}

function dailyPayload() {
  return {
    code: bondCodeValue(nodes.dailyCode),
    strategy: nodes.dailyStrategy.value,
    compare: nodes.dailyStrategy.value === "all",
    start_date: nodes.dailyStart.value || undefined,
    end_date: nodes.dailyEnd.value || undefined,
    initial_cash: Number(nodes.dailyCash.value),
    position_pct: Number(nodes.dailyPosition.value),
    commission_rate: Number(nodes.dailyCommission.value) / 10_000,
    slippage_bps: Number(nodes.dailySlippage.value),
    count: 500,
    completed_bars_only: true,
  };
}

function renderDaily(result) {
  state.daily = result;
  nodes.dailyEmpty.hidden = true;
  nodes.dailyResult.hidden = false;
  const comparison = result.mode === "strategy_comparison";
  const selected = comparison ? result.best : result;
  const metrics = selected?.metrics || {};
  const quality = result.data_quality || {};
  nodes.dailyTitle.textContent = comparison
    ? `${result.code} · 六策略对比`
    : `${result.code} · ${result.strategy_label}`;
  nodes.dailyQuality.textContent = `${metrics.trading_days || 0}个回测交易日 · ${selected?.params?.start_date || "--"} 至 ${selected?.params?.end_date || "--"}（源数据${quality.returned_count || 0}根）`;
  nodes.dailyMetricCards.innerHTML = [
    metricCard("总收益", percent(metrics.total_return), `净利润 ${money(metrics.net_profit)}`, toneClass(metrics.total_return)),
    metricCard("年化收益", percent(metrics.annual_return), `最终资产 ${money(metrics.final_value)}`, toneClass(metrics.annual_return)),
    metricCard("最大回撤", percent(metrics.max_drawdown), `${metrics.max_drawdown_days || 0}个交易日`, "is-down"),
    metricCard("夏普比率", number(metrics.sharpe_ratio, 2), `Calmar ${number(metrics.calmar_ratio, 2)}`),
    metricCard("胜率", percent(metrics.win_rate), `${metrics.closed_trades || 0}笔平仓`),
    metricCard("策略", selected?.strategy_label || "--", comparison ? "当前排名第一" : `${metrics.trading_days || 0}个交易日`),
  ].join("");
  nodes.dailyCompareCard.hidden = !comparison;
  nodes.dailyCompareBody.innerHTML = comparison ? (result.results || []).map((item) => `<tr><td><strong>${escapeHtml(item.strategy_label)}</strong></td><td class="${toneClass(item.metrics.total_return)}">${percent(item.metrics.total_return)}</td><td>${percent(item.metrics.annual_return)}</td><td class="is-down">${percent(item.metrics.max_drawdown)}</td><td>${number(item.metrics.sharpe_ratio, 2)}</td><td>${number(item.trades, 0)}</td></tr>`).join("") : "";
  const trades = comparison ? [] : (result.trades || []);
  nodes.dailyTradeCaption.textContent = comparison ? "选择单一策略查看逐笔成交" : `${trades.length}笔`;
  nodes.dailyTradeBody.innerHTML = trades.length ? trades.map((trade) => `<tr><td>${escapeHtml(dateText(trade.date))}</td><td class="${trade.side === "buy" ? "is-up" : "is-down"}">${trade.side === "buy" ? "买入" : "卖出"}</td><td>${number(trade.price, 3)}</td><td>${number(trade.quantity, 0)}</td><td>${money(trade.fee)}</td><td class="${toneClass(trade.realized_pnl)}">${money(trade.realized_pnl)}</td><td>${escapeHtml(trade.reason)}</td></tr>`).join("") : `<tr><td class="empty-cell" colspan="7">${comparison ? "策略对比模式不展开逐笔；选择一个策略即可查看" : "回测区间没有成交"}</td></tr>`;
  const backfill = quality.latest_day_auto_backfill || {};
  nodes.dailyNotes.innerHTML = [
    result.execution_model || selected?.execution_model || "日线收盘出信号，下一根日K开盘成交。",
    result.fee_model || "可转债双边佣金，无印花税。",
    `数据源：${quality.source || "QMT"}。本地分钟聚合自动补缺 ${quality.auto_local_reference_fill_count || 0} 个交易日。`,
    backfill.attempted ? `最近交易日日K缺口已调用分钟补数任务：${backfill.status}${backfill.error ? `（${backfill.error}）` : ""}。` : "最近交易日数据无需额外补齐。",
    quality.history_is_stale ? `日K仍未补到预期交易日 ${quality.expected_completed_date}，结果标记为不完整。` : "日K已覆盖到预期的最近已完成交易日。",
    result.boundary,
    "历史统计不等于未来收益，不构成投资建议。",
  ].filter(Boolean).map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  drawDailyEquity(result);
}

async function runDaily() {
  nodes.runDailyButton.disabled = true;
  nodes.serviceStatus.textContent = "正在读取并自动补齐日K数据…";
  try {
    const result = await postJson("/api/cb-quant/backtest", dailyPayload());
    renderDaily(result);
    localStorage.setItem("finance.quant.daily.code", bondCodeValue(nodes.dailyCode));
    localStorage.setItem("finance.quant.daily.strategy", nodes.dailyStrategy.value);
    nodes.serviceStatus.textContent = `日线回测完成 · ${result.code}`;
  } catch (error) {
    nodes.serviceStatus.textContent = `日线回测失败 · ${error.message}`;
    showToast(error.message, true);
  } finally {
    nodes.runDailyButton.disabled = false;
  }
}

function portfolioPayload() {
  return {
    strategy: nodes.portfolioStrategy.value,
    start_date: nodes.portfolioStart.value,
    end_date: nodes.portfolioEnd.value,
    initial_cash: Number(nodes.portfolioCash.value),
    top_n: Number(nodes.portfolioTopN.value),
    max_price: Number(nodes.portfolioMaxPrice.value),
    max_premium: Number(nodes.portfolioMaxPremium.value),
    max_balance_billion: Number(nodes.portfolioMaxBalance.value),
    rebalance_every: Number(nodes.portfolioRebalance.value),
    commission_rate: Number(nodes.portfolioCommission.value) / 10_000,
    slippage_bps: Number(nodes.portfolioSlippage.value),
  };
}

function renderPortfolio(result) {
  state.portfolio = result;
  nodes.portfolioEmpty.hidden = true;
  nodes.portfolioResult.hidden = false;
  const metrics = result.metrics || {};
  const quality = result.data_quality || {};
  nodes.portfolioTitle.textContent = `${result.strategy_label} · 持有${result.params?.top_n || 0}只`;
  nodes.portfolioQuality.textContent = `${quality.strategy_dates || 0}个历史截面 · ${result.params?.start_date || "--"} 至 ${result.params?.end_date || "--"} · ${quality.strategy_candidate_codes || 0}只候选`;
  nodes.portfolioMetricCards.innerHTML = [
    metricCard("总收益", percent(metrics.total_return), `净利润 ${money(metrics.net_profit)}`, toneClass(metrics.total_return)),
    metricCard("年化收益", percent(metrics.annual_return), `最终资产 ${money(metrics.final_value)}`, toneClass(metrics.annual_return)),
    metricCard("最大回撤", percent(metrics.max_drawdown), `${metrics.max_drawdown_days || 0}个交易日`, "is-down"),
    metricCard("夏普比率", number(metrics.sharpe_ratio, 2), `Calmar ${number(metrics.calmar_ratio, 2)}`),
    metricCard("平仓胜率", percent(metrics.win_rate), `${metrics.closed_trades || 0}笔卖出`),
    metricCard("换手倍数", number(metrics.turnover, 2), `费用 ${money(metrics.total_fees)}`),
    metricCard("期末持仓", `${metrics.final_position_count || 0}只`, `${metrics.trade_count || 0}笔成交`),
  ].join("");
  drawLineChart(nodes.portfolioEquityCanvas, (result.equity_curve || []).map((row) => ({
    label: row.date,
    value: row.total_asset,
  })), "#b849ba");

  const rankings = result.latest_ranking || [];
  nodes.portfolioRankCaption.textContent = `${dateText(result.latest_ranking_date)} · ${rankings.length}只`;
  nodes.portfolioRankBody.innerHTML = rankings.length ? rankings.map((row) => `<tr><td>${number(row.rank, 0)}</td><td><strong>${escapeHtml(row.name)}</strong><br><small>${escapeHtml(row.code)}</small></td><td>${number(row.close, 3)}</td><td>${percent(Number(row.premium_rate) / 100)}</td><td>${number(row.remaining_balance_billion, 2)}</td><td>${number(row.ma_score, 0)}</td><td class="${toneClass(row.momentum_5d)}">${percent(Number(row.momentum_5d) / 100)}</td><td>${number(row.score, 2)}</td></tr>`).join("") : `<tr><td class="empty-cell" colspan="8">最新截面没有满足严格字段条件的候选</td></tr>`;

  const trades = result.trades || [];
  nodes.portfolioTradeCaption.textContent = `${trades.length}笔`;
  nodes.portfolioTradeBody.innerHTML = trades.length ? trades.map((trade) => `<tr><td>${escapeHtml(dateText(trade.date))}</td><td><strong>${escapeHtml(trade.name || trade.code)}</strong><br><small>${escapeHtml(trade.code)}</small></td><td class="${trade.side === "buy" ? "is-up" : "is-down"}">${trade.side === "buy" ? "买入" : "卖出"}</td><td>${number(trade.price, 3)}</td><td>${number(trade.quantity, 0)}</td><td>${money(trade.fee)}</td><td class="${toneClass(trade.realized_pnl)}">${money(trade.realized_pnl)}</td><td>${escapeHtml(trade.reason)}</td></tr>`).join("") : `<tr><td class="empty-cell" colspan="8">回测区间没有成交</td></tr>`;

  const balanceCoverage = quality.requested_codes
    ? quality.historical_balance_codes / quality.requested_codes
    : 0;
  const eastmoney = quality.eastmoney_kline || {};
  nodes.portfolioNotes.innerHTML = [
    result.execution_model,
    result.fee_model,
    `历史因子：${quality.factor_rows || 0}行、${quality.requested_codes || 0}只；历史余额可用 ${quality.historical_balance_codes || 0}只（${percent(balanceCoverage)}）。`,
    `日K优先从 QMT/QMT 读取 ${quality.qmt_returned_codes || 0}只、${quality.qmt_returned_rows || 0}行；东方财富备用源实际补缺 ${quality.eastmoney_fallback_codes || 0}只、${quality.eastmoney_fallback_rows || 0}行。`,
    `本地缓存：因子命中${quality.factor_cache_hits || 0}个月、新下载${quality.factor_cache_misses || 0}个月；日K命中${eastmoney.kline_cache_hits || 0}只、新下载${eastmoney.kline_cache_misses || 0}只。`,
    quality.strict_factor_policy,
    quality.premium_policy,
    quality.balance_policy,
    quality.event_limit,
    result.boundary,
    "历史统计不等于未来收益，不构成投资建议。",
  ].filter(Boolean).map((note) => `<li>${escapeHtml(note)}</li>`).join("");
}

async function runPortfolio() {
  nodes.runPortfolioButton.disabled = true;
  nodes.runPortfolioButton.textContent = "正在补齐全市场历史数据…";
  nodes.serviceStatus.textContent = "正在读取历史转债截面，并优先用 QMT/QMT 补齐候选券日K…";
  try {
    const result = await postJson("/api/cb-quant/portfolio-backtest", portfolioPayload());
    renderPortfolio(result);
    nodes.serviceStatus.textContent = `组合回测完成 · ${result.strategy_label}`;
  } catch (error) {
    nodes.serviceStatus.textContent = `组合回测失败 · ${error.message}`;
    showToast(error.message, true);
  } finally {
    nodes.runPortfolioButton.disabled = false;
    nodes.runPortfolioButton.textContent = "运行组合回测并自动补数";
  }
}

function drawIntraday(result) {
  const canvas = nodes.intradayCanvas;
  const { context, width, height } = setupCanvas(canvas, 560);
  const rows = (result.chart_rows || []).filter((row) => Number.isFinite(Number(row.close)));
  if (!rows.length) return;
  const plan = result.trade_plan || {};
  const riskLines = [plan.stop_price, plan.take1_price, plan.take2_price].map(Number).filter(Number.isFinite);
  const values = rows.flatMap((row) => [row.close, row.purple, row.intraday_average].map(Number).filter(Number.isFinite)).concat(riskLines);
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  const margin = Math.max(0.2, (maximum - minimum) * 0.06);
  minimum -= margin; maximum += margin;
  const padding = { left: 62, right: 84, top: 22, bottom: 34 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const x = (index) => padding.left + index / Math.max(1, rows.length - 1) * innerWidth;
  const y = (value) => padding.top + (maximum - value) / (maximum - minimum) * innerHeight;
  context.font = "10px Arial";
  for (let index = 0; index <= 5; index += 1) {
    const lineY = padding.top + index / 5 * innerHeight;
    const value = maximum - index / 5 * (maximum - minimum);
    context.strokeStyle = "#e1e7dc"; context.beginPath(); context.moveTo(padding.left, lineY); context.lineTo(width - padding.right, lineY); context.stroke();
    context.fillStyle = "#738077"; context.fillText(number(value, 2), 6, lineY + 3);
  }
  const line = (key, color, widthValue) => {
    context.beginPath(); context.strokeStyle = color; context.lineWidth = widthValue;
    let started = false;
    rows.forEach((row, index) => {
      const value = Number(row[key]); if (!Number.isFinite(value)) return;
      if (started) context.lineTo(x(index), y(value)); else { context.moveTo(x(index), y(value)); started = true; }
    });
    context.stroke();
  };
  line("intraday_average", "#57a99a", 1.4);
  line("purple", "#b849ba", 1.8);
  line("close", "#18342a", 2);
  const horizontal = (value, color, label) => {
    if (!Number.isFinite(Number(value))) return;
    const lineY = y(Number(value));
    context.setLineDash([5, 4]); context.strokeStyle = color; context.lineWidth = 1;
    context.beginPath(); context.moveTo(padding.left, lineY); context.lineTo(width - padding.right, lineY); context.stroke(); context.setLineDash([]);
    context.fillStyle = color; context.fillText(`${label} ${number(value, 3)}`, width - padding.right + 5, lineY + 3);
  };
  horizontal(plan.stop_price, "#b23e2f", "止损");
  horizontal(plan.take1_price, "#d08b1d", "1R");
  horizontal(plan.take2_price, "#228b6b", `${number(plan.take2_r, 1)}R`);
  for (const fill of result.fills || []) {
    const index = rows.findIndex((row) => row.time === String(fill.time).slice(0, 5));
    if (index < 0) continue;
    const px = x(index); const py = y(Number(fill.price));
    context.beginPath(); context.fillStyle = fill.side === "buy" ? "#d84b3f" : "#23886b"; context.arc(px, py, 4.5, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#24332c"; context.fillText(fill.side === "buy" ? "买" : "卖", px + 6, py - 6);
  }
  context.fillStyle = "#738077"; context.fillText(rows[0].time, padding.left, height - 9);
  context.textAlign = "center"; context.fillText("11:30 / 13:00", padding.left + innerWidth / 2, height - 9);
  context.textAlign = "right"; context.fillText(rows.at(-1).time, width - padding.right, height - 9); context.textAlign = "left";
}

function replayPayload() {
  return {
    code: bondCodeValue(nodes.replayCode),
    date: nodes.replayDate.value,
    initial_cash: Number(nodes.replayCash.value),
    win_rate: Number(nodes.replayWinRate.value) / 100,
    kelly_discount: Number(nodes.replayKellyFraction.value) / 100,
    max_risk_pct: Number(nodes.replayRiskCap.value) / 100,
    max_position_pct: Number(nodes.replayPositionCap.value) / 100,
    max_stop_pct: Number(nodes.replayMaxStop.value) / 100,
    take1_r: Number(nodes.replayTake1R.value),
    take2_r: Number(nodes.replayTake2R.value),
    commission_rate: Number(nodes.replayCommission.value) / 10_000,
    slippage_bps: Number(nodes.replaySlippage.value),
  };
}

function renderReplay(result) {
  state.replay = result;
  nodes.replayEmpty.hidden = true;
  nodes.replayResult.hidden = false;
  const metrics = result.metrics || {};
  const plan = result.trade_plan || {};
  const kelly = plan.kelly || {};
  const quality = result.data_quality || {};
  nodes.replayTitle.textContent = `${result.name || result.code} · ${dateText(result.trading_date)}`;
  nodes.replayQuality.textContent = `${quality.minute_bar_count || 0}根分钟 · ${quality.event_count || 0}条事件 · 竞价${result.auction?.quality === "amount_confirmed_0925_l1" ? "完整" : "缺失"}`;
  nodes.replayMetricCards.innerHTML = [
    metricCard("净收益", money(metrics.net_profit), `模拟资金 ${money(metrics.initial_cash)}`, toneClass(metrics.net_profit)),
    metricCard("账户收益", percent(metrics.total_return), `仓位收益 ${percent(metrics.position_return)}`, toneClass(metrics.total_return)),
    metricCard("成本后 R", number(metrics.r_multiple_after_cost, 2), `计划风险 ${money(plan.planned_risk_amount)}`, toneClass(metrics.r_multiple_after_cost)),
    metricCard("模拟仓位", `${number(plan.quantity, 0)}张`, `名义金额 ${money(plan.notional)}`),
    metricCard("最大有利", percent(metrics.mfe_pct), `最大不利 ${percent(metrics.mae_pct)}`, toneClass(metrics.mfe_pct)),
    metricCard("交易费用", money(metrics.total_fees), `${(result.fills || []).length}笔模拟成交`),
  ].join("");
  const auction = result.auction || {};
  nodes.auctionCard.innerHTML = `
    <p>09:25 竞价状态</p><h3>${escapeHtml(auction.label || "竞价不可用")}</h3>
    <dl><div><dt>转债</dt><dd>${number(auction.bond?.price, 3)} / ${number(auction.bond?.change_pct, 2)}%</dd></div>
    <div><dt>正股</dt><dd>${number(auction.stock?.price, 2)} / ${number(auction.stock?.change_pct, 2)}%</dd></div>
    <div><dt>债股差</dt><dd>${number(auction.lead_gap_pct, 2)}个百分点</dd></div></dl>
    <small>仅采纳09:25带成交额确认的样本；此前虚拟撮合价不当作入场价。</small>`;
  nodes.kellyCard.innerHTML = `
    <p>凯利风险预算</p><h3>${percent(kelly.position_fraction)} 仓位</h3>
    <dl><div><dt>完整凯利</dt><dd>${percent(kelly.full_kelly_fraction)}</dd></div>
    <div><dt>折扣凯利</dt><dd>${percent(kelly.discounted_kelly_fraction)}</dd></div>
    <div><dt>实际风险上限</dt><dd>${percent(kelly.risk_budget_fraction)}</dd></div></dl>
    <small>${escapeHtml(kelly.calibration_quality === "historical_sample" ? "已有历史样本校准" : "胜率仍是人工先验，样本不足；已受风险与仓位双重上限约束")}</small>`;
  nodes.decisionTimeline.innerHTML = (result.timeline || []).map((item) => `
    <article><time>${escapeHtml(item.time)}</time><strong>${escapeHtml(item.state)}</strong><span>${escapeHtml(item.title)}</span></article>`).join("") || "<p>当日没有形成可交易组合信号。</p>";
  const fills = result.fills || [];
  nodes.replayFillCaption.textContent = `${fills.length}笔 · ${result.entry_signal ? `组合分 ${result.entry_signal.score}` : "无入场"}`;
  nodes.replayFillBody.innerHTML = fills.length ? fills.map((fill) => `
    <tr><td>${escapeHtml(fill.time)}</td><td class="${fill.side === "buy" ? "is-up" : "is-down"}">${fill.side === "buy" ? "买入" : "卖出"}</td>
    <td>${number(fill.price, 3)}</td><td>${number(fill.quantity, 0)}</td><td>${money(fill.fee)}</td>
    <td class="${toneClass(fill.realized_pnl)}">${money(fill.realized_pnl)}</td><td>${escapeHtml(fill.reason)}</td></tr>`).join("")
    : '<tr><td class="empty-cell" colspan="7">竞价或盘中组合门槛未通过，没有模拟成交</td></tr>';
  nodes.replayNotes.innerHTML = [
    result.execution_model,
    result.fee_model,
    quality.auto_backfill?.attempted
      ? `分钟数据不完整时已自动调用QMT补数任务：${quality.auto_backfill.status}${quality.auto_backfill.error ? `（${quality.auto_backfill.error}）` : ""}。`
      : "分钟数据完整，本次无需自动补数。",
    quality.missing_data?.monitor_events === "monitor_generated_events_cannot_be_reconstructed_from_market_history"
      ? "主力监控事件属于项目实时生成数据；若当时监控未运行，普通历史行情不能事后原样重建。"
      : null,
    quality.missing_data?.auction === "historical_auction_snapshot_unavailable"
      ? "该日竞价快照未留存；分钟补数不能冒充09:25竞价原始快照。"
      : null,
    quality.l1_boundary,
    `止损 ${plan.stop_price ? number(plan.stop_price, 3) : "未生成"}，第一止盈 ${plan.take1_price ? number(plan.take1_price, 3) : "未生成"}，第二止盈 ${plan.take2_price ? number(plan.take2_price, 3) : "未生成"}。`,
    kelly.calibration_quality === "manual_assumption_insufficient_sample" ? "52%胜率是可调的先验假设，不是从这一天反推的胜率；至少需要20–30个交易日做可行性筛选，更多样本后再校准。" : "凯利输入来自历史样本。",
    result.account_execution_review?.reason,
    result.boundary,
    "统计回放，不构成投资建议。",
  ].filter(Boolean).map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  drawIntraday(result);
}

async function runReplay() {
  nodes.runReplayButton.disabled = true;
  nodes.serviceStatus.textContent = "正在拼接竞价、分钟指标与主力监控事件…";
  try {
    const result = await postJson("/api/cb-quant/replay", replayPayload());
    renderReplay(result);
    localStorage.setItem("finance.quant.intraday.code", bondCodeValue(nodes.replayCode));
    localStorage.setItem("finance.quant.intraday.date", nodes.replayDate.value);
    nodes.serviceStatus.textContent = `日内回放完成 · ${result.name || result.code}`;
  } catch (error) {
    nodes.serviceStatus.textContent = `日内回放失败 · ${error.message}`;
    showToast(error.message, true);
  } finally {
    nodes.runReplayButton.disabled = false;
  }
}

function gridPayload() {
  return {
    code: bondCodeValue(nodes.gridCode),
    date: nodes.gridDate.value || undefined,
    initial_cash: Number(nodes.gridCash.value),
    initial_position: Number(nodes.gridInitialPosition.value),
    position_size: Number(nodes.gridPositionSize.value),
    max_position: Number(nodes.gridMaxPosition.value),
    atr_period: Number(nodes.gridAtrPeriod.value),
    atr_multiplier: Number(nodes.gridAtrMultiplier.value),
    min_grid_spacing_pct: Number(nodes.gridMinSpacing.value),
    max_grid_spacing_pct: Number(nodes.gridMaxSpacing.value),
    ma_period: Number(nodes.gridMaPeriod.value),
    trend_threshold_pct: Number(nodes.gridTrendThreshold.value),
    commission_rate: Number(nodes.gridCommission.value) / 10_000,
    slippage_bps: Number(nodes.gridSlippage.value),
    count: 500,
  };
}

function drawGridPrice(result) {
  const canvas = nodes.gridPriceCanvas;
  const { context, width, height } = setupCanvas(canvas, 560);
  const rows = (result.equity_curve || []).map((row) => {
    const close = Number(row.close);
    const reference = Number(row.reference_price ?? row.base_price);
    const spacing = Number(row.grid_spacing_pct);
    return {
      ...row,
      close,
      reference,
      lower: Number.isFinite(Number(row.lower_trigger_price))
        ? Number(row.lower_trigger_price)
        : reference * (1 - spacing / 100),
      upper: Number.isFinite(Number(row.upper_trigger_price))
        ? Number(row.upper_trigger_price)
        : reference * (1 + spacing / 100),
    };
  }).filter((row) => Number.isFinite(row.close) && Number.isFinite(row.reference));
  if (!rows.length) {
    context.fillStyle = "#788078";
    context.font = "12px Arial";
    context.fillText("暂无日内标的走势", 16, 26);
    return;
  }
  const trades = result.trades || [];
  const values = rows.flatMap((row) => [row.close, row.reference, row.lower, row.upper])
    .concat(trades.map((trade) => Number(trade.execution_price)))
    .filter(Number.isFinite);
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  const margin = Math.max(0.02, (maximum - minimum) * 0.08);
  minimum -= margin;
  maximum += margin;
  const padding = { left: 62, right: 22, top: 24, bottom: 34 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const x = (index) => padding.left + index / Math.max(1, rows.length - 1) * innerWidth;
  const y = (value) => padding.top + (maximum - value) / Math.max(0.000001, maximum - minimum) * innerHeight;
  context.font = "10px Arial";
  for (let index = 0; index <= 5; index += 1) {
    const lineY = padding.top + index / 5 * innerHeight;
    const value = maximum - index / 5 * (maximum - minimum);
    context.strokeStyle = "#e1e7dc";
    context.beginPath();
    context.moveTo(padding.left, lineY);
    context.lineTo(width - padding.right, lineY);
    context.stroke();
    context.fillStyle = "#738077";
    context.fillText(number(value, 3), 5, lineY + 3);
  }
  const line = (key, color, lineWidth, dash = []) => {
    context.beginPath();
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.setLineDash(dash);
    rows.forEach((row, index) => {
      const value = Number(row[key]);
      if (!Number.isFinite(value)) return;
      if (index) context.lineTo(x(index), y(value));
      else context.moveTo(x(index), y(value));
    });
    context.stroke();
    context.setLineDash([]);
  };
  line("lower", "#d0a14b", 1, [4, 4]);
  line("upper", "#d0a14b", 1, [4, 4]);
  line("reference", "#b849ba", 1.6, [7, 4]);
  line("close", "#18342a", 2.1);
  trades.forEach((trade, tradeIndex) => {
    const rowIndex = rows.findIndex((row) => row.time === trade.execution_time);
    const price = Number(trade.execution_price);
    if (rowIndex < 0 || !Number.isFinite(price)) return;
    const px = x(rowIndex);
    const py = y(price);
    const buy = trade.side === "buy";
    context.beginPath();
    context.fillStyle = buy ? "#d84b3f" : "#23886b";
    if (buy) {
      context.moveTo(px, py - 7);
      context.lineTo(px - 5, py + 4);
      context.lineTo(px + 5, py + 4);
    } else {
      context.moveTo(px, py + 7);
      context.lineTo(px - 5, py - 4);
      context.lineTo(px + 5, py - 4);
    }
    context.closePath();
    context.fill();
    context.fillStyle = buy ? "#b3362d" : "#177256";
    context.fillText(`${buy ? "买" : "卖"}${tradeIndex + 1}`, px + 7, py + (buy ? 13 : -8));
  });
  context.fillStyle = "#738077";
  context.fillText(rows[0].time, padding.left, height - 9);
  context.textAlign = "center";
  context.fillText("11:30 / 13:00", padding.left + innerWidth / 2, height - 9);
  context.textAlign = "right";
  context.fillText(rows.at(-1).time, width - padding.right, height - 9);
  context.textAlign = "left";
}

function renderGrid(result) {
  state.grid = result;
  nodes.gridEmpty.hidden = true;
  nodes.gridResult.hidden = false;
  nodes.gridDate.value = dateText(result.trading_date);
  const metrics = result.metrics || {};
  const atr = result.atr || {};
  const quality = result.data_quality || {};
  nodes.gridTitle.textContent = `${result.name || result.code} · ${result.strategy_label}`;
  nodes.gridQuality.textContent = `${dateText(result.trading_date)} · ${quality.minute_bar_count || 0}根分钟K · ATR样本 ${atr.sample_count || 0}/${atr.period || 0}`;
  nodes.gridMetricCards.innerHTML = [
    metricCard("总收益", percent(metrics.total_return), `净利润 ${money(metrics.net_profit)}`, toneClass(metrics.total_return)),
    metricCard("最大回撤", percent(metrics.max_drawdown), `最终资产 ${money(metrics.final_value)}`, "is-down"),
    metricCard("上一日ATR", atr.value === null ? "未完成" : number(atr.value, 4), atr.complete ? `截至 ${dateText(atr.last_completed_date)}` : "已降级到最小网格"),
    metricCard("平均网格", `${number(metrics.average_grid_spacing_pct, 3)}%`, `${number(metrics.minimum_grid_spacing_pct, 3)}% – ${number(metrics.maximum_grid_spacing_pct, 3)}%`),
    metricCard("模拟成交", `${metrics.trade_count || 0}笔`, `买${metrics.buy_count || 0} / 卖${metrics.sell_count || 0}`),
    metricCard("期末仓位", `${number(metrics.ending_position, 0)}张`, `费用 ${money(metrics.total_fees)}`),
  ].join("");
  drawGridPrice(result);
  drawLineChart(nodes.gridEquityCanvas, (result.equity_curve || []).map((row) => ({
    label: row.time,
    value: row.total_asset,
  })), "#57a893");

  const trades = result.trades || [];
  nodes.gridTradeCaption.textContent = `${trades.length}笔 · ${metrics.generated_signal_count || 0}次触发`;
  nodes.gridTradeBody.innerHTML = trades.length ? trades.map((trade, index) => `<tr>
    <td>#${index + 1}</td><td>${escapeHtml(trade.signal_time)} / ${escapeHtml(trade.execution_time)}</td>
    <td class="${trade.side === "buy" ? "is-up" : "is-down"}">${trade.side === "buy" ? "买入" : "卖出"}</td>
    <td>${number(trade.signal_price, 3)} / ${number(trade.execution_price, 3)}<br><small>${escapeHtml(trade.quote_source)}</small></td>
    <td>${number(trade.quantity, 0)}</td><td>${number(trade.spacing_pct, 3)}%</td><td>${money(trade.fee)}</td>
    <td class="${toneClass(trade.realized_pnl)}">${money(trade.realized_pnl)}</td><td>${escapeHtml(trade.reason)}</td>
  </tr>`).join("") : '<tr><td class="empty-cell" colspan="9">该交易日没有满足网格宽度、资金与持仓约束的模拟成交</td></tr>';

  const minuteBackfill = quality.minute_auto_backfill || {};
  const dailyBackfill = quality.latest_day_auto_backfill || {};
  nodes.gridNotes.innerHTML = [
    result.indicator_model,
    result.execution_model,
    result.fee_model,
    minuteBackfill.attempted
      ? `分钟数据缺口已自动调用QMT补数：${minuteBackfill.status}${minuteBackfill.error ? `（${minuteBackfill.error}）` : ""}。`
      : "目标交易日分钟数据无需额外补齐。",
    dailyBackfill.attempted
      ? `最近已完成日K缺口已自动聚合补齐：${dailyBackfill.status}${dailyBackfill.error ? `（${dailyBackfill.error}）` : ""}。`
      : "日K预热数据无需额外补齐。",
    atr.complete
      ? `ATR严格使用${atr.last_completed_date ? dateText(atr.last_completed_date) : "目标日前"}及更早的${atr.period}个真实波幅样本。`
      : `目标日前只有${atr.sample_count || 0}个有效真实波幅样本，不足${atr.period || 0}期，本次明确使用最小网格${number(result.params?.min_grid_spacing_pct, 3)}%。`,
    quality.missing_data?.order_book === "ask1_bid1_unavailable_using_next_minute_open"
      ? "分钟历史没有留存ask1/bid1，全部成交使用下一分钟开盘价近似；这不是历史盘口成交证明。"
      : "能读到盘口时买入优先ask1、卖出优先bid1；其余逐笔回退下一分钟开盘价。",
    result.boundary,
    "历史统计不等于未来收益，不构成投资建议。",
  ].filter(Boolean).map((note) => `<li>${escapeHtml(note)}</li>`).join("");
}

async function runGrid() {
  nodes.runGridButton.disabled = true;
  nodes.runGridButton.textContent = "正在补齐日K与分钟K…";
  nodes.serviceStatus.textContent = "正在读取目标交易日前日K并自动补齐分钟数据…";
  try {
    const result = await postJson("/api/cb-quant/atr-grid-backtest", gridPayload());
    renderGrid(result);
    localStorage.setItem("finance.quant.grid.code", bondCodeValue(nodes.gridCode));
    nodes.serviceStatus.textContent = `ATR网格回放完成 · ${result.name || result.code}`;
  } catch (error) {
    nodes.serviceStatus.textContent = `ATR网格回放失败 · ${error.message}`;
    showToast(error.message, true);
  } finally {
    nodes.runGridButton.disabled = false;
    nodes.runGridButton.textContent = "运行ATR网格并自动补数";
  }
}

function paperSettingsPayload() {
  return {
    codes: nodes.paperCodes.value.trim(),
    strategy: nodes.paperStrategy.value,
    cycle_seconds: Number(nodes.paperCycleSeconds.value),
    allocation_pct: Number(nodes.paperAllocation.value),
    grid_position_size: Number(nodes.paperGridPositionSize.value),
    grid_max_position: Number(nodes.paperGridMaxPosition.value),
    grid_atr_period: Number(nodes.paperGridAtrPeriod.value),
    grid_atr_multiplier: Number(nodes.paperGridAtrMultiplier.value),
    grid_min_spacing_pct: Number(nodes.paperGridMinSpacing.value),
    grid_max_spacing_pct: Number(nodes.paperGridMaxSpacing.value),
    grid_ma_period: Number(nodes.paperGridMaPeriod.value),
    grid_trend_threshold_pct: Number(nodes.paperGridTrendThreshold.value),
    win_rate: Number(nodes.paperWinRate.value) / 100,
    kelly_discount: Number(nodes.paperKellyFraction.value) / 100,
    max_risk_pct: Number(nodes.paperRiskCap.value) / 100,
    max_position_pct: Number(nodes.paperPositionCap.value) / 100,
    max_stop_pct: Number(nodes.paperMaxStop.value) / 100,
    take1_r: Number(nodes.paperTake1R.value),
    take2_r: Number(nodes.paperTake2R.value),
    commission_rate: Number(nodes.paperCommission.value) / 10_000,
    slippage_bps: Number(nodes.paperSlippage.value),
  };
}

function syncPaperForm(paper) {
  if (state.paperFormSynced) return;
  const settings = paper.settings || {};
  nodes.paperCodes.value = localStorage.getItem("finance.quant.paper.codes") || (settings.codes || []).join(", ") || nodes.paperCodes.value;
  nodes.paperStrategy.value = settings.strategy || "ma20_cross";
  nodes.paperCycleSeconds.value = settings.cycle_seconds ?? 60;
  nodes.paperAllocation.value = settings.allocation_pct ?? 20;
  nodes.paperGridPositionSize.value = settings.grid_position_size ?? 100;
  nodes.paperGridMaxPosition.value = settings.grid_max_position ?? 500;
  nodes.paperGridAtrPeriod.value = settings.grid_atr_period ?? 14;
  nodes.paperGridAtrMultiplier.value = settings.grid_atr_multiplier ?? 0.5;
  nodes.paperGridMinSpacing.value = settings.grid_min_spacing_pct ?? 0.1;
  nodes.paperGridMaxSpacing.value = settings.grid_max_spacing_pct ?? 0.8;
  nodes.paperGridMaPeriod.value = settings.grid_ma_period ?? 20;
  nodes.paperGridTrendThreshold.value = settings.grid_trend_threshold_pct ?? 0.3;
  nodes.paperWinRate.value = Number(settings.win_rate ?? 0.52) * 100;
  nodes.paperKellyFraction.value = Number(settings.kelly_discount ?? 0.25) * 100;
  nodes.paperRiskCap.value = Number(settings.max_risk_pct ?? 0.005) * 100;
  nodes.paperPositionCap.value = Number(settings.max_position_pct ?? 0.2) * 100;
  nodes.paperMaxStop.value = Number(settings.max_stop_pct ?? 0.02) * 100;
  nodes.paperTake1R.value = settings.take1_r ?? 1;
  nodes.paperTake2R.value = settings.take2_r ?? 2;
  nodes.paperCommission.value = Number(settings.commission_rate ?? 0.0001) * 10_000;
  nodes.paperSlippage.value = settings.slippage_bps ?? 2;
  nodes.paperInitialCash.value = paper.initial_cash || 100_000;
  nodes.manualCode.value = (settings.codes || [])[0] || nodes.manualCode.value;
  state.paperFormSynced = true;
}

function renderPaper(paper) {
  state.paper = paper;
  syncPaperForm(paper);
  const running = paper.runtime?.running === true;
  nodes.paperRuntimeDot.classList.toggle("is-running", running);
  nodes.paperRuntimeText.textContent = running ? "模拟轮询中" : "已停止";
  nodes.paperCycleText.textContent = paper.runtime?.last_cycle_at ? `第${paper.runtime.cycle_count || 0}轮 · ${dateText(paper.runtime.last_cycle_at)}` : paper.runtime?.stopped_reason || "尚未运行";
  const strategyLabel = [
    ...state.dailyStrategies,
    ...state.gridStrategies,
    { name: "intraday_confluence_kelly", label: "日内组合确认 + 折扣凯利" },
  ].find((item) => item.name === paper.settings?.strategy)?.label || paper.settings?.strategy || "模拟策略";
  nodes.paperSource.textContent = paper.runtime?.last_error ? `最近一轮异常：${paper.runtime.last_error}` : `${strategyLabel} · 本地纸面账户 · 不连接真实账户`;
  nodes.paperMetricCards.innerHTML = [
    metricCard("总资产", money(paper.total_asset), `初始 ${money(paper.initial_cash)}`, toneClass(paper.total_pnl)),
    metricCard("累计收益", percent(paper.total_return), money(paper.total_pnl), toneClass(paper.total_return)),
    metricCard("可用现金", money(paper.cash), `现金占比 ${percent(paper.total_asset ? paper.cash / paper.total_asset : 0)}`),
    metricCard("持仓市值", money(paper.market_value), `${paper.position_count || 0}只转债`),
    metricCard("已实现盈亏", money(paper.realized_pnl), "只统计模拟成交", toneClass(paper.realized_pnl)),
    metricCard("浮动盈亏", money(paper.unrealized_pnl), "按最新有效行情", toneClass(paper.unrealized_pnl)),
  ].join("");
  const positions = Object.values(paper.positions || {});
  nodes.positionCaption.textContent = `${positions.length}只 · T+0可卖`;
  nodes.paperPositionBody.innerHTML = positions.length ? positions.map((position) => {
    const risk = position.risk_plan || {};
    return `<tr><td><strong>${escapeHtml(position.name || position.code)}</strong><br><small>${escapeHtml(position.code)}</small></td>
      <td>${number(position.quantity, 0)} / ${number(position.available_quantity, 0)}</td><td>${number(position.average_cost, 3)} / ${number(position.market_price, 3)}</td>
      <td class="is-down">${number(risk.stop_price, 3)}</td><td>${number(risk.take1_price, 3)} / ${number(risk.take2_price, 3)}${risk.take1_done ? "<br><small>1R已完成</small>" : ""}</td>
      <td class="${toneClass(position.unrealized_pnl)}">${money(position.unrealized_pnl)}<br><small>${percent(position.unrealized_pnl_pct)}</small></td><td>${escapeHtml(dateText(position.last_mark_at))}</td></tr>`;
  }).join("") : '<tr><td class="empty-cell" colspan="7">暂无模拟持仓</td></tr>';
  const fills = [...(paper.fills || [])].reverse().slice(0, 50);
  nodes.fillCaption.textContent = `${paper.fills?.length || 0}笔`;
  nodes.paperFillBody.innerHTML = fills.length ? fills.map((fill) => `<tr><td>${escapeHtml(dateText(fill.time))}</td><td>${escapeHtml(fill.code)}</td><td class="${fill.side === "buy" ? "is-up" : "is-down"}">${fill.side === "buy" ? "买入" : "卖出"}</td><td>${number(fill.price, 3)} / ${number(fill.quantity, 0)}</td><td>${money(fill.fee)}</td><td class="${toneClass(fill.realized_pnl)}">${money(fill.realized_pnl)}</td></tr>`).join("") : '<tr><td class="empty-cell" colspan="6">暂无模拟成交</td></tr>';
  const signals = [...(paper.signals || [])].reverse().slice(0, 50);
  const statusLabels = { paper_filled: "已模拟成交", intraday_signal_expired: "超过180秒", kelly_size_rejected: "凯利仓位不足一手", quote_unavailable: "行情不可用", market_closed_waiting: "休市等待", pending_paper_fill: "等待模拟成交", daily_history_stale: "等待日K补齐", position_already_open: "已有持仓", position_unavailable: "无持仓", grid_max_position: "网格持仓已满", grid_position_unavailable: "网格无可卖持仓", paper_cash_insufficient: "纸面现金不足" };
  nodes.signalCaption.textContent = `${paper.signals?.length || 0}条`;
  nodes.paperSignalBody.innerHTML = signals.length ? signals.map((signal) => `<tr><td>${escapeHtml(dateText(signal.signal_date))}</td><td>${escapeHtml(signal.code)}</td><td class="${signal.side === "buy" ? "is-up" : "is-down"}">${signal.side === "buy" ? "买入" : "卖出"}</td><td>${escapeHtml(statusLabels[signal.status] || signal.status || "--")}</td><td title="${escapeHtml(signal.error || signal.reason)}">${escapeHtml(signal.error || signal.reason)}</td></tr>`).join("") : '<tr><td class="empty-cell" colspan="5">暂无策略信号</td></tr>';
  drawLineChart(nodes.paperEquityCanvas, (paper.equity_history || []).map((point) => ({ label: point.time, value: point.total_asset })));
  schedulePaperRefresh(running ? 15_000 : 60_000);
}

function schedulePaperRefresh(delay) {
  window.clearTimeout(state.paperTimer);
  if (state.activeTab !== "paper") return;
  state.paperTimer = window.setTimeout(() => void loadPaper(true), delay);
}

async function loadPaper(refresh = false) {
  try {
    renderPaper(await fetchJson(`/api/cb-quant/paper${refresh ? "?refresh=1" : ""}`));
    nodes.serviceStatus.textContent = "模拟盘已连接 · 可切换日线或日内策略";
  } catch (error) {
    nodes.serviceStatus.textContent = `模拟盘读取失败 · ${error.message}`;
    showToast(error.message, true);
    schedulePaperRefresh(30_000);
  }
}

async function mutatePaper(path, body, button, successMessage) {
  button.disabled = true;
  try {
    const paper = await postJson(path, body);
    renderPaper(paper);
    showToast(successMessage);
    return paper;
  } catch (error) {
    showToast(error.message, true);
    return null;
  } finally {
    button.disabled = false;
  }
}

function setTab(tab) {
  state.activeTab = ["daily", "replay", "grid", "paper"].includes(tab) ? tab : "daily";
  for (const name of ["daily", "replay", "grid", "paper"]) {
    const selected = state.activeTab === name;
    nodes[`${name}Tab`].classList.toggle("is-active", selected);
    nodes[`${name}Tab`].setAttribute("aria-selected", String(selected));
    nodes[`${name}Panel`].hidden = !selected;
  }
  window.clearTimeout(state.paperTimer);
  const url = new URL(window.location.href);
  if (state.activeTab === "daily") url.searchParams.delete("tab");
  else url.searchParams.set("tab", state.activeTab);
  window.history.replaceState(null, "", url);
  if (state.activeTab === "paper") void loadPaper(false);
  if (state.activeTab === "replay" && state.replay) window.requestAnimationFrame(() => drawIntraday(state.replay));
  if (state.activeTab === "grid" && state.grid) window.requestAnimationFrame(() => {
    drawGridPrice(state.grid);
    drawLineChart(nodes.gridEquityCanvas, (state.grid.equity_curve || []).map((row) => ({ label: row.time, value: row.total_asset })), "#57a893");
  });
  if (state.activeTab === "daily" && state.daily) window.requestAnimationFrame(() => drawDailyEquity(state.daily));
}

nodes.dailyForm.addEventListener("submit", (event) => { event.preventDefault(); void runDaily(); });
nodes.portfolioForm.addEventListener("submit", (event) => { event.preventDefault(); void runPortfolio(); });
nodes.replayForm.addEventListener("submit", (event) => { event.preventDefault(); void runReplay(); });
nodes.gridForm.addEventListener("submit", (event) => { event.preventDefault(); void runGrid(); });
nodes.dailyTab.addEventListener("click", () => setTab("daily"));
nodes.replayTab.addEventListener("click", () => setTab("replay"));
nodes.gridTab.addEventListener("click", () => setTab("grid"));
nodes.paperTab.addEventListener("click", () => setTab("paper"));
nodes.paperStartButton.addEventListener("click", async () => {
  localStorage.setItem("finance.quant.paper.codes", nodes.paperCodes.value.trim());
  await mutatePaper("/api/cb-quant/paper/start", paperSettingsPayload(), nodes.paperStartButton, "模拟盘已启动；只会生成纸面成交。");
});
nodes.paperStopButton.addEventListener("click", () => void mutatePaper("/api/cb-quant/paper/stop", {}, nodes.paperStopButton, "模拟轮询已停止。"));
nodes.paperCycleButton.addEventListener("click", () => void mutatePaper("/api/cb-quant/paper/cycle", {}, nodes.paperCycleButton, "已完成一轮日内信号评估。"));
nodes.paperResetButton.addEventListener("click", async () => {
  if (!window.confirm("确定重置模拟账户吗？模拟持仓、成交和权益曲线会被覆盖，真实账户不受影响。")) return;
  state.paperFormSynced = true;
  await mutatePaper("/api/cb-quant/paper/reset", { ...paperSettingsPayload(), initial_cash: Number(nodes.paperInitialCash.value) }, nodes.paperResetButton, "模拟账户已重置。");
});
nodes.manualPaperOrder.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = nodes.manualPaperOrder.querySelector("button");
  const result = await mutatePaper("/api/cb-quant/paper/order", { code: nodes.manualCode.value.trim(), side: nodes.manualSide.value, quantity: Number(nodes.manualQuantity.value) || undefined }, button, "手工模拟委托已按有效QMT行情成交。");
  if (result) nodes.manualQuantity.value = "";
});
window.addEventListener("resize", () => {
  if (state.activeTab === "daily" && state.daily) drawDailyEquity(state.daily);
  if (state.activeTab === "daily" && state.portfolio) drawLineChart(nodes.portfolioEquityCanvas, (state.portfolio.equity_curve || []).map((row) => ({ label: row.date, value: row.total_asset })), "#b849ba");
  if (state.activeTab === "replay" && state.replay) drawIntraday(state.replay);
  if (state.activeTab === "grid" && state.grid) {
    drawGridPrice(state.grid);
    drawLineChart(nodes.gridEquityCanvas, (state.grid.equity_curve || []).map((row) => ({ label: row.time, value: row.total_asset })), "#57a893");
  }
  if (state.activeTab === "paper" && state.paper) renderPaper(state.paper);
});

async function initialize() {
  [nodes.dailyCode, nodes.replayCode, nodes.gridCode].forEach(attachBondAutocomplete);
  nodes.dailyCode.value = localStorage.getItem("finance.quant.daily.code") || nodes.dailyCode.value;
  nodes.replayCode.value = localStorage.getItem("finance.quant.intraday.code") || nodes.replayCode.value;
  nodes.replayDate.value = localStorage.getItem("finance.quant.intraday.date") || nodes.replayDate.value;
  nodes.gridCode.value = localStorage.getItem("finance.quant.grid.code") || nodes.gridCode.value;
  try {
    const [payload, miniQmtHealth] = await Promise.all([
      fetchJson("/api/cb-quant/strategies"),
      fetchJson("/api/miniqmt/health").catch(() => null),
    ]);
    const latestGridDate = dateText(miniQmtHealth?.latest_trading_date);
    if (/^\d{4}-\d{2}-\d{2}$/.test(latestGridDate)) nodes.gridDate.value = latestGridDate;
    state.dailyStrategies = payload.strategies || [];
    nodes.dailyStrategy.insertAdjacentHTML("beforeend", state.dailyStrategies.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.group)} · ${escapeHtml(item.label)}</option>`).join(""));
    const portfolioStrategies = payload.portfolio_strategies || [];
    nodes.portfolioStrategy.innerHTML = portfolioStrategies.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.label)}</option>`).join("");
    const gridStrategies = payload.grid_strategies || [];
    state.gridStrategies = gridStrategies;
    const intradayStrategies = payload.intraday_strategies || [];
    nodes.paperStrategy.innerHTML = [
      ...state.dailyStrategies.map((item) => `<option value="${escapeHtml(item.name)}">日线 · ${escapeHtml(item.label)}</option>`),
      ...intradayStrategies.map((item) => `<option value="${escapeHtml(item.name)}">日内 · ${escapeHtml(item.label)}</option>`),
      ...gridStrategies.map((item) => `<option value="${escapeHtml(item.name)}">日内网格 · ${escapeHtml(item.label)}</option>`),
    ].join("");
    const savedDailyStrategy = localStorage.getItem("finance.quant.daily.strategy");
    if (savedDailyStrategy && [...nodes.dailyStrategy.options].some((item) => item.value === savedDailyStrategy)) nodes.dailyStrategy.value = savedDailyStrategy;
    nodes.serviceStatus.textContent = `${state.dailyStrategies.length}个单券日线 + ${portfolioStrategies.length}个组合轮动 + ${intradayStrategies.length}个事件日内 + ${gridStrategies.length}个ATR网格已就绪 · QMT只读数据源`;
    const requestedTab = new URL(window.location.href).searchParams.get("tab");
    setTab(["replay", "grid", "paper"].includes(requestedTab) ? requestedTab : "daily");
  } catch (error) {
    nodes.serviceStatus.textContent = `量化服务不可用 · ${error.message}`;
    showToast(error.message, true);
  }
}

void initialize();
