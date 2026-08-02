const params = new URLSearchParams(window.location.search);

const state = {
  rows: [],
  tagOrder: [],
  tagCounts: {},
  selectedTag: params.get("tag") || "",
  quotes: new Map(),
  editingRow: null,
  editDraft: new Set(),
};

const nodes = {
  status: document.querySelector("#dataStatus"),
  allCount: document.querySelector("#allCount"),
  matchedCount: document.querySelector("#matchedCount"),
  tagCount: document.querySelector("#tagCount"),
  search: document.querySelector("#searchInput"),
  filters: document.querySelector("#tagFilters"),
  resultTitle: document.querySelector("#resultTitle"),
  resultMeta: document.querySelector("#resultMeta"),
  tableBody: document.querySelector("#tagTableBody"),
  empty: document.querySelector("#emptyState"),
  refresh: document.querySelector("#refreshButton"),
  editor: document.querySelector("#tagEditPanel"),
  editingName: document.querySelector("#editingBondName"),
  editOptions: document.querySelector("#editTagOptions"),
  editStatus: document.querySelector("#editStatus"),
  closeEditor: document.querySelector("#closeEditorButton"),
  cancelEdit: document.querySelector("#cancelEditButton"),
  saveEdit: document.querySelector("#saveEditButton"),
};

function formatNumber(value, digits = 2) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "-";
}

function formatAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (Math.abs(number) >= 1e8) return `${(number / 1e8).toFixed(2)}亿`;
  if (Math.abs(number) >= 1e4) return `${(number / 1e4).toFixed(1)}万`;
  return number.toFixed(0);
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), options.timeout || 15000);
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

function filteredRows() {
  const query = nodes.search.value.trim().toLowerCase();
  return state.rows.filter((row) => {
    if (state.selectedTag && !(row.tags || []).includes(state.selectedTag)) return false;
    if (!query) return true;
    return [row.code, row.name, row.stockCode, row.stockName, row.industry1, row.industry2, row.industry3, ...(row.tags || [])]
      .some((value) => String(value || "").toLowerCase().includes(query));
  }).sort((left, right) => {
    const leftAmount = Number(state.quotes.get(left.code)?.amount) || 0;
    const rightAmount = Number(state.quotes.get(right.code)?.amount) || 0;
    return rightAmount - leftAmount || String(left.code).localeCompare(String(right.code));
  });
}

function setSelectedTag(tag) {
  state.selectedTag = state.tagOrder.includes(tag) ? tag : "";
  const url = new URL(window.location.href);
  if (state.selectedTag) url.searchParams.set("tag", state.selectedTag);
  else url.searchParams.delete("tag");
  window.history.replaceState(window.history.state, "", url);
  renderFilters();
  renderTable();
}

function renderFilters() {
  nodes.filters.replaceChildren();
  const entries = [
    ["", "全部", state.rows.length],
    ...state.tagOrder.map((tag) => [tag, tag, Number(state.tagCounts[tag]) || 0]),
  ];
  for (const [value, label, count] of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = state.selectedTag === value ? "is-active" : "";
    button.textContent = `${label} ${count}`;
    button.addEventListener("click", () => setSelectedTag(value));
    nodes.filters.append(button);
  }
}

function makeCell(className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  return cell;
}

function renderTable() {
  const rows = filteredRows();
  nodes.tableBody.replaceChildren();
  nodes.allCount.textContent = String(state.rows.length);
  nodes.matchedCount.textContent = String(rows.length);
  nodes.tagCount.textContent = String(state.tagOrder.length);
  nodes.resultTitle.textContent = state.selectedTag ? `${state.selectedTag} 标签` : "全部转债";
  nodes.resultMeta.textContent = `共 ${rows.length} 只 · 默认按成交额排序`;
  nodes.empty.hidden = rows.length > 0;

  for (const row of rows) {
    const quote = state.quotes.get(row.code) || {};
    const tableRow = document.createElement("tr");

    const bond = makeCell("bond-cell");
    const detailLink = document.createElement("a");
    detailLink.href = `./bond.html?${new URLSearchParams({ code: row.code.slice(0, 6), name: row.name })}`;
    detailLink.textContent = row.name || row.code;
    const code = document.createElement("span");
    code.textContent = row.code;
    bond.append(detailLink, code);

    const stock = makeCell("stock-cell");
    const stockName = document.createElement("strong");
    stockName.textContent = row.stockName || "-";
    const stockCode = document.createElement("span");
    stockCode.textContent = row.stockCode || "-";
    stock.append(stockName, stockCode);

    const industry = makeCell("industry-cell");
    industry.textContent = [row.industry1, row.industry2].filter(Boolean).join(" / ") || "-";

    const price = makeCell("number-column");
    price.textContent = formatNumber(quote.price, 3);
    const change = makeCell("number-column");
    change.textContent = Number.isFinite(Number(quote.change))
      ? `${Number(quote.change) > 0 ? "+" : ""}${formatNumber(quote.change, 2)}%`
      : "-";
    if (Number(quote.change) > 0) change.classList.add("is-up");
    if (Number(quote.change) < 0) change.classList.add("is-down");
    const amount = makeCell("number-column");
    amount.textContent = formatAmount(quote.amount);

    const tags = makeCell();
    const tagWrap = document.createElement("div");
    tagWrap.className = "row-tags";
    for (const tag of row.tags || []) {
      const tagButton = document.createElement("button");
      tagButton.type = "button";
      tagButton.textContent = tag;
      tagButton.title = `只看“${tag}”标签`;
      tagButton.addEventListener("click", () => setSelectedTag(tag));
      tagWrap.append(tagButton);
    }
    if (!tagWrap.childElementCount) tagWrap.textContent = "未分类";
    tags.append(tagWrap);

    const actions = makeCell();
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "edit-button";
    edit.textContent = "编辑标签";
    edit.addEventListener("click", () => openEditor(row));
    actions.append(edit);

    tableRow.append(bond, stock, industry, price, change, amount, tags, actions);
    nodes.tableBody.append(tableRow);
  }
}

