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
  macd_above_water_golden_cross: "MACD水上金叉",
  underwater_golden_cross_purple_confirmed: "水下金叉·紫线确认",
  purple_line_pullback_reclaim: "回踩紫线后收回",
  intraday_average_pullback_reclaim: "回踩均线后收回",
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
  at_up_limit: "触及涨停",
  open_high: "高开",
  open_low: "低开",
  volume_surge: "分钟放量",
};

const params = new URLSearchParams(window.location.search);
const requestedCode = String(params.get("code") || "").replace(/\D/g, "");
const requestedName = params.get("name") || "";
const SHANGHAI_CLOCK_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const state = {
  payload: null,
  intradayPayloads: [],
  intradayRows: [],
  intradayPayloadCache: new Map(),
  intradayPayloadRequests: new Map(),
  intradayPayloadRetryAt: new Map(),
  dailyPayload: null,
  referenceDailyPayload: null,
  referenceDailyRequest: null,
  referenceDailyTimer: 0,
  referenceDailyFailureCount: 0,
  referenceDailyNextAllowedAt: 0,
  metadata: null,
  view: params.get("view") === "daily" ? "daily" : "intraday",
  selectedIndex: -1,
  refreshTimer: 0,
  panelHistoryBackfillTimer: 0,
  panelHistoryBackfillLoading: false,
  panelHistoryBackfillFailureCount: 0,
  panelHistoryBackfillNextAllowedAt: 0,
  panelHistoryBackfillTradingDate: "",
  manualBackfillJob: null,
  manualBackfillGeneration: 0,
  manualBackfillPollTimer: 0,
  manualBackfillPollToken: "",
  manualBackfillPollFailureCount: 0,
  manualBackfillReloadedJobKey: "",
  manualBackfillRedrawJobKey: "",
  manualBackfillRedrawRequest: null,
  manualBackfillRedrawFailureCount: 0,
  resizeTimer: 0,
  requestId: 0,
  manualDate: Boolean(params.get("date")),
  intradayDays: Math.max(1, Math.min(5, Number(params.get("days")) || 1)),
  tagOrder: [],
  tagDraft: new Set(),
  orderBook: null,
  bookTimer: 0,
  bookLoading: false,
  bookFailureCount: 0,
  tradingCapabilities: null,
  tradeSessionToken: "",
  tradeSessionExpiresAt: 0,
  tradeSessionTicker: 0,
  quickPriceMode: "ask1",
  pendingQuickPreview: null,
  quickConfirmReadyAt: 0,
  holdTimer: 0,
  holdStartedAt: 0,
  quickSubmitting: false,
  panelMetricKeys: null,
  panelActive: true,
};

const pageParams = new URLSearchParams(window.location.search);
const isPanel = pageParams.get("panel") === "1";
const isEmbedded = pageParams.get("embedded") === "1" || isPanel;

const nodes = {
  backLink: document.querySelector(".back-link"),
  name: document.querySelector("#bondName"),
  code: document.querySelector("#bondCode"),
  tags: document.querySelector("#bondTags"),
  manageTagsButton: document.querySelector("#manageTagsButton"),
  tagEditor: document.querySelector("#tagEditor"),
  tagOptions: document.querySelector("#tagOptions"),
  tagEditorStatus: document.querySelector("#tagEditorStatus"),
  cancelTagsButton: document.querySelector("#cancelTagsButton"),
  saveTagsButton: document.querySelector("#saveTagsButton"),
  latestPrice: document.querySelector("#latestPrice"),
  latestChange: document.querySelector("#latestChange"),
  premiumRate: document.querySelector("#premiumRate"),
  premiumDetail: document.querySelector("#premiumDetail"),
  circulatingAmount: document.querySelector("#circulatingAmount"),
  circulatingDetail: document.querySelector("#circulatingDetail"),
  circulatingMarketValue: document.querySelector("#circulatingMarketValue"),
  marketValueDetail: document.querySelector("#marketValueDetail"),
  redeemRiskCard: document.querySelector("#redeemRiskCard"),
  redeemRisk: document.querySelector("#redeemRisk"),
  redeemDetail: document.querySelector("#redeemDetail"),
  redeemAnnouncementLink: document.querySelector("#redeemAnnouncementLink"),
  maturityCard: document.querySelector("#maturityCard"),
  maturityCountdown: document.querySelector("#maturityCountdown"),
  maturityDetail: document.querySelector("#maturityDetail"),
  stockMarketCard: document.querySelector("#stockMarketCard"),
  stockName: document.querySelector("#stockName"),
  stockCode: document.querySelector("#stockCode"),
  stockPrice: document.querySelector("#stockPrice"),
  stockChange: document.querySelector("#stockChange"),
  stockSparkline: document.querySelector("#stockSparkline"),
  totalAmountLabel: document.querySelector("#totalAmountLabel"),
  totalAmount: document.querySelector("#totalAmount"),
  volumeRatioCard: document.querySelector("#volumeRatioCard"),
  volumeRatio: document.querySelector("#volumeRatio"),
  purplePriceCard: document.querySelector("#purplePriceCard"),
  purplePrice: document.querySelector("#purplePrice"),
  purpleSupportCard: document.querySelector("#purpleSupportCard"),
  purpleSupportCount: document.querySelector("#purpleSupportCount"),
  purpleBreakCard: document.querySelector("#purpleBreakCard"),
  purpleBreakCount: document.querySelector("#purpleBreakCount"),
  averageSupportCard: document.querySelector("#averageSupportCard"),
  averageSupportCount: document.querySelector("#averageSupportCount"),
  eventCountLabel: document.querySelector("#eventCountLabel"),
  eventCount: document.querySelector("#eventCount"),
  intradayViewButton: document.querySelector("#intradayViewButton"),
  dailyViewButton: document.querySelector("#dailyViewButton"),
  dateControl: document.querySelector("#dateControl"),
  dateSelect: document.querySelector("#dateSelect"),
  intradayDaysControl: document.querySelector("#intradayDaysControl"),
  intradayDaysSelect: document.querySelector("#intradayDaysSelect"),
  dailyRangeControl: document.querySelector("#dailyRangeControl"),
  dailyRangeSelect: document.querySelector("#dailyRangeSelect"),
  refreshButton: document.querySelector("#refreshButton"),
  connectionStatus: document.querySelector("#connectionStatus"),
  dataAlert: document.querySelector("#dataAlert"),
  chartWrap: document.querySelector("#chartWrap"),
  canvas: document.querySelector("#indicatorChart"),
  tooltip: document.querySelector("#chartTooltip"),
  eventList: document.querySelector("#eventList"),
  eventsTitle: document.querySelector("#eventsTitle"),
  intradayLegend: document.querySelector("#intradayLegend"),
  intradayLegendNote: document.querySelector("#intradayLegendNote"),
  panelMetricControls: document.querySelector("#panelMetricControls"),
  dailyLegend: document.querySelector("#dailyLegend"),
  eventsCard: document.querySelector(".events-card"),
  dataFootnote: document.querySelector("#dataFootnote"),
  tradePanel: document.querySelector("#bondTradePanel"),
  bookStatus: document.querySelector("#bookStatus"),
  bookLastPrice: document.querySelector("#bookLastPrice"),
  bookChange: document.querySelector("#bookChange"),
  bookTime: document.querySelector("#bookTime"),
  orderBook: document.querySelector("#orderBook"),
  bookSpread: document.querySelector("#bookSpread"),
  quickTradeAccess: document.querySelector("#quickTradeAccess"),
  quickTradeUnlock: document.querySelector("#quickTradeUnlock"),
  quickBuyForm: document.querySelector("#quickBuyForm"),
  quickBuyAccount: document.querySelector("#quickBuyAccount"),
  quickBuyPrice: document.querySelector("#quickBuyPrice"),
  quickBuyVolume: document.querySelector("#quickBuyVolume"),
  quickPriceButtons: document.querySelector("#quickPriceButtons"),
  quickVolumeButtons: document.querySelector("#quickVolumeButtons"),
  quickBuyPreview: document.querySelector("#quickBuyPreview"),
  quickTradeMessage: document.querySelector("#quickTradeMessage"),
  tradeUnlockDialog: document.querySelector("#bondTradeUnlockDialog"),
  tradeUnlockForm: document.querySelector("#bondTradeUnlockForm"),
  unlockPhrase: document.querySelector("#bondUnlockPhrase"),
  unlockInput: document.querySelector("#bondUnlockInput"),
  unlockMessage: document.querySelector("#bondUnlockMessage"),
  tradeConfirmDialog: document.querySelector("#bondTradeConfirmDialog"),
  tradeConfirmForm: document.querySelector("#bondTradeConfirmForm"),
  tradePreviewSummary: document.querySelector("#bondTradePreviewSummary"),
  tradeConfirmMessage: document.querySelector("#bondTradeConfirmMessage"),
  executeQuickBuy: document.querySelector("#executeQuickBuy"),
};

if (isEmbedded) {
  document.documentElement.classList.add("is-embedded");
}
if (isPanel) {
  document.documentElement.classList.add("is-panel");
}

const panelDefinitions = [
  { key: "price", label: "价格", weight: 0.33 },
  { key: "amount", label: "分钟成交额", weight: 0.11 },
  { key: "volumeRatio", label: "量比", weight: 0.10 },
  { key: "macd", label: "MACD", weight: 0.16 },
  { key: "dark", label: "暗盘资金", weight: 0.14 },
  { key: "visible", label: "明盘资金", weight: 0.16 },
];
const PANEL_METRIC_STORAGE_KEY = "finance-board:bond-panel-metrics:v1";
const DEFAULT_PANEL_METRIC_KEYS = ["price", "volumeRatio", "macd", "visible"];
const INTRADAY_TOTAL_MINUTES = 240;
const INTRADAY_AXIS_LABELS = [
  { minute: 0, label: "09:30" },
  { minute: 60, label: "10:30" },
  { minute: 120, label: "11:30 / 13:00" },
  { minute: 180, label: "14:00" },
  { minute: 240, label: "15:00" },
];
const INTRADAY_GRID_MINUTES = [30, 60, 90, 120, 150, 180, 210];
const ORDER_BOOK_REFRESH_INTERVAL_MS = 1000;
const ORDER_BOOK_FAILURE_RETRY_BASE_MS = 15_000;
const ORDER_BOOK_FAILURE_RETRY_MAX_MS = 30_000;
const ORDER_BOOK_MAX_AGE_MS = 15_000;
const ORDER_BOOK_FUTURE_TOLERANCE_MS = 5_000;
const PANEL_HISTORY_BACKFILL_INITIAL_DELAY_MS = 1_500;
const PANEL_HISTORY_BACKFILL_PENDING_DELAY_MS = 5_000;
const PANEL_HISTORY_BACKFILL_PARTIAL_DELAY_MS = 30_000;
const PANEL_HISTORY_BACKFILL_FAILURE_BASE_MS = 15_000;
const PANEL_HISTORY_BACKFILL_FAILURE_MAX_MS = 120_000;
const PANEL_HISTORY_BACKFILL_SUCCESS_COOLDOWN_MS = 60_000;
const MANUAL_BACKFILL_MIN_POLL_MS = 3_000;
const MANUAL_BACKFILL_DEFAULT_POLL_MS = 5_000;
const MANUAL_BACKFILL_POLL_FAILURE_MAX_MS = 30_000;
const MANUAL_BACKFILL_MARKET_WAIT_POLL_MS = 30_000;
const MANUAL_BACKFILL_REDRAW_RETRY_BASE_MS = 5_000;
const MANUAL_BACKFILL_REDRAW_RETRY_MAX_MS = 30_000;
const INTRADAY_HISTORY_FAILURE_RETRY_MS = 60_000;
const REFERENCE_DAILY_INITIAL_DELAY_MS = 0;
const REFERENCE_DAILY_FAILURE_BASE_MS = 15_000;
const REFERENCE_DAILY_FAILURE_MAX_MS = 120_000;

function formatNumber(value, digits = 2) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? Number(value).toFixed(digits)
    : "-";
}

function formatAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (Math.abs(number) >= 1e8) return `${(number / 1e8).toFixed(2)}亿`;
  if (Math.abs(number) >= 1e4) return `${(number / 1e4).toFixed(1)}万`;
  return `${number.toFixed(0)}元`;
}

