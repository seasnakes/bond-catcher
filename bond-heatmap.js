const DATA_URL = "./data/convertible-bond-heatmap.json";
const TAG_DATA_URL = "./api/miniqmt/tags";
const TAG_SNAPSHOT_URL = "./data/convertible-bond-tags.json";
const TAG_RETRY_DELAY_MS = 30000;
const SVG_NS = "http://www.w3.org/2000/svg";
const QUOTE_BATCH_SIZE = 100;
const ATTRIBUTE_TAGS = new Set(["次新债", "小盘", "ST"]);
const TAG_UPDATE_CHANNEL_NAME = "finance:bond-tags";
const TAG_UPDATE_STORAGE_KEY = "finance:bond-tags-updated";
const SUPPLEMENTAL_METADATA_CACHE_KEY = "finance:bond-heatmap:supplemental-metadata:v1";
const SUPPLEMENTAL_METADATA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CAMERA = Object.freeze({
  yaw: -10 * Math.PI / 180,
  pitch: 50 * Math.PI / 180,
  zoom: 1.12,
  panX: 0,
  panY: 0,
});

const state = {
  rows: [],
  snapshot: null,
  landscapePositions: new Map(),
  stockQuoteCoverage: 0,
  supplementalBondCount: 0,
  selectedRow: null,
  sparklines: new Map(),
  previewRows: [],
  previewHideTimer: 0,
  previewToken: 0,
  resizeTimer: 0,
  renderFrame: 0,
  refreshing: false,
  quoteRefreshPending: false,
  loading: false,
  tagRefreshing: false,
  tagRetryTimer: 0,
  tagWarning: "",
  statusMessage: "",
  tagOrder: [],
  lastTagVersion: 0,
  pendingTagVersion: 0,
  pendingTagReason: "",
  pendingTagRows: new Map(),
  pendingTagOrder: null,
  pendingTagNeedsFetch: false,
  camera: { ...DEFAULT_CAMERA },
  cameraDrag: {
    active: false,
    pointerId: null,
    mode: "idle",
    lastX: 0,
    lastY: 0,
    startX: 0,
    startY: 0,
    longPressTimer: 0,
  },
};

const tagUpdateChannel = typeof window.BroadcastChannel === "function"
  ? new window.BroadcastChannel(TAG_UPDATE_CHANNEL_NAME)
  : null;

const nodes = {
  status: document.querySelector("#marketStatus"),
  bondCount: document.querySelector("#bondCount"),
  totalAmount: document.querySelector("#totalAmount"),
  upCount: document.querySelector("#upCount"),
  downCount: document.querySelector("#downCount"),
  view: document.querySelector("#viewSelect"),
  group: document.querySelector("#groupSelect"),
  size: document.querySelector("#sizeSelect"),
  sizeLabel: document.querySelector("#sizeLabel"),
  height: document.querySelector("#heightSelect"),
  heightControl: document.querySelector("#heightControl"),
  zoomControl: document.querySelector("#zoomControl"),
  zoomRange: document.querySelector("#zoomRange"),
  zoomValue: document.querySelector("#zoomValue"),
  cameraControls: document.querySelector("#cameraControls"),
  cameraYaw: document.querySelector("#cameraYaw"),
  cameraYawValue: document.querySelector("#cameraYawValue"),
  cameraPitch: document.querySelector("#cameraPitch"),
  cameraPitchValue: document.querySelector("#cameraPitchValue"),
  cameraReset: document.querySelector("#cameraReset"),
  color: document.querySelector("#colorSelect"),
  attentionControl: document.querySelector("#attentionControl"),
  attention: document.querySelector("#attentionSelect"),
  sector: document.querySelector("#sectorSelect"),
  tag: document.querySelector("#tagSelect"),
  search: document.querySelector("#searchInput"),
  refresh: document.querySelector("#refreshButton"),
  legend: document.querySelector("#colorLegend"),
  note: document.querySelector("#dataNote"),
  stage: document.querySelector("#heatmapStage"),
  svg: document.querySelector("#heatmapSvg"),
  tooltip: document.querySelector("#heatmapTooltip"),
  empty: document.querySelector("#emptyState"),
  sectorPreview: document.querySelector("#sectorPreview"),
  sectorPreviewTitle: document.querySelector("#sectorPreviewTitle"),
  sectorPreviewMeta: document.querySelector("#sectorPreviewMeta"),
  sectorPreviewList: document.querySelector("#sectorPreviewList"),
  closeSectorPreview: document.querySelector("#closeSectorPreview"),
  selected: document.querySelector("#selectedBond"),
  selectedName: document.querySelector("#selectedBondName"),
  selectedMeta: document.querySelector("#selectedBondMeta"),
  selectedPrice: document.querySelector("#selectedBondPrice"),
  selectedChange: document.querySelector("#selectedBondChange"),
  openDetail: document.querySelector("#openBondDetail"),
  clearSelected: document.querySelector("#clearSelectedBond"),
  detailOverlay: document.querySelector("#bondDetailOverlay"),
  detailFrame: document.querySelector("#bondDetailFrame"),
  closeDetail: document.querySelector("#closeBondDetail"),
};

function formatNumber(value, digits = 2) {
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function quantile(values, percentile) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * percentile;
  const index = Math.floor(position);
  const fraction = position - index;
  const next = sorted[Math.min(index + 1, sorted.length - 1)];
  return sorted[index] + (next - sorted[index]) * fraction;
}

function chunk(values, size) {
  const groups = [];
  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size));
  }
  return groups;
}

function marketCode(code) {
  const match = String(code || "").match(/^(\d{6})\.(SH|SZ)$/);
  return match ? `${match[1]}.${match[2]}` : "";
}

function secidFromCode(code) {
  const match = String(code || "").match(/^(\d{6})\.(SH|SZ)$/);
  if (!match) return "";
  return `${match[2] === "SH" ? "1" : "0"}.${match[1]}`;
}

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new Error("请求超时，请稍后重试");
    }
    if (error instanceof TypeError) throw new Error("连接暂时不可用，请稍后重试");
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function setMarketStatus(message = state.statusMessage) {
  state.statusMessage = message;
  nodes.status.textContent = [message, state.tagWarning].filter(Boolean).join(" · ");
}

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function radiansToDegrees(value) {
  return Math.round(value * 180 / Math.PI);
}

