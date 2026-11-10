"use strict";

const API_URL = "./api/miniqmt/new-bond-performance";
const SERIES_COLORS = [
  "#176b5b", "#d8454f", "#6b5bbd", "#e18a25", "#2a73bb", "#9b4b75",
  "#5a8731", "#b85f2b", "#2e8994", "#8b6a1f", "#4d5f9f", "#bf3e77",
];

const state = {
  windowMonths: 1,
  intervalMinutes: 30,
  axisMode: "price",
  curveMode: "smooth",
  universe: [],
  selectedCodes: [],
  series: [],
  excluded: [],
  hiddenCodes: new Set(),
  loading: false,
  requestToken: 0,
  hoverProgress: null,
  chartGeometry: null,
  payload: null,
};

const nodes = {
  status: document.querySelector("#dataStatus"),
  refresh: document.querySelector("#refreshButton"),
  windowControls: document.querySelector("#windowControls"),
  intervalControls: document.querySelector("#intervalControls"),
  axisControls: document.querySelector("#axisControls"),
  curveControls: document.querySelector("#curveControls"),
  seriesCount: document.querySelector("#seriesCount"),
  candidateCount: document.querySelector("#candidateCount"),
  medianReturn: document.querySelector("#medianReturn"),
  risingCount: document.querySelector("#risingCount"),
  risingRatio: document.querySelector("#risingRatio"),
  completeStartCount: document.querySelector("#completeStartCount"),
  coverageMetricLabel: document.querySelector("#coverageMetricLabel"),
  coverageMetricHint: document.querySelector("#coverageMetricHint"),
  coverageColumnHeading: document.querySelector("#coverageColumnHeading"),
  chartCaption: document.querySelector("#chartCaption"),
  legend: document.querySelector("#seriesLegend"),
  chartWrap: document.querySelector("#chartWrap"),
  canvas: document.querySelector("#performanceCanvas"),
  tooltip: document.querySelector("#chartTooltip"),
  chartEmpty: document.querySelector("#chartEmpty"),
  search: document.querySelector("#bondSearch"),
  tableBody: document.querySelector("#bondTableBody"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function percent(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function price(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : "--";
}

function intervalLabel(value = state.intervalMinutes) {
  return Number(value) === 1440 ? "日线" : `${Number(value)}分钟`;
}

function colorForSeries(series, index) {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

async function fetchJson(url, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

function setPressed(container, attribute, selectedValue) {
  for (const button of container.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset[attribute] === String(selectedValue)));
  }
}

function setLoading(loading) {
  state.loading = loading;
  nodes.refresh.disabled = loading;
  for (const button of document.querySelectorAll(".segmented-controls button")) button.disabled = loading;
  if (loading) {
    nodes.status.textContent = Number(state.intervalMinutes) === 1440
      ? "正在读取 QMT 日线缓存收盘价，当前读取不会触发历史下载…"
      : "正在聚合 QMT 1 分钟收盘，当前读取不会触发历史下载…";
  }
}

async function loadPerformance({ resetSelection = false } = {}) {
  const token = ++state.requestToken;
  setLoading(true);
  const query = new URLSearchParams({
    window: String(state.windowMonths),
    interval: String(state.intervalMinutes),
  });
  if (!resetSelection && state.selectedCodes.length) query.set("codes", state.selectedCodes.join(","));
  try {
    const payload = await fetchJson(`${API_URL}?${query.toString()}`);
    if (token !== state.requestToken) return;
    state.payload = payload;
    state.universe = Array.isArray(payload.universe) ? payload.universe : [];
    state.selectedCodes = Array.isArray(payload.selected_codes) ? payload.selected_codes : [];
    state.series = Array.isArray(payload.series) ? payload.series : [];
    state.excluded = Array.isArray(payload.excluded_series) ? payload.excluded_series : [];
    state.hiddenCodes = new Set([...state.hiddenCodes].filter((code) => state.selectedCodes.includes(code)));
    state.hoverProgress = null;
    nodes.tooltip.hidden = true;
    renderAll();
    const coverage = payload.coverage || {};
    const errorCount = Array.isArray(coverage.batch_errors) ? coverage.batch_errors.length : 0;
    const sourceRows = Number(state.intervalMinutes) === 1440
      ? `原始日线 ${Number(coverage.raw_daily_row_count || 0).toLocaleString("zh-CN")} 根`
      : `原始分钟 ${Number(coverage.raw_minute_row_count || 0).toLocaleString("zh-CN")} 根`;
    nodes.status.textContent = [
      payload.source || "QMT 1m缓存聚合",
      `生成 ${String(payload.generated_at || "").replace("T", " ")}`,
      sourceRows,
      errorCount ? `${errorCount}批读取异常` : "读取完成",
    ].join(" · ");
  } catch (error) {
    if (token !== state.requestToken) return;
    nodes.status.textContent = `次新债${intervalLabel()}数据暂不可用：${error.message}`;
    state.series = [];
    state.excluded = [];
    renderAll();
  } finally {
    if (token === state.requestToken) setLoading(false);
  }
}

function renderMetrics() {
  const summary = window.NewBondPerformance.summarizeSeries(state.series);
  const isDaily = Number(state.intervalMinutes) === 1440;
  nodes.seriesCount.textContent = String(summary.count);
  nodes.candidateCount.textContent = `周期候选 ${state.universe.length} 只 · 已选 ${state.selectedCodes.length} 只`;
  nodes.medianReturn.textContent = percent(summary.medianReturn);
  nodes.medianReturn.className = Number(summary.medianReturn) > 0 ? "positive" : Number(summary.medianReturn) < 0 ? "negative" : "";
  nodes.risingCount.textContent = `${summary.risingCount} 只`;
  nodes.risingRatio.textContent = summary.count ? `占可比较标的 ${(summary.risingCount / summary.count * 100).toFixed(0)}%` : "--";
  nodes.completeStartCount.textContent = `${summary.completeStartCount} / ${summary.count}`;
  nodes.coverageMetricLabel.textContent = isDaily ? "上市首日有日线" : "上市首日分钟完整";
  nodes.coverageMetricHint.textContent = isDaily ? "QMT 日线缓存含上市日收盘" : "至少 228 根且覆盖开收盘";
  nodes.coverageColumnHeading.textContent = isDaily ? "日线覆盖" : "分钟覆盖";
  nodes.chartCaption.textContent = `${state.windowMonths}个月 · ${intervalLabel()}收盘 · ${state.axisMode === "price" ? "价格纵轴" : "收益率纵轴"} · ${state.curveMode === "smooth" ? "平滑连接" : "直线连接"} · ${summary.count}条曲线`;
}

function renderLegend() {
  nodes.legend.innerHTML = state.series.map((series, index) => {
    const color = colorForSeries(series, index);
    const visible = !state.hiddenCodes.has(series.code);
    return `<button type="button" data-code="${escapeHtml(series.code)}" aria-pressed="${visible}" title="点击隐藏或显示 ${escapeHtml(series.name)}"><i style="--series-color:${color}"></i><span>${escapeHtml(series.name)} ${percent(series.return_pct)}</span></button>`;
  }).join("");
}

function selectedSeriesMap() {
  return new Map(state.series.map((row) => [row.code, row]));
}

function excludedSeriesMap() {
  return new Map(state.excluded.map((row) => [row.code, row]));
}

function renderTable() {
  const term = nodes.search.value.trim().toLowerCase();
  const seriesMap = selectedSeriesMap();
  const excludedMap = excludedSeriesMap();
  const selected = new Set(state.selectedCodes);
  const isDaily = Number(state.intervalMinutes) === 1440;
  const rows = state.universe.filter((row) => !term || [row.name, row.code, row.plain_code, row.stock_name, row.stock_code]
    .some((value) => String(value || "").toLowerCase().includes(term)));
  nodes.tableBody.innerHTML = rows.map((row) => {
    const observed = seriesMap.get(row.code);
    const excluded = excludedMap.get(row.code);
    const checked = selected.has(row.code);
    const coverage = observed
      ? isDaily
        ? observed.starts_on_listing_date
          ? "含上市日日线"
          : "缺上市日日线"
        : observed.listing_day_complete
          ? `首日完整 ${observed.listing_day_raw_bar_count}根`
          : observed.starts_on_listing_date
            ? `首日部分覆盖 ${observed.listing_day_raw_bar_count || 0}根`
            : "缺上市日分钟"
      : excluded
        ? `仅 ${excluded.observed_sessions || 0} 个有效日`
        : "选中后读取";
    const returnClass = Number(observed?.return_pct) > 0 ? "positive" : Number(observed?.return_pct) < 0 ? "negative" : "";
    return `<tr class="${checked ? "is-selected" : ""}">
      <td><input type="checkbox" data-code="${escapeHtml(row.code)}" ${checked ? "checked" : ""} aria-label="显示${escapeHtml(row.name)}" /></td>
      <td><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.code)}</small></td>
      <td>${escapeHtml(row.listing_date || "--")}</td>
      <td>${escapeHtml(row.stock_name || "--")}<small>${escapeHtml(row.stock_code || "")}</small></td>
      <td>${observed ? observed.session_count : excluded ? excluded.observed_sessions : "--"}</td>
      <td>${escapeHtml(observed?.first_datetime || "--")}</td>
      <td>${escapeHtml(observed?.last_datetime || "--")}</td>
      <td class="${returnClass}">${observed ? percent(observed.return_pct) : "--"}</td>
      <td class="${observed && !(isDaily ? observed.starts_on_listing_date : observed.listing_day_complete) ? "coverage-warning" : ""}">${escapeHtml(coverage)}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="9">没有匹配的次新债</td></tr>`;
}

function visibleSeries() {
  return state.series.filter((row) => !state.hiddenCodes.has(row.code));
}

function renderChart() {
  const canvas = nodes.canvas;
  const rectangle = nodes.chartWrap.getBoundingClientRect();
  const width = Math.max(320, rectangle.width);
  const height = Math.max(390, rectangle.height);
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const series = visibleSeries();
  nodes.chartEmpty.hidden = series.length > 0;
  if (!series.length) {
    state.chartGeometry = null;
    return;
  }
  const margin = { top: 14, right: 24, bottom: 55, left: width < 520 ? 58 : 70 };
  const plot = {
    left: margin.left,
    top: margin.top,
    right: width - margin.right,
    bottom: height - margin.bottom,
  };
  plot.width = plot.right - plot.left;
  plot.height = plot.bottom - plot.top;
  const valueField = state.axisMode === "price" ? "close" : "return_pct";
  const domain = window.NewBondPerformance.chartDomain(series, valueField);
  const x = (value) => plot.left + Math.max(0, Math.min(1, Number(value))) * plot.width;
  const y = (value) => plot.bottom - (Number(value) - domain.minimum) / (domain.maximum - domain.minimum) * plot.height;
  const pointValue = (point) => Number(point?.[valueField]);
  state.chartGeometry = { ...plot, width, height, domain, x, y };

  context.lineWidth = 1;
  context.strokeStyle = "#dbe2d7";
  context.fillStyle = "#68746c";
  context.font = "11px Arial, Microsoft YaHei, sans-serif";
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (let index = 0; index <= 5; index += 1) {
    const value = domain.minimum + (domain.maximum - domain.minimum) * index / 5;
    const py = y(value);
    context.beginPath();
    context.moveTo(plot.left, py);
    context.lineTo(plot.right, py);
    context.stroke();
    context.fillText(state.axisMode === "price" ? value.toFixed(1) : `${value.toFixed(1)}%`, plot.left - 9, py);
  }

  context.save();
  context.translate(16, plot.top + plot.height / 2);
  context.rotate(-Math.PI / 2);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#68746c";
  context.fillText(state.axisMode === "price" ? "收盘价（元）" : "相对首个取样收益率（%）", 0, 0);
  context.restore();

  const xTicks = [
    [0, "首日"], [0.25, "25%"], [0.5, "中段"], [0.75, "75%"], [1, "最近"],
  ];
  context.textAlign = "center";
  context.textBaseline = "top";
  for (const [value, label] of xTicks) {
    const px = x(value);
    context.strokeStyle = "#e3e8df";
    context.beginPath();
    context.moveTo(px, plot.top);
    context.lineTo(px, plot.bottom);
    context.stroke();
    context.fillStyle = "#68746c";
    context.fillText(label, px, plot.bottom + 9);
  }
  context.fillText("归一化日历进程（首日 → 最新日）", plot.left + plot.width / 2, height - 20);

  if (state.axisMode === "return" && domain.minimum <= 0 && domain.maximum >= 0) {
    context.strokeStyle = "#89948d";
    context.setLineDash([5, 4]);
    context.beginPath();
    context.moveTo(plot.left, y(0));
    context.lineTo(plot.right, y(0));
    context.stroke();
    context.setLineDash([]);
  }

  series.forEach((item) => {
    const index = state.series.findIndex((row) => row.code === item.code);
    const color = colorForSeries(item, index);
    context.strokeStyle = color;
    context.lineWidth = 1.7;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    const coordinates = (item.points || []).map((point) => ({
      x: x(point.progress),
      y: y(pointValue(point)),
    })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (coordinates.length) context.moveTo(coordinates[0].x, coordinates[0].y);
    if (state.curveMode === "smooth" && coordinates.length > 2) {
      for (const segment of window.NewBondPerformance.monotoneBezierSegments(coordinates)) {
        context.bezierCurveTo(
          segment.control1.x,
          segment.control1.y,
          segment.control2.x,
          segment.control2.y,
          segment.to.x,
          segment.to.y,
        );
      }
    } else {
      coordinates.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    }
    context.stroke();
    for (const point of [item.points?.[0], item.points?.at(-1)]) {
      if (!point) continue;
      context.fillStyle = color;
      context.beginPath();
      context.arc(x(point.progress), y(pointValue(point)), 2.5, 0, Math.PI * 2);
      context.fill();
    }
  });

  context.strokeStyle = "#93a096";
  context.lineWidth = 1;
  context.strokeRect(plot.left + 0.5, plot.top + 0.5, plot.width - 1, plot.height - 1);

  if (state.hoverProgress !== null) {
    const px = x(state.hoverProgress);
    context.strokeStyle = "#2e3d34";
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(px, plot.top);
    context.lineTo(px, plot.bottom);
    context.stroke();
    context.setLineDash([]);
    series.forEach((item) => {
      const point = window.NewBondPerformance.nearestPoint(item.points, state.hoverProgress);
      if (!point) return;
      const index = state.series.findIndex((row) => row.code === item.code);
      context.fillStyle = colorForSeries(item, index);
      context.beginPath();
      context.arc(px, y(pointValue(point)), 3.2, 0, Math.PI * 2);
      context.fill();
    });
  }
}

function showTooltip(clientX, clientY) {
  const geometry = state.chartGeometry;
  if (!geometry || state.hoverProgress === null) return;
  const series = visibleSeries();
  const valueField = state.axisMode === "price" ? "close" : "return_pct";
  const rows = window.NewBondPerformance.sortTooltipRows(series.map((item) => ({
    item,
    point: window.NewBondPerformance.nearestPoint(item.points, state.hoverProgress),
    index: state.series.findIndex((row) => row.code === item.code),
  })).filter((row) => row.point), valueField);
  const sortLabel = state.axisMode === "price" ? "价格高→低" : "收益率高→低";
  nodes.tooltip.innerHTML = `<strong>上市进程 ${(state.hoverProgress * 100).toFixed(1)}% · ${sortLabel}</strong>${rows.map(({ item, point, index }, rank) => `<div><b>${rank + 1}</b><i style="--series-color:${colorForSeries(item, index)}"></i><span>${escapeHtml(item.name)}<br>${escapeHtml(point.datetime)}</span><span>${percent(point.return_pct)}<br>${price(point.close)}</span></div>`).join("")}`;
  nodes.tooltip.hidden = false;
  const wrapRect = nodes.chartWrap.getBoundingClientRect();
  const localX = clientX - wrapRect.left;
  const localY = clientY - wrapRect.top;
  const tooltipWidth = Math.min(330, wrapRect.width - 20);
  nodes.tooltip.style.left = `${Math.max(10, Math.min(wrapRect.width - tooltipWidth - 10, localX + 14))}px`;
  nodes.tooltip.style.top = `${Math.max(8, Math.min(wrapRect.height - nodes.tooltip.offsetHeight - 8, localY + 12))}px`;
}

function renderAll() {
  setPressed(nodes.windowControls, "window", state.windowMonths);
  setPressed(nodes.intervalControls, "interval", state.intervalMinutes);
  setPressed(nodes.axisControls, "axis", state.axisMode);
  setPressed(nodes.curveControls, "curve", state.curveMode);
  renderMetrics();
  renderLegend();
  renderTable();
  renderChart();
}

nodes.windowControls.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-window]");
  if (!button || state.loading) return;
  state.windowMonths = Number(button.dataset.window);
  state.selectedCodes = [];
  state.hiddenCodes.clear();
  void loadPerformance({ resetSelection: true });
});

nodes.intervalControls.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-interval]");
  if (!button || state.loading) return;
  state.intervalMinutes = Number(button.dataset.interval);
  void loadPerformance();
});