function formatPercent(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function renderBondMetadata(payload) {
  state.metadata = payload;
  nodes.premiumRate.textContent = formatPercent(payload.premium_rate);
  nodes.premiumRate.className = Number(payload.premium_rate) >= 30 ? "is-hot" : "";
  nodes.premiumDetail.textContent =
    `转股价值 ${formatNumber(payload.conversion_value, 2)} · ` +
    `正股 ${formatNumber(payload.stock_price, 2)} / 转股价 ${formatNumber(payload.conversion_price, 2)}`;
  nodes.circulatingAmount.textContent = formatAmount(payload.circulating_face_value);
  nodes.circulatingDetail.textContent =
    `${payload.circulating_source || "MiniQMT"} · 未转股面值`;
  nodes.circulatingMarketValue.textContent = formatAmount(payload.circulating_market_value);
  nodes.marketValueDetail.textContent =
    `按转债 ${formatNumber(payload.bond_price, 3)} 元计算`;

  const redeem = payload.redeem || {};
  nodes.redeemRisk.textContent = redeem.status || "-";
  nodes.redeemRiskCard.dataset.risk = redeem.risk || "unknown";
  const trigger = Number.isFinite(Number(redeem.trigger_price))
    ? ` · 触发价 ${formatNumber(redeem.trigger_price, 2)}`
    : "";
  nodes.redeemDetail.textContent = `${redeem.countdown || "暂无计数"}${trigger}`;
  nodes.redeemRiskCard.title = redeem.quality || "公司正式公告优先";
  const announcement = redeem.announcement || {};
  nodes.redeemAnnouncementLink.hidden = !announcement.url;
  if (announcement.url) {
    nodes.redeemAnnouncementLink.href = announcement.url;
    const noticeDate = displayDailyDate(announcement.notice_date);
    nodes.redeemAnnouncementLink.textContent =
      `${announcement.status || "强赎公告"}${noticeDate !== "-" ? ` · ${noticeDate}` : ""}`;
    nodes.redeemAnnouncementLink.title = announcement.title || "查看公司公告";
  }
  const maturity = payload.maturity || {};
  nodes.maturityCountdown.textContent = maturity.status || "-";
  nodes.maturityCard.dataset.risk = maturity.risk || "unknown";
  nodes.maturityDetail.textContent = maturity.countdown || "暂无到期条款";
  nodes.maturityCard.title = maturity.quality || "按合同到期日计算自然日";
  const stockLabel = payload.stock_name || "正股";
  const stockCode = payload.stock_code || "";
  nodes.stockName.textContent = stockLabel;
  nodes.stockCode.textContent = stockCode;
  nodes.stockMarketCard.title = `${stockLabel}${stockCode ? ` ${stockCode}` : ""}`;
  nodes.stockPrice.textContent = formatNumber(payload.stock_price, 2);
  nodes.stockPrice.className = toneClass(payload.stock_change);
  nodes.stockPrice.title = nodes.stockMarketCard.title;
  nodes.stockChange.textContent = formatPercent(payload.stock_change);
  nodes.stockChange.className = toneClass(payload.stock_change);
  nodes.stockChange.title = nodes.stockMarketCard.title;
  drawCurrentStockSparkline();
}

function drawCurrentStockSparkline() {
  if (!state.metadata) return;
  drawStockSparkline(
    state.metadata.stock_intraday || [],
    state.metadata.stock_previous_close,
    state.metadata.stock_price,
  );
}

function drawStockSparkline(rows, previousClose, currentPrice) {
  const canvas = nodes.stockSparkline;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!(width > 0 && height > 0)) return;
  const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const points = rows
    .map((row) => ({ minute: intradayMinute(row.time), price: Number(row.price) }))
    .filter((row) => Number.isFinite(row.minute) && Number.isFinite(row.price));
  if (!points.length) {
    context.fillStyle = "#8a9388";
    context.font = '11px Arial, "Microsoft YaHei", sans-serif';
    context.fillText("暂无分时", 6, Math.max(13, height / 2 + 4));
    return;
  }
  const values = points.map((row) => row.price);
  if (Number.isFinite(Number(previousClose))) values.push(Number(previousClose));
  if (Number.isFinite(Number(currentPrice))) values.push(Number(currentPrice));
  let min = Math.min(...values);
  let max = Math.max(...values);
  const span = max - min || Math.max(Math.abs(max) * 0.01, 0.01);
  min -= span * 0.08;
  max += span * 0.08;
  const xFor = (minute) => 4 + (minute / INTRADAY_TOTAL_MINUTES) * (width - 8);
  const yFor = (price) => 3 + ((max - price) / (max - min || 1)) * (height - 6);
  if (Number.isFinite(Number(previousClose))) {
    context.strokeStyle = "#b7c0b3";
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(4, yFor(Number(previousClose)));
    context.lineTo(width - 4, yFor(Number(previousClose)));
    context.stroke();
    context.setLineDash([]);
  }
  const latest = Number.isFinite(Number(currentPrice))
    ? Number(currentPrice)
    : points.at(-1).price;
  context.strokeStyle = latest >= Number(previousClose) ? "#df2434" : "#159447";
  context.lineWidth = 1.5;
  context.beginPath();
  points.forEach((point, index) => {
    const x = xFor(point.minute);
    const y = yFor(point.price);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  const latestLabel = formatNumber(latest, 2);
  context.font = 'bold 10px Arial, "Microsoft YaHei", sans-serif';
  const labelWidth = context.measureText(latestLabel).width + 7;
  const labelHeight = 14;
  const labelX = Math.max(3, width - labelWidth - 3);
  const labelY = Math.max(
    2,
    Math.min(height - labelHeight - 2, yFor(latest) - labelHeight / 2),
  );
  context.fillStyle = "rgba(255,255,255,.92)";
  context.fillRect(labelX, labelY, labelWidth, labelHeight);
  context.strokeStyle = latest >= Number(previousClose) ? "#df2434" : "#159447";
  context.strokeRect(labelX + 0.5, labelY + 0.5, labelWidth - 1, labelHeight - 1);
  context.fillStyle = latest >= Number(previousClose) ? "#b81f2c" : "#127d3d";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(latestLabel, labelX + labelWidth / 2, labelY + labelHeight / 2 + 0.5);
}

async function loadBondMetadata() {
  if (!requestedCode) return;
  try {
    const query = new URLSearchParams({ code: requestedCode });
    renderBondMetadata(await fetchJson(`/api/miniqmt/bond-meta?${query}`, 65000));
  } catch (error) {
    nodes.premiumDetail.textContent = "估值数据暂不可用";
    nodes.circulatingDetail.textContent = "流通规模暂不可用";
    nodes.marketValueDetail.textContent = "流通市值暂不可用";
    nodes.redeemDetail.textContent = error.message || "强赎计数暂不可用";
    nodes.maturityDetail.textContent = "到期条款暂不可用";
  }
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

function shanghaiClockParts(now = new Date()) {
  const parts = Object.fromEntries(
    SHANGHAI_CLOCK_FORMATTER.formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const calendarDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return {
    ...parts,
    weekday: calendarDate.getUTCDay(),
    minuteOfDay: parts.hour * 60 + parts.minute,
  };
}

function shanghaiInstant(year, month, day, hour, minute) {
  return Date.UTC(year, month - 1, day, hour - 8, minute);
}

function marketRefreshWindow(now = new Date()) {
  const clock = shanghaiClockParts(now);
  const isWeekday = clock.weekday >= 1 && clock.weekday <= 5;
  const inMorning = clock.minuteOfDay >= 9 * 60 + 30 && clock.minuteOfDay < 11 * 60 + 31;
  const inAfternoon = clock.minuteOfDay >= 13 * 60 && clock.minuteOfDay < 15 * 60 + 1;
  if (isWeekday && (inMorning || inAfternoon)) {
    return { active: true, nextDelayMs: 0 };
  }

  let nextAt = 0;
  if (isWeekday && clock.minuteOfDay < 9 * 60 + 30) {
    nextAt = shanghaiInstant(clock.year, clock.month, clock.day, 9, 30);
  } else if (
    isWeekday &&
    clock.minuteOfDay >= 11 * 60 + 31 &&
    clock.minuteOfDay < 13 * 60
  ) {
    nextAt = shanghaiInstant(clock.year, clock.month, clock.day, 13, 0);
  } else {
    for (let offset = 1; offset <= 7; offset += 1) {
      const candidate = new Date(Date.UTC(clock.year, clock.month - 1, clock.day + offset));
      const weekday = candidate.getUTCDay();
      if (weekday < 1 || weekday > 5) continue;
      nextAt = shanghaiInstant(
        candidate.getUTCFullYear(),
        candidate.getUTCMonth() + 1,
        candidate.getUTCDate(),
        9,
        30,
      );
      break;
    }
  }
  return {
    active: false,
    nextDelayMs: Math.max(1000, nextAt - now.getTime()),
  };
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

async function postJson(url, body, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    return payload;
  } finally {
    window.clearTimeout(timeout);
  }
}

function applyBondPayload(payload, intradayPayloads = [payload]) {
  state.payload = payload;
  state.intradayPayloads = intradayPayloads;
  state.intradayRows = intradayPayloads.flatMap((dayPayload, dayIndex) =>
    (dayPayload.rows || []).map((row) => ({
      ...row,
      trading_date: dayPayload.trading_date,
      previous_close: dayPayload.previous_close,
      _dayIndex: dayIndex,
      _dayCount: intradayPayloads.length,
    })),
  );
  state.selectedIndex = Math.max(0, state.intradayRows.length - 1);
  renderPayload(payload);
}

function panelHistoryBackfillRequired(payload = state.payload) {
  const historyBackfill = payload?.history_backfill;
  if (!historyBackfill?.required) return false;
  const status = String(historyBackfill.status || "").toLowerCase();
  if (["pending", "queued", "running"].includes(status)) return true;
  if (["partial", "failed"].includes(status)) {
    return Number(historyBackfill.retry_in_seconds) > 0;
  }
  return false;
}

function panelHistoryBackfillAllowed() {
  return Boolean(
    isPanel
    && state.panelActive
    && !document.hidden
    && state.view === "intraday"
    && !state.manualDate
    && Number(state.intradayDays) === 1
    && !manualBackfillActiveForCurrentView()
  );
}

function clearPanelHistoryBackfillTimer() {
  window.clearTimeout(state.panelHistoryBackfillTimer);
  state.panelHistoryBackfillTimer = 0;
}

function resetPanelHistoryBackfillForDate(payload) {
  const tradingDate = String(payload?.trading_date || "");
  if (!tradingDate || tradingDate === state.panelHistoryBackfillTradingDate) return;
  clearPanelHistoryBackfillTimer();
  state.panelHistoryBackfillTradingDate = tradingDate;
  state.panelHistoryBackfillFailureCount = 0;
  state.panelHistoryBackfillNextAllowedAt = 0;
}

function panelHistoryBackfillFailureDelay() {
  return Math.min(
    PANEL_HISTORY_BACKFILL_FAILURE_MAX_MS,
    PANEL_HISTORY_BACKFILL_FAILURE_BASE_MS
      * (2 ** Math.max(0, state.panelHistoryBackfillFailureCount - 1)),
  );
}

function panelHistoryBackfillRetryDelay(payload) {
  const historyBackfill = payload?.history_backfill || {};
  const retrySeconds = Number(historyBackfill.retry_in_seconds);
  if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
    return Math.max(
      PANEL_HISTORY_BACKFILL_PENDING_DELAY_MS,
      Math.ceil(retrySeconds * 1000),
    );
  }
  return String(historyBackfill.status || "").toLowerCase() === "partial"
    ? PANEL_HISTORY_BACKFILL_PARTIAL_DELAY_MS
    : PANEL_HISTORY_BACKFILL_PENDING_DELAY_MS;
}

function schedulePanelHistoryBackfill(payload = state.payload) {
  resetPanelHistoryBackfillForDate(payload);
  if (!panelHistoryBackfillAllowed() || !panelHistoryBackfillRequired(payload)) {
    clearPanelHistoryBackfillTimer();
    return;
  }
  if (state.panelHistoryBackfillLoading || state.panelHistoryBackfillTimer) return;
  const now = Date.now();
  const firstAttemptDelay = state.panelHistoryBackfillNextAllowedAt > 0
    ? 0
    : PANEL_HISTORY_BACKFILL_INITIAL_DELAY_MS;
  const delay = Math.max(
    firstAttemptDelay,
    state.panelHistoryBackfillNextAllowedAt - now,
    0,
  );
  state.panelHistoryBackfillTimer = window.setTimeout(() => {
    state.panelHistoryBackfillTimer = 0;
    void loadPanelHistoryBackfill();
  }, delay);
}

async function loadPanelHistoryBackfill() {
  if (
    !panelHistoryBackfillAllowed()
    || state.panelHistoryBackfillLoading
    || !panelHistoryBackfillRequired(state.payload)
  ) return;
  resetPanelHistoryBackfillForDate(state.payload);
  const requestedTradingDate = String(state.payload?.trading_date || "");
  let schedulingPayload = state.payload;
  state.panelHistoryBackfillLoading = true;
  state.panelHistoryBackfillNextAllowedAt = Math.max(
    state.panelHistoryBackfillNextAllowedAt,
    Date.now() + PANEL_HISTORY_BACKFILL_PENDING_DELAY_MS,
  );
  try {
    // Omitting fast intentionally invokes the server's ordinary read-only GET.
    // The backend refreshes its existing MiniQMT minute cache asynchronously;
    // this browser path never calls a history download endpoint.
    const query = new URLSearchParams({ code: requestedCode });
    const payload = await fetchJson(`/api/miniqmt/bond?${query}`, 12000);
    schedulingPayload = payload;
    if (
      requestedTradingDate
      && String(payload.trading_date || "") !== requestedTradingDate
    ) {
      throw new Error("history_backfill_trading_date_changed");
    }
    if (
      requestedTradingDate
      && String(state.payload?.trading_date || "") !== requestedTradingDate
    ) {
      schedulingPayload = state.payload;
      return;
    }
    const historyBackfill = payload.history_backfill || {};
    if (
      String(historyBackfill.status || "").toLowerCase() === "failed"
      || historyBackfill.error
    ) {
      throw new Error(historyBackfill.error || "history_backfill_failed");
    }

    state.panelHistoryBackfillFailureCount = 0;
    state.panelHistoryBackfillNextAllowedAt = Date.now() + (
      panelHistoryBackfillRequired(payload)
        ? panelHistoryBackfillRetryDelay(payload)
        : PANEL_HISTORY_BACKFILL_SUCCESS_COOLDOWN_MS
    );
    const currentRowCount = Array.isArray(state.payload?.rows)
      ? state.payload.rows.length
      : 0;
    const incomingRowCount = Array.isArray(payload.rows) ? payload.rows.length : 0;
    if (
      panelHistoryBackfillAllowed()
      && incomingRowCount > 0
      && incomingRowCount >= currentRowCount
    ) {
      applyBondPayload(payload, [payload]);
      setStatus(statusText(payload), statusTone(payload));
      scheduleRefresh();
    }
  } catch (_error) {
    schedulingPayload = state.payload;
    state.panelHistoryBackfillFailureCount += 1;
    state.panelHistoryBackfillNextAllowedAt =
      Date.now() + panelHistoryBackfillFailureDelay();
  } finally {
    state.panelHistoryBackfillLoading = false;
    schedulePanelHistoryBackfill(schedulingPayload);
  }
}

function normalizeManualBackfillStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if ([
    "accepted",
    "pending",
    "waiting",
    "waiting_for_market_close",
    "waiting_for_bridge_cooldown",
  ].includes(status)) return "queued";
  if ([
    "refreshing",
    "processing",
    "in_progress",
    "reading_cache",
    "downloading",
    "verifying",
    "persisting",
  ].includes(status)) return "running";
  if (["complete", "completed", "success", "succeeded", "not_needed"].includes(status)) {
    return "ready";
  }
  if (["error", "cancelled", "canceled", "interrupted"].includes(status)) return "failed";
  return ["submitting", "queued", "running", "partial", "ready", "failed"]
    .includes(status)
    ? status
    : "queued";
}

function manualBackfillIsActive(job = state.manualBackfillJob) {
  return ["submitting", "queued", "running"]
    .includes(normalizeManualBackfillStatus(job?.status));
}

function manualBackfillCodeKey(value) {
  return String(value || "").replace(/\D/g, "").slice(-6);
}

function currentIntradayBackfillDate() {
  const selectedDate = state.manualDate ? nodes.dateSelect.value : "";
  const date = String(selectedDate || state.payload?.trading_date || "");
  return /^\d{8}$/.test(date) ? date : "";
}

function manualBackfillMatchesCurrentView(job = state.manualBackfillJob) {
  return Boolean(
    job
    && state.view === "intraday"
    && manualBackfillCodeKey(job.code) === manualBackfillCodeKey(requestedCode)
    && String(job.date || "") === currentIntradayBackfillDate(),
  );
}

function manualBackfillContextVisible(job = state.manualBackfillJob) {
  return Boolean(
    manualBackfillMatchesCurrentView(job)
    && !document.hidden
    && (!isPanel || state.panelActive),
  );
}

function manualBackfillActiveForCurrentView() {
  return Boolean(
    state.manualBackfillJob
    && manualBackfillIsActive(state.manualBackfillJob)
    && manualBackfillMatchesCurrentView(state.manualBackfillJob),
  );
}

function clearManualBackfillPollTimer() {
  window.clearTimeout(state.manualBackfillPollTimer);
  state.manualBackfillPollTimer = 0;
}

function manualBackfillWaitReasons(job) {
  return new Set(
    [job?.wait_reason, job?.phase, job?.raw_status]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean),
  );
}

function manualBackfillPollDelay(payload) {
  const explicitMilliseconds = Number(payload?.poll_after_ms);
  const seconds = [
    payload?.poll_after_seconds,
    payload?.poll_after,
    payload?.retry_after_seconds,
    payload?.retry_in_seconds,
  ]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  const requestedDelay = Math.max(
    Number.isFinite(explicitMilliseconds) && explicitMilliseconds > 0
      ? Math.ceil(explicitMilliseconds)
      : 0,
    seconds.length ? Math.ceil(Math.max(...seconds) * 1000) : 0,
  );
  let delay = Math.max(
    MANUAL_BACKFILL_MIN_POLL_MS,
    requestedDelay || MANUAL_BACKFILL_DEFAULT_POLL_MS,
  );
  const waitReasons = manualBackfillWaitReasons(payload);
  if (
    waitReasons.has("waiting_for_market_close")
    || waitReasons.has("waiting_for_monitor_to_stop")
    || waitReasons.has("waiting_for_1512")
  ) {
    delay = Math.max(delay, MANUAL_BACKFILL_MARKET_WAIT_POLL_MS);
  }
  return delay;
}

function manualBackfillMissingCount(job) {
  if (Array.isArray(job?.missing_after)) return job.missing_after.length;
  const value = Number(job?.missing_after ?? job?.missing_count);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function manualBackfillStatusPresentation(job) {
  const status = normalizeManualBackfillStatus(job?.status);
  if (status === "submitting") {
    return { text: "正在提交补齐任务", tone: "", button: "提交中…", disabled: true };
  }
  if (status === "queued") {
    const position = Number(job?.queue_position);
    const waitReasons = manualBackfillWaitReasons(job);
    const waitingForMarket = [
      "waiting_for_market_close",
      "waiting_for_monitor_to_stop",
      "waiting_for_1512",
    ].some((reason) => waitReasons.has(reason));
    const waitingForBridge = [
      "waiting_for_bridge_cooldown",
      "bridge_failure_cooldown",
    ].some((reason) => waitReasons.has(reason));
    const waitingText = waitingForMarket
      ? "已排队 · 盘后执行"
      : waitingForBridge
        ? "已排队 · Bridge冷却"
        : Number.isFinite(position) && position > 0
          ? `已排队 · 第${Math.ceil(position)}位`
          : "已排队 · 等待执行";
    return {
      text: waitingText,
      tone: "is-warning",
      button: "排队中…",
      disabled: true,
    };
  }
  if (status === "running") {
    const current = Number(job?.after_bar_count ?? job?.row_count);
    const expected = Number(job?.expected_bar_count);
    const progress = Number.isFinite(current) && current >= 0
      ? Number.isFinite(expected) && expected > 0
        ? ` · 已获取${Math.floor(current)}/${Math.floor(expected)}分钟`
        : ` · 已获取${Math.floor(current)}分钟`
      : "";
    return {
      text: `正在补齐${progress}`,
      tone: "is-live",
      button: "补齐中…",
      disabled: true,
    };
  }
  if (status === "partial") {
    const missing = manualBackfillMissingCount(job);
    return {
      text: missing === null || missing <= 0
        ? "本次补齐结束 · 仍有缺口"
        : `本次补齐结束 · 还缺${missing}分钟`,
      tone: "is-warning",
      button: "立即刷新",
      disabled: false,
    };
  }
  if (status === "ready") {
    const after = Number(
      job?.after_bar_count
      ?? job?.row_count_after
      ?? job?.row_count,
    );
    return {
      text: Number.isFinite(after)
        ? `补齐完成 · 已获取${Math.floor(after)}分钟`
        : "补齐完成 · 分时已重绘",
      tone: "is-live",
      button: "立即刷新",
      disabled: false,
    };
  }
  const error = String(job?.error || job?.message || "未知原因").slice(0, 80);
  return {
    text: `补齐失败：${error} · 点击重试`,
    tone: "is-error",
    button: "立即刷新",
    disabled: false,
  };
}

function renderManualBackfillState(job = state.manualBackfillJob) {
  if (!manualBackfillMatchesCurrentView(job)) return false;
  const presentation = manualBackfillStatusPresentation(job);
  nodes.refreshButton.textContent = presentation.button;
  nodes.refreshButton.disabled = presentation.disabled;
  if (job?.poll_error && manualBackfillIsActive(job)) {
    setStatus("补齐任务仍在运行 · 状态查询稍后重试", "is-warning");
  } else {
    setStatus(presentation.text, presentation.tone);
  }
  return true;
}

function manualBackfillJobKey(job) {
  return String(job?.job_id || `${job?.code || ""}:${job?.date || ""}:${job?.generation || 0}`);
}

function manualBackfillRedrawRetryDelay() {
  return Math.min(
    MANUAL_BACKFILL_REDRAW_RETRY_MAX_MS,
    MANUAL_BACKFILL_REDRAW_RETRY_BASE_MS
      * (2 ** Math.max(0, state.manualBackfillRedrawFailureCount - 1)),
  );
}

function scheduleManualBackfillRedrawRetry(job, generation) {
  clearManualBackfillPollTimer();
  if (
    generation !== state.manualBackfillGeneration
    || normalizeManualBackfillStatus(job?.status) !== "ready"
    || !manualBackfillContextVisible(job)
  ) return;
  state.manualBackfillPollTimer = window.setTimeout(() => {
    state.manualBackfillPollTimer = 0;
    void redrawReadyManualBackfill(job, generation);
  }, manualBackfillRedrawRetryDelay());
}

async function redrawReadyManualBackfill(job, generation) {
  if (
    normalizeManualBackfillStatus(job?.status) !== "ready"
    || generation !== state.manualBackfillGeneration
    || !manualBackfillContextVisible(job)
  ) return false;
  const jobKey = manualBackfillJobKey(job);
  if (state.manualBackfillReloadedJobKey === jobKey) return true;
  if (
    state.manualBackfillRedrawJobKey === jobKey
    && state.manualBackfillRedrawRequest
  ) return state.manualBackfillRedrawRequest;

  state.intradayPayloadCache.delete(String(job.date || ""));
  state.intradayPayloadRetryAt.delete(String(job.date || ""));
  const redrawRequest = (async () => {
    let applied = false;
    try {
      applied = await loadBond({
        date: state.manualDate ? String(job.date || "") : "",
      }) === true;
    } catch (_error) {
      applied = false;
    }
    const stillMatching = Boolean(
      generation === state.manualBackfillGeneration
      && manualBackfillMatchesCurrentView(job),
    );
    if (applied && stillMatching) {
      clearManualBackfillPollTimer();
      state.manualBackfillReloadedJobKey = jobKey;
      state.manualBackfillRedrawFailureCount = 0;
      renderManualBackfillState(state.manualBackfillJob);
      return true;
    }
    if (stillMatching && manualBackfillContextVisible(job)) {
      state.manualBackfillRedrawFailureCount += 1;
      scheduleManualBackfillRedrawRetry(job, generation);
    }
    return false;
  })();
  state.manualBackfillRedrawJobKey = jobKey;
  state.manualBackfillRedrawRequest = redrawRequest;
  try {
    return await redrawRequest;
  } finally {
    if (state.manualBackfillRedrawRequest === redrawRequest) {
      state.manualBackfillRedrawJobKey = "";
      state.manualBackfillRedrawRequest = null;
    }
  }
}

function scheduleManualBackfillPoll(payload = state.manualBackfillJob, options = {}) {
  clearManualBackfillPollTimer();
  if (
    !manualBackfillIsActive(payload)
    || !manualBackfillContextVisible(payload)
    || !payload?.job_id
  ) return;
  const delay = options.immediate
    ? 0
    : Number.isFinite(Number(options.delayMs))
      ? Math.max(MANUAL_BACKFILL_MIN_POLL_MS, Number(options.delayMs))
      : manualBackfillPollDelay(payload);
  state.manualBackfillPollTimer = window.setTimeout(() => {
    state.manualBackfillPollTimer = 0;
    void pollManualBackfill();
  }, delay);
}

async function applyManualBackfillPayload(payload, generation, target) {
  if (generation !== state.manualBackfillGeneration) return null;
  const currentJob = state.manualBackfillJob || {};
  const jobId = payload?.job_id || payload?.task_id || payload?.id || currentJob.job_id || "";
  const status = normalizeManualBackfillStatus(payload?.status || currentJob.status);
  const job = {
    ...currentJob,
    ...(payload || {}),
    job_id: String(jobId),
    code: payload?.code || currentJob.code || target.code,
    date: String(payload?.date || payload?.trading_date || currentJob.date || target.date),
    status,
    raw_status: String(payload?.status || currentJob.raw_status || ""),
    generation,
    poll_error: "",
  };
  if (manualBackfillIsActive(job) && !job.job_id) {
    throw new Error("补齐服务未返回任务编号");
  }
  state.manualBackfillJob = job;
  state.manualBackfillPollFailureCount = 0;
  if (manualBackfillMatchesCurrentView(job)) renderManualBackfillState(job);
  if (manualBackfillIsActive(job)) {
    scheduleManualBackfillPoll(job);
  } else {
    clearManualBackfillPollTimer();
    await redrawReadyManualBackfill(job, generation);
  }
  return job;
}

async function pollManualBackfill() {
  const job = state.manualBackfillJob;
  if (
    !manualBackfillIsActive(job)
    || !manualBackfillContextVisible(job)
    || !job?.job_id
  ) return;
  const generation = state.manualBackfillGeneration;
  const pollToken = `${generation}:${String(job.job_id)}`;
  if (state.manualBackfillPollToken === pollToken) return;
  const target = { code: job.code, date: job.date };
  state.manualBackfillPollToken = pollToken;
  try {
    const query = new URLSearchParams({ job_id: String(job.job_id) });
    const payload = await fetchJson(`/api/miniqmt/intraday-backfill?${query}`, 12000);
    await applyManualBackfillPayload(payload, generation, target);
  } catch (error) {
    if (generation !== state.manualBackfillGeneration) return;
    state.manualBackfillPollFailureCount += 1;
    state.manualBackfillJob = {
      ...state.manualBackfillJob,
      poll_error: error?.message || "状态查询失败",
    };
    if (manualBackfillMatchesCurrentView(state.manualBackfillJob)) {
      renderManualBackfillState(state.manualBackfillJob);
    }
    const retryDelay = Math.min(
      MANUAL_BACKFILL_POLL_FAILURE_MAX_MS,
      MANUAL_BACKFILL_DEFAULT_POLL_MS
        * (2 ** Math.max(0, state.manualBackfillPollFailureCount - 1)),
    );
    scheduleManualBackfillPoll(state.manualBackfillJob, { delayMs: retryDelay });
  } finally {
    if (state.manualBackfillPollToken === pollToken) {
      state.manualBackfillPollToken = "";
    }
    const currentJob = state.manualBackfillJob;
    const currentToken = currentJob?.job_id
      ? `${state.manualBackfillGeneration}:${String(currentJob.job_id)}`
      : "";
    if (
      currentToken
      && currentToken !== pollToken
      && manualBackfillIsActive(currentJob)
      && manualBackfillContextVisible(currentJob)
      && !state.manualBackfillPollTimer
      && state.manualBackfillPollToken !== currentToken
    ) {
      scheduleManualBackfillPoll(currentJob);
    }
  }
}

function resumeManualBackfillForView() {
  const job = state.manualBackfillJob;
  if (!manualBackfillContextVisible(job)) return;
  renderManualBackfillState(job);
  if (manualBackfillIsActive(job)) {
    scheduleManualBackfillPoll(job, { immediate: true });
  } else if (normalizeManualBackfillStatus(job?.status) === "ready") {
    void redrawReadyManualBackfill(job, state.manualBackfillGeneration);
  }
}

async function startManualIntradayRefresh() {
  if (state.view !== "intraday") return null;
  const target = {
    code: requestedCode,
    date: currentIntradayBackfillDate(),
  };
  if (!target.date) {
    void loadBond({ date: state.manualDate ? nodes.dateSelect.value : "" });
    setStatus("正在读取交易日，稍后可再次刷新", "is-warning");
    return null;
  }
  if (
    manualBackfillIsActive(state.manualBackfillJob)
    && manualBackfillMatchesCurrentView(state.manualBackfillJob)
  ) {
    renderManualBackfillState(state.manualBackfillJob);
    resumeManualBackfillForView();
    return state.manualBackfillJob;
  }

  const generation = state.manualBackfillGeneration + 1;
  state.manualBackfillGeneration = generation;
  state.manualBackfillPollFailureCount = 0;
  state.manualBackfillReloadedJobKey = "";
  state.manualBackfillRedrawJobKey = "";
  state.manualBackfillRedrawRequest = null;
  state.manualBackfillRedrawFailureCount = 0;
  clearPanelHistoryBackfillTimer();
  clearManualBackfillPollTimer();
  state.manualBackfillJob = {
    job_id: "",
    code: target.code,
    date: target.date,
    reason: "manual",
    status: "submitting",
    generation,
  };
  renderManualBackfillState(state.manualBackfillJob);

  // Refresh the already available rows immediately. Enqueuing the maintenance
  // job happens in parallel and never blocks the first chart repaint.
  void loadBond({ date: state.manualDate ? target.date : "" });
  try {
    const payload = await postJson("/api/miniqmt/intraday-backfill", {
      code: target.code,
      date: target.date,
      reason: "manual",
    });
    return await applyManualBackfillPayload(payload, generation, target);
  } catch (error) {
    if (generation !== state.manualBackfillGeneration) return null;
    return applyManualBackfillPayload(
      {
        status: "failed",
        error: error?.message || "补齐任务提交失败",
      },
      generation,
      target,
    );
  }
}

function referenceDailyLoadAllowed() {
  return Boolean(
    state.view === "intraday"
    && !document.hidden
    && (!isPanel || state.panelActive),
  );
}

function clearReferenceDailyTimer() {
  window.clearTimeout(state.referenceDailyTimer);
  state.referenceDailyTimer = 0;
}

function referenceDailyFailureDelay() {
  return Math.min(
    REFERENCE_DAILY_FAILURE_MAX_MS,
    REFERENCE_DAILY_FAILURE_BASE_MS
      * (2 ** Math.max(0, state.referenceDailyFailureCount - 1)),
  );
}

function scheduleReferenceDailyLoad() {
  if (
    state.referenceDailyPayload
    || state.referenceDailyRequest
    || state.referenceDailyTimer
  ) return;
  if (!referenceDailyLoadAllowed()) {
    clearReferenceDailyTimer();
    return;
  }
  const delay = Math.max(
    state.referenceDailyNextAllowedAt - Date.now(),
    REFERENCE_DAILY_INITIAL_DELAY_MS,
    0,
  );
  state.referenceDailyTimer = window.setTimeout(() => {
    state.referenceDailyTimer = 0;
    void loadReferenceDailyPayload();
  }, delay);
}

async function loadReferenceDailyPayload() {
  clearReferenceDailyTimer();
  if (!referenceDailyLoadAllowed()) return state.referenceDailyPayload;
  if (state.referenceDailyPayload) return state.referenceDailyPayload;
  if (state.referenceDailyRequest) return state.referenceDailyRequest;

  const query = new URLSearchParams({
    code: requestedCode,
    count: "30",
    reference: "1",
  });
  state.referenceDailyRequest = fetchJson(`/api/miniqmt/daily?${query}`, 12000);
  try {
    const payload = await state.referenceDailyRequest;
    if (!Array.isArray(payload?.rows)) {
      throw new Error("reference_daily_rows_missing");
    }
    state.referenceDailyPayload = payload;
    state.referenceDailyFailureCount = 0;
    state.referenceDailyNextAllowedAt = 0;
    if (referenceDailyLoadAllowed() && state.intradayRows.length) drawChart();
    return payload;
  } catch (_error) {
    state.referenceDailyFailureCount += 1;
    state.referenceDailyNextAllowedAt = Date.now() + referenceDailyFailureDelay();
    return null;
  } finally {
    state.referenceDailyRequest = null;
    if (!state.referenceDailyPayload) scheduleReferenceDailyLoad();
  }
}

function currentBondMarketCode() {
  const payloadCode = String(state.payload?.monitor_code || "").trim().toUpperCase();
  if (/^\d{6}\.(?:SH|SZ)$/.test(payloadCode)) return payloadCode;
  const code = payloadCode.replace(/\D/g, "").slice(-6) || requestedCode;
  const market = code.startsWith("110")
    || code.startsWith("111")
    || code.startsWith("113")
    || code.startsWith("118")
    ? "SH"
    : "SZ";
  return code ? `${code}.${market}` : "";
}

function shanghaiDateKey(now = new Date()) {
  const clock = shanghaiClockParts(now);
  return `${clock.year}${String(clock.month).padStart(2, "0")}${String(clock.day).padStart(2, "0")}`;
}

function orderBookTimestamp(payload) {
  let timestamp = Number(payload?.timestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    if (timestamp < 100_000_000_000) timestamp *= 1000;
    return timestamp;
  }
  const date = String(payload?.date || "");
  const time = String(payload?.time || "");
  const timeMatch = /^(\d{2}):(\d{2}):(\d{2})$/.exec(time);
  if (!/^\d{8}$/.test(date) || !timeMatch) return Number.NaN;
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3]);
  if (hour > 23 || minute > 59 || second > 59) return Number.NaN;
  return shanghaiInstant(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)),
    Number(date.slice(6, 8)),
    hour,
    minute,
  ) + second * 1000;
}

