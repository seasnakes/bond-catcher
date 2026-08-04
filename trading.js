const state = {
  payload: null,
  view: "summary",
  search: "",
  account: "",
  sort: {
    summary: { key: "total_amount", direction: -1 },
    trades: { key: "time", direction: -1 },
    orders: { key: "time", direction: -1 },
    positions: { key: "market_value", direction: -1 },
  },
  refreshTimer: 0,
};

const statusNode = document.querySelector("#tradingStatus");
const refreshButton = document.querySelector("#tradingRefresh");
const searchInput = document.querySelector("#tradeSearch");
const accountFilterBox = document.querySelector("#accountFilterBox");
const accountFilter = document.querySelector("#accountFilter");
const tabs = document.querySelector("#tradeTabs");
const table = document.querySelector("#tradeTable");
const tableHead = table.querySelector("thead");
const tableBody = table.querySelector("tbody");
const emptyNode = document.querySelector("#tradeEmpty");
const refreshHint = document.querySelector("#refreshHint");

const columns = {
  summary: [
    { key: "name", label: "标的", type: "bond" },
    { key: "code", label: "代码", type: "muted" },
    { key: "buy_fills", label: "买入笔数", type: "number" },
    { key: "buy_volume", label: "买入数量", type: "number" },
    { key: "buy_average", label: "买入均价", type: "price" },
    { key: "buy_amount", label: "买入金额", type: "money" },
    { key: "sell_fills", label: "卖出笔数", type: "number" },
    { key: "sell_volume", label: "卖出数量", type: "number" },
    { key: "sell_average", label: "卖出均价", type: "price" },
    { key: "sell_amount", label: "卖出金额", type: "money" },
    { key: "net_volume", label: "净数量", type: "signed" },
    { key: "total_amount", label: "总成交额", type: "money" },
  ],
  trades: [
    { key: "time", label: "时间" },
    { key: "name", label: "标的", type: "bond" },
    { key: "code", label: "代码", type: "muted" },
    { key: "account", label: "账户", type: "muted" },
    { key: "side", label: "方向", type: "side" },
    { key: "price", label: "成交价", type: "price" },
    { key: "volume", label: "数量", type: "number" },
    { key: "amount", label: "成交金额", type: "money" },
    { key: "strategy", label: "策略", type: "muted" },
  ],
  orders: [
    { key: "time", label: "时间" },
    { key: "name", label: "标的", type: "bond" },
    { key: "code", label: "代码", type: "muted" },
    { key: "account", label: "账户", type: "muted" },
    { key: "side", label: "方向", type: "side" },
    { key: "price", label: "委托价", type: "price" },
    { key: "volume", label: "委托量", type: "number" },
    { key: "traded_price", label: "成交均价", type: "price" },
    { key: "traded_volume", label: "成交量", type: "number" },
    { key: "status", label: "状态" },
    { key: "strategy", label: "策略", type: "muted" },
  ],
  positions: [
    { key: "name", label: "标的", type: "bond" },
    { key: "code", label: "代码", type: "muted" },
    { key: "account", label: "账户", type: "muted" },
    { key: "volume", label: "持仓", type: "number" },
    { key: "available", label: "可用", type: "number" },
    { key: "average_price", label: "成本价", type: "price" },
    { key: "last_price", label: "现价", type: "price" },
    { key: "market_value", label: "市值", type: "money" },
    { key: "floating_profit", label: "浮动盈亏", type: "signedMoney" },
    { key: "profit_rate", label: "收益率", type: "percent" },
  ],
};

function formatNumber(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return number.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `¥${formatNumber(number, 2)}`;
}

function formatCompactMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  if (Math.abs(number) >= 100_000_000) return `${formatNumber(number / 100_000_000, 2)}亿`;
  if (Math.abs(number) >= 10_000) return `${formatNumber(number / 10_000, 2)}万`;
  return formatMoney(number);
}

function signedClass(value) {
  const number = Number(value);
  return number > 0 ? "is-up" : number < 0 ? "is-down" : "";
}

function bondUrl(row) {
  const code = String(row.code || "");
  const params = new URLSearchParams({ code: code.replace(/\D/g, "").slice(0, 6) });
  if (row.name) params.set("name", row.name);
  return `./bond.html?${params}`;
}