function normalizeAngle(value) {
  const fullTurn = Math.PI * 2;
  return ((value + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
}

function syncCameraControls() {
  const yaw = radiansToDegrees(state.camera.yaw);
  const pitch = radiansToDegrees(state.camera.pitch);
  nodes.cameraYaw.value = String(yaw);
  nodes.cameraPitch.value = String(pitch);
  nodes.cameraYawValue.textContent = `${yaw}°`;
  nodes.cameraPitchValue.textContent = `${pitch}°`;
  const zoom = Math.round(state.camera.zoom * 100);
  nodes.zoomRange.value = String(zoom);
  nodes.zoomValue.textContent = `${zoom}%`;
}

function scheduleRender() {
  if (state.renderFrame) return;
  state.renderFrame = window.requestAnimationFrame(() => {
    state.renderFrame = 0;
    render();
  });
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function interpolateColor(from, to, ratio) {
  const start = hexToRgb(from);
  const end = hexToRgb(to);
  const value = start.map((channel, index) =>
    Math.round(channel + (end[index] - channel) * Math.max(0, Math.min(1, ratio))),
  );
  return `rgb(${value.join(",")})`;
}

function colorScale(field) {
  const green = "#159447";
  const neutral = "#59635d";
  const red = "#df2434";
  let minimum;
  let midpoint;
  let maximum;
  let suffix;

  if (field === "change") {
    maximum = Math.max(4, quantile(state.rows.map((row) => Math.abs(row.change)), 0.96));
    minimum = -maximum;
    midpoint = 0;
    suffix = "%";
  } else if (field === "premium") {
    minimum = 0;
    maximum = Math.max(80, quantile(state.rows.map((row) => row.premium), 0.94));
    midpoint = maximum / 2;
    suffix = "%";
  } else {
    minimum = 100;
    maximum = Math.max(180, quantile(state.rows.map((row) => row.price), 0.96));
    midpoint = (minimum + maximum) / 2;
    suffix = "";
  }

  const scale = (input) => {
    const value = Math.max(minimum, Math.min(maximum, Number(input)));
    if (value <= midpoint) {
      return interpolateColor(green, neutral, (value - minimum) / Math.max(0.0001, midpoint - minimum));
    }
    return interpolateColor(neutral, red, (value - midpoint) / Math.max(0.0001, maximum - midpoint));
  };

  return {
    scale,
    ticks: field === "change"
      ? [minimum, minimum / 2, 0, maximum / 2, maximum]
      : [minimum, midpoint, maximum],
    suffix,
  };
}

function terrainColor(height, tone, isThreeDimensional = false) {
  const base = isThreeDimensional ? "#111713" : "#090d0b";
  const target = tone > 0.08 ? "#8d3036" : tone < -0.08 ? "#176040" : "#7c745f";
  const toneWeight = 0.42 + Math.min(0.58, Math.abs(tone) * 0.58);
  const intensity = Math.max(0, Math.min(1, height)) * toneWeight;
  return interpolateColor(base, target, isThreeDimensional ? intensity * 0.88 : intensity * 0.72);
}

function landscapePointRadius(row, sizeKey, maximum) {
  const value = Math.log1p(Math.max(0, Number(row[sizeKey]) || 0));
  return 2.2 + Math.sqrt(Math.max(0, Math.min(1, value / Math.max(0.001, maximum)))) * 5.8;
}

function appendLandscapeGrid(width, height) {
  const defs = svgElement("defs");
  const pattern = svgElement("pattern", {
    id: "landscape-grid-pattern",
    width: 28,
    height: 28,
    patternUnits: "userSpaceOnUse",
  });
  pattern.append(svgElement("circle", {
    class: "landscape-grid-dot",
    cx: 1.3,
    cy: 1.3,
    r: 0.8,
  }));
  defs.append(pattern);
  nodes.svg.append(defs);
  nodes.svg.append(svgElement("rect", {
    x: 0,
    y: 0,
    width,
    height,
    fill: "url(#landscape-grid-pattern)",
    "pointer-events": "none",
  }));
}

function binaryLayout(items, x, y, width, height, valueKey) {
  if (items.length === 0) return [];
  if (items.length === 1) {
    return [{ ...items[0], x0: x, y0: y, x1: x + width, y1: y + height }];
  }

  const sorted = [...items].sort((left, right) => right[valueKey] - left[valueKey]);
  const total = sorted.reduce((sum, item) => sum + Math.max(item[valueKey], 0.003), 0);
  let accumulated = 0;
  let cut = 1;
  let bestDifference = Number.POSITIVE_INFINITY;
  for (let index = 1; index < sorted.length; index += 1) {
    accumulated += Math.max(sorted[index - 1][valueKey], 0.003);
    const difference = Math.abs(total / 2 - accumulated);
    if (difference < bestDifference) {
      bestDifference = difference;
      cut = index;
    }
  }

  const first = sorted.slice(0, cut);
  const second = sorted.slice(cut);
  const firstValue = first.reduce((sum, item) => sum + Math.max(item[valueKey], 0.003), 0);
  const ratio = firstValue / total;

  if (width >= height) {
    const firstWidth = width * ratio;
    return binaryLayout(first, x, y, firstWidth, height, valueKey).concat(
      binaryLayout(second, x + firstWidth, y, width - firstWidth, height, valueKey),
    );
  }

  const firstHeight = height * ratio;
  return binaryLayout(first, x, y, width, firstHeight, valueKey).concat(
    binaryLayout(second, x, y + firstHeight, width, height - firstHeight, valueKey),
  );
}

function filteredRows() {
  const query = nodes.search.value.trim().toLowerCase();
  const sector = nodes.sector.value;
  const tag = nodes.tag.value;
  const groupKey = nodes.group.value;
  return state.rows.filter((row) => {
    if (sector && groupValue(row, groupKey) !== sector) return false;
    if (tag && !(row.tags || []).includes(tag)) return false;
    if (!query) return true;
    return [row.name, row.code, row.stock, row.theme, ...row.topics, ...(row.tags || [])]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function tagGroup(row) {
  const tags = Array.isArray(row.tags) ? row.tags.filter(Boolean) : [];
  const primaryTag = String(row.primaryTag || "").trim();
  if (primaryTag && tags.includes(primaryTag)) return primaryTag;
  return tags.find((tag) => !ATTRIBUTE_TAGS.has(tag)) || tags[0] || "未标签";
}

function groupValue(row, groupKey = nodes.group.value) {
  if (groupKey === "tag") return tagGroup(row);
  return row[groupKey] || "未分类";
}

function recomputeLandscapePositions(groupKey = nodes.group.value) {
  state.landscapePositions = window.BondLandscape.computeEmbedding(state.rows, {
    groupFor: (row) => groupValue(row, groupKey),
  });
}

function updateTagOptions(payload) {
  const previous = nodes.tag.value;
  nodes.tag.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部标签";
  nodes.tag.append(all);
  if (Array.isArray(payload?.tagOrder)) state.tagOrder = payload.tagOrder.map(String);
  const tagOrder = [...new Set([
    ...state.tagOrder,
    ...state.rows.flatMap((row) => row.tags || []),
  ])];
  state.tagOrder = tagOrder;
  for (const tag of tagOrder) {
    const count = state.rows.filter((row) => (row.tags || []).includes(tag)).length;
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = `${tag}（${count}）`;
    nodes.tag.append(option);
  }
  if (tagOrder.includes(previous)) nodes.tag.value = previous;
}

function updateSectorOptions() {
  const groupKey = nodes.group.value;
  const previous = nodes.sector.value;
  const values = [...new Set(state.rows.map((row) => groupValue(row, groupKey)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
  nodes.sector.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部分组";
  nodes.sector.append(all);
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    nodes.sector.append(option);
  }
  if (values.includes(previous)) nodes.sector.value = previous;
}

function renderLegend(colors) {
  nodes.legend.replaceChildren();
  for (const value of colors.ticks) {
    const item = document.createElement("span");
    item.className = "legend-item";
    const swatch = document.createElement("i");
    swatch.className = "legend-swatch";
    swatch.style.background = colors.scale(value);
    const label = document.createElement("span");
    label.textContent = `${Math.round(value)}${colors.suffix}`;
    item.append(swatch, label);
    nodes.legend.append(item);
  }
  nodes.legend.style.gridTemplateColumns = `repeat(${colors.ticks.length}, 1fr)`;
}

function showTooltip(event, row) {
  nodes.tooltip.innerHTML = `
    <strong>${row.name} · ${row.code}</strong>
    <span>${row.stock}｜${row.industry1} / ${row.industry2}</span>
    <div class="tooltip-grid">
      <span>价格</span><span>${formatNumber(row.price, 3)}</span>
      <span>涨跌幅</span><span>${row.change > 0 ? "+" : ""}${formatNumber(row.change)}%</span>
      <span>正股涨跌</span><span>${row.stockChange !== null && row.stockChange !== undefined && Number.isFinite(Number(row.stockChange))
        ? `${row.stockChange > 0 ? "+" : ""}${formatNumber(row.stockChange)}%`
        : "尚未刷新"}</span>
      <span>成交额</span><span>${formatNumber(row.amount)}亿元</span>
      <span>转股溢价率</span><span>${formatNumber(row.premium)}%</span>
      <span>发行规模</span><span>${formatNumber(row.issue)}亿元</span>
      <span>信用评级</span><span>${row.rating}</span>
      <span>主线题材</span><span>${row.theme}</span>
      <span>标签</span><span>${(row.tags || []).join("、") || "未归类"}</span>
    </div>
  `;
  nodes.tooltip.hidden = false;
  const stageRect = nodes.stage.getBoundingClientRect();
  const left = Math.min(
    nodes.stage.clientWidth - nodes.tooltip.offsetWidth - 8,
    Math.max(8, event.clientX - stageRect.left + 12),
  );
  const top = Math.min(
    nodes.stage.clientHeight - nodes.tooltip.offsetHeight - 8,
    Math.max(8, event.clientY - stageRect.top + 12),
  );
  nodes.tooltip.style.left = `${left}px`;
  nodes.tooltip.style.top = `${top}px`;
}

function compactBondLabel(name, width, height) {
  if (width < 15 || height < 10) return null;
  const fullName = String(name || "");
  const compact = width >= 58
    ? fullName
    : fullName.replace(/转债$/, "").replace(/转(\d+)$/, "转$1");
  const characterBudget = Math.max(1, Math.floor((width - 3) / 4.8));
  const text = compact.slice(0, characterBudget);
  const fontSize = Math.max(
    4.5,
    Math.min(11, height - 2, (width - 3) / Math.max(1, text.length)),
  );
  return { text, fontSize, compact: text !== fullName };
}

function sparklinePath(points, width, height) {
  const values = points.map(Number).filter(Number.isFinite);
  if (values.length < 2) return "";
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || Math.max(1, Math.abs(maximum) * 0.01);
  const step = width / Math.max(1, values.length - 1);
  const padding = 1.5;
  return values
    .map((value, index) => {
      const x = index * step;
      const y = padding + (1 - (value - minimum) / range) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function renderPreviewSpark(row) {
  const box = document.createElement("span");
  box.className = "sector-preview-spark";
  const secid = secidFromCode(row.code);
  const hasResult = state.sparklines.has(secid);
  const spark = state.sparklines.get(secid);
  const points = Array.isArray(spark?.points) ? spark.points : [];
  if (points.length < 2) {
    if (!hasResult) {
      box.classList.add("is-loading");
      box.title = "正在读取今日分时";
    } else {
      box.textContent = "暂无分时";
      box.title = "行情源未返回今日分时";
    }
    return box;
  }
  const svg = svgElement("svg", {
    viewBox: "0 0 150 24",
    "aria-hidden": "true",
    preserveAspectRatio: "none",
  });
  const tone = row.change > 0 ? "is-up" : row.change < 0 ? "is-down" : "is-flat";
  const path = svgElement("path", {
    class: tone,
    d: sparklinePath(points, 150, 24),
  });
  svg.append(path);
  box.append(svg);
  box.title = spark?.time ? `${spark.source || "今日分时"} · ${spark.time}` : "今日分时";
  return box;
}

function renderSectorPreviewRows() {
  const fragment = document.createDocumentFragment();
  for (const row of state.previewRows) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "sector-preview-row";
    item.title = `打开 ${row.name} 分时详情`;

    const name = document.createElement("span");
    name.className = "sector-preview-name";
    name.textContent = row.name;
    const code = document.createElement("small");
    code.textContent = row.code.slice(0, 6);
    name.append(code);

    const price = document.createElement("span");
    price.className = "sector-preview-price";
    price.textContent = formatNumber(row.price, 3);

    const change = document.createElement("span");
    change.className =
      `sector-preview-change${row.change > 0 ? " is-up" : row.change < 0 ? " is-down" : ""}`;
    change.textContent = `${row.change > 0 ? "+" : ""}${formatNumber(row.change)}%`;

    item.append(name, renderPreviewSpark(row), price, change);
    item.addEventListener("click", () => {
      selectBond(row);
      openBond(row);
    });
    fragment.append(item);
  }
  nodes.sectorPreviewList.replaceChildren(fragment);
}

async function loadSectorSparklines(rows, token) {
  const missing = rows
    .map((row) => secidFromCode(row.code))
    .filter((secid) => secid && !state.sparklines.has(secid));
  for (const group of chunk(missing, 24)) {
    try {
      const payload = await fetchJson(`/api/sparks?secids=${group.join(",")}`, 20000);
      const returned = new Set();
      for (const spark of payload.sparks || []) {
        if (spark?.secid && Array.isArray(spark.points)) {
          state.sparklines.set(spark.secid, spark);
          returned.add(spark.secid);
        }
      }
      for (const secid of group) {
        if (!returned.has(secid)) state.sparklines.set(secid, { secid, points: [] });
      }
      if (token === state.previewToken && !nodes.sectorPreview.hidden) {
        renderSectorPreviewRows();
      }
    } catch (error) {
      console.warn("Sector preview sparkline request failed.", error);
    }
  }
}

function showSectorPreview(groupName, rows) {
  window.clearTimeout(state.previewHideTimer);
  const token = (state.previewToken += 1);
  state.previewRows = [...rows].sort((left, right) => right.amount - left.amount);
  nodes.sectorPreviewTitle.textContent = groupName;
  nodes.sectorPreviewMeta.textContent =
    `${rows.length}只 · 成交额 ${formatNumber(rows.reduce((sum, row) => sum + row.amount, 0))}亿元` +
    " · 点击列表进入分时";
  nodes.sectorPreview.hidden = false;
  renderSectorPreviewRows();
  void loadSectorSparklines(state.previewRows, token);
}

function hideSectorPreview() {
  window.clearTimeout(state.previewHideTimer);
  state.previewToken += 1;
  nodes.sectorPreview.hidden = true;
}

function scheduleSectorPreviewHide() {
  window.clearTimeout(state.previewHideTimer);
  state.previewHideTimer = window.setTimeout(hideSectorPreview, 260);
}

function bondDetailUrl(row, embedded = false) {
  const query = new URLSearchParams({
    code: row.code.slice(0, 6),
    name: row.name,
  });
  if (embedded) query.set("embedded", "1");
  return `./bond.html?${query}`;
}

function clearBondSelectionMarker() {
  nodes.svg.querySelectorAll(".bond-selection-marker").forEach((marker) => marker.remove());
}

function appendBondSelectionMarker(row) {
  clearBondSelectionMarker();
  const pointGroup = nodes.svg.querySelector(`[data-bond-code="${CSS.escape(row.code)}"]`);
  const pointNode = pointGroup?.querySelector(".bond-point");
  const radius = Number(pointNode?.getAttribute("r"));
  const transform = pointGroup?.getAttribute("transform");
  if (!pointGroup || !Number.isFinite(radius) || !transform) return;

  const marker = svgElement("g", {
    class: "bond-selection-marker",
    transform,
    "data-selected-code": row.code,
    "aria-hidden": "true",
  });
  marker.append(svgElement("circle", {
    class: "bond-selection-ring is-outer",
    r: (radius + 6.5).toFixed(2),
  }));
  marker.append(svgElement("circle", {
    class: "bond-selection-ring is-inner",
    r: (radius + 3.2).toFixed(2),
  }));
  nodes.svg.append(marker);
}

function selectBond(row) {
  state.selectedRow = row;
  nodes.selected.hidden = false;
  nodes.selectedName.textContent = `${row.name} · ${row.code}`;
  nodes.selectedMeta.textContent =
    `${row.stock}｜${row.industry1} / ${row.industry2}｜${(row.tags || []).join("、") || row.theme}`;
  nodes.selectedPrice.textContent = formatNumber(row.price, 3);
  nodes.selectedChange.textContent =
    `${row.change > 0 ? "+" : ""}${formatNumber(row.change)}%`;
  nodes.selectedChange.className =
    row.change > 0 ? "is-up" : row.change < 0 ? "is-down" : "";
  nodes.svg.querySelectorAll(".bond-tile.is-selected").forEach((tile) => {
    tile.classList.remove("is-selected");
  });
  nodes.svg.querySelectorAll(".attention-label.is-selected").forEach((label) => {
    label.classList.remove("is-selected");
    label.setAttribute("aria-pressed", "false");
  });
  nodes.svg
    .querySelector(`[data-bond-code="${CSS.escape(row.code)}"] .bond-tile`)
    ?.classList.add("is-selected");
  const attentionLabel = nodes.svg.querySelector(
    `[data-attention-code="${CSS.escape(row.code)}"]`,
  );
  attentionLabel?.classList.add("is-selected");
  attentionLabel?.setAttribute("aria-pressed", "true");
  appendBondSelectionMarker(row);
}

function clearSelectedBond() {
  state.selectedRow = null;
  nodes.selected.hidden = true;
  nodes.svg.querySelectorAll(".bond-tile.is-selected").forEach((tile) => {
    tile.classList.remove("is-selected");
  });
  nodes.svg.querySelectorAll(".attention-label.is-selected").forEach((label) => {
    label.classList.remove("is-selected");
    label.setAttribute("aria-pressed", "false");
  });
  clearBondSelectionMarker();
}

function openBond(row, updateHistory = true) {
  if (!row) return;
  nodes.detailFrame.src = bondDetailUrl(row, true);
  nodes.detailOverlay.hidden = false;
  document.body.classList.add("has-detail-overlay");
  if (updateHistory) {
    const url = new URL(window.location.href);
    url.searchParams.set("bond", row.code.slice(0, 6));
    url.searchParams.set("name", row.name);
    window.history.pushState({ bondHeatmapOverlay: true }, "", url);
  }
}

function hideBondDetail() {
  nodes.detailOverlay.hidden = true;
  nodes.detailFrame.removeAttribute("src");
  document.body.classList.remove("has-detail-overlay");
}

function clearBondDetailUrl() {
  const url = new URL(window.location.href);
  const hasBondDetail = url.searchParams.has("bond") || url.searchParams.has("name");
  if (!hasBondDetail) return;
  url.searchParams.delete("bond");
  url.searchParams.delete("name");
  const currentState = window.history.state && typeof window.history.state === "object"
    ? { ...window.history.state }
    : null;
  if (currentState) delete currentState.bondHeatmapOverlay;
  const nextState = currentState && Object.keys(currentState).length > 0 ? currentState : null;
  window.history.replaceState(nextState, "", url);
}

function closeBondDetail() {
  hideBondDetail();
  clearBondDetailUrl();
}

function appendTerrain2D(terrain, width, height) {
  const cellWidth = width / Math.max(1, terrain.columns - 1);
  const cellHeight = height / Math.max(1, terrain.rows - 1);
  const cells = svgElement("g", { "aria-hidden": "true" });
  for (let gy = 0; gy < terrain.rows; gy += 1) {
    for (let gx = 0; gx < terrain.columns; gx += 1) {
      const index = gy * terrain.columns + gx;
      const elevation = terrain.values[index];
      if (elevation < 0.015) continue;
      cells.append(svgElement("rect", {
        class: "terrain-cell",
        x: gx * cellWidth - cellWidth * 0.54,
        y: gy * cellHeight - cellHeight * 0.54,
        width: cellWidth * 1.08,
        height: cellHeight * 1.08,
        fill: terrainColor(elevation, terrain.tones[index]),
        opacity: 0.24 + elevation * 0.7,
      }));
    }
  }
  nodes.svg.append(cells);

  const contours = BondLandscape.marchingSquares(
    terrain,
    [0.1, 0.18, 0.27, 0.37, 0.48, 0.6, 0.72, 0.84],
    width,
    height,
  );
  for (const contour of contours) {
    if (contour.segments.length === 0) continue;
    const path = contour.segments.map(([from, to]) =>
      `M${from.x.toFixed(2)} ${from.y.toFixed(2)}L${to.x.toFixed(2)} ${to.y.toFixed(2)}`,
    ).join("");
    nodes.svg.append(svgElement("path", {
      class: "terrain-contour",
      d: path,
      opacity: 0.32 + contour.threshold * 0.7,
    }));
  }
}

function terrainGridPoint(terrain, gx, gy, width, height, elevationOffset = 0) {
  const index = gy * terrain.columns + gx;
  return BondLandscape.project3D(
    gx / Math.max(1, terrain.columns - 1),
    gy / Math.max(1, terrain.rows - 1),
    Math.max(0, terrain.values[index] + elevationOffset),
    width,
    height,
    state.camera,
  );
}

function appendTerrain3D(terrain, width, height) {
  const faces = svgElement("g", { "aria-hidden": "true" });
  const orderedFaces = [];
  for (let gy = 0; gy < terrain.rows - 1; gy += 1) {
    for (let gx = 0; gx < terrain.columns - 1; gx += 1) {
      const indices = [
        gy * terrain.columns + gx,
        gy * terrain.columns + gx + 1,
        (gy + 1) * terrain.columns + gx + 1,
        (gy + 1) * terrain.columns + gx,
      ];
      const elevation = indices.reduce((sum, index) => sum + terrain.values[index], 0) / 4;
      if (elevation < 0.012) continue;
      const tone = indices.reduce((sum, index) => sum + terrain.tones[index], 0) / 4;
      const points = [
        terrainGridPoint(terrain, gx, gy, width, height),
        terrainGridPoint(terrain, gx + 1, gy, width, height),
        terrainGridPoint(terrain, gx + 1, gy + 1, width, height),
        terrainGridPoint(terrain, gx, gy + 1, width, height),
      ];
      const face = svgElement("path", {
        class: "terrain-face",
        d: `M${points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join("L")}Z`,
        fill: terrainColor(elevation, tone, true),
        opacity: 0.58 + elevation * 0.38,
      });
      orderedFaces.push({
        depth: points.reduce((sum, point) => sum + point.depth, 0) / points.length,
        face,
      });
    }
  }
  orderedFaces.sort((left, right) => left.depth - right.depth);
  for (const item of orderedFaces) faces.append(item.face);
  nodes.svg.append(faces);

  const mesh = svgElement("g", { "aria-hidden": "true" });
  const rowStep = Math.max(2, Math.round(terrain.rows / 13));
  const columnStep = Math.max(2, Math.round(terrain.columns / 17));
  for (let gy = 0; gy < terrain.rows; gy += rowStep) {
    const points = [];
    for (let gx = 0; gx < terrain.columns; gx += 1) {
      const point = terrainGridPoint(terrain, gx, gy, width, height, 0.004);
      points.push(`${gx ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
    }
    mesh.append(svgElement("path", { class: "terrain-mesh", d: points.join("") }));
  }
  for (let gx = 0; gx < terrain.columns; gx += columnStep) {
    const points = [];
    for (let gy = 0; gy < terrain.rows; gy += 1) {
      const point = terrainGridPoint(terrain, gx, gy, width, height, 0.004);
      points.push(`${gy ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
    }
    mesh.append(svgElement("path", { class: "terrain-mesh", d: points.join("") }));
  }
  nodes.svg.append(mesh);
}

function appendLandscapeLabels(terrain, width, height, isThreeDimensional) {
  const buckets = new Map();
  for (const point of terrain.points) {
    if (!buckets.has(point.group)) buckets.set(point.group, []);
    buckets.get(point.group).push(point);
  }
  const candidates = [...buckets].map(([name, points]) => {
    const weightTotal = points.reduce((sum, point) => sum + 0.3 + point.activity, 0) || 1;
    const x = points.reduce((sum, point) => sum + point.x * (0.3 + point.activity), 0) / weightTotal;
    const y = points.reduce((sum, point) => sum + point.y * (0.3 + point.activity), 0) / weightTotal;
    const amount = points.reduce((sum, point) => sum + Math.max(0, Number(point.row.amount) || 0), 0);
    const z = BondLandscape.sampleGrid(terrain.values, terrain.columns, terrain.rows, x, y);
    return { name, points, x, y, z, amount, stat: terrain.groupStats.get(name) };
  }).sort((left, right) => right.amount - left.amount || right.points.length - left.points.length)
    .slice(0, isThreeDimensional ? (width < 760 ? 6 : 10) : (width < 760 ? 9 : 15));

  const placed = [];
  const occupied = [];
  for (const candidate of candidates) {
    const projected = isThreeDimensional
      ? BondLandscape.project3D(
        candidate.x,
        candidate.y,
        Math.min(1.05, candidate.z + 0.045),
        width,
        height,
        state.camera,
      )
      : { x: candidate.x * width, y: candidate.y * height };
    let labelY = projected.y;
    const collisionWidth = isThreeDimensional ? 108 : 86;
    const collisionHeight = isThreeDimensional ? 27 : 22;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const collides = placed.some((item) =>
        Math.abs(item.x - projected.x) < collisionWidth && Math.abs(item.y - labelY) < collisionHeight,
      );
      if (!collides) break;
      labelY += attempt % 2 === 0 ? -22 : 36;
    }
    labelY = Math.max(18, Math.min(height - 28, labelY));
    placed.push({ x: projected.x, y: labelY });
    occupied.push({
      left: projected.x - 8,
      right: projected.x + Math.min(138, 20 + candidate.name.length * 12),
      top: labelY - 13,
      bottom: labelY + (isThreeDimensional ? 8 : 18),
    });

    const label = svgElement("g", {
      class: "landscape-label",
      transform: `translate(${projected.x.toFixed(2)},${labelY.toFixed(2)})`,
      role: "button",
      tabindex: "0",
      "aria-label": `查看${candidate.name}转债列表`,
    });
    if (isThreeDimensional) {
      label.append(svgElement("path", { d: "M0 -5L5 4L-5 4Z" }));
    } else {
      label.append(svgElement("circle", { r: 3.6 }));
    }
    const name = svgElement("text", { x: 8, y: -2 });
    name.textContent = candidate.name;
    const meta = svgElement("text", { class: "landscape-label-meta", x: 8, y: 10 });
    const medianChange = Number(candidate.stat?.medianChange);
    meta.textContent = `${candidate.points.length}只${Number.isFinite(medianChange)
      ? ` · 正股中位${medianChange > 0 ? "+" : ""}${formatNumber(medianChange)}%`
      : ""}`;
    label.append(name);
    if (!isThreeDimensional) label.append(meta);
    label.addEventListener("pointerenter", () =>
      showSectorPreview(candidate.name, candidate.points.map((point) => point.row)),
    );
    label.addEventListener("pointerleave", scheduleSectorPreviewHide);
    label.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showSectorPreview(candidate.name, candidate.points.map((point) => point.row));
      }
    });
    nodes.svg.append(label);
  }
  return occupied;
}

function appendLandscapePoints(terrain, width, height, sizeKey, colors, colorKey, isThreeDimensional) {
  const maximum = quantile(
    terrain.points.map((point) => Math.log1p(Math.max(0, Number(point.row[sizeKey]) || 0))),
    0.96,
  ) || 1;
  const projectedPoints = terrain.points.map((point) => ({
    point,
    projected: isThreeDimensional
      ? BondLandscape.project3D(
        point.x,
        point.y,
        Math.min(1.05, point.z + 0.027),
        width,
        height,
        state.camera,
      )
      : { x: point.x * width, y: point.y * height, depth: point.y },
  })).sort((left, right) => left.projected.depth - right.projected.depth);
  for (const item of projectedPoints) {
    const point = item.point;
    const row = point.row;
    const projected = item.projected;
    const group = svgElement("g", {
      role: "link",
      tabindex: "0",
      "data-bond-code": row.code,
      transform: `translate(${projected.x.toFixed(2)},${projected.y.toFixed(2)})`,
      "aria-label": `${row.name}，涨跌幅${row.change}%`,
    });
    const pointNode = svgElement("circle", {
      class: "bond-point bond-tile",
      r: landscapePointRadius(row, sizeKey, maximum).toFixed(2),
      fill: colors.scale(row[colorKey]),
      opacity: 0.94,
    });
    group.append(pointNode);
    group.addEventListener("pointermove", (event) => showTooltip(event, row));
    group.addEventListener("pointerleave", () => {
      nodes.tooltip.hidden = true;
    });
    group.addEventListener("click", () => selectBond(row));
    group.addEventListener("dblclick", () => openBond(row));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectBond(row);
      }
    });
    nodes.svg.append(group);
  }
}

function boxesOverlap(left, right, padding = 4) {
  return !(
    left.right + padding < right.left ||
    left.left - padding > right.right ||
    left.bottom + padding < right.top ||
    left.top - padding > right.bottom
  );
}

function appendAttentionLabels(terrain, width, height, isThreeDimensional, occupied, bounds) {
  const threshold = Number(nodes.attention.value);
  const maximumLabels = width < 760 ? 8 : width < 1120 ? 14 : 20;
  const candidates = BondLandscape.selectAttentionPoints(terrain.points, threshold, maximumLabels * 2);
  if (candidates.length === 0) return;

  const layer = svgElement("g", { class: "attention-labels" });
  const offsets = [
    { side: 1, top: -24 },
    { side: 1, top: 7 },
    { side: -1, top: -24 },
    { side: -1, top: 7 },
    { side: 1, top: -43 },
    { side: -1, top: -43 },
    { side: 1, top: -62 },
    { side: -1, top: -62 },
    { side: 1, top: 26 },
    { side: -1, top: 26 },
  ];
  let rendered = 0;

  for (const point of candidates) {
    if (rendered >= maximumLabels) break;
    const row = point.row;
    const change = Number(row.change);
    const changeText = `${change > 0 ? "+" : ""}${formatNumber(change)}%`;
    const labelWidth = Math.min(124, 16 + String(row.name).length * 11 + changeText.length * 6.2);
    const projected = isThreeDimensional
      ? BondLandscape.project3D(
        point.x,
        point.y,
        Math.min(1.05, point.z + 0.032),
        width,
        height,
        state.camera,
      )
      : { x: point.x * width, y: point.y * height };
    let placement = null;

    for (const offset of offsets) {
      const left = offset.side > 0 ? projected.x + 9 : projected.x - labelWidth - 9;
      const top = projected.y + offset.top;
      const box = { left, right: left + labelWidth, top, bottom: top + 18 };
      const inside = box.left >= bounds.left + 4
        && box.right <= bounds.right - 4
        && box.top >= bounds.top + 4
        && box.bottom <= bounds.bottom - 4;
      if (inside && !occupied.some((item) => boxesOverlap(box, item))) {
        placement = { ...box, side: offset.side };
        break;
      }
    }
    if (!placement) continue;

    occupied.push(placement);
    rendered += 1;
    const connectorX = placement.side > 0 ? placement.left : placement.right;
    const connectorY = placement.top + 9;
    const group = svgElement("g", {
      class: "attention-label",
      "data-attention-code": row.code,
      role: "button",
      tabindex: "0",
      "aria-label": `选中${row.name}，涨跌幅${changeText}`,
      "aria-pressed": "false",
    });
    group.append(svgElement("line", {
      x1: projected.x.toFixed(2),
      y1: projected.y.toFixed(2),
      x2: connectorX.toFixed(2),
      y2: connectorY.toFixed(2),
    }));
    group.append(svgElement("rect", {
      x: placement.left.toFixed(2),
      y: placement.top.toFixed(2),
      width: labelWidth.toFixed(2),
      height: 18,
      rx: 3,
    }));
    const text = svgElement("text", {
      x: (placement.left + 5).toFixed(2),
      y: (placement.top + 12.5).toFixed(2),
    });
    const name = svgElement("tspan", { class: "attention-name" });
    name.textContent = row.name;
    const value = svgElement("tspan", {
      class: `attention-change ${change > 0 ? "is-up" : change < 0 ? "is-down" : "is-flat"}`,
      dx: 5,
    });
    value.textContent = changeText;
    text.append(name, value);
    group.append(text);
    group.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    group.addEventListener("pointermove", (event) => showTooltip(event, row));
    group.addEventListener("pointerleave", () => {
      nodes.tooltip.hidden = true;
    });
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      selectBond(row);
    });
    group.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openBond(row);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectBond(row);
      }
    });
    layer.append(group);
  }
  nodes.svg.append(layer);
}