function orderBookIsFresh(payload, now = new Date()) {
  if (!payload || payload.date !== shanghaiDateKey(now)) return false;
  const timestamp = orderBookTimestamp(payload);
  if (!Number.isFinite(timestamp)) return false;
  const ageMs = now.getTime() - timestamp;
  return ageMs >= -ORDER_BOOK_FUTURE_TOLERANCE_MS && ageMs <= ORDER_BOOK_MAX_AGE_MS;
}

function quickTradeSessionActive() {
  return Boolean(
    state.tradeSessionToken
      && state.tradeSessionExpiresAt > Date.now(),
  );
}

function setQuickTradeMessage(message, tone = "") {
  nodes.quickTradeMessage.textContent = message;
  nodes.quickTradeMessage.classList.toggle("is-error", tone === "error");
  nodes.quickTradeMessage.classList.toggle("is-success", tone === "success");
}

function setBondDialogMessage(node, message, tone = "") {
  node.textContent = message;
  node.classList.toggle("is-error", tone === "error");
  node.classList.toggle("is-success", tone === "success");
}

function quickTradeContextReason(now = new Date()) {
  const capability = state.tradingCapabilities || {};
  if (!capability.local_access) return "局域网访问只读";
  if (!capability.bridge_enabled) return "QMT未启用交易";
  if (!capability.bridge_connected) return "QMT交易账户未连接";
  if (state.view !== "intraday") return "日K模式仅看盘";
  if (state.manualDate) return "历史分时仅看盘";
  if (!state.orderBook || state.orderBook.date !== shanghaiDateKey(now)) return "盘口不是今日数据";
  if (!marketRefreshWindow(now).active) return "非交易时段锁定";
  if (state.bookFailureCount > 0) return "盘口连接中断，等待重试";
  if (!orderBookIsFresh(state.orderBook, now)) return "盘口已过期，等待实时刷新";
  return "";
}

