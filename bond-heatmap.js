const DATA_URL = "./data/convertible-bond-heatmap.json";
const TAG_DATA_URL = "./data/convertible-bond-tags.json";
const SVG_NS = "http://www.w3.org/2000/svg";
const QUOTE_BATCH_SIZE = 100;
const ATTRIBUTE_TAGS = new Set(["次新债", "小盘", "ST"]);

const state = {
  rows: [],
  snapshot: null,
  selectedRow: null,
  sparklines: new Map(),
  previewRows: [],
  previewHideTimer: 0,
  previewToken: 0,
  resizeTimer: 0,
  refreshing: false,
};

const nodes = {
  status: document.querySelector("#marketStatus"),
  bondCount: document.querySelector("#bondCount"),
  totalAmount: document.querySelector("#totalAmount"),
  upCount: document.querySelector("#upCount"),
  downCount: document.querySelector("#downCount"),
  group: document.querySelector("#groupSelect"),
  size: document.querySelector("#sizeSelect"),
  color: document.querySelector("#colorSelect"),
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
  } finally {
    window.clearTimeout(timer);
  }
}

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
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

function updateTagOptions(payload) {
  nodes.tag.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部标签";
  nodes.tag.append(all);
  for (const tag of payload.tagOrder || []) {
    const count = Number(payload.tagCounts?.[tag]) || 0;
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = `${tag}（${count}）`;
    nodes.tag.append(option);
  }
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
  nodes.svg
    .querySelector(`[data-bond-code="${CSS.escape(row.code)}"] .bond-tile`)
    ?.classList.add("is-selected");
}

function clearSelectedBond() {
  state.selectedRow = null;
  nodes.selected.hidden = true;
  nodes.svg.querySelectorAll(".bond-tile.is-selected").forEach((tile) => {
    tile.classList.remove("is-selected");
  });
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

function closeBondDetail() {
  if (window.history.state?.bondHeatmapOverlay) {
    window.history.back();
  } else {
    hideBondDetail();
  }
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
  nodes.empty.hidden = rows.length > 0;
  nodes.bondCount.textContent = String(rows.length);
  nodes.totalAmount.textContent = `${formatNumber(rows.reduce((sum, row) => sum + row.amount, 0))}亿`;
  nodes.upCount.textContent = String(rows.filter((row) => row.change > 0).length);
  nodes.downCount.textContent = String(rows.filter((row) => row.change < 0).length);
  renderLegend(colors);

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
  nodes.status.textContent = "正在读取 MiniQMT 全市场转债行情…";
  const quoteBySecid = new Map();
  let failedBatches = 0;

  try {
    const codes = state.rows.map((row) => marketCode(row.code)).filter(Boolean);
    for (const group of chunk(codes, QUOTE_BATCH_SIZE)) {
      try {
        const query = new URLSearchParams({ codes: group.join(",") });
        const payload = await fetchJson(`/api/miniqmt/quotes?${query}`, 12000);
        for (const quote of payload.quotes || []) {
          if (quote.secid) quoteBySecid.set(quote.secid, quote);
        }
      } catch (error) {
        failedBatches += 1;
        console.warn("MiniQMT heatmap quote batch failed.", error);
      }
    }

    let updated = 0;
    for (const row of state.rows) {
      const quote = quoteBySecid.get(secidFromCode(row.code));
      if (!quote) continue;
      const price = Number(quote.price);
      const change = Number(quote.change);
      const amount = Number(quote.amount);
      if (Number.isFinite(price) && price > 0) row.price = price;
      if (Number.isFinite(change)) row.change = change;
      if (Number.isFinite(amount) && amount >= 0) row.amount = amount / 1e8;
      updated += 1;
    }
    render();
    if (updated > 0) {
      nodes.status.textContent =
        `MiniQMT 已更新 ${updated}/${state.rows.length} 只` +
        (failedBatches ? ` · ${failedBatches} 组读取失败` : "");
    } else {
      nodes.status.textContent = `MiniQMT 暂无返回，显示 ${state.snapshot.asOf} 快照`;
    }
  } finally {
    state.refreshing = false;
    nodes.refresh.disabled = false;
  }
}

async function load() {
  try {
    const [payload, tagPayload] = await Promise.all([
      fetchJson(DATA_URL, 8000),
      fetchJson(TAG_DATA_URL, 8000),
    ]);
    const tagByCode = new Map(
      (tagPayload.rows || []).map((row) => [row.code, {
        tags: row.tags || [],
        primaryTag: row.primaryTag || "",
      }]),
    );
    state.snapshot = payload;
    state.rows = Array.isArray(payload.rows)
      ? payload.rows.map((row) => {
          const tagInfo = tagByCode.get(row.code) || {};
          return {
            ...row,
            tags: tagInfo.tags || [],
            primaryTag: tagInfo.primaryTag || "",
          };
        })
      : [];
    if (state.rows.length === 0) throw new Error("转债快照为空");
    nodes.note.textContent =
      `基础快照：${payload.asOf}。行业、题材、转股溢价率来自该快照；` +
      "价格、涨跌幅和成交额可用 MiniQMT 刷新。点击矩形进入单债分时详情。";
    nodes.status.textContent = `${payload.asOf} 快照 · ${state.rows.length}只`;
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
    void refreshMiniQmtQuotes();
  } catch (error) {
    nodes.status.textContent = error.message || "转债星图加载失败";
    nodes.empty.hidden = false;
    nodes.empty.textContent = error.message || "转债星图加载失败";
  }
}

nodes.group.addEventListener("change", () => {
  updateSectorOptions();
  render();
});
nodes.size.addEventListener("change", render);
nodes.color.addEventListener("change", render);
nodes.sector.addEventListener("change", render);
nodes.tag.addEventListener("change", render);
nodes.search.addEventListener("input", render);
nodes.refresh.addEventListener("click", refreshMiniQmtQuotes);
nodes.openDetail.addEventListener("click", () => openBond(state.selectedRow));
nodes.clearSelected.addEventListener("click", clearSelectedBond);
nodes.closeSectorPreview.addEventListener("click", hideSectorPreview);
nodes.sectorPreview.addEventListener("pointerenter", () => {
  window.clearTimeout(state.previewHideTimer);
});
nodes.sectorPreview.addEventListener("pointerleave", scheduleSectorPreviewHide);
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
new ResizeObserver(render).observe(nodes.stage);

load();
