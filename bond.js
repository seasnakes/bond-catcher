const EVENT_LABELS = {
  accelerate_up: "涨速加速",
  accelerate_down: "跌速加速",
  urgent_up: "急速拉升",
  urgent_down: "急速下跌",
  sudden_rise: "快速拉升",
  sudden_fall: "快速下跌",
  suspected_large_buy: "疑似连续大单买入",
  suspected_large_sell: "疑似连续大单卖出",
  visible_bid_large_order: "五档大买单",
  visible_ask_large_order: "五档大卖单",
  visible_book_support: "五档买盘支撑",
  visible_book_pressure: "五档卖盘压制",
  macd_underwater_golden_cross: "MACD水下金叉",
  underwater_golden_cross_purple_confirmed: "水下金叉·紫线确认",
  purple_line_pullback_reclaim: "回调紫线后收回",
  dark_funds_inflow_start: "暗盘资金转入",
  dark_funds_outflow_start: "暗盘资金转出",
  dark_funds_inflow_accelerating: "暗盘流入增强",
  dark_funds_outflow_accelerating: "暗盘流出增强",
  visible_funds_inflow_start: "明盘资金转入",
  visible_funds_strong_inflow: "明盘资金强流入",
  visible_funds_inflow_weakening: "明盘流入减弱",
  visible_funds_outflow: "明盘资金流出",
  visible_funds_strong_exit: "明盘资金强流出",
  high_pullback: "高位回落",
  low_rebound: "低位反弹",
  interval_volume: "区间放量",
  strong_interval_volume: "区间强放量",
  new_high_acceleration: "创新高加速",
  new_low_acceleration: "创新低加速",
  platform_dive: "平台跳水",
  pole_jump: "旱地拔葱",
  near_up_limit: "接近涨停",
  open_high: "高开",
  open_low: "低开",
  volume_surge: "分钟放量",
};

const params = new URLSearchParams(window.location.search);
const requestedCode = String(params.get("code") || "").replace(/\D/g, "");
const requestedName = params.get("name") || "";
const state = {
  payload: null,
  dailyPayload: null,
  view: params.get("view") === "daily" ? "daily" : "intraday",
  selectedIndex: -1,
  refreshTimer: 0,
  resizeTimer: 0,
  requestId: 0,
  manualDate: Boolean(params.get("date")),
};

const pageParams = new URLSearchParams(window.location.search);
const isEmbedded = pageParams.get("embedded") === "1";

const nodes = {
  backLink: document.querySelector(".back-link"),
  name: document.querySelector("#bondName"),
  code: document.querySelector("#bondCode"),
  latestPrice: document.querySelector("#latestPrice"),
  latestChange: document.querySelector("#latestChange"),
  barCountLabel: document.querySelector("#barCountLabel"),
  barCount: document.querySelector("#barCount"),
  latestMinuteLabel: document.querySelector("#latestMinuteLabel"),
  latestMinute: document.querySelector("#latestMinute"),
  totalAmountLabel: document.querySelector("#totalAmountLabel"),
  totalAmount: document.querySelector("#totalAmount"),
  eventCountLabel: document.querySelector("#eventCountLabel"),
  eventCount: document.querySelector("#eventCount"),
  intradayViewButton: document.querySelector("#intradayViewButton"),
  dailyViewButton: document.querySelector("#dailyViewButton"),
  dateControl: document.querySelector("#dateControl"),
  dateSelect: document.querySelector("#dateSelect"),
  dailyRangeControl: document.querySelector("#dailyRangeControl"),
  dailyRangeSelect: document.querySelector("#dailyRangeSelect"),
  refreshButton: document.querySelector("#refreshButton"),
  connectionStatus: document.querySelector("#connectionStatus"),
  dataAlert: document.querySelector("#dataAlert"),
  chartWrap: document.querySelector("#chartWrap"),
  canvas: document.querySelector("#indicatorChart"),
  tooltip: document.querySelector("#chartTooltip"),
  eventList: document.querySelector("#eventList"),
  intradayLegend: document.querySelector("#intradayLegend"),
  dailyLegend: document.querySelector("#dailyLegend"),
  eventsCard: document.querySelector(".events-card"),
  dataFootnote: document.querySelector("#dataFootnote"),
};

function isBoardReferrer() {
  try {
    const referrer = new URL(document.referrer);
    return (
      referrer.origin === window.location.origin &&
      ["/", "/index.html"].includes(referrer.pathname)
    );
  } catch {
    return false;
  }
}

if (isEmbedded) {
  document.documentElement.classList.add("is-embedded");
}

const panelDefinitions = [
  { key: "price", label: "价格", weight: 0.36 },
  { key: "amount", label: "分钟成交额", weight: 0.13 },
  { key: "macd", label: "MACD", weight: 0.17 },
  { key: "dark", label: "暗盘资金", weight: 0.16 },
  { key: "visible", label: "明盘资金", weight: 0.18 },
];

function formatNumber(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "-";
}

function formatAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (Math.abs(number) >= 1e8) return `${(number / 1e8).toFixed(2)}亿`;
  if (Math.abs(number) >= 1e4) return `${(number / 1e4).toFixed(1)}万`;
  return `${number.toFixed(0)}元`;
}

function toneClass(value) {
  if (Number(value) > 0) return "is-up";
  if (Number(value) < 0) return "is-down";
  return "";
}