function landscapeViewBox(width, height, isThreeDimensional) {
  if (isThreeDimensional) return { left: 0, top: 0, right: width, bottom: height, width, height };
  const viewWidth = width / state.camera.zoom;
  const viewHeight = height / state.camera.zoom;
  const maxPanX = Math.max(0, (width - viewWidth) / (2 * width));
  const maxPanY = Math.max(0, (height - viewHeight) / (2 * height));
  const panX = clamp(state.camera.panX, -maxPanX, maxPanX);
  const panY = clamp(state.camera.panY, -maxPanY, maxPanY);
  const left = (width - viewWidth) / 2 - panX * width;
  const top = (height - viewHeight) / 2 - panY * height;
  return {
    left,
    top,
    right: left + viewWidth,
    bottom: top + viewHeight,
    width: viewWidth,
    height: viewHeight,
  };
}

function renderLandscape(rows, width, height, sizeKey, colorKey, colors) {
  const isThreeDimensional = nodes.view.value === "terrain3d";
  const columns = isThreeDimensional
    ? Math.max(38, Math.min(52, Math.round(width / 25)))
    : Math.max(52, Math.min(76, Math.round(width / 18)));
  const gridRows = Math.max(28, Math.round(columns * height / Math.max(width, 1)));
  const terrain = BondLandscape.buildTerrain(rows, state.landscapePositions, {
    columns,
    rows: gridRows,
    sigma: isThreeDimensional ? 0.071 : 0.064,
    groupFor: (row) => groupValue(row, nodes.group.value),
    heightMode: nodes.height.value,
    sizeField: sizeKey,
  });

  const viewBox = landscapeViewBox(width, height, isThreeDimensional);
  nodes.svg.setAttribute("viewBox", `${viewBox.left} ${viewBox.top} ${viewBox.width} ${viewBox.height}`);
  nodes.svg.replaceChildren();
  nodes.svg.append(svgElement("rect", {
    class: "landscape-background",
    x: 0,
    y: 0,
    width,
    height,
  }));
  appendLandscapeGrid(width, height);
  if (isThreeDimensional) appendTerrain3D(terrain, width, height);
  else appendTerrain2D(terrain, width, height);
  const occupied = appendLandscapeLabels(terrain, width, height, isThreeDimensional);
  appendLandscapePoints(terrain, width, height, sizeKey, colors, colorKey, isThreeDimensional);
  appendAttentionLabels(terrain, width, height, isThreeDimensional, occupied, viewBox);

  const caption = svgElement("text", {
    class: "landscape-caption",
    x: viewBox.left + 12,
    y: viewBox.bottom - 13,
  });
  caption.textContent = isThreeDimensional
    ? `同一向量坐标 · 短拖旋转 · 长按拖拽平移 · 滚轮缩放 ${Math.round(state.camera.zoom * 100)}%`
    : `向量距离表示相似性 · 拖拽平移 · 滑杆/滚轮缩放 ${Math.round(state.camera.zoom * 100)}%`;
  nodes.svg.append(caption);
}