nodes.axisControls.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-axis]");
  if (!button) return;
  state.axisMode = button.dataset.axis;
  setPressed(nodes.axisControls, "axis", state.axisMode);
  renderMetrics();
  renderChart();
});

nodes.curveControls.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-curve]");
  if (!button) return;
  state.curveMode = button.dataset.curve;
  setPressed(nodes.curveControls, "curve", state.curveMode);
  renderMetrics();
  renderChart();
});

nodes.refresh.addEventListener("click", () => void loadPerformance());
nodes.search.addEventListener("input", renderTable);

nodes.legend.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-code]");
  if (!button) return;
  const code = button.dataset.code;
  if (state.hiddenCodes.has(code)) state.hiddenCodes.delete(code);
  else state.hiddenCodes.add(code);
  renderLegend();
  renderChart();
});

nodes.tableBody.addEventListener("change", (event) => {
  const checkbox = event.target.closest('input[type="checkbox"][data-code]');
  if (!checkbox || state.loading) return;
  const code = checkbox.dataset.code;
  const next = new Set(state.selectedCodes);
  if (checkbox.checked) {
    if (next.size >= 12) {
      checkbox.checked = false;
      nodes.status.textContent = "最多同时比较 12 只次新债，请先取消一只。";
      return;
    }
    next.add(code);
  } else {
    if (next.size <= 1) {
      checkbox.checked = true;
      nodes.status.textContent = "至少保留 1 只比较标的。";
      return;
    }
    next.delete(code);
  }
  state.selectedCodes = [...next];
  state.hiddenCodes.delete(code);
  void loadPerformance();
});

nodes.canvas.addEventListener("pointermove", (event) => {
  const geometry = state.chartGeometry;
  if (!geometry) return;
  const rectangle = nodes.canvas.getBoundingClientRect();
  const localX = event.clientX - rectangle.left;
  if (localX < geometry.left || localX > geometry.right) {
    state.hoverProgress = null;
    nodes.tooltip.hidden = true;
  } else {
    state.hoverProgress = (localX - geometry.left) / geometry.width;
    showTooltip(event.clientX, event.clientY);
  }
  renderChart();
});

nodes.canvas.addEventListener("pointerleave", () => {
  state.hoverProgress = null;
  nodes.tooltip.hidden = true;
  renderChart();
});

const resizeObserver = new ResizeObserver(() => renderChart());
resizeObserver.observe(nodes.chartWrap);

void loadPerformance({ resetSelection: true });