function setStatus(text, tone = "") {
  nodes.connectionStatus.textContent = text;
  nodes.connectionStatus.className = `status-pill${tone ? ` ${tone}` : ""}`;
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    return payload;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function loadBond(options = {}) {
  if (!requestedCode) {
    setStatus("缺少转债代码", "is-error");
    return;
  }
  const requestId = (state.requestId += 1);
  const date = options.date !== undefined
    ? options.date
    : state.manualDate
      ? nodes.dateSelect.value || params.get("date") || ""
      : "";
  setStatus("正在读取MiniQMT");
  try {
    const query = new URLSearchParams({ code: requestedCode });
    if (date) query.set("date", date);
    const payload = await fetchJson(
      `/api/miniqmt/bond?${query}`,
      date ? 120000 : 12000,
    );
    if (requestId !== state.requestId) return;
    state.payload = payload;
    state.selectedIndex = Math.max(0, payload.rows.length - 1);
    renderPayload(payload);
    setStatus(statusText(payload), statusTone(payload));
    scheduleRefresh();
  } catch (error) {
    if (requestId !== state.requestId) return;
    setStatus(error.message || "MiniQMT读取失败", "is-error");
    nodes.eventList.innerHTML = `<div class="empty-events">${escapeHtml(
      error.message || "MiniQMT读取失败",
    )}</div>`;
  }
}

function setView(view, options = {}) {
  state.view = view === "daily" ? "daily" : "intraday";
  state.selectedIndex = -1;
  nodes.tooltip.hidden = true;
  nodes.intradayViewButton.classList.toggle("is-active", state.view === "intraday");
  nodes.dailyViewButton.classList.toggle("is-active", state.view === "daily");
  nodes.dateControl.hidden = state.view !== "intraday";
  nodes.dailyRangeControl.hidden = state.view !== "daily";
  nodes.intradayLegend.hidden = state.view !== "intraday";
  nodes.dailyLegend.hidden = state.view !== "daily";
  nodes.eventsCard.hidden = state.view !== "intraday";
  window.clearTimeout(state.refreshTimer);

  if (options.updateUrl !== false) {
    const url = new URL(window.location.href);
    if (state.view === "daily") url.searchParams.set("view", "daily");
    else url.searchParams.delete("view");
    window.history.replaceState(window.history.state, "", url);
  }

  if (options.load === false) return;
  if (state.view === "daily") {
    if (state.dailyPayload && !options.force) renderDailyPayload(state.dailyPayload);
    else void loadDaily();
  } else if (state.payload && !options.force) {
    renderPayload(state.payload);
    setStatus(statusText(state.payload), statusTone(state.payload));
    scheduleRefresh();
  } else {
    void loadBond();
  }
}

async function openDailyIntraday(index) {
  const row = state.dailyPayload?.rows?.[index];
  const tradingDate = String(row?.date || "");
  if (!/^\d{8}$/.test(tradingDate)) return;
  state.manualDate = true;
  const url = new URL(window.location.href);
  url.searchParams.delete("view");
  url.searchParams.set("date", tradingDate);
  window.history.replaceState(window.history.state, "", url);
  setView("intraday", { updateUrl: false, load: false });
  setStatus(`正在读取 ${displayDailyDate(tradingDate)} 分时`);
  nodes.refreshButton.disabled = true;
  try {
    await loadBond({ date: tradingDate });
  } finally {
    nodes.refreshButton.disabled = false;
  }
}

async function loadDaily() {
  if (!requestedCode) {
    setStatus("缺少转债代码", "is-error");
    return;
  }
  const requestId = (state.requestId += 1);
  const count = Number(nodes.dailyRangeSelect.value) || 120;
  setStatus("正在读取 MiniQMT 日K");
  nodes.refreshButton.disabled = true;
  try {
    const query = new URLSearchParams({ code: requestedCode, count: String(count) });
    const payload = await fetchJson(`/api/miniqmt/daily?${query}`, 120000);
    if (requestId !== state.requestId || state.view !== "daily") return;
    state.dailyPayload = payload;
    state.selectedIndex = Math.max(0, payload.rows.length - 1);
    renderDailyPayload(payload);
    setStatus(`日K · ${payload.source} · ${payload.rows.length}日`);
  } catch (error) {
    if (requestId !== state.requestId) return;
    setStatus(error.message || "MiniQMT日K读取失败", "is-error");
  } finally {
    if (requestId === state.requestId) nodes.refreshButton.disabled = false;
  }
}

function displayDailyDate(value) {
  const text = String(value || "");
  return text.length === 8
    ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
    : text || "-";
}

function renderDailyPayload(payload) {
  const rows = payload.rows || [];
  if (!rows.length) return;
  const latest = rows.at(-1);
  const first = rows[0];
  const displayName = requestedName || state.payload?.name || "可转债";
  const rangeReturn =
    Number(first.close) > 0 ? (Number(latest.close) / Number(first.close) - 1) * 100 : 0;
  document.title = `${displayName} ${payload.code} · 日K`;
  nodes.name.textContent = displayName;
  nodes.code.textContent = payload.code;
  nodes.latestPrice.textContent = formatNumber(latest.close, 3);
  nodes.latestChange.textContent =
    `${Number(latest.change) > 0 ? "+" : ""}${formatNumber(latest.change, 2)}%`;
  nodes.latestChange.className = toneClass(latest.change);
  nodes.barCountLabel.textContent = "交易日数";
  nodes.latestMinuteLabel.textContent = "最新日期";
  nodes.totalAmountLabel.textContent = "区间成交额";
  nodes.eventCountLabel.textContent = "区间涨跌";
  nodes.barCount.textContent = String(rows.length);
  nodes.latestMinute.textContent = displayDailyDate(latest.date);
  nodes.totalAmount.textContent = formatAmount(
    rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
  );
  nodes.eventCount.textContent =
    `${rangeReturn > 0 ? "+" : ""}${formatNumber(rangeReturn, 2)}%`;
  nodes.eventCount.className = toneClass(rangeReturn);
  nodes.dataAlert.hidden = true;
  drawChart();
}

function renderPayload(payload) {
  const displayName = payload.name || requestedName || "可转债";
  document.title = `${displayName} ${payload.code} · MiniQMT分时指标`;
  nodes.name.textContent = displayName;
  nodes.code.textContent = payload.code;
  nodes.latestPrice.textContent = formatNumber(payload.latest_price, 3);
  const displayedReturn = Number.isFinite(Number(payload.daily_return))
    ? Number(payload.daily_return)
    : Number(payload.change_from_first);
  nodes.latestChange.textContent = `${displayedReturn > 0 ? "+" : ""}${formatNumber(
    displayedReturn,
    2,
  )}%`;
  nodes.latestChange.className = toneClass(displayedReturn);
  nodes.barCountLabel.textContent = "分钟数";
  nodes.latestMinuteLabel.textContent = "最新分钟";
  nodes.totalAmountLabel.textContent = "累计成交额";
  nodes.eventCountLabel.textContent = "今日信号";
  nodes.eventCount.className = "";
  nodes.barCount.textContent = `${payload.bar_count}${payload.complete_session ? " / 241" : ""}`;
  nodes.latestMinute.textContent = payload.latest_minute || "-";
  nodes.totalAmount.textContent = formatAmount(payload.total_amount);
  nodes.eventCount.textContent = String(payload.events.length);
  renderDates(payload.available_dates, payload.trading_date);
  renderDataAlert(payload);
  renderEvents(payload.events);
  nodes.dataFootnote.textContent = payload.full_session
    ? `${payload.source || "MiniQMT"} · 当前为完整交易日数据；黄色均价线按分钟成交额估算，普通行情不等同于Level-2逐笔。`
    : payload.complete_session
      ? "当前分钟数据可用于指标分析，但尚未达到241根完整回放；黄色均价线按分钟成交额估算。"
      : `当前为盘中数据；页面每${payload.realtime?.refresh_interval_seconds || 2}秒读取一次，分钟指标在来源分钟形成后稳定，黄色均价线按分钟成交额估算。`;
  drawChart();
}

function statusText(payload) {
  if (payload.realtime?.data_is_stale && !state.manualDate) {
    return "等待今日数据 · 自动重试";
  }
  if (payload.realtime?.monitor_alive && payload.realtime?.is_latest_trading_date) {
    return `实时刷新 · ${payload.realtime.refresh_interval_seconds || 2}秒 · 只读`;
  }
  if (payload.full_session) return "完整241分钟 · 只读";
  if (payload.complete_session) return "可用交易日 · 只读";
  return "历史/静态数据 · 只读";
}

function statusTone(payload) {
  if (payload.realtime?.data_is_stale && !state.manualDate) return "is-warning";
  if (payload.realtime?.monitor_alive && payload.realtime?.is_latest_trading_date) {
    return "is-live";
  }
  return "";
}

function displayDate(value) {
  const text = String(value || "");
  return text.length === 8
    ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
    : text || "-";
}

function renderDataAlert(payload) {
  const isHistorical = payload.realtime?.data_is_stale;
  if (!isHistorical) {
    nodes.dataAlert.hidden = true;
    nodes.dataAlert.textContent = "";
    nodes.dataAlert.className = "data-alert";
    return;
  }
  nodes.dataAlert.hidden = false;
  if (state.manualDate) {
    nodes.dataAlert.className = "data-alert is-history";
    nodes.dataAlert.textContent = `正在查看历史交易日 ${displayDate(payload.trading_date)}，不会自动跳回今天。`;
    return;
  }
  nodes.dataAlert.className = "data-alert is-stale";
  nodes.dataAlert.textContent =
    `今日数据尚未到达，当前临时显示 ${displayDate(payload.trading_date)}。` +
    "页面会持续检查，并在MiniQMT产生今日数据后自动切换。";
}

function renderDates(dates, selected) {
  const current = nodes.dateSelect.value;
  nodes.dateSelect.replaceChildren();
  for (const date of dates || []) {
    const option = document.createElement("option");
    option.value = date;
    option.textContent = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    option.selected = date === selected;
    nodes.dateSelect.append(option);
  }
  if (!selected && current) nodes.dateSelect.value = current;
}

function renderEvents(events) {
  nodes.eventList.replaceChildren();
  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "empty-events";
    empty.textContent = "该交易日暂无已记录信号";
    nodes.eventList.append(empty);
    return;
  }
  for (const event of [...events].reverse()) {
    const row = document.createElement("article");
    row.className = `event-row ${toneClass(event.direction === "up" ? 1 : event.direction === "down" ? -1 : 0)}`;
    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = String(event.event_time || "").slice(11, 19);
    const type = document.createElement("span");
    type.className = "event-type";
    type.textContent = EVENT_LABELS[event.event_type] || event.event_type;
    type.title = event.event_type;
    const price = document.createElement("span");
    price.className = "event-price";
    price.textContent = formatNumber(event.price, 3);
    const score = document.createElement("span");
    score.className = "event-score";
    score.textContent = Number.isFinite(Number(event.speed_1m))
      ? `1分钟 ${Number(event.speed_1m) > 0 ? "+" : ""}${formatNumber(
          Number(event.speed_1m) * 100,
          2,
        )}%`
      : `评分 ${formatNumber(event.score, 2)}`;
    const confidence = document.createElement("span");
    confidence.className = "event-confidence";
    confidence.textContent = event.confidence;
    row.append(time, type, price, score, confidence);
    nodes.eventList.append(row);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function scheduleRefresh() {
  window.clearTimeout(state.refreshTimer);
  if (state.view !== "intraday") return;
  const realtime = state.payload?.realtime;
  const waitingForToday = !state.manualDate && realtime?.data_is_stale;
  const followingLive = realtime?.monitor_alive && realtime?.is_latest_trading_date;
  if (!waitingForToday && !followingLive) return;
  const date = state.manualDate ? state.payload.trading_date : "";
  state.refreshTimer = window.setTimeout(
    () => loadBond({ date }),
    (realtime?.refresh_interval_seconds || 2) * 1000,
  );
}

function chartGeometry(canvas) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const left = width < 700 ? 48 : 68;
  const right = width < 700 ? 48 : 72;
  const top = 10;
  const bottom = 28;
  const gap = 12;
  const usable = height - top - bottom - gap * (panelDefinitions.length - 1);
  let cursor = top;
  const panels = panelDefinitions.map((definition) => {
    const panelHeight = usable * definition.weight;
    const panel = {
      ...definition,
      x: left,
      y: cursor,
      width: width - left - right,
      height: panelHeight,
    };
    cursor += panelHeight + gap;
    return panel;
  });
  return { width, height, left, right, top, bottom, panels };
}

function finiteValues(values) {
  return values
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .filter(Number.isFinite);
}

function domain(values, options = {}) {
  const finite = finiteValues(values);
  if (!finite.length) return [-1, 1];
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (options.includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (options.includeValue !== undefined) {
    min = Math.min(Number(options.includeValue), min);
    max = Math.max(Number(options.includeValue), max);
  }
  const range = max - min || Math.max(Math.abs(max) * 0.02, 1);
  const pad = range * (options.padding ?? 0.08);
  return [min - pad, max + pad];
}

function xFor(index, panel, length) {
  return panel.x + (length <= 1 ? 0 : (index / (length - 1)) * panel.width);
}

function yFor(value, panel, range) {
  const [min, max] = range;
  return panel.y + panel.height - ((Number(value) - min) / (max - min || 1)) * panel.height;
}

function setupCanvas() {
  const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = nodes.canvas.clientWidth;
  const height = nodes.canvas.clientHeight;
  nodes.canvas.width = Math.round(width * ratio);
  nodes.canvas.height = Math.round(height * ratio);
  const context = nodes.canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}

function drawChart() {
  if (state.view === "daily") {
    drawDailyChart();
    return;
  }
  const rows = state.payload?.rows || [];
  if (!rows.length) return;
  const context = setupCanvas();
  const geometry = chartGeometry(nodes.canvas);
  context.clearRect(0, 0, geometry.width, geometry.height);
  context.font = '11px Arial, "Microsoft YaHei", sans-serif';
  context.lineJoin = "round";
  context.lineCap = "round";
  const domains = drawPanels(context, geometry, rows);
  drawEvents(context, geometry.panels[0], rows, domains.price);
  drawAxes(context, geometry, rows, domains);
  if (state.selectedIndex >= 0) drawCrosshair(context, geometry, rows, state.selectedIndex);
}

function dailyChartGeometry(canvas) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const left = width < 700 ? 48 : 68;
  const right = width < 700 ? 48 : 72;
  const top = 12;
  const bottom = 30;
  const gap = 14;
  const usable = height - top - bottom - gap;
  const priceHeight = usable * 0.76;
  return {
    width,
    height,
    panels: [
      { key: "price", label: "日K", x: left, y: top, width: width - left - right, height: priceHeight },
      {
        key: "amount",
        label: "成交额",
        x: left,
        y: top + priceHeight + gap,
        width: width - left - right,
        height: usable - priceHeight,
      },
    ],
  };
}

function dailySlotCount(rows) {
  const selectedRange = Number(nodes.dailyRangeSelect.value) || 120;
  const requestedCount = Number(state.dailyPayload?.requested_count) || selectedRange;
  return Math.max(rows.length, selectedRange, requestedCount);
}

function dailyXFor(index, panel, slotCount) {
  const slotWidth = panel.width / Math.max(1, slotCount);
  return panel.x + slotWidth * (index + 0.5);
}

function movingAverage(rows, period) {
  let sum = 0;
  return rows.map((row, index) => {
    sum += Number(row.close);
    if (index >= period) sum -= Number(rows[index - period].close);
    return index >= period - 1 ? sum / period : null;
  });
}

function drawDailyChart() {
  const rows = state.dailyPayload?.rows || [];
  if (!rows.length) return;
  const chartRows = rows.map((row) => ({ ...row }));
  for (const [key, period] of [["ma5", 5], ["ma10", 10], ["ma20", 20]]) {
    const values = movingAverage(chartRows, period);
    chartRows.forEach((row, index) => {
      row[key] = values[index];
    });
  }

  const context = setupCanvas();
  const geometry = dailyChartGeometry(nodes.canvas);
  const [pricePanel, amountPanel] = geometry.panels;
  const slotCount = dailySlotCount(chartRows);
  const slotWidth = pricePanel.width / slotCount;
  context.clearRect(0, 0, geometry.width, geometry.height);
  context.font = '11px Arial, "Microsoft YaHei", sans-serif';
  context.lineJoin = "round";
  context.lineCap = "round";

  for (const panel of geometry.panels) {
    context.fillStyle = "#fff";
    context.fillRect(panel.x, panel.y, panel.width, panel.height);
    context.strokeStyle = "#dfe5da";
    context.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.width - 1, panel.height - 1);
    for (let line = 1; line < 5; line += 1) {
      const y = panel.y + (panel.height * line) / 5;
      context.strokeStyle = "#edf0ea";
      context.beginPath();
      context.moveTo(panel.x, y);
      context.lineTo(panel.x + panel.width, y);
      context.stroke();
    }
  }

  const priceDomain = domain(
    chartRows.flatMap((row) => [row.low, row.high, row.ma5, row.ma10, row.ma20]),
    { padding: 0.05 },
  );
  const amountDomain = domain(chartRows.map((row) => row.amount), {
    includeZero: true,
    padding: 0.03,
  });
  const candleWidth = Math.max(1.5, Math.min(9, slotWidth * 0.62));
  chartRows.forEach((row, index) => {
    const x = dailyXFor(index, pricePanel, slotCount);
    const openY = yFor(row.open, pricePanel, priceDomain);
    const closeY = yFor(row.close, pricePanel, priceDomain);
    const highY = yFor(row.high, pricePanel, priceDomain);
    const lowY = yFor(row.low, pricePanel, priceDomain);
    const rising = Number(row.close) >= Number(row.open);
    const color = rising ? "#df2434" : "#159447";
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, highY);
    context.lineTo(x, lowY);
    context.stroke();
    context.fillStyle = rising ? "rgba(223,36,52,.18)" : "rgba(21,148,71,.22)";
    context.strokeStyle = color;
    const bodyY = Math.min(openY, closeY);
    const bodyHeight = Math.max(1.2, Math.abs(openY - closeY));
    context.fillRect(x - candleWidth / 2, bodyY, candleWidth, bodyHeight);
    context.strokeRect(x - candleWidth / 2, bodyY, candleWidth, bodyHeight);
  });
  drawLine(context, chartRows, pricePanel, priceDomain, "ma5", "#e2a51a", 1.2);
  drawLine(context, chartRows, pricePanel, priceDomain, "ma10", "#d638c2", 1.2);
  drawLine(context, chartRows, pricePanel, priceDomain, "ma20", "#1f5fbf", 1.2);
  drawBars(
    context,
    chartRows,
    amountPanel,
    amountDomain,
    (row) => row.close >= row.open ? "rgba(223,36,52,.62)" : "rgba(21,148,71,.62)",
  );

  context.fillStyle = "#586355";
  context.font = '10px Arial, "Microsoft YaHei", sans-serif';
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillText("日K", pricePanel.x + 6, pricePanel.y + 10);
  context.fillText("成交额", amountPanel.x + 6, amountPanel.y + 10);
  for (const [panel, range, key] of [
    [pricePanel, priceDomain, "price"],
    [amountPanel, amountDomain, "amount"],
  ]) {
    for (const ratio of [0.15, 0.5, 0.85]) {
      const value = range[1] - (range[1] - range[0]) * ratio;
      const y = panel.y + panel.height * ratio;
      context.textAlign = "right";
      context.fillText(formatAxis(value, key), panel.x - 6, y);
    }
  }
  const labels = [...new Set([
    0,
    Math.floor((chartRows.length - 1) / 4),
    Math.floor((chartRows.length - 1) / 2),
    Math.floor(((chartRows.length - 1) * 3) / 4),
    chartRows.length - 1,
  ])];
  context.textBaseline = "top";
  labels.forEach((index, labelIndex) => {
    const x = dailyXFor(index, amountPanel, slotCount);
    context.textAlign = labelIndex === 0 ? "left" : labelIndex === labels.length - 1 ? "right" : "center";
    context.fillText(displayDailyDate(chartRows[index]?.date).slice(5), x, amountPanel.y + amountPanel.height + 7);
  });

  if (state.selectedIndex >= 0) {
    const index = Math.max(0, Math.min(chartRows.length - 1, state.selectedIndex));
    const x = dailyXFor(index, pricePanel, slotCount);
    context.save();
    context.strokeStyle = "rgba(48,61,51,.48)";
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(x, pricePanel.y);
    context.lineTo(x, amountPanel.y + amountPanel.height);
    context.stroke();
    context.restore();
  }
}