function updateDataNote() {
  if (!state.snapshot) return;
  if (nodes.view.value === "treemap") {
    nodes.note.textContent =
      `基础快照：${state.snapshot.asOf}，并合并自动记录的新债 ${state.supplementalBondCount} 只。` +
      "旧债行业、题材、转股溢价率来自该快照；" +
      "价格、涨跌幅和成交额可用 QMT 刷新。点击矩形进入单债分时详情。";
    return;
  }
  const strengthNote = state.stockQuoteCoverage > 0
    ? `正股相对强度已覆盖 ${state.stockQuoteCoverage} 只映射标的`
    : "正股行情尚未刷新，山高暂以转债涨跌代理";
  const terrainNote = nodes.height.value === "groupPeak"
    ? "当前为分组独立强度峰：每个分组只生成一个峰，不受组内数量影响"
    : nodes.height.value === "groupStrength"
      ? "当前为强度加权相似密度：组内相似标的会共同形成山体"
      : "当前山体按所选高度指标生成";
  nodes.note.textContent =
    `位置先按当前“${nodes.group.selectedOptions[0]?.textContent || "分组"}”聚类，组内再由行业、题材和转债特征向量排布；已合并自动记录的新债 ${state.supplementalBondCount} 只；${strengthNote}。` +
    `${terrainNote}；异动名称可直接点击选中对应转债。` +
    "山高是同期强弱的可视化，不是预测信号。";
}