function renderQuickTradeAccess() {
  if (!nodes.tradePanel || isPanel) return;
  const reason = quickTradeContextReason();
  const capability = state.tradingCapabilities || {};
  const bridgeAvailable = Boolean(
    capability.local_access
      && capability.bridge_enabled
      && capability.bridge_connected,
  );
  const unlocked = bridgeAvailable && quickTradeSessionActive();
  const canTrade = unlocked && !reason;
  const hasPrice = Number(nodes.quickBuyPrice.value) > 0;
  const fields = [nodes.quickBuyAccount, nodes.quickBuyPrice, nodes.quickBuyVolume];
  for (const field of fields) field.disabled = !canTrade;
  for (const button of nodes.quickPriceButtons.querySelectorAll("button")) {
    button.disabled = !canTrade;
  }
  for (const button of nodes.quickVolumeButtons.querySelectorAll("button")) {
    button.disabled = !canTrade;
  }
  nodes.quickBuyPreview.disabled = !canTrade || !hasPrice;
  nodes.quickTradeUnlock.disabled = !bridgeAvailable;
  nodes.quickTradeUnlock.classList.toggle("is-unlocked", unlocked);
  nodes.quickTradeUnlock.textContent = unlocked ? "关闭交易" : "开启交易";
  if (unlocked) {
    const seconds = Math.max(0, Math.ceil((state.tradeSessionExpiresAt - Date.now()) / 1000));
    const countdown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    nodes.quickTradeAccess.textContent = reason ? `已解锁 · ${reason}` : `已解锁 ${countdown}`;
  } else {
    nodes.quickTradeAccess.textContent = reason || "当前锁定";
  }
}

function bookPrice(mode) {
  const payload = state.orderBook || {};
  if (mode === "bid1") return Number(payload.bids?.[0]?.price);
  if (mode === "ask1") return Number(payload.asks?.[0]?.price);
  return Number(payload.last_price);
}

function syncQuickPrice() {
  if (state.quickPriceMode === "manual") return;
  const price = bookPrice(state.quickPriceMode);
  if (Number.isFinite(price) && price > 0) nodes.quickBuyPrice.value = price.toFixed(3);
  renderQuickTradeAccess();
}

function selectQuickPrice(mode) {
  state.quickPriceMode = mode;
  for (const button of nodes.quickPriceButtons.querySelectorAll("button")) {
    button.classList.toggle("is-active", button.dataset.price === mode);
  }
  syncQuickPrice();
}

function renderOrderBook(payload) {
  state.orderBook = payload;
  nodes.bookLastPrice.textContent = formatNumber(payload.last_price, 3);
  nodes.bookLastPrice.className = toneClass(payload.change);
  nodes.bookChange.textContent = formatPercent(payload.change);
  nodes.bookChange.className = toneClass(payload.change);
  nodes.bookTime.textContent = `${displayDate(payload.date)} ${payload.time || "--"}`;
  nodes.bookSpread.textContent = Number.isFinite(Number(payload.spread))
    ? formatNumber(payload.spread, 3)
    : "-";
  const now = new Date();
  const current = payload.date === shanghaiDateKey(now);
  const active = marketRefreshWindow(now).active;
  const fresh = orderBookIsFresh(payload, now);
  nodes.bookStatus.textContent = current && active && fresh
    ? `实时 ${payload.time || ""}`
    : current && active
      ? `盘口已过期 ${payload.time || ""}`
    : current
      ? `已收盘 ${payload.time || ""}`
      : `数据 ${displayDate(payload.date)}`;
  nodes.bookStatus.className = `book-status${current && active && fresh ? " is-live" : " is-stale"}`;

  nodes.orderBook.replaceChildren();
  const rows = [
    ...(payload.asks || []).slice().reverse().map((row) => ({ ...row, side: "ask" })),
    ...(payload.bids || []).map((row) => ({ ...row, side: "bid" })),
  ];
  for (const row of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `book-level is-${row.side}`;
    button.disabled = !(Number(row.price) > 0);
    button.dataset.price = row.price || "";
    button.title = row.price ? `点击将限价设为 ${formatNumber(row.price, 3)}` : "该档无报价";
    const level = document.createElement("span");
    level.textContent = `${row.side === "ask" ? "卖" : "买"}${row.level}`;
    const price = document.createElement("strong");
    price.textContent = row.price ? formatNumber(row.price, 3) : "-";
    const volume = document.createElement("small");
    volume.textContent = Number.isFinite(Number(row.volume_hands))
      ? formatNumber(row.volume_hands, 0)
      : "-";
    button.append(level, price, volume);
    nodes.orderBook.append(button);
  }
  syncQuickPrice();
  renderQuickTradeAccess();
}

function orderBookRefreshDelay() {
  if (state.bookFailureCount <= 0) return ORDER_BOOK_REFRESH_INTERVAL_MS;
  return Math.min(
    ORDER_BOOK_FAILURE_RETRY_MAX_MS,
    ORDER_BOOK_FAILURE_RETRY_BASE_MS * (2 ** (state.bookFailureCount - 1)),
  );
}

function scheduleOrderBookRefresh() {
  window.clearTimeout(state.bookTimer);
  if (isPanel || document.hidden) return;
  const refreshWindow = marketRefreshWindow();
  const delay = refreshWindow.active
    ? orderBookRefreshDelay()
    : refreshWindow.nextDelayMs;
  if (!(delay > 0)) return;
  state.bookTimer = window.setTimeout(
    () => void loadOrderBook({ quiet: true }),
    Math.max(ORDER_BOOK_REFRESH_INTERVAL_MS, delay),
  );
}

async function loadOrderBook(options = {}) {
  if (isPanel || state.bookLoading || !currentBondMarketCode()) return;
  state.bookLoading = true;
  if (!options.quiet) {
    nodes.bookStatus.textContent = "正在读取";
    nodes.bookStatus.className = "book-status";
  }
  try {
    const query = new URLSearchParams({ code: currentBondMarketCode() });
    const payload = await fetchJson(`/api/miniqmt/order-book?${query}`, 8000);
    state.bookFailureCount = 0;
    renderOrderBook(payload);
  } catch (error) {
    state.bookFailureCount += 1;
    const retrySeconds = Math.ceil(orderBookRefreshDelay() / 1000);
    nodes.bookStatus.textContent = `盘口读取失败 · ${retrySeconds}秒后重试`;
    nodes.bookStatus.className = "book-status is-error";
    renderQuickTradeAccess();
    if (!options.quiet) setQuickTradeMessage(error.message || "实时盘口不可用", "error");
  } finally {
    state.bookLoading = false;
    scheduleOrderBookRefresh();
  }
}

function populateQuickTradeAccounts(accounts = []) {
  const selected = nodes.quickBuyAccount.value;
  nodes.quickBuyAccount.replaceChildren();
  for (const account of accounts) {
    if (!account.label) continue;
    const label = `${account.label}${account.connected ? "" : "（未连接）"}`;
    nodes.quickBuyAccount.append(new Option(label, account.label, false, account.label === selected));
  }
}

async function loadBondTradingCapabilities() {
  if (isPanel) return;
  try {
    const payload = await fetchJson("/api/miniqmt/trading/capabilities", 12000);
    state.tradingCapabilities = payload;
    nodes.unlockPhrase.textContent = payload.unlock_phrase || "开启实盘交易";
    populateQuickTradeAccounts(payload.accounts || []);
  } catch (error) {
    state.tradingCapabilities = {
      local_access: true,
      bridge_enabled: false,
      bridge_connected: false,
    };
    setQuickTradeMessage(`交易能力检查失败：${error.message}`, "error");
  }
  renderQuickTradeAccess();
}

function cancelQuickHold() {
  window.clearInterval(state.holdTimer);
  state.holdTimer = 0;
  state.holdStartedAt = 0;
  nodes.executeQuickBuy.style.setProperty("--hold-progress", "0%");
  if (!state.quickSubmitting && state.pendingQuickPreview) {
    nodes.executeQuickBuy.querySelector("span").textContent = "长按1.5秒提交";
  }
}

function lockQuickTrading(message = "交易已关闭，页面恢复只读。", tone = "success") {
  state.tradeSessionToken = "";
  state.tradeSessionExpiresAt = 0;
  state.pendingQuickPreview = null;
  window.clearInterval(state.tradeSessionTicker);
  cancelQuickHold();
  if (nodes.tradeConfirmDialog.open) nodes.tradeConfirmDialog.close();
  renderQuickTradeAccess();
  setQuickTradeMessage(message, tone);
}

function startQuickSessionTicker() {
  window.clearInterval(state.tradeSessionTicker);
  state.tradeSessionTicker = window.setInterval(() => {
    if (!quickTradeSessionActive()) lockQuickTrading("交易会话已到期，页面恢复只读。");
    else renderQuickTradeAccess();
  }, 1000);
}

