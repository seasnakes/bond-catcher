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
  capabilities: null,
  sessionToken: "",
  sessionExpiresAt: 0,
  sessionTicker: 0,
  pendingPreview: null,
  confirmReadyAt: 0,
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
const modeBadge = document.querySelector("#tradingModeBadge");
const unlockButton = document.querySelector("#tradeUnlockButton");
const tradingAccessText = document.querySelector("#tradingAccessText");
const orderForm = document.querySelector("#orderForm");
const orderAccount = document.querySelector("#orderAccount");
const orderCode = document.querySelector("#orderCode");
const orderSide = document.querySelector("#orderSide");
const orderPrice = document.querySelector("#orderPrice");
const orderVolume = document.querySelector("#orderVolume");
const orderPreviewButton = document.querySelector("#orderPreviewButton");
const orderFormMessage = document.querySelector("#orderFormMessage");
const unlockDialog = document.querySelector("#tradeUnlockDialog");
const unlockForm = document.querySelector("#tradeUnlockForm");
const unlockPhraseNode = document.querySelector("#unlockPhrase");
const unlockPhraseInput = document.querySelector("#unlockPhraseInput");
const unlockMessage = document.querySelector("#unlockMessage");
const confirmDialog = document.querySelector("#tradeConfirmDialog");
const confirmForm = document.querySelector("#tradeConfirmForm");
const confirmTitle = document.querySelector("#tradeConfirmTitle");
const previewSummary = document.querySelector("#tradePreviewSummary");
const confirmationPhrase = document.querySelector("#tradeConfirmationPhrase");
const confirmationInput = document.querySelector("#tradeConfirmationInput");
const confirmMessage = document.querySelector("#tradeConfirmMessage");
const executeTradeButton = document.querySelector("#executeTradeButton");

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
    { key: "cancelable", label: "操作", type: "action" },
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
  if (column.type === "action") {
    if (row.cancelable && row.order_id) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cancel-order-button";
      button.dataset.orderId = String(row.order_id);
      button.dataset.account = row.account || "";
      button.textContent = "撤单";
      button.disabled = !sessionIsActive();
      cell.append(button);
    } else {
      cell.textContent = "--";
    }
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
  const orderSelected = orderAccount.value;
  orderAccount.replaceChildren();
  for (const label of labels) orderAccount.append(new Option(label, label));
  if (labels.includes(orderSelected)) orderAccount.value = orderSelected;
}

function sessionIsActive() {
  return Boolean(state.sessionToken && state.sessionExpiresAt > Date.now());
}

function setMessage(node, message, tone = "") {
  node.textContent = message;
  node.classList.toggle("is-error", tone === "error");
  node.classList.toggle("is-success", tone === "success");
}