function render() {
  if (state.rows.length === 0) return;
  const rows = filteredRows();
  const width = Math.max(320, nodes.stage.clientWidth);
  const height = Math.max(520, nodes.stage.clientHeight);
  const groupKey = nodes.group.value;
  const sizeKey = nodes.size.value;
  const colorKey = nodes.color.value;
  const colors = colorScale(colorKey);
  const landscapeMode = nodes.view.value !== "treemap";

  nodes.stage.classList.toggle("is-landscape", landscapeMode);
  nodes.stage.classList.toggle("is-3d", nodes.view.value === "terrain3d");
  nodes.heightControl.hidden = !landscapeMode;
  nodes.zoomControl.hidden = !landscapeMode;
  nodes.cameraControls.hidden = nodes.view.value !== "terrain3d";
  nodes.attentionControl.hidden = !landscapeMode;
  nodes.sizeLabel.textContent = landscapeMode ? "点大小代表" : "面积代表";
  nodes.empty.hidden = rows.length > 0;
  nodes.empty.textContent = "没有匹配的转债";
  nodes.bondCount.textContent = String(rows.length);
  nodes.totalAmount.textContent = `${formatNumber(rows.reduce((sum, row) => sum + row.amount, 0))}亿`;
  nodes.upCount.textContent = String(rows.filter((row) => row.change > 0).length);
  nodes.downCount.textContent = String(rows.filter((row) => row.change < 0).length);
  renderLegend(colors);
  updateDataNote();

  if (landscapeMode) {
    renderLandscape(rows, width, height, sizeKey, colorKey, colors);
    if (state.selectedRow && rows.some((row) => row.code === state.selectedRow.code)) {
      selectBond(state.selectedRow);
    } else if (state.selectedRow) {
      clearSelectedBond();
    }
    return;
  }

  const groups = new Map();

  for (const row of rows) {
    const group = groupValue(row, groupKey);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
  }

  const groupRows = [...groups].map(([name, children]) => ({
    name,
    children,
    [sizeKey]: children.reduce((sum, row) => sum + Math.max(row[sizeKey], 0.003), 0),
  }));
  const groupRects = binaryLayout(groupRows, 2, 2, width - 4, height - 4, sizeKey);

  nodes.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  nodes.svg.replaceChildren();

  for (const group of groupRects) {
    const groupWidth = group.x1 - group.x0;
    const groupHeight = group.y1 - group.y0;
    const outline = svgElement("rect", {
      class: "group-outline",
      x: group.x0,
      y: group.y0,
      width: Math.max(0, groupWidth),
      height: Math.max(0, groupHeight),
    });
    nodes.svg.append(outline);

    if (groupWidth > 34 && groupHeight > 24) {
      const label = svgElement("text", {
        class: "group-label",
        x: group.x0 + 5,
        y: group.y0 + 14,
        "font-size": Math.max(10, Math.min(13, (groupWidth - 10) / Math.max(4, group.name.length))),
      });
      label.textContent = group.name;
      nodes.svg.append(label);
    }
    if (groupWidth > 28 && groupHeight > 22) {
      const hitbox = svgElement("rect", {
        class: "group-hitbox",
        x: group.x0,
        y: group.y0,
        width: Math.max(0, groupWidth),
        height: Math.min(19, groupHeight),
        "aria-label": `查看${group.name}转债列表`,
      });
      hitbox.addEventListener("pointerenter", () => showSectorPreview(group.name, group.children));
      hitbox.addEventListener("pointerleave", scheduleSectorPreviewHide);
      nodes.svg.append(hitbox);
    }

    const leaves = binaryLayout(
      group.children,
      group.x0 + 1,
      group.y0 + 19,
      Math.max(0, groupWidth - 2),
      Math.max(0, groupHeight - 20),
      sizeKey,
    );
    for (const row of leaves) {
      const tileWidth = row.x1 - row.x0;
      const tileHeight = row.y1 - row.y0;
      const tileGroup = svgElement("g", {
        role: "link",
        tabindex: "0",
        "data-bond-code": row.code,
        transform: `translate(${row.x0},${row.y0})`,
        "aria-label": `${row.name}，涨跌幅${row.change}%`,
      });
      const tile = svgElement("rect", {
        class: "bond-tile",
        width: Math.max(0, tileWidth - 1),
        height: Math.max(0, tileHeight - 1),
        fill: colors.scale(row[colorKey]),
      });
      tileGroup.append(tile);

      const fittedLabel = compactBondLabel(row.name, tileWidth, tileHeight);
      if (fittedLabel) {
        const hasValue = tileWidth >= 34 && tileHeight >= 29;
        const name = svgElement("text", {
          class: `bond-name${fittedLabel.compact ? " is-compact" : ""}`,
          x: tileWidth / 2,
          y: hasValue ? tileHeight / 2 - 1 : tileHeight / 2 + fittedLabel.fontSize * 0.34,
          "font-size": fittedLabel.fontSize,
        });
        name.textContent = fittedLabel.text;
        tileGroup.append(name);
        if (hasValue) {
          const value = svgElement("text", {
            class: "bond-value",
            x: tileWidth / 2,
            y: tileHeight / 2 + Math.max(7, fittedLabel.fontSize - 1),
            "font-size": Math.max(6, fittedLabel.fontSize - 2),
          });
          value.textContent = `${formatNumber(row[colorKey])}${colors.suffix}`;
          tileGroup.append(value);
        }
      }

      tileGroup.addEventListener("pointermove", (event) => showTooltip(event, row));
      tileGroup.addEventListener("pointerleave", () => {
        nodes.tooltip.hidden = true;
      });
      tileGroup.addEventListener("click", () => selectBond(row));
      tileGroup.addEventListener("dblclick", () => openBond(row));
      tileGroup.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectBond(row);
        }
      });
      nodes.svg.append(tileGroup);
    }
  }
  if (state.selectedRow && rows.some((row) => row.code === state.selectedRow.code)) {
    selectBond(state.selectedRow);
  } else if (state.selectedRow) {
    clearSelectedBond();
  }
}