function drawPanels(context, geometry, rows) {
  const [pricePanel, amountPanel, macdPanel, darkPanel, visiblePanel] = geometry.panels;
  for (const panel of geometry.panels) {
    context.fillStyle = "#ffffff";
    context.fillRect(panel.x, panel.y, panel.width, panel.height);
    context.strokeStyle = "#dfe5da";
    context.lineWidth = 1;
    context.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.width - 1, panel.height - 1);
    for (let line = 1; line < 4; line += 1) {
      const y = panel.y + (panel.height * line) / 4;
      context.strokeStyle = "#edf0ea";
      context.beginPath();
      context.moveTo(panel.x, y);
      context.lineTo(panel.x + panel.width, y);
      context.stroke();
    }
  }

  const priceDomain = domain(
    rows.flatMap((row) => [
      row.low,
      row.high,
      row.intraday_average,
      row.purple,
      state.payload?.previous_close,
    ]),
    { padding: 0.06 },
  );
  drawHighLowBand(context, rows, pricePanel, priceDomain);
  if (Number(state.payload?.previous_close) > 0) {
    drawHorizontalLine(
      context,
      pricePanel,
      priceDomain,
      Number(state.payload.previous_close),
      "#7d8998",
      [4, 4],
    );
  }
  drawLine(context, rows, pricePanel, priceDomain, "close", "#1f5fbf", 1.55);
  drawLine(
    context,
    rows,
    pricePanel,
    priceDomain,
    "intraday_average",
    "#e2a51a",
    1.35,
  );
  drawLine(context, rows, pricePanel, priceDomain, "purple", "#c6ccd6", 1.05, [2, 3]);
  drawConditionalLine(
    context,
    rows,
    pricePanel,
    priceDomain,
    "purple",
    (row) => (row.purple_rising ? "#d638c2" : "#139a55"),
    1.8,
  );

  const amountDomain = domain(rows.map((row) => row.amount), { includeZero: true, padding: 0.05 });
  drawBars(context, rows, amountPanel, amountDomain, (row) =>
    row.close >= row.open ? "rgba(223,36,52,.68)" : "rgba(21,148,71,.68)",
  );

  const darkDomain = domain(
    rows.flatMap((row) => [row.dark_buy, row.dark_sell]),
    { includeZero: true, padding: 0.08 },
  );
  drawBars(context, rows, darkPanel, darkDomain, (row) =>
    row.dark_state === "inflow" ? "rgba(154,44,53,.72)" : "rgba(63,120,181,.72)",
    (row) => (row.dark_state === "inflow" ? row.dark_buy : row.dark_sell),
  );
  drawZeroLine(context, darkPanel, darkDomain);

  const macdDomain = domain(
    rows.flatMap((row) => [row.macd, row.dif, row.dea]),
    { includeZero: true, padding: 0.08 },
  );
  drawBars(
    context,
    rows,
    macdPanel,
    macdDomain,
    (row) => (row.macd >= 0 ? "rgba(223,36,52,.55)" : "rgba(21,148,71,.55)"),
    (row) => row.macd,
  );
  drawLine(context, rows, macdPanel, macdDomain, "dif", "#32275f", 1.15);
  drawLine(context, rows, macdPanel, macdDomain, "dea", "#d08a18", 1.05);
  drawZeroLine(context, macdPanel, macdDomain);

  const visibleDomain = domain(
    rows.flatMap((row) => [row.visible_funds, row.visible_funds_aa]),
    { includeZero: true, includeValue: 100, padding: 0.05 },
  );
  drawBars(
    context,
    rows,
    visiblePanel,
    visibleDomain,
    (row) =>
      row.visible_funds >= 100 ? "rgba(164,19,32,.82)" : "rgba(239,113,119,.72)",
    (row) => row.visible_funds,
  );
  drawLine(context, rows, visiblePanel, visibleDomain, "visible_funds_aa", "#8e2434", 1.0);
  drawHorizontalLine(context, visiblePanel, visibleDomain, 100, "#b13d49", [4, 3]);
  drawVisibleCrosses(context, rows, visiblePanel, visibleDomain);
  drawHalfHourSeparators(context, geometry.panels, rows);

  return {
    price: priceDomain,
    amount: amountDomain,
    dark: darkDomain,
    macd: macdDomain,
    visible: visibleDomain,
  };
}