function renderTradingAccess() {
  const capability = state.capabilities || {};
  const local = Boolean(capability.local_access);
  const available = local && capability.bridge_enabled && capability.bridge_connected;
  const unlocked = available && sessionIsActive();
  for (const field of [orderAccount, orderCode, orderSide, orderPrice, orderVolume, orderPreviewButton]) {
    field.disabled = !unlocked;
  }
  modeBadge.classList.toggle("is-unlocked", unlocked);
  modeBadge.textContent = unlocked ? "交易已解锁" : "只读";
  unlockButton.hidden = !local;
  unlockButton.disabled = !available;
  unlockButton.classList.toggle("is-unlocked", unlocked);
  unlockButton.textContent = unlocked ? "关闭交易" : "开启交易";
  if (!local) tradingAccessText.textContent = "局域网访问只读，交易入口已禁用";
  else if (!capability.bridge_enabled) tradingAccessText.textContent = "QMT服务未启用交易模块";
  else if (!capability.bridge_connected) tradingAccessText.textContent = "QMT交易账户未连接";
  else if (unlocked) {
    const seconds = Math.max(0, Math.ceil((state.sessionExpiresAt - Date.now()) / 1000));
    tradingAccessText.textContent = `已解锁，${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} 后自动关闭`;
  } else tradingAccessText.textContent = "当前锁定，仅可查看";
  if (!unlocked && orderFormMessage.classList.contains("is-success")) {
    setMessage(orderFormMessage, "开启交易后才能生成预览；页面不会自动下单。");
  }
  if (state.payload) renderTable();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function loadTradingCapabilities() {
  try {
    const response = await fetch("/api/miniqmt/trading/capabilities", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    state.capabilities = payload;
    unlockPhraseNode.textContent = payload.unlock_phrase || "开启实盘交易";
  } catch (error) {
    state.capabilities = { local_access: true, bridge_enabled: false, bridge_connected: false };
    setMessage(orderFormMessage, `交易能力检查失败：${error.message}`, "error");
  }
  renderTradingAccess();
}

function lockTradingSession() {
  state.sessionToken = "";
  state.sessionExpiresAt = 0;
  state.pendingPreview = null;
  window.clearInterval(state.sessionTicker);
  renderTradingAccess();
}

function startSessionTicker() {
  window.clearInterval(state.sessionTicker);
  state.sessionTicker = window.setInterval(() => {
    if (!sessionIsActive()) lockTradingSession();
    else renderTradingAccess();
  }, 1000);
}

function showTradePreview(payload, kind) {
  state.pendingPreview = { ...payload, kind };
  state.confirmReadyAt = Date.now() + 2000;
  confirmTitle.textContent = kind === "cancel" ? "确认撤销实盘委托" : "确认提交实盘委托";
  const order = payload.order || {};
  const summaryRows = kind === "cancel"
    ? [
        ["标的", `${order.name || ""} ${order.stock_code || ""}`],
        ["委托编号", order.order_id || "--"],
        ["方向", order.side || "--"],
        ["未成交数量", Math.max(0, Number(order.order_volume || 0) - Number(order.traded_volume || 0))],
      ]
    : [
        ["标的", `${order.name || ""} ${order.stock_code || ""}`],
        ["方向", order.side || "--"],
        ["数量", order.order_volume || "--"],
        ["限价", formatNumber(order.price, 3)],
        ["预计金额", formatMoney(order.amount)],
        ["现价", formatNumber(payload.checks?.last_price, 3)],
      ];
  previewSummary.replaceChildren();
  for (const [label, value] of summaryRows) {
    const row = document.createElement("div");
    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    const valueNode = document.createElement("strong");
    valueNode.textContent = String(value);
    row.append(labelNode, valueNode);
    previewSummary.append(row);
  }
  confirmationPhrase.textContent = payload.confirmation;
  confirmationInput.value = "";
  executeTradeButton.textContent = kind === "cancel" ? "提交撤单" : "提交实盘委托";
  executeTradeButton.disabled = true;
  setMessage(confirmMessage, "请核对标的、方向、数量和价格，2秒后可确认。", "");
  confirmDialog.showModal();
}

function updateConfirmButton() {
  const preview = state.pendingPreview;
  executeTradeButton.disabled = !preview
    || Date.now() < state.confirmReadyAt
    || confirmationInput.value !== preview.confirmation;
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

unlockButton.addEventListener("click", () => {
  if (sessionIsActive()) {
    lockTradingSession();
    setMessage(orderFormMessage, "交易已手动关闭，页面恢复只读。", "success");
    return;
  }
  unlockPhraseInput.value = "";
  setMessage(unlockMessage, "");
  unlockDialog.showModal();
});

unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#confirmTradeUnlock");
  button.disabled = true;
  try {
    const payload = await postJson("/api/miniqmt/trading/unlock", { phrase: unlockPhraseInput.value });
    state.sessionToken = payload.session_token;
    state.sessionExpiresAt = Number(payload.expires_at || 0);
    unlockDialog.close();
    startSessionTicker();
    renderTradingAccess();
    setMessage(orderFormMessage, "交易已解锁。填写单笔限价委托并先生成预览。", "success");
  } catch (error) {
    setMessage(unlockMessage, error.message, "error");
  } finally {
    button.disabled = false;
  }
});

for (const id of ["closeTradeUnlock", "cancelTradeUnlock"]) {
  document.querySelector(`#${id}`).addEventListener("click", () => unlockDialog.close());
}

orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!sessionIsActive()) {
    setMessage(orderFormMessage, "交易会话已过期，请重新开启。", "error");
    lockTradingSession();
    return;
  }
  orderPreviewButton.disabled = true;
  setMessage(orderFormMessage, "正在校验账户、资金、持仓和实时价格…");
  try {
    const payload = await postJson("/api/miniqmt/trading/order-preview", {
      session_token: state.sessionToken,
      account: orderAccount.value,
      stock_code: orderCode.value,
      side: orderSide.value,
      price: Number(orderPrice.value),
      volume: Number(orderVolume.value),
    });
    setMessage(orderFormMessage, "校验通过，请在弹窗中完成二次确认。", "success");
    showTradePreview(payload, "order");
  } catch (error) {
    setMessage(orderFormMessage, error.message, "error");
  } finally {
    orderPreviewButton.disabled = !sessionIsActive();
  }
});

tableBody.addEventListener("click", async (event) => {
  const button = event.target.closest(".cancel-order-button");
  if (!button) return;
  if (!sessionIsActive()) {
    setMessage(orderFormMessage, "请先开启交易，再生成撤单预览。", "error");
    return;
  }
  button.disabled = true;
  try {
    const payload = await postJson("/api/miniqmt/trading/cancel-preview", {
      session_token: state.sessionToken,
      account: button.dataset.account,
      order_id: Number(button.dataset.orderId),
    });
    showTradePreview(payload, "cancel");
  } catch (error) {
    setMessage(orderFormMessage, error.message, "error");
  } finally {
    button.disabled = false;
  }
});

confirmationInput.addEventListener("input", updateConfirmButton);
confirmationInput.addEventListener("focus", () => {
  window.setTimeout(updateConfirmButton, Math.max(0, state.confirmReadyAt - Date.now()));
});

confirmForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  updateConfirmButton();
  if (executeTradeButton.disabled || !state.pendingPreview) return;
  executeTradeButton.disabled = true;
  setMessage(confirmMessage, "正在提交，请勿关闭页面或重复操作…");
  const preview = state.pendingPreview;
  try {
    const endpoint = preview.kind === "cancel"
      ? "/api/miniqmt/trading/cancel-execute"
      : "/api/miniqmt/trading/order-execute";
    const payload = await postJson(endpoint, {
      session_token: state.sessionToken,
      preview_token: preview.preview_token,
      confirmation: confirmationInput.value,
    });
    state.pendingPreview = null;
    setMessage(orderFormMessage, payload.message || "请求已提交，请刷新委托核对。", "success");
    confirmDialog.close();
    await refreshTradingData();
  } catch (error) {
    state.pendingPreview = null;
    setMessage(confirmMessage, error.message, "error");
  }
});

for (const id of ["closeTradeConfirm", "cancelTradeConfirm"]) {
  document.querySelector(`#${id}`).addEventListener("click", () => {
    state.pendingPreview = null;
    confirmDialog.close();
  });
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

Promise.all([loadTradingCapabilities(), refreshTradingData()]);