async function refreshMiniQmtQuotes() {
  if (state.refreshing || state.rows.length === 0) return;
  state.refreshing = true;
  nodes.refresh.disabled = true;
  setMarketStatus("正在读取 QMT 全市场转债与正股行情…");
  const quoteBySecid = new Map();
  let failedBatches = 0;

  try {
    const codes = [...new Set(state.rows.flatMap((row) => [
      marketCode(row.code),
      marketCode(row.stockCode),
    ]).filter(Boolean))];
    for (const group of chunk(codes, QUOTE_BATCH_SIZE)) {
      try {
        const query = new URLSearchParams({ codes: group.join(",") });
        const payload = await fetchJson(`/api/miniqmt/quotes?${query}`, 12000);
        for (const quote of payload.quotes || []) {
          if (quote.secid) quoteBySecid.set(quote.secid, quote);
        }
      } catch (error) {
        failedBatches += 1;
        console.warn("QMT heatmap quote batch failed.", error);
        if (/HTTP 5\d\d|timed out|timeout|aborted|fetch failed|超时|连接暂时不可用/i.test(String(error?.message || error))) {
          break;
        }
      }
    }

    let updatedBonds = 0;
    const updatedStockCodes = new Set();
    for (const row of state.rows) {
      const bondQuote = quoteBySecid.get(secidFromCode(row.code));
      if (bondQuote) {
        const price = Number(bondQuote.price);
        const change = Number(bondQuote.change);
        const amount = Number(bondQuote.amount);
        if (Number.isFinite(price) && price > 0) row.price = price;
        if (Number.isFinite(change)) row.change = change;
        if (Number.isFinite(amount) && amount >= 0) row.amount = amount / 1e8;
        updatedBonds += 1;
      }
      const stockQuote = quoteBySecid.get(secidFromCode(row.stockCode));
      const stockChange = Number(stockQuote?.change);
      if (stockQuote) {
        const stockPrice = Number(stockQuote.price);
        if (Number.isFinite(stockPrice) && stockPrice > 0) row.stockPrice = stockPrice;
        if (Number.isFinite(stockChange)) {
          row.stockChange = stockChange;
          updatedStockCodes.add(row.stockCode);
        }
      }
      const conversionPrice = Number(row.conversionPrice);
      const stockPrice = Number(row.stockPrice);
      if (
        Number.isFinite(conversionPrice)
        && conversionPrice > 0
        && Number.isFinite(stockPrice)
        && stockPrice > 0
      ) {
        row.conversionValue = stockPrice / conversionPrice * 100;
        if (Number.isFinite(Number(row.price)) && row.price > 0 && row.conversionValue > 0) {
          row.premium = (row.price / row.conversionValue - 1) * 100;
        }
      }
    }
    state.stockQuoteCoverage = updatedStockCodes.size;
    render();
    const stockCodes = [...new Set(state.rows.map((row) => marketCode(row.stockCode)).filter(Boolean))];
    if (updatedBonds > 0) {
      setMarketStatus(
        `QMT 已更新 转债${updatedBonds}/${state.rows.length} · 正股${updatedStockCodes.size}/${stockCodes.length}` +
        (failedBatches ? ` · ${failedBatches} 组读取失败` : ""));
    } else {
      setMarketStatus(`QMT 暂无返回，显示 ${state.snapshot.asOf} 快照`);
    }
  } finally {
    state.refreshing = false;
    nodes.refresh.disabled = false;
    if (state.quoteRefreshPending) {
      state.quoteRefreshPending = false;
      void refreshMiniQmtQuotes();
    }
  }
}

function supplementalRowsFromUniverse(bonds, existingCodes, tagByCode = new Map()) {
  return (Array.isArray(bonds) ? bonds : [])
    .filter((bond) => {
      const code = String(bond?.code || "").toUpperCase();
      return tagByCode.has(code) && !existingCodes.has(code);
    })
    .map((bond) => {
      const code = String(bond.code || "").toUpperCase();
      const tagInfo = tagByCode.get(code) || {};
      const isLifecycleSupplement = Boolean(tagInfo.lifecycleSupplemental);
      const tags = [...new Set(
        (Array.isArray(tagInfo.tags) && tagInfo.tags.length
          ? tagInfo.tags
          : isLifecycleSupplement
            ? []
            : ["次新债"])
          .map(String)
          .filter(Boolean),
      )];
      const requestedPrimary = String(tagInfo.primaryTag || "");
      const primaryTag = tags.includes(requestedPrimary) ? requestedPrimary : "";
      const topicTags = tags.filter((tag) => !ATTRIBUTE_TAGS.has(tag));
      const theme = primaryTag || topicTags[0] || (isLifecycleSupplement ? "待分类" : "次新债");
      const systemTopics = isLifecycleSupplement ? [] : ["次新债", "新上市转债"];
      return {
        code,
        name: String(tagInfo.name || bond.name || bond.code || "新上市转债"),
        stock: String(tagInfo.stockName || bond.stockName || "待补正股"),
        stockCode: String(tagInfo.stockCode || bond.stockCode || "").toUpperCase(),
        industry1: String(tagInfo.industry1 || "新上市转债"),
        industry2: String(tagInfo.industry2 || "待分类"),
        industry3: String(tagInfo.industry3 || "待分类"),
        theme,
        topics: [...new Set([...topicTags, ...systemTopics])],
        tags,
        primaryTag,
        listedDate: String(tagInfo.listedDate || bond.listingDate || ""),
        price: 100,
        change: 0,
        amount: 0,
        premium: 0,
        issue: Number(bond.issueScaleBillion) || 0,
        rating: String(bond.rating || "待补"),
        stockChange: null,
        supplemental: true,
        lifecycleSupplemental: isLifecycleSupplement,
        dataQuality: isLifecycleSupplement
          ? "QMT 当前存续债池兜底补充；行业资料待补"
          : "新债自动记录；行业资料待补",
      };
    });
}

function normalizeSupplementalMetadata(metadata) {
  const issueFaceValue = Number(metadata?.issueFaceValue ?? metadata?.issue_face_value);
  return {
    name: String(metadata?.name || ""),
    stockCode: marketCode(metadata?.stockCode || metadata?.stock_code),
    stockName: String(metadata?.stockName || metadata?.stock_name || ""),
    conversionPrice: Number(metadata?.conversionPrice ?? metadata?.conversion_price),
    conversionValue: Number(metadata?.conversionValue ?? metadata?.conversion_value),
    premium: Number(metadata?.premium ?? metadata?.premium_rate),
    issue: Number.isFinite(issueFaceValue) && issueFaceValue > 0
      ? issueFaceValue / 1e8
      : Number(metadata?.issue),
    bondPrice: Number(metadata?.bondPrice ?? metadata?.bond_price),
    stockPrice: Number(metadata?.stockPrice ?? metadata?.stock_price),
    stockChange: Number(metadata?.stockChange ?? metadata?.stock_change),
  };
}

function applySupplementalMetadata(row, metadata) {
  const normalized = normalizeSupplementalMetadata(metadata);
  if (normalized.name) row.name = normalized.name;
  if (normalized.stockName) row.stock = normalized.stockName;
  if (normalized.stockCode) row.stockCode = normalized.stockCode;
  if (Number.isFinite(normalized.conversionPrice) && normalized.conversionPrice > 0) {
    row.conversionPrice = normalized.conversionPrice;
  }
  if (Number.isFinite(normalized.issue) && normalized.issue > 0) row.issue = normalized.issue;
  if (Number.isFinite(normalized.bondPrice) && normalized.bondPrice > 0) row.price = normalized.bondPrice;
  if (Number.isFinite(normalized.stockPrice) && normalized.stockPrice > 0) {
    row.stockPrice = normalized.stockPrice;
  }
  if (Number.isFinite(normalized.stockChange)) row.stockChange = normalized.stockChange;

  const conversionPrice = Number(row.conversionPrice);
  const stockPrice = Number(row.stockPrice);
  if (
    Number.isFinite(conversionPrice)
    && conversionPrice > 0
    && Number.isFinite(stockPrice)
    && stockPrice > 0
  ) {
    row.conversionValue = stockPrice / conversionPrice * 100;
    if (Number.isFinite(Number(row.price)) && row.price > 0 && row.conversionValue > 0) {
      row.premium = (row.price / row.conversionValue - 1) * 100;
    }
  } else {
    if (Number.isFinite(normalized.conversionValue) && normalized.conversionValue > 0) {
      row.conversionValue = normalized.conversionValue;
    }
    if (Number.isFinite(normalized.premium)) row.premium = normalized.premium;
  }
  row.dataQuality = "自动新债池资料；行情由 QMT 单独刷新";
}

function readSupplementalMetadataCache() {
  try {
    const payload = JSON.parse(window.localStorage.getItem(SUPPLEMENTAL_METADATA_CACHE_KEY) || "null");
    return payload?.rows && typeof payload.rows === "object" ? payload.rows : {};
  } catch (_error) {
    return {};
  }
}