function renderEditOptions() {
  nodes.editOptions.replaceChildren();
  for (const tag of state.tagOrder) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tag;
    button.setAttribute("aria-pressed", String(state.editDraft.has(tag)));
    button.addEventListener("click", () => {
      if (state.editDraft.has(tag)) state.editDraft.delete(tag);
      else state.editDraft.add(tag);
      button.setAttribute("aria-pressed", String(state.editDraft.has(tag)));
      nodes.editStatus.textContent = "有未保存的修改";
    });
    nodes.editOptions.append(button);
  }
}

function openEditor(row) {
  state.editingRow = row;
  state.editDraft = new Set(row.tags || []);
  nodes.editingName.textContent = `${row.name} ${row.code}`;
  nodes.editStatus.textContent = "点击标签可选中或取消";
  renderEditOptions();
  nodes.editor.hidden = false;
  nodes.editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function closeEditor() {
  nodes.editor.hidden = true;
  state.editingRow = null;
}

function recalculateCounts() {
  state.tagCounts = Object.fromEntries(
    state.tagOrder.map((tag) => [tag, state.rows.filter((row) => (row.tags || []).includes(tag)).length]),
  );
}

async function saveEditor() {
  if (!state.editingRow) return;
  nodes.saveEdit.disabled = true;
  nodes.cancelEdit.disabled = true;
  nodes.editStatus.textContent = "正在保存";
  try {
    const payload = await fetchJson("/api/miniqmt/tags", {
      method: "POST",
      body: {
        code: state.editingRow.code,
        tags: state.tagOrder.filter((tag) => state.editDraft.has(tag)),
      },
    });
    state.editingRow.tags = payload.tags || [];
    recalculateCounts();
    renderFilters();
    renderTable();
    closeEditor();
  } catch (error) {
    nodes.editStatus.textContent = error.message || "标签保存失败";
  } finally {
    nodes.saveEdit.disabled = false;
    nodes.cancelEdit.disabled = false;
  }
}

async function loadQuotes() {
  nodes.refresh.disabled = true;
  nodes.status.textContent = "正在刷新 MiniQMT 行情…";
  try {
    const query = new URLSearchParams({ codes: state.rows.map((row) => row.code).join(",") });
    const payload = await fetchJson(`/api/miniqmt/quotes?${query}`, { timeout: 30000 });
    state.quotes = new Map((payload.quotes || []).map((quote) => [quote.monitor_code, quote]));
    nodes.status.textContent = `${payload.source} · ${payload.generated_at.replace("T", " ")}`;
    renderTable();
  } catch (error) {
    nodes.status.textContent = `行情读取失败：${error.message}`;
  } finally {
    nodes.refresh.disabled = false;
  }
}

async function initialize() {
  try {
    const payload = await fetchJson("/api/miniqmt/tags", { timeout: 20000 });
    state.rows = payload.rows || [];
    state.tagOrder = payload.tagOrder || [];
    state.tagCounts = payload.tagCounts || {};
    if (!state.tagOrder.includes(state.selectedTag)) state.selectedTag = "";
    renderFilters();
    renderTable();
    await loadQuotes();
  } catch (error) {
    nodes.status.textContent = `标签读取失败：${error.message}`;
    nodes.empty.hidden = false;
    nodes.empty.textContent = error.message || "标签读取失败";
  }
}

nodes.search.addEventListener("input", renderTable);
nodes.refresh.addEventListener("click", loadQuotes);
nodes.closeEditor.addEventListener("click", closeEditor);
nodes.cancelEdit.addEventListener("click", closeEditor);
nodes.saveEdit.addEventListener("click", saveEditor);

void initialize();