function drawHighLowBand(context, rows, panel, range) {
  if (rows.length < 2) return;
  context.save();
  context.fillStyle = "rgba(31,95,191,.08)";
  context.beginPath();
  rows.forEach((row, index) => {
    const x = xFor(index, panel, rows.length);
    const y = yFor(row.high, panel, range);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    context.lineTo(
      xFor(index, panel, rows.length),
      yFor(rows[index].low, panel, range),
    );
  }
  context.closePath();
  context.fill();
  context.restore();
}

function drawHalfHourSeparators(context, panels, rows) {
  if (!panels.length || !rows.length) return;
  const firstPanel = panels[0];
  const lastPanel = panels.at(-1);
  const top = firstPanel.y;
  const bottom = lastPanel.y + lastPanel.height;
  const boundaries = [];
  rows.forEach((row, index) => {
    const time = String(row.time || "");
    if (index === 0 || !/:(00|30)$/.test(time)) return;
    const x = xFor(index, firstPanel, rows.length);
    const previous = boundaries.at(-1);
    if (previous && x - previous.x < 14) {
      previous.x = (previous.x + x) / 2;
      previous.label = `${previous.label}/${time}`;
      return;
    }
    boundaries.push({ x, label: time });
  });
  context.save();
  context.strokeStyle = "rgba(93, 105, 94, .38)";
  context.lineWidth = 0.8;
  context.setLineDash([4, 4]);
  context.fillStyle = "#7a8478";
  context.font = '9px Arial, "Microsoft YaHei", sans-serif';
  context.textAlign = "center";
  context.textBaseline = "bottom";
  boundaries.forEach(({ x, label }) => {
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, bottom);
    context.stroke();
    context.fillText(label, x, firstPanel.y + firstPanel.height - 4);
  });
  context.restore();
}