function showQuickTradePreview(payload) {
  state.pendingQuickPreview = payload;
  state.quickConfirmReadyAt = Date.now() + 500;
  nodes.tradePreviewSummary.replaceChildren();
  const order = payload.order || {};
  const rows = [
    ["标的", `${order.name || ""} ${order.stock_code || ""}`],
    ["方向", order.side || "买入"],
    ["数量", `${order.order_volume || "-"}张`],
    ["限价", formatNumber(order.price, 3)],
    ["预计金额", formatAmount(order.amount)],
    ["校验现价", formatNumber(payload.checks?.last_price, 3)],
  ];
  for (const [label, value] of rows) {
    const item = document.createElement("div");
    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    const valueNode = document.createElement("strong");
    valueNode.textContent = String(value);
    item.append(labelNode, valueNode);
    nodes.tradePreviewSummary.append(item);
  }
  nodes.executeQuickBuy.disabled = true;
  nodes.executeQuickBuy.querySelector("span").textContent = "长按1.5秒提交";
  setBondDialogMessage(nodes.tradeConfirmMessage, "预览30秒后失效；提交前服务端会再次检查价格与资金。", "");
  nodes.tradeConfirmDialog.showModal();
  window.setTimeout(() => {
    if (state.pendingQuickPreview === payload && nodes.tradeConfirmDialog.open) {
      nodes.executeQuickBuy.disabled = false;
    }
  }, 500);
}

async function executeQuickOrder() {
  if (!state.pendingQuickPreview || state.quickSubmitting) return;
  const preview = state.pendingQuickPreview;
  state.quickSubmitting = true;
  nodes.executeQuickBuy.disabled = true;
  nodes.executeQuickBuy.querySelector("span").textContent = "正在提交…";
  setBondDialogMessage(nodes.tradeConfirmMessage, "正在提交，请勿重复操作。", "");
  try {
    const payload = await postJson("/api/miniqmt/trading/order-execute", {
      session_token: state.tradeSessionToken,
      preview_token: preview.preview_token,
      confirmation: preview.confirmation,
    }, 20000);
    state.pendingQuickPreview = null;
    nodes.tradeConfirmDialog.close();
    setQuickTradeMessage(
      `${payload.message || "委托已提交"}${payload.order_id ? ` · 委托号 ${payload.order_id}` : ""}`,
      "success",
    );
    await loadOrderBook({ quiet: true });
  } catch (error) {
    state.pendingQuickPreview = null;
    setBondDialogMessage(nodes.tradeConfirmMessage, error.message, "error");
    nodes.executeQuickBuy.querySelector("span").textContent = "预览失效，请关闭重试";
  } finally {
    state.quickSubmitting = false;
    cancelQuickHold();
  }
}

function startQuickHold(event) {
  if (nodes.executeQuickBuy.disabled || !state.pendingQuickPreview || state.quickSubmitting) return;
  event.preventDefault();
  cancelQuickHold();
  state.holdStartedAt = performance.now();
  nodes.executeQuickBuy.querySelector("span").textContent = "保持按住…";
  state.holdTimer = window.setInterval(() => {
    const elapsed = performance.now() - state.holdStartedAt;
    const progress = Math.min(100, (elapsed / 1500) * 100);
    nodes.executeQuickBuy.style.setProperty("--hold-progress", `${progress}%`);
    if (progress < 100) return;
    window.clearInterval(state.holdTimer);
    state.holdTimer = 0;
    void executeQuickOrder();
  }, 30);
}

async function loadBond(options = {}) {
  if (isPanel && !state.panelActive) return false;
  if (!requestedCode) {
    setStatus("缺少转债代码", "is-error");
    return false;
  }
  const requestId = (state.requestId += 1);
  const date = options.date !== undefined
    ? options.date
    : state.manualDate
      ? nodes.dateSelect.value || params.get("date") || ""
      : "";
  setStatus("正在读取MiniQMT");
  if (manualBackfillMatchesCurrentView()) renderManualBackfillState();
  try {
    const query = new URLSearchParams({ code: requestedCode });
    if (date) query.set("date", date);
    if (isPanel && !date) query.set("fast", "1");
    const payload = await fetchJson(
      `/api/miniqmt/bond?${query}`,
      date ? 120000 : 12000,
    );
    if (requestId !== state.requestId) return false;
    const intradayPayloads = await loadIntradayPayloads(payload, requestId);
    if (requestId !== state.requestId) return false;
    applyBondPayload(payload, intradayPayloads);
    setStatus(
      intradayPayloads.length > 1
        ? `${intradayPayloads.length}日分时 · MiniQMT真实分钟数据`
        : statusText(payload),
      statusTone(payload),
    );
    if (manualBackfillMatchesCurrentView()) {
      renderManualBackfillState();
    } else {
      nodes.refreshButton.textContent = "立即刷新";
      nodes.refreshButton.disabled = false;
    }
    scheduleRefresh();
    schedulePanelHistoryBackfill(payload);
    scheduleReferenceDailyLoad();
    return true;
  } catch (error) {
    if (requestId !== state.requestId) return false;
    setStatus(error.message || "MiniQMT读取失败", "is-error");
    nodes.eventList.innerHTML = `<div class="empty-events">${escapeHtml(
      error.message || "MiniQMT读取失败",
    )}</div>`;
    if (manualBackfillMatchesCurrentView()) renderManualBackfillState();
    return false;
  }
}

function intradayAvailableDates(mainPayload, dayCount) {
  const endDate = String(mainPayload.trading_date || "");
  if (!/^\d{8}$/.test(endDate)) return [];
  const referenceDates = state.referenceDailyPayload
    ? state.referenceDailyPayload.available_dates
      || (state.referenceDailyPayload.rows || []).map((row) => row.date)
    : [];
  const candidateDates = referenceDates.length
    ? referenceDates
    : mainPayload.available_dates || [];
  return [...new Set([
    ...candidateDates.map((value) => String(value || "")),
    endDate,
  ].filter((value) => /^\d{8}$/.test(value) && value <= endDate))]
    .sort();
}

async function loadIntradayPayloads(mainPayload, requestId) {
  const dayCount = state.intradayDays;
  if (dayCount <= 1) return [mainPayload];
  const endDate = String(mainPayload.trading_date || "");
  const candidateDates = intradayAvailableDates(mainPayload, dayCount).reverse();
  const payloads = [];
  for (const tradingDate of candidateDates) {
    if (requestId !== state.requestId) return [mainPayload];
    if (payloads.length >= dayCount) break;
    if (tradingDate === endDate) {
      payloads.push(mainPayload);
      continue;
    }
    const cachedPayload = state.intradayPayloadCache.get(tradingDate);
    if (cachedPayload) {
      payloads.push(cachedPayload);
      continue;
    }
    if ((state.intradayPayloadRetryAt.get(tradingDate) || 0) > Date.now()) continue;
    let historyRequest = state.intradayPayloadRequests.get(tradingDate);
    if (!historyRequest) {
      const query = new URLSearchParams({ code: requestedCode, date: tradingDate });
      historyRequest = fetchJson(`/api/miniqmt/bond?${query}`, 120000)
        .then((payload) => {
          if (String(payload?.trading_date || "") !== tradingDate) {
            throw new Error("historical_intraday_date_mismatch");
          }
          state.intradayPayloadCache.set(tradingDate, payload);
          state.intradayPayloadRetryAt.delete(tradingDate);
          return payload;
        })
        .catch(() => {
          state.intradayPayloadRetryAt.set(
            tradingDate,
            Date.now() + INTRADAY_HISTORY_FAILURE_RETRY_MS,
          );
          return null;
        })
        .finally(() => {
          if (state.intradayPayloadRequests.get(tradingDate) === historyRequest) {
            state.intradayPayloadRequests.delete(tradingDate);
          }
        });
      state.intradayPayloadRequests.set(tradingDate, historyRequest);
    }
    const payload = await historyRequest;
    if (payload) payloads.push(payload);
  }
  return payloads.reverse();
}

function setView(view, options = {}) {
  state.view = view === "daily" ? "daily" : "intraday";
  state.selectedIndex = -1;
  nodes.tooltip.hidden = true;
  nodes.intradayViewButton.classList.toggle("is-active", state.view === "intraday");
  nodes.dailyViewButton.classList.toggle("is-active", state.view === "daily");
  nodes.dateControl.hidden = state.view !== "intraday";
  nodes.intradayDaysControl.hidden = state.view !== "intraday";
  nodes.dailyRangeControl.hidden = state.view !== "daily";
  nodes.intradayLegend.hidden = state.view !== "intraday";
  nodes.dailyLegend.hidden = state.view !== "daily";
  nodes.eventsCard.hidden = state.view !== "intraday";
  renderQuickTradeAccess();
  window.clearTimeout(state.refreshTimer);
  clearPanelHistoryBackfillTimer();
  clearReferenceDailyTimer();
  clearManualBackfillPollTimer();
  if (state.view === "daily") {
    nodes.refreshButton.textContent = "立即刷新";
    nodes.refreshButton.disabled = false;
  }

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
    schedulePanelHistoryBackfill(state.payload);
    scheduleReferenceDailyLoad();
    resumeManualBackfillForView();
  } else {
    void loadBond();
  }
}

async function openDailyIntraday(index) {
  const row = state.dailyPayload?.rows?.[index];
  const tradingDate = String(row?.date || "");
  if (!/^\d{8}$/.test(tradingDate)) return;
  clearManualBackfillPollTimer();
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
  renderBondTags(payload.tags || state.payload?.tags || []);
  nodes.latestPrice.textContent = formatNumber(latest.close, 3);
  nodes.latestChange.textContent =
    `${Number(latest.change) > 0 ? "+" : ""}${formatNumber(latest.change, 2)}%`;
  nodes.latestChange.className = toneClass(latest.change);
  nodes.totalAmountLabel.textContent = "区间成交额";
  nodes.eventCountLabel.textContent = "区间涨跌";
  nodes.totalAmount.textContent = formatAmount(
    rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
  );
  nodes.volumeRatioCard.hidden = true;
  nodes.purplePriceCard.hidden = true;
  nodes.purpleSupportCard.hidden = true;
  nodes.purpleBreakCard.hidden = true;
  nodes.averageSupportCard.hidden = true;
  nodes.eventCount.textContent =
    `${rangeReturn > 0 ? "+" : ""}${formatNumber(rangeReturn, 2)}%`;
  nodes.eventCount.className = toneClass(rangeReturn);
  nodes.dataAlert.hidden = true;
  drawChart();
  window.requestAnimationFrame(drawCurrentStockSparkline);
}

function renderPayload(payload) {
  const displayedRows = intradayRows();
  const displayedPayloads = intradayPayloads();
  const displayName = payload.name || requestedName || "可转债";
  document.title = `${displayName} ${payload.code} · MiniQMT分时指标`;
  nodes.name.textContent = displayName;
  nodes.code.textContent = payload.code;
  renderBondTags(payload.tags);
  nodes.latestPrice.textContent = formatNumber(payload.latest_price, 3);
  const displayedReturn = Number.isFinite(Number(payload.daily_return))
    ? Number(payload.daily_return)
    : Number(payload.change_from_first);
  nodes.latestChange.textContent = `${displayedReturn > 0 ? "+" : ""}${formatNumber(
    displayedReturn,
    2,
  )}%`;
  nodes.latestChange.className = toneClass(displayedReturn);
  nodes.totalAmountLabel.textContent = "累计成交额";
  nodes.eventCountLabel.textContent = "今日信号";
  nodes.eventCount.className = "";
  nodes.totalAmount.textContent = formatAmount(
    displayedPayloads.length > 1
      ? displayedRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
      : payload.total_amount,
  );
  nodes.volumeRatioCard.hidden = false;
  nodes.purplePriceCard.hidden = false;
  nodes.purpleSupportCard.hidden = false;
  nodes.purpleBreakCard.hidden = false;
  nodes.averageSupportCard.hidden = false;
  const hasVolumeRatio =
    payload.volume_ratio !== null &&
    payload.volume_ratio !== undefined &&
    Number.isFinite(Number(payload.volume_ratio));
  nodes.volumeRatio.textContent = hasVolumeRatio
    ? formatNumber(payload.volume_ratio, 2)
    : "-";
  nodes.volumeRatio.className =
    hasVolumeRatio && Number(payload.volume_ratio) >= 2 ? "is-hot" : "";
  const latestPurple = [...displayedRows]
    .reverse()
    .map((row) => Number(row.purple))
    .find(Number.isFinite);
  nodes.purplePrice.textContent = Number.isFinite(latestPurple)
    ? formatNumber(latestPurple, 3)
    : "-";
  const latestPurpleRow = [...displayedRows]
    .reverse()
    .find((row) => Number.isFinite(Number(row.purple)));
  nodes.purplePrice.className = latestPurpleRow?.purple_rising ? "is-purple" : "is-down";
  const purpleSupportCount = Number(payload.support_counts?.purple) || 0;
  const purpleBreakCount = Number(payload.support_counts?.purple_break) || 0;
  const averageSupportCount = Number(payload.support_counts?.intraday_average) || 0;
  nodes.purpleSupportCount.textContent = `${purpleSupportCount}次`;
  nodes.purpleBreakCount.textContent = `${purpleBreakCount}次`;
  nodes.purpleBreakCount.className = purpleBreakCount === 0 ? "is-strong" : "is-down";
  nodes.purpleBreakCard.title = payload.purple_break_definition?.quality || "有效跌破紫线次数";
  nodes.averageSupportCount.textContent = `${averageSupportCount}次`;
  nodes.purpleSupportCount.className = purpleSupportCount >= 3 ? "is-hot" : "";
  nodes.averageSupportCount.className = averageSupportCount >= 3 ? "is-hot" : "";
  nodes.eventCountLabel.textContent = displayedPayloads.length > 1 ? "区间信号" : "今日信号";
  nodes.eventsTitle.textContent = displayedPayloads.length > 1 ? "区间信号" : "当日信号";
  nodes.eventCount.textContent = String(
    displayedPayloads.reduce((sum, item) => sum + item.events.length, 0),
  );
  renderDates(payload.available_dates, payload.trading_date);
  renderDataAlert(payload);
  renderEvents(
    displayedPayloads.flatMap((item) => item.events.map((event) => ({
      ...event,
      trading_date: item.trading_date,
    }))),
  );
  window.requestAnimationFrame(drawCurrentStockSparkline);
  const autoRefreshPaused = !state.manualDate && !marketRefreshWindow().active;
  const historyStatus = String(payload.history_backfill?.status || "")
    .toLowerCase();
  const historyBackfillInProgress = ["pending", "queued", "running"]
    .includes(historyStatus);
  const historyBackfillDeferred = historyStatus === "deferred";
  const historyBackfillPartial = ["partial", "failed"].includes(historyStatus);
  nodes.dataFootnote.textContent = payload.fast_preview
    ? historyBackfillInProgress
      ? `${payload.source || "本地监控"} · 极速预览只读取本地监控和已有缓存；早盘历史分钟正在后台低频补齐，完成后将自动重绘。`
      : historyBackfillDeferred
      ? `${payload.source || "本地监控"} · 维护窗口外暂不读取历史分钟；将在盘后自动补齐。`
      : historyBackfillPartial
      ? `${payload.source || "本地监控"} · 历史分钟当前部分可用，后台将在维护窗口内有限重试。`
      : `${payload.source || "本地监控"} · 极速预览已包含当前可用的完整分钟缓存。`
    : historyBackfillInProgress
    ? `${payload.source || "本地监控"} · 早盘历史分钟正在后台低频补齐；当前图已先展示可用数据，完成后将自动重绘。`
    : historyBackfillDeferred
    ? `${payload.source || "本地监控"} · 当前不在历史分钟维护窗口；已有分时先行展示，盘后自动补齐。`
    : historyBackfillPartial
    ? `${payload.source || "本地监控"} · 历史分钟部分可用；后台将在维护窗口内有限重试。`
    : autoRefreshPaused
    ? `${payload.source || "MiniQMT"} · 当前为非交易时段，自动刷新已暂停；可使用“立即刷新”手动检查。`
    : payload.full_session
    ? `${payload.source || "MiniQMT"} · 当前为完整交易日数据；黄色均价线按分钟成交额估算，普通行情不等同于Level-2逐笔。`
    : payload.complete_session
      ? "当前分钟数据可用于指标分析，但尚未达到241根完整回放；黄色均价线按分钟成交额估算。"
      : `当前为盘中数据；页面每${payload.realtime?.refresh_interval_seconds || 2}秒读取一次，分钟指标在来源分钟形成后稳定，黄色均价线按分钟成交额估算。`;
  drawChart();
}