function renderCell(row, column) {
  const cell = document.createElement("td");
  const value = row[column.key];
  if (column.type === "bond") {
    const link = document.createElement("a");
    link.className = "bond-link";
    link.href = bondUrl(row);
    link.textContent = value || row.code || "--";
    cell.append(link);
    return cell;
  }
  if (column.type === "muted") cell.classList.add("cell-muted");
  if (column.type === "side") {
    const sideTone = value === "买入" ? "side-buy" : value === "卖出" ? "side-sell" : "";
    if (sideTone) cell.classList.add(sideTone);
  }
  if (column.type === "signed" || column.type === "signedMoney" || column.type === "percent") {
    const tone = signedClass(value);
    if (tone) cell.classList.add(tone);
  }
  if (column.type === "price") cell.textContent = Number(value) ? formatNumber(value, 3) : "--";
  else if (column.type === "money" || column.type === "signedMoney") cell.textContent = formatMoney(value);
  else if (column.type === "number") cell.textContent = formatNumber(value);
  else if (column.type === "signed") cell.textContent = `${Number(value) > 0 ? "+" : ""}${formatNumber(value)}`;
  else if (column.type === "percent") cell.textContent = `${Number(value) > 0 ? "+" : ""}${formatNumber(value, 2)}%`;
  else cell.textContent = value || "--";
  return cell;
}

function rowsForCurrentView() {
  const payload = state.payload || {};
  const source = state.view === "summary"
    ? payload.symbol_summary
    : state.view === "trades"
      ? payload.trades
      : state.view === "orders"
        ? payload.orders
        : payload.positions;
  const keyword = state.search.trim().toLowerCase();
  const rows = (Array.isArray(source) ? source : []).filter((row) => {
    if (state.account && row.account && row.account !== state.account) return false;
    if (!keyword) return true;
    return `${row.name || ""} ${row.code || ""}`.toLowerCase().includes(keyword);
  });
  const sort = state.sort[state.view];
  return rows.sort((left, right) => {
    const a = left[sort.key];
    const b = right[sort.key];
    if (typeof a === "number" || typeof b === "number") {
      return (Number(a) - Number(b)) * sort.direction;
    }
    return String(a || "").localeCompare(String(b || ""), "zh-CN") * sort.direction;
  });
}

function renderTable() {
  const selectedColumns = columns[state.view];
  const rows = rowsForCurrentView();
  tableHead.replaceChildren();
  tableBody.replaceChildren();

  const headerRow = document.createElement("tr");
  const activeSort = state.sort[state.view];
  for (const column of selectedColumns) {
    const head = document.createElement("th");
    head.textContent = column.label;
    head.dataset.key = column.key;
    if (activeSort.key === column.key) {
      head.classList.add("is-sorted");
      head.dataset.arrow = activeSort.direction > 0 ? "▲" : "▼";
    }
    headerRow.append(head);
  }
  tableHead.append(headerRow);

  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const column of selectedColumns) tr.append(renderCell(row, column));
    fragment.append(tr);
  }
  tableBody.append(fragment);
  table.hidden = rows.length === 0;
  emptyNode.hidden = rows.length !== 0;
}

function setCard(id, value, toneValue = null) {
  const node = document.querySelector(`#${id}`);
  node.textContent = value;
  node.classList.remove("is-up", "is-down");
  if (toneValue !== null) {
    const tone = signedClass(toneValue);
    if (tone) node.classList.add(tone);
  }
}

function renderAccountFilters(accounts) {
  const labels = (accounts || []).map((item) => item.label).filter(Boolean);
  accountFilterBox.hidden = labels.length <= 1;
  const selected = state.account;
  accountFilter.replaceChildren(new Option("全部", ""));
  for (const label of labels) accountFilter.append(new Option(label, label));
  accountFilter.value = labels.includes(selected) ? selected : "";
  state.account = accountFilter.value;
}