function drawLine(context, rows, panel, range, key, color, width, dash = []) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.setLineDash(dash);
  context.beginPath();
  let started = false;
  rows.forEach((row, index) => {
    const rawValue = row[key];
    const value =
      rawValue === null || rawValue === undefined || rawValue === ""
        ? Number.NaN
        : Number(rawValue);
    if (!Number.isFinite(value)) {
      started = false;
      return;
    }
    const x = xFor(index, panel, rows.length);
    const y = yFor(value, panel, range);
    if (!started) {
      context.moveTo(x, y);
      started = true;
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();
  context.restore();
}

function drawConditionalLine(context, rows, panel, range, key, colorForRow, width) {
  context.save();
  context.lineWidth = width;
  for (let index = 1; index < rows.length; index += 1) {
    const previous = Number(rows[index - 1][key]);
    const value = Number(rows[index][key]);
    if (!Number.isFinite(previous) || !Number.isFinite(value)) continue;
    context.strokeStyle = colorForRow(rows[index]);
    context.beginPath();
    context.moveTo(xFor(index - 1, panel, rows.length), yFor(previous, panel, range));
    context.lineTo(xFor(index, panel, rows.length), yFor(value, panel, range));
    context.stroke();
  }
  context.restore();
}

function drawBars(context, rows, panel, range, colorForRow, valueForRow = (row) => row.amount) {
  const barWidth = Math.max(1, Math.min(5, (panel.width / rows.length) * 0.72));
  const zeroY = yFor(0, panel, range);
  rows.forEach((row, index) => {
    const value = Number(valueForRow(row));
    if (!Number.isFinite(value)) return;
    const x = xFor(index, panel, rows.length) - barWidth / 2;
    const valueY = yFor(value, panel, range);
    context.fillStyle = colorForRow(row);
    context.fillRect(x, Math.min(zeroY, valueY), barWidth, Math.max(1, Math.abs(zeroY - valueY)));
  });
}

function drawHorizontalLine(context, panel, range, value, color, dash = []) {
  const y = yFor(value, panel, range);
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 0.8;
  context.setLineDash(dash);
  context.beginPath();
  context.moveTo(panel.x, y);
  context.lineTo(panel.x + panel.width, y);
  context.stroke();
  context.restore();
}

function drawZeroLine(context, panel, range) {
  drawHorizontalLine(context, panel, range, 0, "#9ca69b");
}

function drawVisibleCrosses(context, rows, panel, range) {
  context.fillStyle = "#ad1d2a";
  for (let index = 1; index < rows.length; index += 1) {
    const previous = Number(rows[index - 1].visible_funds);
    const current = Number(rows[index].visible_funds);
    if (!(previous < 100 && current >= 100)) continue;
    const x = xFor(index, panel, rows.length);
    const y = yFor(current, panel, range) - 4;
    context.beginPath();
    context.moveTo(x, y - 4);
    context.lineTo(x - 3.5, y + 2);
    context.lineTo(x + 3.5, y + 2);
    context.closePath();
    context.fill();
  }
}

function drawAxes(context, geometry, rows, domains) {
  context.fillStyle = "#657064";
  context.font = '10px Arial, "Microsoft YaHei", sans-serif';
  context.textBaseline = "middle";
  geometry.panels.forEach((panel) => {
    const range = domains[panel.key];
    context.fillStyle = "#586355";
    context.textAlign = "left";
    context.fillText(panel.label, panel.x + 6, panel.y + 10);
    for (const ratio of [0.15, 0.5, 0.85]) {
      const value = range[1] - (range[1] - range[0]) * ratio;
      const y = panel.y + panel.height * ratio;
      context.textAlign = "right";
      context.fillText(formatAxis(value, panel.key), panel.x - 6, y);
      if (panel.key === "price" && Number(state.payload?.previous_close) > 0) {
        const returnValue = (value / Number(state.payload.previous_close) - 1) * 100;
        context.fillStyle = "#596579";
        context.textAlign = "left";
        context.fillText(
          `${returnValue > 0 ? "+" : ""}${returnValue.toFixed(1)}%`,
          panel.x + panel.width + 6,
          y,
        );
        context.fillStyle = "#586355";
      }
    }
    if (panel.key === "price" && Number(state.payload?.previous_close) > 0) {
      context.fillStyle = "#596579";
      context.textAlign = "right";
      context.fillText("当日涨跌幅", panel.x + panel.width - 6, panel.y + 10);
    }
  });

  const lastPanel = geometry.panels.at(-1);
  const labels = [0, Math.floor((rows.length - 1) / 4), Math.floor((rows.length - 1) / 2), Math.floor(((rows.length - 1) * 3) / 4), rows.length - 1];
  context.textBaseline = "top";
  labels.forEach((index, labelIndex) => {
    const x = xFor(index, lastPanel, rows.length);
    context.textAlign = labelIndex === 0 ? "left" : labelIndex === labels.length - 1 ? "right" : "center";
    context.fillText(rows[index]?.time || "", x, lastPanel.y + lastPanel.height + 7);
  });
}

function formatAxis(value, key) {
  if (key === "amount") return formatAmount(value).replace("元", "");
  if (key === "price") return Number(value).toFixed(2);
  return Math.abs(value) >= 100 ? Number(value).toFixed(0) : Number(value).toFixed(2);
}

function drawEvents(context, panel, rows, priceDomain) {
  const events = state.payload?.events || [];
  if (!events.length) return;
  const indexByTime = new Map(rows.map((row, index) => [row.time, index]));
  const lanes = new Map();
  for (const event of events) {
    const sourceTime = String(event.details?.source_bar_time || event.event_time || "").slice(11, 16);
    const index = indexByTime.get(sourceTime);
    if (index === undefined) continue;
    const lane = lanes.get(index) || 0;
    lanes.set(index, lane + 1);
    const x = xFor(index, panel, rows.length);
    const up = event.direction !== "down";
    const anchor = Number(event.price) || Number(rows[index].close);
    const y = yFor(anchor, panel, priceDomain) + (up ? -9 - lane * 7 : 9 + lane * 7);
    context.fillStyle = up ? "#df2434" : "#159447";
    context.beginPath();
    if (up) {
      context.moveTo(x, y - 4);
      context.lineTo(x - 3.5, y + 3);
      context.lineTo(x + 3.5, y + 3);
    } else {
      context.moveTo(x, y + 4);
      context.lineTo(x - 3.5, y - 3);
      context.lineTo(x + 3.5, y - 3);
    }
    context.closePath();
    context.fill();
  }
}

function drawCrosshair(context, geometry, rows, index) {
  const panel = geometry.panels[0];
  const x = xFor(index, panel, rows.length);
  context.save();
  context.strokeStyle = "rgba(48,61,51,.42)";
  context.lineWidth = 0.8;
  context.setLineDash([3, 3]);
  context.beginPath();
  context.moveTo(x, geometry.panels[0].y);
  context.lineTo(x, geometry.panels.at(-1).y + geometry.panels.at(-1).height);
  context.stroke();
  context.restore();
}

function selectedIndexFromPointer(event) {
  const rows =
    state.view === "daily"
      ? state.dailyPayload?.rows || []
      : state.payload?.rows || [];
  if (!rows.length) return -1;
  const geometry =
    state.view === "daily"
      ? dailyChartGeometry(nodes.canvas)
      : chartGeometry(nodes.canvas);
  const panel = geometry.panels[0];
  const rect = nodes.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  if (state.view === "daily") {
    const slotCount = dailySlotCount(rows);
    const slotWidth = panel.width / slotCount;
    const index = Math.floor((x - panel.x) / slotWidth);
    return index >= 0 && index < rows.length ? index : -1;
  }
  const ratio = Math.max(0, Math.min(1, (x - panel.x) / panel.width));
  return Math.round(ratio * (rows.length - 1));
}

function showTooltip(event) {
  const index = selectedIndexFromPointer(event);
  if (index < 0) {
    if (!nodes.tooltip.hidden || state.selectedIndex >= 0) {
      nodes.tooltip.hidden = true;
      state.selectedIndex = -1;
      drawChart();
    }
    return;
  }
  state.selectedIndex = index;
  if (state.view === "daily") {
    showDailyTooltip(event, index);
    return;
  }
  const row = state.payload.rows[index];
  const nearbyEvents = state.payload.events.filter((item) => {
    const source = String(item.details?.source_bar_time || item.event_time || "").slice(11, 16);
    return source === row.time;
  });
  nodes.tooltip.innerHTML = `
    <strong>${row.time}　${formatNumber(row.close, 3)}</strong>
    开 ${formatNumber(row.open, 3)}　高 ${formatNumber(row.high, 3)}　低 ${formatNumber(row.low, 3)}<br>
    涨跌幅 ${formatMinuteReturn(row.close)}<br>
    紫线 ${formatNumber(row.purple, 3)}　成交额 ${formatAmount(row.amount)}<br>
    均价≈ ${formatNumber(row.intraday_average, 3)}<br>
    暗盘 ${row.dark_state === "inflow" ? "流入" : "流出"}　MACD ${formatNumber(row.macd, 4)}<br>
    明盘资金 ${formatNumber(row.visible_funds, 2)}
    ${nearbyEvents.length ? `<br>信号：${nearbyEvents.map((item) => escapeHtml(EVENT_LABELS[item.event_type] || item.event_type)).join("、")}` : ""}
  `;
  nodes.tooltip.hidden = false;
  const wrapRect = nodes.chartWrap.getBoundingClientRect();
  const left = event.clientX - wrapRect.left + 14;
  const top = event.clientY - wrapRect.top + 12;
  const maxLeft = nodes.chartWrap.clientWidth - nodes.tooltip.offsetWidth - 8;
  const maxTop = nodes.chartWrap.clientHeight - nodes.tooltip.offsetHeight - 8;
  nodes.tooltip.style.left = `${Math.max(8, Math.min(maxLeft, left))}px`;
  nodes.tooltip.style.top = `${Math.max(8, Math.min(maxTop, top))}px`;
  drawChart();
}

function showDailyTooltip(event, index) {
  const rows = state.dailyPayload?.rows || [];
  const row = rows[index];
  if (!row) return;
  nodes.tooltip.innerHTML = `
    <strong>${displayDailyDate(row.date)}　${formatNumber(row.close, 3)}</strong>
    开 ${formatNumber(row.open, 3)}　高 ${formatNumber(row.high, 3)}　低 ${formatNumber(row.low, 3)}<br>
    涨跌幅 ${Number(row.change) > 0 ? "+" : ""}${formatNumber(row.change, 2)}%<br>
    成交额 ${formatAmount(row.amount)}　成交量 ${Number(row.volume || 0).toLocaleString("zh-CN")}
  `;
  nodes.tooltip.hidden = false;
  const wrapRect = nodes.chartWrap.getBoundingClientRect();
  const left = event.clientX - wrapRect.left + 14;
  const top = event.clientY - wrapRect.top + 12;
  const maxLeft = nodes.chartWrap.clientWidth - nodes.tooltip.offsetWidth - 8;
  const maxTop = nodes.chartWrap.clientHeight - nodes.tooltip.offsetHeight - 8;
  nodes.tooltip.style.left = `${Math.max(8, Math.min(maxLeft, left))}px`;
  nodes.tooltip.style.top = `${Math.max(8, Math.min(maxTop, top))}px`;
  drawChart();
}

function formatMinuteReturn(price) {
  const previousClose = Number(state.payload?.previous_close);
  if (!(previousClose > 0) || !Number.isFinite(Number(price))) return "-";
  const value = (Number(price) / previousClose - 1) * 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

nodes.canvas.addEventListener("pointermove", showTooltip);
nodes.canvas.addEventListener("dblclick", (event) => {
  if (state.view !== "daily") return;
  const index = selectedIndexFromPointer(event);
  if (index < 0) return;
  event.preventDefault();
  void openDailyIntraday(index);
});
nodes.canvas.addEventListener("pointerleave", () => {
  nodes.tooltip.hidden = true;
  state.selectedIndex = -1;
  drawChart();
});
nodes.refreshButton.addEventListener("click", () => {
  if (state.view === "daily") {
    loadDaily();
  } else {
    loadBond({ date: state.manualDate ? nodes.dateSelect.value : "" });
  }
});
nodes.dateSelect.addEventListener("change", () => {
  state.manualDate = true;
  loadBond({ date: nodes.dateSelect.value });
});
nodes.dailyRangeSelect.addEventListener("change", loadDaily);
nodes.intradayViewButton.addEventListener("click", () => setView("intraday"));
nodes.dailyViewButton.addEventListener("click", () => setView("daily"));
nodes.backLink.addEventListener("click", (event) => {
  if (isEmbedded && window.parent !== window) {
    event.preventDefault();
    window.parent.postMessage({ type: "finance:close-bond-overlay" }, window.location.origin);
    return;
  }
  if (!isBoardReferrer() || window.history.length <= 1) return;
  event.preventDefault();
  window.history.back();
});
window.addEventListener("resize", () => {
  window.clearTimeout(state.resizeTimer);
  state.resizeTimer = window.setTimeout(drawChart, 100);
});

nodes.name.textContent = requestedName || "可转债";
nodes.code.textContent = requestedCode;
setView(state.view, { updateUrl: false, force: true });
