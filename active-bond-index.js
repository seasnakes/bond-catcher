const LIVE_URL = "./api/active-index/live";
const INDICES_URL = "./api/indices";
const SVG_NS = "http://www.w3.org/2000/svg";
const OVERLAY_CONFIGS = {
  sh000001: { name: "上证指数", className: "overlay-sh000001" },
  sz399006: { name: "创业板指", className: "overlay-sz399006" },
  sh000680: { name: "科创综指", className: "overlay-sh000680" },
  kospi: { name: "韩国KOSPI", className: "overlay-kospi" },
};

const state = {
  payload: null,
  view: "intraday",
  dailyRange: 60,
  sortField: "amount",
  sortDirection: "desc",
  refreshTimer: 0,
  loading: false,
  sparklines: new Map(),
  sparkQuoteDate: "",
  sparkLoading: false,
  overlays: new Map(),
  selectedOverlays: new Set(),
  overlayLoading: false,
  overlayLoadedAt: 0,
};

const nodes = {
  liveDot: document.querySelector("#liveDot"),
  status: document.querySelector("#marketStatus"),
  lastUpdated: document.querySelector("#lastUpdated"),
  refresh: document.querySelector("#refreshButton"),
  indexValue: document.querySelector("#indexValue"),
  indexChange: document.querySelector("#indexChange"),
  count: document.querySelector("#constituentCount"),
  universeDate: document.querySelector("#universeDate"),
  amount: document.querySelector("#indexAmount"),
  breadth: document.querySelector("#breadth"),
  coverage: document.querySelector("#coverage"),
  chart: document.querySelector("#marketChart"),
  chartStage: document.querySelector("#chartStage"),
  chartTooltip: document.querySelector("#chartTooltip"),
  chartEmpty: document.querySelector("#chartEmpty"),
  dailyRanges: document.querySelector("#dailyRanges"),
  overlayControls: document.querySelector("#overlayControls"),
  scope: document.querySelector("#scopeSelect"),
  search: document.querySelector("#searchInput"),
  rows: document.querySelector("#constituentRows"),
};

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "--";
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function signed(value, digits = 2, suffix = "%") {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "--";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${formatNumber(number, digits)}${suffix}`;
}

function formatAmount(value) {
  const number = Number(value || 0);
  if (number >= 1e8) return `${formatNumber(number / 1e8, 2)}亿`;
  if (number >= 1e4) return `${formatNumber(number / 1e4, 0)}万`;
  return formatNumber(number, 0);
}

function valueClass(value) {
  const number = Number(value);
  return number > 0 ? "is-up" : number < 0 ? "is-down" : "flat";
}

function setValue(node, text, value = null) {
  node.textContent = text;
  node.classList.remove("is-up", "is-down", "flat");
  if (value !== null) node.classList.add(valueClass(value));
}

function renderHeader() {
  const payload = state.payload;
  const quote = payload.index;
  const tableUniverse = payload.table_universe;
  const coverage = payload.coverage;
  nodes.liveDot.classList.toggle("is-live", payload.is_live);
  const sessionLabel = payload.is_live
    ? "盘中实时"
    : payload.data_is_stale
      ? `最近行情 ${payload.quote_date}`
      : "非交易时段";
  nodes.status.textContent = `${sessionLabel} · ${payload.source} · 只读`;
  nodes.lastUpdated.textContent = payload.generated_at.slice(11, 19);
  setValue(nodes.indexValue, formatNumber(quote.value, 2), quote.change);
  setValue(nodes.indexChange, signed(quote.change, 2), quote.change);
  nodes.count.textContent = `${tableUniverse.count}只`;
  nodes.universeDate.textContent = `适用 ${tableUniverse.effective_date}`;
  nodes.amount.textContent = formatAmount(quote.amount);
  nodes.breadth.textContent = `${quote.up} / ${quote.down}`;
  nodes.coverage.textContent = `${coverage.table_returned}/${coverage.table_requested}`;
}

function chartFrame(rows, valueAccessor, options = {}) {
  const width = 1200;
  const height = 580;
  const margin = { left: 64, right: 62, top: 24, bottom: 34 };
  const topBottom = options.topBottom || 360;
  const values = rows.map(valueAccessor).filter(Number.isFinite);
  const minimum = options.minimum ?? Math.min(...values);
  const maximum = options.maximum ?? Math.max(...values);
  const padding = (maximum - minimum || Math.max(1, Math.abs(maximum) * .01)) * .06;
  const low = minimum - padding;
  const high = maximum + padding;
  const x = (index) =>
    margin.left + index / Math.max(1, rows.length - 1) * (width - margin.left - margin.right);
  const y = (value) =>
    margin.top + (high - value) / Math.max(.0001, high - low) * (topBottom - margin.top);
  return { width, height, margin, topBottom, low, high, x, y };
}

function drawGrid(
  frame,
  labels,
  formatter = (value) => formatNumber(value, 2),
  rightFormatter = null,
) {
  const grid = svgElement("g", { class: "chart-grid" });
  const axis = svgElement("g", { class: "chart-axis" });
  for (let index = 0; index < 5; index += 1) {
    const value = frame.low + (frame.high - frame.low) * index / 4;
    const y = frame.y(value);
    grid.append(svgElement("line", {
      x1: frame.margin.left,
      x2: frame.width - frame.margin.right,
      y1: y,
      y2: y,
    }));
    const label = svgElement("text", {
      x: frame.margin.left - 8,
      y: y + 4,
      "text-anchor": "end",
    });
    label.textContent = formatter(value);
    axis.append(label);
    if (rightFormatter) {
      const rightLabel = svgElement("text", {
        class: valueClass(value),
        x: frame.width - frame.margin.right + 8,
        y: y + 4,
        "text-anchor": "start",
      });
      rightLabel.textContent = rightFormatter(value);
      axis.append(rightLabel);
    }
  }
  for (const item of labels) {
    const label = svgElement("text", {
      x: frame.x(item.index),
      y: frame.height - 12,
      "text-anchor": item.anchor || "middle",
    });
    label.textContent = item.text;
    axis.append(label);
  }
  nodes.chart.append(grid, axis);
}

function bindChartHover(rows, frame, tooltipHtml) {
  const crosshair = svgElement("line", {
    class: "chart-crosshair",
    y1: frame.margin.top,
    y2: frame.height - frame.margin.bottom,
    visibility: "hidden",
  });
  const hit = svgElement("rect", {
    class: "chart-hit",
    x: frame.margin.left,
    y: frame.margin.top,
    width: frame.width - frame.margin.left - frame.margin.right,
    height: frame.height - frame.margin.top - frame.margin.bottom,
  });
  hit.addEventListener("mousemove", (event) => {
    const bounds = nodes.chart.getBoundingClientRect();
    const svgX = (event.clientX - bounds.left) / bounds.width * frame.width;
    const ratio = (svgX - frame.margin.left) / (frame.width - frame.margin.left - frame.margin.right);
    const index = Math.max(0, Math.min(rows.length - 1, Math.round(ratio * (rows.length - 1))));
    const x = frame.x(index);
    crosshair.setAttribute("x1", x);
    crosshair.setAttribute("x2", x);
    crosshair.setAttribute("visibility", "visible");
    nodes.chartTooltip.innerHTML = tooltipHtml(rows[index]);
    nodes.chartTooltip.hidden = false;
    nodes.chartTooltip.style.left = `${Math.min(
      nodes.chartStage.clientWidth - 205,
      Math.max(5, event.clientX - bounds.left + 12),
    )}px`;
    nodes.chartTooltip.style.top = `${Math.max(5, event.clientY - bounds.top - 85)}px`;
  });
  hit.addEventListener("mouseleave", () => {
    crosshair.setAttribute("visibility", "hidden");
    nodes.chartTooltip.hidden = true;
  });
  nodes.chart.append(crosshair, hit);
}

function normalizedClock(value) {
  const match = String(value || "").match(/(\d{2}):?(\d{2})(?::\d{2})?$/);
  return match ? `${match[1]}:${match[2]}` : "";
}

function selectedOverlaySeries() {
  return [...state.selectedOverlays]
    .map((key) => {
      const item = state.overlays.get(key);
      const config = OVERLAY_CONFIGS[key];
      const points = Array.isArray(item?.points) ? item.points.map(Number) : [];
      const previousClose = Number(item?.price) - Number(item?.change);
      if (!config || points.length < 2 || !(previousClose > 0)) return null;
      const changes = points.map((value) => (value / previousClose - 1) * 100);
      const clocks = Array.isArray(item?.sparkTimes)
        ? item.sparkTimes.map(normalizedClock)
        : [];
      return {
        key,
        ...config,
        changes,
        clocks,
        source: item.sparkSource || "外层看板分时",
      };
    })
    .filter(Boolean);
}

function overlayCoordinates(series, rows, frame) {
  if (series.clocks.length === series.changes.length) {
    const rowIndexByClock = new Map(rows.map((row, index) => [row.clock, index]));
    const coordinates = series.changes
      .map((change, index) => {
        const rowIndex = rowIndexByClock.get(series.clocks[index]);
        return rowIndex === undefined ? null : [frame.x(rowIndex), frame.y(change)];
      })
      .filter(Boolean);
    if (coordinates.length >= 2) return coordinates;
  }
  return series.changes.map((change, index) => [
    frame.margin.left
      + index / Math.max(1, series.changes.length - 1)
      * (frame.width - frame.margin.left - frame.margin.right),
    frame.y(change),
  ]);
}

function overlayValueAt(series, row, index, rowCount) {
  if (series.clocks.length === series.changes.length) {
    const clockIndex = series.clocks.indexOf(row.clock);
    if (clockIndex >= 0) return series.changes[clockIndex];
  }
  const mappedIndex = Math.round(
    index / Math.max(1, rowCount - 1) * (series.changes.length - 1),
  );
  return series.changes[mappedIndex];
}

function renderIntradayChart() {
  const rows = state.payload.intraday;
  nodes.chart.replaceChildren();
  nodes.chartEmpty.hidden = rows.length > 0;
  if (!rows.length) return;
  const overlays = selectedOverlaySeries();
  const allChanges = [
    ...rows.map((row) => Number(row.change)).filter(Number.isFinite),
    ...overlays.flatMap((series) => series.changes.filter(Number.isFinite)),
  ];
  const maximumMove = Math.max(.25, ...allChanges.map((value) => Math.abs(value)));
  const frame = chartFrame(rows, (row) => row.change, {
    topBottom: 405,
    minimum: -maximumMove,
    maximum: maximumMove,
  });
  const labels = [
    { index: 0, text: rows[0].clock, anchor: "start" },
    { index: Math.floor((rows.length - 1) / 2), text: rows[Math.floor((rows.length - 1) / 2)].clock },
    { index: rows.length - 1, text: rows.at(-1).clock, anchor: "end" },
  ];
  const anchor = Number(state.payload.index.anchor) || Number(rows[0].value) || 100;
  drawGrid(
    frame,
    labels,
    (change) => formatNumber(anchor * (1 + change / 100), 2),
    (change) => signed(change, 2),
  );

  const barWidth = Math.max(1, (frame.width - frame.margin.left - frame.margin.right) / rows.length * .55);

  const points = rows.map((row, index) =>
    `${frame.x(index).toFixed(2)},${frame.y(row.change).toFixed(2)}`,
  ).join(" ");
  nodes.chart.append(svgElement("polyline", { class: "index-line", points }));
  for (const series of overlays) {
    const overlayPoints = overlayCoordinates(series, rows, frame)
      .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
      .join(" ");
    nodes.chart.append(svgElement("polyline", {
      class: `overlay-line ${series.className}`,
      points: overlayPoints,
    }));
  }

  const amountTop = 420;
  const amountBottom = 545;
  const maxAmount = Math.max(1, ...rows.map((row) => row.amount));
  rows.forEach((row, index) => {
    const previous = rows[Math.max(0, index - 1)];
    const height = row.amount / maxAmount * (amountBottom - amountTop);
    nodes.chart.append(svgElement("rect", {
      class: `amount-bar ${valueClass(row.value - previous.value)}`,
      x: frame.x(index) - barWidth / 2,
      y: amountBottom - height,
      width: barWidth,
      height: Math.max(1, height),
    }));
  });
  const amountLabel = svgElement("text", {
    class: "chart-axis",
    x: frame.margin.left - 8,
    y: amountTop + 4,
    "text-anchor": "end",
  });
  amountLabel.textContent = formatAmount(maxAmount);
  nodes.chart.append(amountLabel);

  bindChartHover(rows, frame, (row) => {
    const index = rows.indexOf(row);
    const overlayRows = overlays.map((series) => {
      const change = overlayValueAt(series, row, index, rows.length);
      return `<span><i>${series.name}</i><b class="${valueClass(change)}">${signed(change, 2)}</b></span>`;
    }).join("");
    return `
      <strong>${state.payload.quote_date} ${row.clock}</strong>
      <span><i>活跃转债</i><b class="${valueClass(row.change)}">${signed(row.change, 2)}</b></span>
      ${overlayRows}
      <span><i>指数点位</i><b>${formatNumber(row.value, 2)}</b></span>
      <span><i>分钟成交额</i><b>${formatAmount(row.amount)}</b></span>
      <span><i>上涨 / 下跌</i><b>${row.up} / ${row.down}</b></span>
    `;
  });
}

function renderDailyChart() {
  const allRows = state.payload.daily;
  const rows = allRows.slice(-state.dailyRange);
  nodes.chart.replaceChildren();
  nodes.chartEmpty.hidden = rows.length > 0;
  if (!rows.length) return;
  const frame = chartFrame(rows, (row) => row.close, {
    topBottom: 430,
    minimum: Math.min(...rows.map((row) => row.low)),
    maximum: Math.max(...rows.map((row) => row.high)),
  });
  const labels = [
    { index: 0, text: rows[0].date.slice(5), anchor: "start" },
    { index: Math.floor((rows.length - 1) / 2), text: rows[Math.floor((rows.length - 1) / 2)].date.slice(5) },
    { index: rows.length - 1, text: rows.at(-1).date.slice(5), anchor: "end" },
  ];
  drawGrid(frame, labels);
  const slot = (frame.width - frame.margin.left - frame.margin.right) / Math.max(1, rows.length);
  const bodyWidth = Math.max(2, Math.min(10, slot * .58));
  rows.forEach((row, index) => {
    const direction = row.close >= row.open ? "is-up" : "is-down";
    nodes.chart.append(svgElement("line", {
      class: `candle-wick ${direction}`,
      x1: frame.x(index),
      x2: frame.x(index),
      y1: frame.y(row.high),
      y2: frame.y(row.low),
    }));
    const top = frame.y(Math.max(row.open, row.close));
    const bottom = frame.y(Math.min(row.open, row.close));
    nodes.chart.append(svgElement("rect", {
      class: `candle ${direction}`,
      x: frame.x(index) - bodyWidth / 2,
      y: top,
      width: bodyWidth,
      height: Math.max(1.2, bottom - top),
    }));
  });
  const amountTop = 455;
  const amountBottom = 545;
  const maxAmount = Math.max(1, ...rows.map((row) => row.amount));
  rows.forEach((row, index) => {
    const height = Number(row.amount || 0) / maxAmount * (amountBottom - amountTop);
    nodes.chart.append(svgElement("rect", {
      class: `amount-bar ${row.close >= row.open ? "is-up" : "is-down"}`,
      x: frame.x(index) - bodyWidth / 2,
      y: amountBottom - height,
      width: bodyWidth,
      height: Math.max(1, height),
    }));
  });
  bindChartHover(rows, frame, (row) => `
    <strong>${row.date}</strong>
    <span><i>开 / 收</i><b>${formatNumber(row.open, 2)} / ${formatNumber(row.close, 2)}</b></span>
    <span><i>高 / 低</i><b>${formatNumber(row.high, 2)} / ${formatNumber(row.low, 2)}</b></span>
    <span><i>成交额</i><b>${formatAmount(row.amount)}</b></span>
    <span><i>来源</i><b>${row.source}</b></span>
  `);
}

function renderChart() {
  if (state.view === "daily") renderDailyChart();
  else renderIntradayChart();
}

function filteredConstituents() {
  const query = nodes.search.value.trim().toLowerCase();
  const scope = nodes.scope.value;
  const sortField = state.sortField;
  const direction = state.sortDirection === "asc" ? 1 : -1;
  return state.payload.constituents
    .filter((row) => {
      if (query && !`${row.name} ${row.code}`.toLowerCase().includes(query)) return false;
      if (scope === "up") return Number(row.change) > 0;
      if (scope === "down") return Number(row.change) < 0;
      if (scope === "fast") return Math.abs(Number(row.speed1m || 0)) >= .3;
      return true;
    })
    .sort((left, right) => {
      if (sortField === "name") {
        return direction * String(left.name || left.code).localeCompare(
          String(right.name || right.code),
          "zh-CN",
        );
      }
      const leftValue = Number(left[sortField]);
      const rightValue = Number(right[sortField]);
      if (!Number.isFinite(leftValue) && !Number.isFinite(rightValue)) return 0;
      if (!Number.isFinite(leftValue)) return 1;
      if (!Number.isFinite(rightValue)) return -1;
      return direction * (leftValue - rightValue);
    });
}

function updateSortHeaders() {
  document.querySelectorAll("th[data-sort]").forEach((header) => {
    const active = header.dataset.sort === state.sortField;
    const button = header.querySelector(".sort-button");
    const indicator = header.querySelector(".sort-indicator");
    button?.classList.toggle("is-active", active);
    if (indicator) indicator.textContent = active
      ? state.sortDirection === "asc" ? "↑" : "↓"
      : "";
    if (active) {
      header.setAttribute(
        "aria-sort",
        state.sortDirection === "asc" ? "ascending" : "descending",
      );
    } else {
      header.removeAttribute("aria-sort");
    }
  });
}

function secidFromCode(code) {
  const match = String(code || "").match(/^(\d{6})\.(SH|SZ)$/);
  if (!match) return "";
  return `${match[2] === "SH" ? "1" : "0"}.${match[1]}`;
}

function sparklinePath(points, width, height) {
  const values = points.map(Number).filter(Number.isFinite);
  if (values.length < 2) return "";
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || Math.max(1, Math.abs(maximum) * .01);
  const step = width / Math.max(1, values.length - 1);
  const padding = 1.5;
  return values.map((value, index) => {
    const x = index * step;
    const y = padding + (1 - (value - minimum) / range) * (height - padding * 2);
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function sparklineMarkup(row) {
  const spark = state.sparklines.get(secidFromCode(row.code));
  const points = Array.isArray(spark?.points) ? spark.points : [];
  const path = sparklinePath(points, 92, 22);
  if (!path) return '<span class="row-sparkline is-loading"></span>';
  const tone = valueClass(row.change).replace("is-", "");
  return `
    <span class="row-sparkline" title="${spark.source || "今日分时"} ${spark.time || ""}">
      <svg viewBox="0 0 92 22" aria-hidden="true">
        <path class="spark-${tone}" d="${path}"></path>
      </svg>
    </span>
  `;
}

function bondDetailUrl(row) {
  const query = new URLSearchParams({
    code: row.code.slice(0, 6),
    name: row.name,
  });
  return `./bond.html?${query}`;
}

function tagMarkup(tags = [], limit = 2) {
  return tags
    .slice(0, limit)
    .map((tag) => `<span class="bond-tag">${tag}</span>`)
    .join("");
}

function renderTable() {
  const rows = filteredConstituents();
  nodes.rows.replaceChildren();
  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    const volumeClass = Number(row.volumeRatio) >= 2 ? "hot-value" : "";
    const speedClass = Math.abs(Number(row.speed1m || 0)) >= .3 ? "hot-value" : valueClass(row.speed1m);
    tr.innerHTML = `
      <td class="rank">${index + 1}</td>
      <td>
        <span class="bond-name">${row.name}</span><span class="bond-code">${row.code}</span>
        <span class="bond-tags">${tagMarkup(row.tags)}</span>
      </td>
      <td class="spark-cell">${sparklineMarkup(row)}</td>
      <td class="number ${valueClass(row.change)}">${signed(row.change, 2)}</td>
      <td class="number ${valueClass(row.change)}">${formatNumber(row.price, 3)}</td>
      <td class="number ${volumeClass}">${formatNumber(row.volumeRatio, 2)}</td>
      <td class="number ${speedClass}">${signed(row.speed1m, 2)}</td>
      <td class="number amount-value">${formatAmount(row.amount)}</td>
      <td class="number amount-value">${formatAmount(row.amount1m)}</td>
      <td class="number ${valueClass(row.change3d)}">${signed(row.change3d, 2)}</td>
    `;
    tr.title = `双击查看 ${row.name} 分时`;
    tr.addEventListener("dblclick", () => {
      window.location.href = bondDetailUrl(row);
    });
    nodes.rows.append(tr);
  });
}

async function loadSparklines() {
  if (!state.payload || state.sparkLoading) return;
  if (
    state.sparkQuoteDate === state.payload.quote_date
    && state.sparklines.size >= state.payload.constituents.length
  ) return;
  state.sparkLoading = true;
  if (state.sparkQuoteDate !== state.payload.quote_date) {
    state.sparklines.clear();
    state.sparkQuoteDate = state.payload.quote_date;
  }
  const secids = [...new Set(
    state.payload.constituents.map((row) => secidFromCode(row.code)).filter(Boolean),
  )];
  try {
    for (let index = 0; index < secids.length; index += 70) {
      const group = secids.slice(index, index + 70);
      const response = await fetch(`/api/sparks?secids=${group.join(",")}`, {
        cache: "no-store",
      });
      if (!response.ok) continue;
      const payload = await response.json();
      for (const spark of payload.sparks || []) {
        if (spark?.secid) state.sparklines.set(spark.secid, spark);
      }
    }
  } catch (error) {
    console.warn("Active index constituent sparklines unavailable.", error);
  } finally {
    state.sparkLoading = false;
    renderTable();
  }
}

async function loadOverlayIndices(force = false) {
  if (state.overlayLoading || state.selectedOverlays.size === 0) return;
  if (!force && Date.now() - state.overlayLoadedAt < 60_000 && state.overlays.size) {
    renderIntradayChart();
    return;
  }
  state.overlayLoading = true;
  try {
    const response = await fetch(INDICES_URL, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    state.overlays.clear();
    for (const item of payload.indices || []) {
      if (OVERLAY_CONFIGS[item?.key]) state.overlays.set(item.key, item);
    }
    state.overlayLoadedAt = Date.now();
    if (state.view === "intraday") renderIntradayChart();
  } catch (error) {
    console.warn("Index overlays unavailable.", error);
  } finally {
    state.overlayLoading = false;
  }
}

function scheduleRefresh() {
  window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(
    () => loadLive(false),
    state.payload?.is_live ? 10_000 : 60_000,
  );
}

async function loadLive(manual = false) {
  if (state.loading) return;
  state.loading = true;
  nodes.refresh.disabled = true;
  if (manual) nodes.status.textContent = "正在刷新 QMT 行情…";
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 55_000);
    const response = await fetch(LIVE_URL, { cache: "no-store", signal: controller.signal });
    window.clearTimeout(timer);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    state.payload = payload;
    renderHeader();
    renderChart();
    renderTable();
    void loadSparklines();
    if (state.selectedOverlays.size) void loadOverlayIndices(true);
  } catch (error) {
    nodes.status.textContent = `QMT 行情读取失败：${error.message}`;
    nodes.liveDot.classList.remove("is-live");
  } finally {
    state.loading = false;
    nodes.refresh.disabled = false;
    scheduleRefresh();
  }
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      document.querySelectorAll("[data-view]").forEach((item) =>
        item.classList.toggle("is-active", item === button),
      );
      nodes.dailyRanges.hidden = state.view !== "daily";
      nodes.overlayControls.hidden = state.view !== "intraday";
      renderChart();
    });
  });
  document.querySelectorAll("[data-range]").forEach((button) => {
    button.addEventListener("click", () => {
      state.dailyRange = Number(button.dataset.range);
      document.querySelectorAll("[data-range]").forEach((item) =>
        item.classList.toggle("is-active", item === button),
      );
      renderDailyChart();
    });
  });
  nodes.refresh.addEventListener("click", () => loadLive(true));
  document.querySelectorAll("th[data-sort] .sort-button").forEach((button) => {
    button.addEventListener("click", () => {
      const field = button.closest("th")?.dataset.sort;
      if (!field) return;
      if (state.sortField === field) {
        state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
      } else {
        state.sortField = field;
        state.sortDirection = field === "name" ? "asc" : "desc";
      }
      updateSortHeaders();
      renderTable();
    });
  });
  nodes.overlayControls.querySelectorAll("input[data-overlay]").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.selectedOverlays.add(input.dataset.overlay);
      else state.selectedOverlays.delete(input.dataset.overlay);
      if (state.selectedOverlays.size && !state.overlays.has(input.dataset.overlay)) {
        void loadOverlayIndices();
      } else {
        renderIntradayChart();
      }
    });
  });
  nodes.scope.addEventListener("change", renderTable);
  nodes.search.addEventListener("input", renderTable);
  updateSortHeaders();
}

bindEvents();
loadLive();