function writeSupplementalMetadataCache(rows) {
  try {
    window.localStorage.setItem(
      SUPPLEMENTAL_METADATA_CACHE_KEY,
      JSON.stringify({ version: 1, rows }),
    );
  } catch (_error) {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

function applyCachedSupplementalMetadata(rows) {
  const cache = readSupplementalMetadataCache();
  const now = Date.now();
  for (const row of rows) {
    const entry = cache[row.code];
    if (!entry?.metadata || now - Number(entry.updatedAt || 0) >= SUPPLEMENTAL_METADATA_CACHE_TTL_MS) {
      continue;
    }
    applySupplementalMetadata(row, entry.metadata);
  }
  return cache;
}

async function refreshSupplementalMetadata(rows) {
  const cache = applyCachedSupplementalMetadata(rows);
  const now = Date.now();
  const targets = rows.filter((row) => {
    const entry = cache[row.code];
    return !entry?.metadata
      || now - Number(entry.updatedAt || 0) >= SUPPLEMENTAL_METADATA_CACHE_TTL_MS;
  });
  if (targets.length === 0) return 0;

  let enriched = 0;
  for (const group of chunk(targets, 5)) {
    const results = await Promise.all(group.map(async (row) => {
      try {
        return await fetchJson(
          `/api/miniqmt/bond-meta?code=${encodeURIComponent(row.code)}`,
          60_000,
        );
      } catch (error) {
        console.warn(`New bond metadata unavailable for ${row.code}.`, error);
        return null;
      }
    }));
    results.forEach((metadata, index) => {
      if (!metadata?.ok) return;
      const row = group[index];
      applySupplementalMetadata(row, metadata);
      const normalized = normalizeSupplementalMetadata(metadata);
      cache[row.code] = {
        updatedAt: now,
        metadata: {
          name: normalized.name,
          stockCode: normalized.stockCode,
          stockName: normalized.stockName,
          conversionPrice: normalized.conversionPrice,
          issue: normalized.issue,
        },
      };
      enriched += 1;
    });
  }
  writeSupplementalMetadataCache(cache);
  if (enriched > 0 && state.rows.length > 0) {
    recomputeLandscapePositions();
    render();
  }
  return enriched;
}

function tagMetadataMap(payload) {
  return new Map(
    (payload?.rows || []).map((row) => [row.code, {
      name: row.name || "",
      tags: row.tags || [],
      primaryTag: row.primaryTag || "",
      stockCode: row.stockCode || "",
      stockName: row.stockName || "",
      listedDate: row.listedDate || "",
      industry1: row.industry1 || "",
      industry2: row.industry2 || "",
      industry3: row.industry3 || "",
      supplemental: Boolean(row.supplemental),
      lifecycleSupplemental: Boolean(row.lifecycleSupplemental),
    }]),
  );
}

function applyTagInfoToRow(row, tagInfo) {
  const tags = [...new Set((tagInfo.tags || []).map(String).filter(Boolean))];
  const primaryTag = tags.includes(tagInfo.primaryTag) ? tagInfo.primaryTag : "";
  row.tags = tags;
  row.primaryTag = primaryTag;
  if (!row.stockCode && tagInfo.stockCode) row.stockCode = tagInfo.stockCode;
  if (!row.stock && tagInfo.stockName) row.stock = tagInfo.stockName;
  if (!row.supplemental) return;
  const isLifecycleSupplement = Boolean(
    row.lifecycleSupplemental || tagInfo.lifecycleSupplemental,
  );
  const topicTags = tags.filter((tag) => !ATTRIBUTE_TAGS.has(tag));
  row.lifecycleSupplemental = isLifecycleSupplement;
  row.theme = primaryTag || topicTags[0] || (isLifecycleSupplement ? "待分类" : "次新债");
  row.topics = [
    ...new Set([
      ...topicTags,
      ...(isLifecycleSupplement ? [] : ["次新债", "新上市转债"]),
    ]),
  ];
}

function applyTagPayload(payload) {
  const tagByCode = tagMetadataMap(payload);
  state.rows = state.rows.filter((row) => tagByCode.has(row.code));
  for (const row of state.rows) {
    const tagInfo = tagByCode.get(row.code);
    if (!tagInfo) continue;
    applyTagInfoToRow(row, tagInfo);
  }
  return tagByCode;
}

function applyInlineTagRows(rows) {
  const changes = new Map((rows || []).map((row) => [String(row.code || "").toUpperCase(), row]));
  let applied = 0;
  for (const row of state.rows) {
    const tagInfo = changes.get(String(row.code || "").toUpperCase());
    if (!tagInfo) continue;
    applyTagInfoToRow(row, tagInfo);
    applied += 1;
  }
  return applied;
}

function storedTagUpdateVersion() {
  try {
    const payload = JSON.parse(window.localStorage.getItem(TAG_UPDATE_STORAGE_KEY) || "null");
    return Number(payload?.version) || 0;
  } catch (_error) {
    return 0;
  }
}

async function refreshTagAnalysis() {
  if (state.tagRefreshing || state.rows.length === 0) return;
  window.clearTimeout(state.tagRetryTimer);
  state.tagRetryTimer = 0;
  const targetVersion = state.pendingTagVersion || storedTagUpdateVersion() || Date.now();
  const reason = state.pendingTagReason || "标签更新";
  const inlineRows = [...state.pendingTagRows.values()];
  const inlineTagOrder = state.pendingTagOrder ? [...state.pendingTagOrder] : null;
  const needsFetch = state.pendingTagNeedsFetch || (inlineRows.length === 0 && !inlineTagOrder);
  const startedAt = performance.now();
  let succeeded = false;
  let addedRows = [];
  state.pendingTagVersion = 0;
  state.pendingTagReason = "";
  state.pendingTagRows.clear();
  state.pendingTagOrder = null;
  state.pendingTagNeedsFetch = false;
  state.tagRefreshing = true;
  try {
    let tagPayload = { tagOrder: inlineTagOrder || state.tagOrder };
    let shouldRebuildLandscape = inlineRows.length > 0;
    if (needsFetch) {
      tagPayload = await fetchJson(TAG_DATA_URL, 8000);
      if (!Array.isArray(tagPayload.rows) || tagPayload.rows.length === 0) {
        throw new Error("标签数据暂不可用");
      }
      const tagByCode = applyTagPayload(tagPayload);
      const existingCodes = new Set(state.rows.map((row) => row.code));
      addedRows = supplementalRowsFromUniverse(
        (tagPayload.rows || []).filter((row) => row.supplemental),
        existingCodes,
        tagByCode,
      );
      state.rows.push(...addedRows);
      state.supplementalBondCount = state.rows.filter((row) => row.supplemental).length;
      if (addedRows.length > 0) applyCachedSupplementalMetadata(addedRows);
      shouldRebuildLandscape = true;
    } else if (applyInlineTagRows(inlineRows) !== inlineRows.length) {
      state.pendingTagNeedsFetch = true;
    }
    if (shouldRebuildLandscape) recomputeLandscapePositions();
    updateTagOptions(tagPayload);
    if (shouldRebuildLandscape) {
      updateSectorOptions();
      render();
    }
    if (addedRows?.length > 0) void refreshSupplementalMetadata(addedRows);
    if (addedRows?.length > 0) {
      if (state.refreshing) state.quoteRefreshPending = true;
      else void refreshMiniQmtQuotes();
    }
    state.lastTagVersion = Math.max(state.lastTagVersion, targetVersion);
    const elapsed = Math.max(0, Math.round(performance.now() - startedAt));
    state.tagWarning = "";
    setMarketStatus(`${reason}已同步 · ${needsFetch ? "全量" : "增量"}分析 ${elapsed}ms`);
    succeeded = true;
  } catch (error) {
    state.pendingTagVersion = Math.max(state.pendingTagVersion, targetVersion);
    state.pendingTagReason = reason;
    for (const row of inlineRows) {
      state.pendingTagRows.set(String(row.code || "").toUpperCase(), row);
    }
    if (inlineTagOrder) state.pendingTagOrder = inlineTagOrder;
    state.pendingTagNeedsFetch ||= needsFetch;
    state.tagWarning = `最新标签同步失败：${error.message}；保留已有星图，30秒后重试`;
    setMarketStatus();
  } finally {
    state.tagRefreshing = false;
    if (
      (succeeded && state.pendingTagVersion > state.lastTagVersion)
      || (!succeeded && state.pendingTagVersion > targetVersion)
      || state.pendingTagNeedsFetch
    ) {
      state.tagRetryTimer = window.setTimeout(refreshTagAnalysis, succeeded ? 0 : TAG_RETRY_DELAY_MS);
    }
  }
}

function requestTagAnalysisRefresh(message = {}, force = false) {
  const version = Number(message?.version) || storedTagUpdateVersion();
  if (!force && (!version || version <= state.lastTagVersion)) return;
  const inlineRows = Array.isArray(message?.rows) ? message.rows : [];
  const existingCodes = new Set(state.rows.map((row) => String(row.code || "").toUpperCase()));
  for (const row of inlineRows) {
    const code = String(row?.code || "").toUpperCase();
    if (!code) continue;
    state.pendingTagRows.set(code, row);
    if (!existingCodes.has(code)) state.pendingTagNeedsFetch = true;
  }
  if (Array.isArray(message?.tagOrder)) state.pendingTagOrder = message.tagOrder.map(String);
  if (force || (inlineRows.length === 0 && !state.pendingTagOrder)) {
    state.pendingTagNeedsFetch = true;
  }
  state.pendingTagVersion = Math.max(state.pendingTagVersion, version || Date.now());
  state.pendingTagReason = String(message?.reason || "标签更新");
  if (!state.tagRefreshing && state.rows.length > 0) void refreshTagAnalysis();
}

async function load() {
  if (state.loading) return;
  state.loading = true;
  nodes.refresh.disabled = true;
  nodes.refresh.textContent = "刷新 QMT 行情";
  setMarketStatus("正在读取本地转债快照…");
  try {
    const [payload, cachedTags] = await Promise.all([
      fetchJson(DATA_URL, 8000),
      fetchJson(TAG_SNAPSHOT_URL, 8000).catch(() => null),
    ]);
    const tagPayload = cachedTags?.rows?.length ? cachedTags : { rows: payload.rows || [] };
    const tagByCode = tagMetadataMap(tagPayload);
    state.snapshot = payload;
    state.rows = Array.isArray(payload.rows)
      ? payload.rows.filter((row) => tagByCode.has(row.code)).map((row) => {
          const tagInfo = tagByCode.get(row.code) || {};
          return {
            ...row,
            tags: tagInfo.tags || [],
            primaryTag: tagInfo.primaryTag || "",
            stockCode: tagInfo.stockCode || "",
            stockChange: null,
          };
        })
      : [];
    if (state.rows.length === 0) throw new Error("转债快照为空");
    if (!window.BondLandscape) throw new Error("转债地形算法未加载");
    const existingCodes = new Set(state.rows.map((row) => row.code));
    const supplementalCandidates = (tagPayload.rows || []).filter((row) => row.supplemental);
    const supplementalRows = supplementalRowsFromUniverse(
      supplementalCandidates,
      existingCodes,
      tagByCode,
    );
    state.rows.push(...supplementalRows);
    state.supplementalBondCount = supplementalRows.length;
    applyCachedSupplementalMetadata(supplementalRows);
    recomputeLandscapePositions();
    state.tagWarning = "正在同步最新标签与存续名单";
    setMarketStatus(`${payload.asOf} 基础快照 · 共${state.rows.length}只`);
    updateTagOptions(tagPayload);
    updateSectorOptions();
    render();
    const requestedBond = new URLSearchParams(window.location.search).get("bond");
    if (requestedBond) {
      const row = state.rows.find((item) => item.code.startsWith(requestedBond));
      if (row) {
        selectBond(row);
        openBond(row, false);
      }
    }
    if (supplementalRows.length > 0) void refreshSupplementalMetadata(supplementalRows);
    state.pendingTagNeedsFetch = true;
    state.pendingTagReason ||= "最新标签";
    void refreshTagAnalysis().then(refreshMiniQmtQuotes);
  } catch (error) {
    setMarketStatus(error.message || "转债星图加载失败");
    nodes.empty.hidden = false;
    nodes.empty.textContent = `${error.message || "转债星图加载失败"}，点击“重新加载星图”重试`;
    nodes.refresh.textContent = "重新加载星图";
  } finally {
    state.loading = false;
    if (!state.refreshing) nodes.refresh.disabled = false;
  }
}

nodes.view.addEventListener("change", () => {
  hideSectorPreview();
  render();
});
nodes.group.addEventListener("change", () => {
  updateSectorOptions();
  recomputeLandscapePositions();
  render();
});
nodes.size.addEventListener("change", render);
nodes.height.addEventListener("change", render);
nodes.zoomRange.addEventListener("input", () => {
  state.camera.zoom = Number(nodes.zoomRange.value) / 100;
  if (state.camera.zoom <= 1) {
    state.camera.panX = 0;
    state.camera.panY = 0;
  }
  syncCameraControls();
  scheduleRender();
});
nodes.cameraYaw.addEventListener("input", () => {
  state.camera.yaw = Number(nodes.cameraYaw.value) * Math.PI / 180;
  syncCameraControls();
  scheduleRender();
});
nodes.cameraPitch.addEventListener("input", () => {
  state.camera.pitch = Number(nodes.cameraPitch.value) * Math.PI / 180;
  syncCameraControls();
  scheduleRender();
});
nodes.cameraReset.addEventListener("click", () => {
  state.camera = { ...DEFAULT_CAMERA };
  syncCameraControls();
  scheduleRender();
});
nodes.color.addEventListener("change", render);
nodes.attention.addEventListener("change", render);
nodes.sector.addEventListener("change", render);
nodes.tag.addEventListener("change", render);
nodes.search.addEventListener("input", render);
nodes.refresh.addEventListener("click", () => {
  if (state.rows.length === 0) {
    void load();
    return;
  }
  if (state.tagWarning) requestTagAnalysisRefresh({ reason: "手动刷新标签" }, true);
  void refreshMiniQmtQuotes();
});
nodes.openDetail.addEventListener("click", () => openBond(state.selectedRow));
nodes.clearSelected.addEventListener("click", clearSelectedBond);
nodes.closeSectorPreview.addEventListener("click", hideSectorPreview);
nodes.sectorPreview.addEventListener("pointerenter", () => {
  window.clearTimeout(state.previewHideTimer);
});
nodes.sectorPreview.addEventListener("pointerleave", scheduleSectorPreviewHide);
function clearCameraLongPress() {
  window.clearTimeout(state.cameraDrag.longPressTimer);
  state.cameraDrag.longPressTimer = 0;
}

function beginCameraPan() {
  if (!state.cameraDrag.active) return;
  state.cameraDrag.mode = "pan";
  nodes.stage.classList.remove("is-rotating");
  nodes.stage.classList.add("is-panning");
}

nodes.svg.addEventListener("pointerdown", (event) => {
  if (nodes.view.value === "treemap" || event.button !== 0) return;
  if (event.target.closest("[data-bond-code], .landscape-label, .attention-label")) return;
  state.cameraDrag.active = true;
  state.cameraDrag.pointerId = event.pointerId;
  state.cameraDrag.lastX = event.clientX;
  state.cameraDrag.lastY = event.clientY;
  state.cameraDrag.startX = event.clientX;
  state.cameraDrag.startY = event.clientY;
  state.cameraDrag.mode = nodes.view.value === "terrain2d" || event.shiftKey ? "pan" : "pending";
  nodes.svg.setPointerCapture(event.pointerId);
  if (state.cameraDrag.mode === "pan") {
    beginCameraPan();
  } else {
    clearCameraLongPress();
    state.cameraDrag.longPressTimer = window.setTimeout(beginCameraPan, 320);
  }
  event.preventDefault();
});
nodes.svg.addEventListener("pointermove", (event) => {
  if (!state.cameraDrag.active || event.pointerId !== state.cameraDrag.pointerId) return;
  const deltaX = event.clientX - state.cameraDrag.lastX;
  const deltaY = event.clientY - state.cameraDrag.lastY;
  if (
    state.cameraDrag.mode === "pending"
    && Math.hypot(event.clientX - state.cameraDrag.startX, event.clientY - state.cameraDrag.startY) > 6
  ) {
    clearCameraLongPress();
    state.cameraDrag.mode = "rotate";
    nodes.stage.classList.add("is-rotating");
  }
  state.cameraDrag.lastX = event.clientX;
  state.cameraDrag.lastY = event.clientY;
  if (state.cameraDrag.mode === "pan") {
    const bounds = nodes.svg.getBoundingClientRect();
    const panLimit = nodes.view.value === "terrain3d"
      ? 0.45
      : Math.max(0, (1 - 1 / state.camera.zoom) / 2);
    state.camera.panX = clamp(state.camera.panX + deltaX / Math.max(bounds.width, 1), -panLimit, panLimit);
    state.camera.panY = clamp(state.camera.panY + deltaY / Math.max(bounds.height, 1), -panLimit, panLimit);
  } else if (state.cameraDrag.mode === "rotate") {
    state.camera.yaw = normalizeAngle(state.camera.yaw - deltaX * 0.008);
    state.camera.pitch = clamp(
      state.camera.pitch + deltaY * 0.006,
      18 * Math.PI / 180,
      72 * Math.PI / 180,
    );
  }
  syncCameraControls();
  scheduleRender();
});
function finishCameraDrag(event) {
  if (!state.cameraDrag.active || event.pointerId !== state.cameraDrag.pointerId) return;
  clearCameraLongPress();
  state.cameraDrag.active = false;
  state.cameraDrag.pointerId = null;
  state.cameraDrag.mode = "idle";
  nodes.stage.classList.remove("is-rotating", "is-panning");
  if (nodes.svg.hasPointerCapture(event.pointerId)) nodes.svg.releasePointerCapture(event.pointerId);
}
nodes.svg.addEventListener("pointerup", finishCameraDrag);
nodes.svg.addEventListener("pointercancel", finishCameraDrag);
nodes.svg.addEventListener("wheel", (event) => {
  if (nodes.view.value === "treemap") return;
  event.preventDefault();
  state.camera.zoom = clamp(state.camera.zoom * Math.exp(-event.deltaY * 0.0011), 0.75, 1.8);
  syncCameraControls();
  scheduleRender();
}, { passive: false });
nodes.closeDetail.addEventListener("click", closeBondDetail);
window.addEventListener("popstate", () => {
  if (!window.history.state?.bondHeatmapOverlay) hideBondDetail();
});
window.addEventListener("message", (event) => {
  if (
    event.origin === window.location.origin &&
    event.source === nodes.detailFrame.contentWindow &&
    event.data?.type === "finance:close-bond-overlay"
  ) {
    closeBondDetail();
  }
});
window.addEventListener("resize", () => {
  window.clearTimeout(state.resizeTimer);
  state.resizeTimer = window.setTimeout(render, 100);
});
tagUpdateChannel?.addEventListener("message", (event) => {
  if (event.data?.type === "finance:bond-tags-updated") {
    requestTagAnalysisRefresh(event.data);
  }
});
window.addEventListener("storage", (event) => {
  if (event.key !== TAG_UPDATE_STORAGE_KEY || !event.newValue) return;
  try {
    requestTagAnalysisRefresh(JSON.parse(event.newValue));
  } catch (_error) {
    requestTagAnalysisRefresh();
  }
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) requestTagAnalysisRefresh({ reason: "返回星图后标签" }, true);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    requestTagAnalysisRefresh({ reason: "重新打开星图后标签" });
  }
});
window.addEventListener("focus", () => {
  requestTagAnalysisRefresh({ reason: "重新聚焦星图后标签" });
});
new ResizeObserver(render).observe(nodes.stage);

syncCameraControls();
load();