function renderPayload(payload) {
  const summary = payload.summary || {};
  setCard("totalAsset", formatCompactMoney(summary.total_asset));
  document.querySelector("#assetAccountCount").textContent = `${summary.account_count || 0} 个账户 · 已脱敏`;
  setCard("availableCash", formatCompactMoney(summary.cash));
  document.querySelector("#marketValue").textContent = `持仓市值 ${formatCompactMoney(summary.market_value)}`;
  setCard("tradeCount", `${summary.trade_count || 0} 笔`);
  document.querySelector("#tradePeriod").textContent = summary.first_trade_time
    ? `${summary.first_trade_time}—${summary.last_trade_time}`
    : "今日暂无成交";
  setCard("buyAmount", formatCompactMoney(summary.buy_amount), summary.buy_amount);
  document.querySelector("#buyCaption").textContent = `${summary.trade_symbol_count || 0} 只成交标的`;
  setCard("sellAmount", formatCompactMoney(summary.sell_amount), -Number(summary.sell_amount || 0));
  document.querySelector("#sellCaption").textContent = `${summary.current_position_count || 0} 只当前持仓`;
  setCard("netBuyAmount", formatCompactMoney(summary.net_buy_amount), summary.net_buy_amount);
  document.querySelector("#orderCaption").textContent = `${summary.order_count || 0} 笔委托 · ${summary.cancelled_order_count || 0} 笔撤单`;

  document.querySelector("#summaryCount").textContent = payload.symbol_summary?.length || 0;
  document.querySelector("#tradesCount").textContent = payload.trades?.length || 0;
  document.querySelector("#ordersCount").textContent = payload.orders?.length || 0;
  document.querySelector("#positionsCount").textContent = payload.positions?.length || 0;

  const strip = document.querySelector("#accountStrip");
  strip.replaceChildren();
  for (const account of payload.accounts || []) {
    const badge = document.createElement("span");
    badge.className = `account-state${account.connected ? " is-connected" : ""}`;
    badge.textContent = `${account.label} ${account.connected ? "已连接" : "未连接"}`;
    strip.append(badge);
  }
  renderAccountFilters(payload.accounts);
  renderTable();
}

function isTradingRefreshWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (values.weekday === "Sat" || values.weekday === "Sun") return false;
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 5;
}

function scheduleRefresh() {
  window.clearTimeout(state.refreshTimer);
  if (!isTradingRefreshWindow()) {
    refreshHint.textContent = "非交易时段不会自动刷新";
    return;
  }
  refreshHint.textContent = "交易时段每 15 秒自动刷新";
  state.refreshTimer = window.setTimeout(() => refreshTradingData({ quiet: true }), 15_000);
}

async function refreshTradingData(options = {}) {
  if (refreshButton.disabled) return;
  refreshButton.disabled = true;
  if (!options.quiet) statusNode.textContent = "正在读取真实账户数据…";
  try {
    const response = await fetch("/api/miniqmt/trading", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    state.payload = payload;
    renderPayload(payload);
    const time = String(payload.generated_at || "").split("T")[1] || "";
    statusNode.textContent = `${payload.source} · ${payload.trading_date} ${time} · ${payload.summary?.connected ? "账户已连接" : "账户连接异常"}`;
  } catch (error) {
    statusNode.textContent = `读取失败：${error.message || "QMT 服务不可用"}`;
    if (!state.payload) {
      table.hidden = true;
      emptyNode.hidden = false;
      emptyNode.textContent = "暂时无法读取 QMT 实盘数据";
    }
  } finally {
    refreshButton.disabled = false;
    scheduleRefresh();
  }
}

tabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button) return;
  state.view = button.dataset.view;
  for (const item of tabs.querySelectorAll("button")) item.classList.toggle("is-active", item === button);
  renderTable();
});

tableHead.addEventListener("click", (event) => {
  const head = event.target.closest("th[data-key]");
  if (!head) return;
  const sort = state.sort[state.view];
  if (sort.key === head.dataset.key) sort.direction *= -1;
  else {
    sort.key = head.dataset.key;
    sort.direction = head.dataset.key === "name" || head.dataset.key === "code" ? 1 : -1;
  }
  renderTable();
});

searchInput.addEventListener("input", () => {
  state.search = searchInput.value;
  renderTable();
});

accountFilter.addEventListener("change", () => {
  state.account = accountFilter.value;
  renderTable();
});

refreshButton.addEventListener("click", () => refreshTradingData());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) window.clearTimeout(state.refreshTimer);
  else refreshTradingData({ quiet: true });
});

refreshTradingData();