function statusText(payload) {
  const historyStatus = String(payload.history_backfill?.status || "")
    .toLowerCase();
  const historyBackfillInProgress = ["pending", "queued", "running"]
    .includes(historyStatus);
  if (payload.fast_preview) {
    return historyBackfillInProgress
      ? "极速预览 · 后台补齐中"
      : historyStatus === "deferred"
      ? "极速预览 · 待盘后补齐"
      : ["partial", "failed"].includes(historyStatus)
      ? "极速预览 · 历史分钟部分可用"
      : "极速预览 · 分时已补齐";
  }
  if (historyBackfillInProgress) {
    return "历史分钟补齐中 · 已先展示本地分时";
  }
  if (historyStatus === "deferred") {
    return "历史分钟待盘后补齐 · 已先展示本地分时";
  }
  if (historyStatus === "partial") {
    return "历史分钟部分补齐 · 后台有限重试";
  }
  if (historyStatus === "failed") {
    return "历史分钟补齐失败 · 可点击立即刷新";
  }
  if (
    payload.history_backfill?.status === "ready"
    && payload.history_backfill?.local_gap_detected
  ) return "历史分钟已补齐 · 只读";
  if (
    !state.manualDate &&
    !marketRefreshWindow().active &&
    (payload.realtime?.data_is_stale || payload.realtime?.is_latest_trading_date)
  ) {
    return "非交易时段 · 自动刷新已暂停";
  }
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
  if (!state.manualDate && !marketRefreshWindow().active) return "";
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
  if (!marketRefreshWindow().active) {
    nodes.dataAlert.textContent =
      `今日数据尚未到达，当前临时显示 ${displayDate(payload.trading_date)}。` +
      "非交易时段已暂停自动检查，可使用“立即刷新”手动检查。";
    return;
  }
  nodes.dataAlert.textContent =
    `今日数据尚未到达，当前临时显示 ${displayDate(payload.trading_date)}。` +
    "页面会在交易时段持续检查，并在MiniQMT产生今日数据后自动切换。";
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
    time.textContent = state.intradayDays > 1
      ? `${displayDailyDate(event.trading_date).slice(5)} ${String(event.event_time || "").slice(11, 16)}`
      : String(event.event_time || "").slice(11, 19);
    const type = document.createElement("span");
    type.className = "event-type";
    type.textContent = EVENT_LABELS[event.event_type] || event.event_type;
    type.title = event.event_type;
    const price = document.createElement("span");
    price.className = "event-price";
    price.textContent = formatNumber(event.price, 3);
    const score = document.createElement("span");
    score.className = "event-score";
    const speed = event.speed_1m === null || event.speed_1m === undefined
      ? Number.NaN
      : Number(event.speed_1m);
    score.textContent = Number.isFinite(speed)
      ? `1分钟 ${speed > 0 ? "+" : ""}${formatNumber(
          speed * 100,
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

function renderBondTags(tags = []) {
  nodes.tags.replaceChildren();
  for (const tag of tags) {
    const chip = document.createElement("a");
    chip.textContent = tag;
    chip.href = `./bond-tags.html?${new URLSearchParams({ tag })}`;
    chip.title = `查看“${tag}”标签下的全部转债`;
    nodes.tags.append(chip);
  }
  nodes.tags.hidden = tags.length === 0;
}

function renderTagEditor() {
  nodes.tagOptions.replaceChildren();
  for (const tag of state.tagOrder) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tag;
    button.setAttribute("aria-pressed", String(state.tagDraft.has(tag)));
    button.addEventListener("click", () => {
      if (state.tagDraft.has(tag)) state.tagDraft.delete(tag);
      else state.tagDraft.add(tag);
      button.setAttribute("aria-pressed", String(state.tagDraft.has(tag)));
      nodes.tagEditorStatus.textContent = "有未保存的修改";
    });
    nodes.tagOptions.append(button);
  }
}

async function openTagEditor() {
  nodes.manageTagsButton.disabled = true;
  nodes.tagEditorStatus.textContent = "正在读取标签";
  nodes.tagEditor.hidden = false;
  try {
    const payload = await fetchJson(
      `/api/miniqmt/tags?${new URLSearchParams({ code: requestedCode })}`,
    );
    state.tagOrder = payload.tagOrder || [];
    state.tagDraft = new Set(payload.rows?.[0]?.tags || state.payload?.tags || []);
    renderTagEditor();
    nodes.tagEditorStatus.textContent = "点击标签可选中或取消";
  } catch (error) {
    nodes.tagEditorStatus.textContent = error.message || "标签读取失败";
  } finally {
    nodes.manageTagsButton.disabled = false;
  }
}

async function saveTagEditor() {
  nodes.saveTagsButton.disabled = true;
  nodes.cancelTagsButton.disabled = true;
  nodes.tagEditorStatus.textContent = "正在保存";
  try {
    const payload = await postJson("/api/miniqmt/tags", {
      code: requestedCode,
      tags: state.tagOrder.filter((tag) => state.tagDraft.has(tag)),
    });
    if (state.payload) state.payload.tags = payload.tags;
    for (const item of state.intradayPayloads) item.tags = payload.tags;
    renderBondTags(payload.tags);
    nodes.tagEditorStatus.textContent = "已保存";
    window.setTimeout(() => {
      nodes.tagEditor.hidden = true;
    }, 350);
  } catch (error) {
    nodes.tagEditorStatus.textContent = error.message || "标签保存失败";
  } finally {
    nodes.saveTagsButton.disabled = false;
    nodes.cancelTagsButton.disabled = false;
  }
}

function scheduleRefresh() {
  window.clearTimeout(state.refreshTimer);
  if (state.view !== "intraday") return;
  if (isPanel && (!state.panelActive || document.hidden)) return;
  const historyStatus = String(state.payload?.history_backfill?.status || "")
    .toLowerCase();
  if (
    !isPanel
    && ["pending", "queued", "running"].includes(historyStatus)
    && !manualBackfillActiveForCurrentView()
  ) {
    state.refreshTimer = window.setTimeout(
      () => loadBond({ date: "" }),
      1000,
    );
    return;
  }
  const realtime = state.payload?.realtime;
  const waitingForToday = !state.manualDate && realtime?.data_is_stale;
  const followingLive = realtime?.monitor_alive && realtime?.is_latest_trading_date;
  if (!waitingForToday && !followingLive) return;
  const refreshWindow = marketRefreshWindow();
  if (!refreshWindow.active) {
    if (!state.manualDate && refreshWindow.nextDelayMs > 0) {
      state.refreshTimer = window.setTimeout(
        () => loadBond({ date: "" }),
        refreshWindow.nextDelayMs,
      );
    }
    return;
  }
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
  const definitions = activePanelDefinitions();
  const usable = height - top - bottom - gap * (definitions.length - 1);
  let cursor = top;
  const panels = definitions.map((definition) => {
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

function panelMetricKeySet() {
  if (!isPanel) return new Set(panelDefinitions.map((definition) => definition.key));
  if (state.panelMetricKeys) return state.panelMetricKeys;
  const validKeys = new Set(panelDefinitions.map((definition) => definition.key));
  let selected = DEFAULT_PANEL_METRIC_KEYS;
  try {
    const stored = JSON.parse(localStorage.getItem(PANEL_METRIC_STORAGE_KEY) || "null");
    if (Array.isArray(stored)) selected = stored;
  } catch {
    // Use the compact defaults when local storage is unavailable or malformed.
  }
  state.panelMetricKeys = new Set(
    selected.filter((key) => validKeys.has(key)),
  );
  state.panelMetricKeys.add("price");
  return state.panelMetricKeys;
}

function activePanelDefinitions() {
  const selected = panelMetricKeySet();
  const definitions = panelDefinitions.filter((definition) => selected.has(definition.key));
  const totalWeight = definitions.reduce((sum, definition) => sum + definition.weight, 0) || 1;
  return definitions.map((definition) => ({
    ...definition,
    weight: definition.weight / totalWeight,
  }));
}

function syncPanelMetricControls() {
  if (!nodes.panelMetricControls) return;
  const selected = panelMetricKeySet();
  for (const input of nodes.panelMetricControls.querySelectorAll("[data-panel-metric]")) {
    input.checked = selected.has(input.dataset.panelMetric);
  }
}

function savePanelMetricSelection() {
  if (!nodes.panelMetricControls || !isPanel) return;
  const selected = [...nodes.panelMetricControls.querySelectorAll("[data-panel-metric]:checked")]
    .map((input) => input.dataset.panelMetric);
  selected.push("price");
  state.panelMetricKeys = new Set(selected);
  try {
    localStorage.setItem(PANEL_METRIC_STORAGE_KEY, JSON.stringify([...state.panelMetricKeys]));
  } catch {
    // The selection still applies for this page even if persistence is unavailable.
  }
  drawChart();
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

function intradayMinute(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time || ""));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const clockMinutes = hour * 60 + minute;
  const morningStart = 9 * 60 + 30;
  const morningEnd = 11 * 60 + 30;
  const afternoonStart = 13 * 60;
  const afternoonEnd = 15 * 60;
  if (clockMinutes >= morningStart && clockMinutes <= morningEnd) {
    return clockMinutes - morningStart;
  }
  if (clockMinutes >= afternoonStart && clockMinutes <= afternoonEnd) {
    return 120 + clockMinutes - afternoonStart;
  }
  return null;
}

function intradayRowsAreContiguous(previousRow, currentRow) {
  if (!previousRow || !currentRow) return false;
  if (previousRow.trading_date !== currentRow.trading_date) return false;
  const previousMinute = intradayMinute(previousRow.time);
  const currentMinute = intradayMinute(currentRow.time);
  return Number.isFinite(previousMinute)
    && Number.isFinite(currentMinute)
    && currentMinute >= previousMinute
    && currentMinute - previousMinute <= 1;
}

function intradayPayloads() {
  return state.intradayPayloads.length ? state.intradayPayloads : state.payload ? [state.payload] : [];
}

function intradayRows() {
  return state.intradayRows.length ? state.intradayRows : state.payload?.rows || [];
}

function intradayDayCount(rows = intradayRows()) {
  return Math.max(1, Number(rows.at(-1)?._dayCount) || intradayPayloads().length || 1);
}

function intradayXFor(row, panel) {
  const minute = intradayMinute(row?.time);
  const dayCount = Math.max(1, Number(row?._dayCount) || intradayDayCount());
  const dayIndex = Math.max(0, Math.min(dayCount - 1, Number(row?._dayIndex) || 0));
  const ratio = Number.isFinite(minute)
    ? Math.max(0, Math.min(1, (dayIndex + minute / INTRADAY_TOTAL_MINUTES) / dayCount))
    : 0;
  return panel.x + ratio * panel.width;
}

function seriesXFor(row, index, panel, rows) {
  if (state.view === "daily") {
    return dailyXFor(index, panel, dailySlotCount(rows));
  }
  return intradayXFor(row, panel);
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

const INTRADAY_REFERENCE_DEFINITIONS = [
  { key: "ma5", label: "MA5", color: "#e2a51a", dash: [] },
  { key: "ma10", label: "MA10", color: "#d638c2", dash: [] },
  { key: "support5", label: "支撑", color: "#159447", dash: [5, 3] },
  { key: "resistance5", label: "压力", color: "#df2434", dash: [5, 3] },
];

function dailyRowsBefore(tradingDate) {
  return (state.referenceDailyPayload?.rows || [])
    .filter((row) => String(row.date || "") < String(tradingDate || ""))
    .filter((row) => /^\d{8}$/.test(String(row.date || "")))
    .sort((left, right) => String(left.date).localeCompare(String(right.date)));
}

function averageDailyCloses(rows, period) {
  const values = rows
    .map((row) => Number(row.close))
    .filter(Number.isFinite)
    .slice(-period);
  return values.length === period
    ? values.reduce((sum, value) => sum + value, 0) / period
    : null;
}

function referenceLevelsForDate(tradingDate) {
  const rows = dailyRowsBefore(tradingDate);
  const recent = rows.slice(-5);
  const levels = [];
  const ma5 = averageDailyCloses(rows, 5);
  const ma10 = averageDailyCloses(rows, 10);
  if (Number.isFinite(ma5)) levels.push({ key: "ma5", value: ma5 });
  if (Number.isFinite(ma10)) levels.push({ key: "ma10", value: ma10 });
  const lows = recent.map((row) => Number(row.low)).filter(Number.isFinite);
  const highs = recent.map((row) => Number(row.high)).filter(Number.isFinite);
  if (recent.length >= 5 && lows.length >= 5) {
    levels.push({ key: "support5", value: Math.min(...lows) });
  }
  if (recent.length >= 5 && highs.length >= 5) {
    levels.push({ key: "resistance5", value: Math.max(...highs) });
  }
  return levels;
}

function distanceToRange(value, range) {
  if (value < range[0]) return range[0] - value;
  if (value > range[1]) return value - range[1];
  return 0;
}

function referenceRenderState(rows, pricePanel, basePriceDomain) {
  const dates = [...new Set(rows.map((row) => String(row.trading_date || "")))]
    .filter(Boolean);
  const levelsByDate = new Map(
    dates.map((tradingDate) => [tradingDate, referenceLevelsForDate(tradingDate)]),
  );
  const baseValuesByDate = new Map();
  for (const row of rows) {
    const tradingDate = String(row.trading_date || "");
    const values = baseValuesByDate.get(tradingDate) || [];
    values.push(row.low, row.high, row.close);
    baseValuesByDate.set(tradingDate, values);
  }
  const pricePerPixel = (basePriceDomain[1] - basePriceDomain[0])
    / Math.max(1, pricePanel.height);
  const nearDistance = Math.max(pricePerPixel * 48, 0.006 * Number(rows.at(-1)?.close || 0));
  const allLevels = [];
  for (const [tradingDate, levels] of levelsByDate.entries()) {
    const curveValues = finiteValues(baseValuesByDate.get(tradingDate) || []);
    if (!curveValues.length) continue;
    const curveRange = [Math.min(...curveValues), Math.max(...curveValues)];
    for (const level of levels) {
      const definition = INTRADAY_REFERENCE_DEFINITIONS.find((item) => item.key === level.key);
      if (!definition) continue;
      const existing = allLevels.find((item) => item.key === level.key);
      const target = existing || {
        ...definition,
        valuesByDate: new Map(),
        visibleDates: new Set(),
      };
      target.valuesByDate.set(tradingDate, level.value);
      if (distanceToRange(level.value, curveRange) <= nearDistance) {
        target.visibleDates.add(tradingDate);
      }
      if (!existing) allLevels.push(target);
    }
  }
  const visibleValues = allLevels.flatMap((level) =>
    [...level.visibleDates].map((tradingDate) => level.valuesByDate.get(tradingDate)),
  );
  const latestDate = dates.at(-1);
  const latestLevels = (levelsByDate.get(latestDate) || []).map((level) => {
    const definition = INTRADAY_REFERENCE_DEFINITIONS.find((item) => item.key === level.key);
    const rendered = allLevels.find((item) => item.key === level.key);
    return {
      ...definition,
      ...level,
      visible: Boolean(rendered?.visibleDates.has(latestDate)),
    };
  });
  return { allLevels, latestLevels, visibleValues };
}

function renderIntradayReferenceSummary(levels) {
  if (!nodes.intradayLegendNote) return;
  if (!levels.length) {
    nodes.intradayLegendNote.textContent = "移动鼠标查看分钟详情 · 日线参考位暂不可用";
    return;
  }
  const items = levels.map((level) => {
    const stateLabel = level.visible ? "近" : "远";
    const stateClass = level.visible ? "is-near" : "is-far";
    return `<span class="reference-summary-item ${stateClass}">${level.label} ${formatNumber(level.value, 3)} · ${stateLabel}</span>`;
  });
  nodes.intradayLegendNote.innerHTML = `移动鼠标查看分钟详情 · ${items.join(" · ")}`;
}

function drawReferenceLevels(context, rows, panel, range, referenceState) {
  if (!referenceState.allLevels.length) return;
  const dayCount = intradayDayCount(rows);
  for (const level of referenceState.allLevels) {
    for (const tradingDate of level.visibleDates) {
      const dateRows = rows.filter((row) => String(row.trading_date || "") === tradingDate);
      if (!dateRows.length) continue;
      const dayIndex = Number(dateRows[0]._dayIndex) || 0;
      const value = level.valuesByDate.get(tradingDate);
      const y = yFor(value, panel, range);
      const startX = panel.x + (dayIndex / dayCount) * panel.width;
      const endX = panel.x + ((dayIndex + 1) / dayCount) * panel.width;
      context.save();
      context.strokeStyle = level.color;
      context.lineWidth = 1.05;
      context.setLineDash(level.dash);
      context.beginPath();
      context.moveTo(startX, y);
      context.lineTo(endX, y);
      context.stroke();
      context.restore();
    }
  }

  const latestDate = String(rows.at(-1)?.trading_date || "");
  const latestDateRows = rows.filter((row) => String(row.trading_date || "") === latestDate);
  if (!latestDateRows.length) return;
  const labelX = panel.x + panel.width - 4;
  context.save();
  context.font = 'bold 10px Arial, "Microsoft YaHei", sans-serif';
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (const level of referenceState.allLevels) {
    if (!level.visibleDates.has(latestDate)) continue;
    const value = level.valuesByDate.get(latestDate);
    const y = Math.max(panel.y + 10, Math.min(panel.y + panel.height - 10, yFor(value, panel, range)));
    context.fillStyle = "rgba(255,255,255,.9)";
    const label = `${level.label} ${formatNumber(value, 3)}`;
    const width = context.measureText(label).width + 6;
    context.fillRect(labelX - width, y - 8, width, 16);
    context.fillStyle = level.color;
    context.fillText(label, labelX - 3, y);
  }
  context.restore();
}

function drawChart() {
  if (state.view === "daily") {
    drawDailyChart();
    return;
  }
  const rows = intradayRows();
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
  drawLatestPurpleMarker(context, geometry.panels[0], rows, domains.price);
  if (state.selectedIndex >= 0) drawCrosshair(context, geometry, rows, state.selectedIndex);
}

function drawLatestPurpleMarker(context, panel, rows, priceDomain) {
  const latest = [...rows]
    .reverse()
    .find((row) => Number.isFinite(Number(row.purple)));
  if (!latest) return;
  const value = Number(latest.purple);
  const color = latest.purple_rising ? "#d638c2" : "#139a55";
  const rawY = yFor(value, panel, priceDomain);
  const label = `紫 ${formatNumber(value, 3)}`;
  context.save();
  context.font = 'bold 10px Arial, "Microsoft YaHei", sans-serif';
  const labelWidth = context.measureText(label).width + 10;
  const labelHeight = 17;
  const labelX = panel.x + panel.width - labelWidth - 4;
  const labelY = Math.max(
    panel.y + 18,
    Math.min(panel.y + panel.height - labelHeight - 3, rawY - labelHeight / 2),
  );
  context.strokeStyle = color;
  context.lineWidth = 0.8;
  context.setLineDash([3, 3]);
  context.beginPath();
  context.moveTo(Math.max(panel.x, labelX - 48), rawY);
  context.lineTo(panel.x + panel.width - 2, rawY);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = "rgba(255,255,255,.94)";
  context.fillRect(labelX, labelY, labelWidth, labelHeight);
  context.strokeStyle = color;
  context.strokeRect(labelX + 0.5, labelY + 0.5, labelWidth - 1, labelHeight - 1);
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, labelX + labelWidth / 2, labelY + labelHeight / 2 + 0.5);
  context.restore();
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
  const candidateLabels = [...new Set([
    0,
    Math.floor((chartRows.length - 1) / 4),
    Math.floor((chartRows.length - 1) / 2),
    Math.floor(((chartRows.length - 1) * 3) / 4),
    chartRows.length - 1,
  ])];
  const minimumLabelGap = Math.max(58, context.measureText("00-00").width + 22);
  const labels = [];
  for (const index of [...candidateLabels].reverse()) {
    const x = dailyXFor(index, amountPanel, slotCount);
    const nearestX = labels.length
      ? Math.min(...labels.map((selected) => Math.abs(
        dailyXFor(selected, amountPanel, slotCount) - x,
      )))
      : Number.POSITIVE_INFINITY;
    if (nearestX >= minimumLabelGap) labels.push(index);
  }
  labels.sort((left, right) => left - right);
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
  const panelsByKey = new Map(geometry.panels.map((panel) => [panel.key, panel]));
  const pricePanel = panelsByKey.get("price");
  const amountPanel = panelsByKey.get("amount");
  const volumeRatioPanel = panelsByKey.get("volumeRatio");
  const macdPanel = panelsByKey.get("macd");
  const darkPanel = panelsByKey.get("dark");
  const visiblePanel = panelsByKey.get("visible");
  if (!pricePanel) return {};
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
      row.previous_close ?? state.payload?.previous_close,
    ]),
    { padding: 0.06 },
  );
  const priceValues = rows.flatMap((row) => [
    row.low,
    row.high,
    row.intraday_average,
    row.purple,
    row.previous_close ?? state.payload?.previous_close,
  ]);
  const referenceState = referenceRenderState(rows, pricePanel, priceDomain);
  const adjustedPriceDomain = domain(
    [...priceValues, ...referenceState.visibleValues],
    { padding: 0.06 },
  );
  renderIntradayReferenceSummary(referenceState.latestLevels);
  drawHighLowBand(context, rows, pricePanel, adjustedPriceDomain);
  drawPreviousCloseLines(context, rows, pricePanel, adjustedPriceDomain);
  drawReferenceLevels(context, rows, pricePanel, adjustedPriceDomain, referenceState);
  drawLine(context, rows, pricePanel, adjustedPriceDomain, "close", "#1f5fbf", 1.55);
  drawLine(
    context,
    rows,
    pricePanel,
    adjustedPriceDomain,
    "intraday_average",
    "#e2a51a",
    1.35,
  );
  drawLine(context, rows, pricePanel, adjustedPriceDomain, "purple", "#c6ccd6", 1.05, [2, 3]);
  drawConditionalLine(
    context,
    rows,
    pricePanel,
    adjustedPriceDomain,
    "purple",
    (row) => (row.purple_rising ? "#d638c2" : "#139a55"),
    1.8,
  );

  const domains = { price: adjustedPriceDomain };

  if (amountPanel) {
    const amountDomain = domain(rows.map((row) => row.amount), {
      includeZero: true,
      padding: 0.05,
    });
    drawBars(context, rows, amountPanel, amountDomain, (row) =>
      row.close >= row.open ? "rgba(223,36,52,.68)" : "rgba(21,148,71,.68)",
    );
    domains.amount = amountDomain;
  }

  if (volumeRatioPanel) {
    const volumeRatioDomain = domain(
      rows.map((row) => row.volume_ratio),
      { includeZero: true, includeValue: 2, padding: 0.05 },
    );
    drawLine(
      context,
      rows,
      volumeRatioPanel,
      volumeRatioDomain,
      "volume_ratio",
      "#6546ad",
      1.45,
    );
    drawHorizontalLine(context, volumeRatioPanel, volumeRatioDomain, 1, "#9a8bbd", [4, 3]);
    drawHorizontalLine(context, volumeRatioPanel, volumeRatioDomain, 2, "#c4772b", [3, 3]);
    domains.volumeRatio = volumeRatioDomain;
  }

  if (darkPanel) {
    const darkDomain = domain(
      rows.flatMap((row) => [row.dark_buy, row.dark_sell]),
      { includeZero: true, padding: 0.08 },
    );
    drawBars(
      context,
      rows,
      darkPanel,
      darkDomain,
      (row) => row.dark_state === "inflow" ? "rgba(154,44,53,.72)" : "rgba(63,120,181,.72)",
      (row) => (row.dark_state === "inflow" ? row.dark_buy : row.dark_sell),
    );
    drawZeroLine(context, darkPanel, darkDomain);
    domains.dark = darkDomain;
  }

  if (macdPanel) {
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
    domains.macd = macdDomain;
  }

  if (visiblePanel) {
    const visibleDomain = domain(
      rows.flatMap((row) => [row.visible_funds, row.visible_funds_aa]),
      { includeZero: true, includeValue: 100, padding: 0.05 },
    );
    drawBars(
      context,
      rows,
      visiblePanel,
      visibleDomain,
      (row) => row.visible_funds >= 100 ? "rgba(164,19,32,.82)" : "rgba(239,113,119,.72)",
      (row) => row.visible_funds,
    );
    drawLine(context, rows, visiblePanel, visibleDomain, "visible_funds_aa", "#8e2434", 1.0);
    drawHorizontalLine(context, visiblePanel, visibleDomain, 100, "#b13d49", [4, 3]);
    drawVisibleCrosses(context, rows, visiblePanel, visibleDomain);
    domains.visible = visibleDomain;
  }
  drawHalfHourSeparators(context, geometry.panels, rows);

  return domains;
}

function drawHighLowBand(context, rows, panel, range) {
  if (rows.length < 2) return;
  context.save();
  context.fillStyle = "rgba(31,95,191,.08)";
  const groups = [];
  let currentGroup = [];
  for (const row of rows) {
    if (currentGroup.length && !intradayRowsAreContiguous(currentGroup.at(-1), row)) {
      groups.push(currentGroup);
      currentGroup = [];
    }
    currentGroup.push(row);
  }
  if (currentGroup.length) groups.push(currentGroup);
  for (const dayRows of groups) {
    if (dayRows.length < 2) continue;
    context.beginPath();
    dayRows.forEach((row, index) => {
      const x = intradayXFor(row, panel);
      const y = yFor(row.high, panel, range);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    for (let index = dayRows.length - 1; index >= 0; index -= 1) {
      context.lineTo(intradayXFor(dayRows[index], panel), yFor(dayRows[index].low, panel, range));
    }
    context.closePath();
    context.fill();
  }
  context.restore();
}

function drawPreviousCloseLines(context, rows, panel, range) {
  const dayCount = intradayDayCount(rows);
  const seen = new Set();
  for (const row of rows) {
    const dayIndex = Number(row._dayIndex) || 0;
    const value = Number(row.previous_close ?? state.payload?.previous_close);
    if (!(value > 0) || seen.has(dayIndex)) continue;
    seen.add(dayIndex);
    const y = yFor(value, panel, range);
    const startX = panel.x + (dayIndex / dayCount) * panel.width;
    const endX = panel.x + ((dayIndex + 1) / dayCount) * panel.width;
    context.save();
    context.strokeStyle = "#7d8998";
    context.lineWidth = 0.8;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(startX, y);
    context.lineTo(endX, y);
    context.stroke();
    context.restore();
  }
}

function drawHalfHourSeparators(context, panels, rows) {
  if (!panels.length || !rows.length) return;
  const firstPanel = panels[0];
  const lastPanel = panels.at(-1);
  const top = firstPanel.y;
  const bottom = lastPanel.y + lastPanel.height;
  context.save();
  context.strokeStyle = "rgba(93, 105, 94, .38)";
  context.lineWidth = 0.8;
  context.setLineDash([4, 4]);
  context.fillStyle = "#7a8478";
  context.font = '9px Arial, "Microsoft YaHei", sans-serif';
  context.textAlign = "center";
  context.textBaseline = "bottom";
  const dayCount = intradayDayCount(rows);
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    INTRADAY_GRID_MINUTES.forEach((minute) => {
      const x = firstPanel.x
        + ((dayIndex + minute / INTRADAY_TOTAL_MINUTES) / dayCount) * firstPanel.width;
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
    });
    if (dayIndex > 0) {
      const x = firstPanel.x + (dayIndex / dayCount) * firstPanel.width;
      context.setLineDash([]);
      context.strokeStyle = "rgba(61, 78, 63, .68)";
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
      context.setLineDash([4, 4]);
      context.strokeStyle = "rgba(93, 105, 94, .38)";
    }
  }
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
    const x = seriesXFor(row, index, panel, rows);
    const y = yFor(value, panel, range);
    const disconnected = index > 0 && !intradayRowsAreContiguous(rows[index - 1], row);
    if (!started || disconnected) {
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
    if (!intradayRowsAreContiguous(rows[index - 1], rows[index])) continue;
    const previous = Number(rows[index - 1][key]);
    const value = Number(rows[index][key]);
    if (!Number.isFinite(previous) || !Number.isFinite(value)) continue;
    context.strokeStyle = colorForRow(rows[index]);
    context.beginPath();
    context.moveTo(
      intradayXFor(rows[index - 1], panel),
      yFor(previous, panel, range),
    );
    context.lineTo(intradayXFor(rows[index], panel), yFor(value, panel, range));
    context.stroke();
  }
  context.restore();
}

function drawBars(context, rows, panel, range, colorForRow, valueForRow = (row) => row.amount) {
  const slots = state.view === "daily"
    ? dailySlotCount(rows)
    : (INTRADAY_TOTAL_MINUTES + 1) * intradayDayCount(rows);
  const barWidth = Math.max(
    1,
    Math.min(5, (panel.width / slots) * 0.72),
  );
  const zeroY = yFor(0, panel, range);
  rows.forEach((row, index) => {
    const value = Number(valueForRow(row));
    if (!Number.isFinite(value)) return;
    const x = seriesXFor(row, index, panel, rows) - barWidth / 2;
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
    if (rows[index].trading_date !== rows[index - 1].trading_date) continue;
    const previous = Number(rows[index - 1].visible_funds);
    const current = Number(rows[index].visible_funds);
    if (!(previous < 100 && current >= 100)) continue;
    const x = intradayXFor(rows[index], panel);
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
  context.textBaseline = "top";
  const dayCount = intradayDayCount(rows);
  if (dayCount === 1) {
    INTRADAY_AXIS_LABELS.forEach(({ minute, label }, labelIndex) => {
      const x = lastPanel.x
        + (minute / INTRADAY_TOTAL_MINUTES) * lastPanel.width;
      context.textAlign = labelIndex === 0
        ? "left"
        : labelIndex === INTRADAY_AXIS_LABELS.length - 1
          ? "right"
          : "center";
      context.fillText(label, x, lastPanel.y + lastPanel.height + 7);
    });
  } else {
    const dates = [...new Map(rows.map((row) => [row._dayIndex, row.trading_date])).entries()];
    for (const [dayIndex, tradingDate] of dates) {
      const centerX = lastPanel.x + ((dayIndex + 0.5) / dayCount) * lastPanel.width;
      context.textAlign = "center";
      context.fillText(displayDailyDate(tradingDate).slice(5), centerX, lastPanel.y + lastPanel.height + 7);
    }
  }
}

function formatAxis(value, key) {
  if (key === "amount") return formatAmount(value).replace("元", "");
  if (key === "price") return Number(value).toFixed(2);
  if (key === "volumeRatio") return `${Number(value).toFixed(2)}x`;
  return Math.abs(value) >= 100 ? Number(value).toFixed(0) : Number(value).toFixed(2);
}

function drawEvents(context, panel, rows, priceDomain) {
  const events = intradayPayloads().flatMap((payload) =>
    payload.events.map((event) => ({ ...event, trading_date: payload.trading_date })),
  );
  if (!events.length) return;
  const indexByTime = new Map(
    rows.map((row, index) => [`${row.trading_date}|${row.time}`, index]),
  );
  const lanes = new Map();
  for (const event of events) {
    const sourceTime = String(event.details?.source_bar_time || event.event_time || "").slice(11, 16);
    const index = indexByTime.get(`${event.trading_date}|${sourceTime}`);
    if (index === undefined) continue;
    const lane = lanes.get(index) || 0;
    lanes.set(index, lane + 1);
    const x = intradayXFor(rows[index], panel);
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
  const x = intradayXFor(rows[index], panel);
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
      : intradayRows();
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
  const dayCount = intradayDayCount(rows);
  const targetPosition = ratio * dayCount;
  const targetDay = Math.min(dayCount - 1, Math.floor(targetPosition));
  const targetMinute = (targetPosition - targetDay) * INTRADAY_TOTAL_MINUTES;
  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  rows.forEach((row, index) => {
    if ((Number(row._dayIndex) || 0) !== targetDay) return;
    const minute = intradayMinute(row.time);
    if (!Number.isFinite(minute)) return;
    const distance = Math.abs(minute - targetMinute);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
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
  const row = intradayRows()[index];
  const dayPayload = intradayPayloads().find(
    (item) => item.trading_date === row.trading_date,
  ) || state.payload;
  const nearbyEvents = dayPayload.events.filter((item) => {
    const source = String(item.details?.source_bar_time || item.event_time || "").slice(11, 16);
    return source === row.time;
  });
  nodes.tooltip.innerHTML = `
    <strong>${state.intradayDays > 1 ? `${displayDailyDate(row.trading_date)}　` : ""}${row.time}　${formatNumber(row.close, 3)}</strong>
    开 ${formatNumber(row.open, 3)}　高 ${formatNumber(row.high, 3)}　低 ${formatNumber(row.low, 3)}<br>
    涨跌幅 ${formatMinuteReturn(row.close, row.previous_close)}<br>
    紫线 ${formatNumber(row.purple, 3)}　成交额 ${formatAmount(row.amount)}　量比 ${formatNumber(row.volume_ratio, 2)}<br>
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

function formatMinuteReturn(price, rowPreviousClose = null) {
  const previousClose = Number(rowPreviousClose ?? state.payload?.previous_close);
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
    void loadDaily();
  } else {
    void startManualIntradayRefresh();
  }
});
nodes.dateSelect.addEventListener("change", () => {
  clearManualBackfillPollTimer();
  state.manualDate = true;
  renderQuickTradeAccess();
  void loadBond({ date: nodes.dateSelect.value }).then(() => {
    resumeManualBackfillForView();
  });
});
nodes.intradayDaysSelect.addEventListener("change", () => {
  state.intradayDays = Math.max(1, Math.min(5, Number(nodes.intradayDaysSelect.value) || 1));
  const url = new URL(window.location.href);
  if (state.intradayDays > 1) url.searchParams.set("days", String(state.intradayDays));
  else url.searchParams.delete("days");
  window.history.replaceState(window.history.state, "", url);
  void loadBond({ date: state.manualDate ? nodes.dateSelect.value : "" });
});
nodes.manageTagsButton.addEventListener("click", () => {
  if (!nodes.tagEditor.hidden) {
    nodes.tagEditor.hidden = true;
    return;
  }
  void openTagEditor();
});
nodes.cancelTagsButton.addEventListener("click", () => {
  nodes.tagEditor.hidden = true;
});
nodes.saveTagsButton.addEventListener("click", () => void saveTagEditor());
nodes.dailyRangeSelect.addEventListener("change", loadDaily);
nodes.intradayViewButton.addEventListener("click", () => setView("intraday"));
nodes.dailyViewButton.addEventListener("click", () => setView("daily"));
if (isPanel && nodes.panelMetricControls) {
  syncPanelMetricControls();
  nodes.panelMetricControls.addEventListener("change", (event) => {
    if (event.target.matches("[data-panel-metric]")) savePanelMetricSelection();
  });
}
nodes.backLink.addEventListener("click", (event) => {
  if (isEmbedded && window.parent !== window) {
    event.preventDefault();
    window.parent.postMessage({ type: "finance:close-bond-overlay" }, window.location.origin);
  }
});
if (!isPanel) {
  nodes.orderBook.addEventListener("click", (event) => {
    const level = event.target.closest(".book-level[data-price]");
    if (!level || !(Number(level.dataset.price) > 0)) return;
    state.quickPriceMode = "manual";
    nodes.quickBuyPrice.value = Number(level.dataset.price).toFixed(3);
    for (const button of nodes.quickPriceButtons.querySelectorAll("button")) {
      button.classList.remove("is-active");
    }
    renderQuickTradeAccess();
  });
  nodes.quickPriceButtons.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-price]");
    if (button) selectQuickPrice(button.dataset.price);
  });
  nodes.quickVolumeButtons.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-volume]");
    if (!button) return;
    nodes.quickBuyVolume.value = button.dataset.volume;
    for (const item of nodes.quickVolumeButtons.querySelectorAll("button")) {
      item.classList.toggle("is-active", item === button);
    }
  });
  nodes.quickBuyPrice.addEventListener("input", () => {
    state.quickPriceMode = "manual";
    for (const button of nodes.quickPriceButtons.querySelectorAll("button")) {
      button.classList.remove("is-active");
    }
    renderQuickTradeAccess();
  });
  nodes.quickBuyVolume.addEventListener("input", () => {
    for (const button of nodes.quickVolumeButtons.querySelectorAll("button")) {
      button.classList.toggle("is-active", button.dataset.volume === nodes.quickBuyVolume.value);
    }
  });
  nodes.quickTradeUnlock.addEventListener("click", () => {
    if (quickTradeSessionActive()) {
      lockQuickTrading();
      return;
    }
    nodes.unlockInput.value = "";
    setBondDialogMessage(nodes.unlockMessage, "", "");
    nodes.tradeUnlockDialog.showModal();
  });
  nodes.tradeUnlockForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.querySelector("#confirmBondTradeUnlock");
    button.disabled = true;
    try {
      const payload = await postJson("/api/miniqmt/trading/unlock", {
        phrase: nodes.unlockInput.value,
      });
      state.tradeSessionToken = payload.session_token;
      state.tradeSessionExpiresAt = Number(payload.expires_at || 0);
      nodes.tradeUnlockDialog.close();
      startQuickSessionTicker();
      renderQuickTradeAccess();
      setQuickTradeMessage("交易已解锁。默认使用卖一价，提交前仍会生成预览。", "success");
    } catch (error) {
      setBondDialogMessage(nodes.unlockMessage, error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
  for (const id of ["closeBondTradeUnlock", "cancelBondTradeUnlock"]) {
    document.querySelector(`#${id}`).addEventListener("click", () => nodes.tradeUnlockDialog.close());
  }
  nodes.quickBuyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!quickTradeSessionActive()) {
      lockQuickTrading("交易会话已过期，请重新开启。", "error");
      return;
    }
    const reason = quickTradeContextReason();
    if (reason) {
      setQuickTradeMessage(reason, "error");
      renderQuickTradeAccess();
      return;
    }
    nodes.quickBuyPreview.disabled = true;
    setQuickTradeMessage("正在核对账户、资金与最新盘口…");
    try {
      const payload = await postJson("/api/miniqmt/trading/order-preview", {
        session_token: state.tradeSessionToken,
        account: nodes.quickBuyAccount.value,
        stock_code: currentBondMarketCode(),
        side: "buy",
        price: Number(nodes.quickBuyPrice.value),
        volume: Number(nodes.quickBuyVolume.value),
      }, 20000);
      setQuickTradeMessage("校验通过，请在弹窗中长按确认。", "success");
      showQuickTradePreview(payload);
    } catch (error) {
      setQuickTradeMessage(error.message, "error");
    } finally {
      renderQuickTradeAccess();
    }
  });
  for (const id of ["closeBondTradeConfirm", "cancelBondTradeConfirm"]) {
    document.querySelector(`#${id}`).addEventListener("click", () => {
      state.pendingQuickPreview = null;
      cancelQuickHold();
      nodes.tradeConfirmDialog.close();
    });
  }
  nodes.executeQuickBuy.addEventListener("pointerdown", startQuickHold);
  for (const eventName of ["pointerup", "pointercancel", "pointerleave"]) {
    nodes.executeQuickBuy.addEventListener(eventName, cancelQuickHold);
  }
  nodes.executeQuickBuy.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") startQuickHold(event);
  });
  nodes.executeQuickBuy.addEventListener("keyup", cancelQuickHold);
  nodes.executeQuickBuy.addEventListener("contextmenu", (event) => event.preventDefault());
}
if (isPanel && window.parent !== window) {
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type !== "finance:bond-panel-active") return;
    state.panelActive = Boolean(event.data.active);
    window.clearTimeout(state.refreshTimer);
    clearPanelHistoryBackfillTimer();
    clearReferenceDailyTimer();
    clearManualBackfillPollTimer();
    if (state.panelActive && !document.hidden) {
      if (state.payload) {
        scheduleRefresh();
        schedulePanelHistoryBackfill(state.payload);
        scheduleReferenceDailyLoad();
        resumeManualBackfillForView();
      }
      else void loadBond();
    }
  });
  document.addEventListener("dblclick", (event) => {
    if (event.target.closest?.("a, button, select")) return;
    event.preventDefault();
    const target = new URL(window.location.href);
    target.searchParams.delete("embedded");
    target.searchParams.delete("panel");
    window.parent.postMessage(
      {
        type: "finance:open-bond-overlay",
        url: `${target.pathname}${target.search}`,
      },
      window.location.origin,
    );
  });
}
window.addEventListener("resize", () => {
  window.clearTimeout(state.resizeTimer);
  state.resizeTimer = window.setTimeout(() => {
    drawChart();
    drawCurrentStockSparkline();
  }, 100);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    window.clearTimeout(state.bookTimer);
    window.clearTimeout(state.refreshTimer);
    clearPanelHistoryBackfillTimer();
    clearReferenceDailyTimer();
    clearManualBackfillPollTimer();
  } else if (!isPanel) {
    void loadOrderBook({ quiet: true });
    if (state.referenceDailyPayload) drawChart();
    else scheduleReferenceDailyLoad();
    resumeManualBackfillForView();
  } else if (state.panelActive) {
    if (state.payload) {
      scheduleRefresh();
      schedulePanelHistoryBackfill(state.payload);
      if (state.referenceDailyPayload) drawChart();
      else scheduleReferenceDailyLoad();
      resumeManualBackfillForView();
    }
    else void loadBond();
  }
});

nodes.name.textContent = requestedName || "可转债";
nodes.code.textContent = requestedCode;
nodes.intradayDaysSelect.value = String(state.intradayDays);
void loadBondMetadata();
if (!isPanel) {
  void loadBondTradingCapabilities();
  void loadOrderBook();
}
setView(state.view, { updateUrl: false, force: true });
