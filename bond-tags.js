const params = new URLSearchParams(window.location.search);

const state = {
  rows: [],
  tagOrder: [],
  tagCounts: {},
  selectedTag: params.get("tag") || "",
  quotes: new Map(),
  editingRow: null,
  editDraft: new Set(),
  quickAddRow: null,
};

const nodes = {
  status: document.querySelector("#dataStatus"),
  allCount: document.querySelector("#allCount"),
  matchedCount: document.querySelector("#matchedCount"),
  tagCount: document.querySelector("#tagCount"),
  search: document.querySelector("#searchInput"),
  searchSuggestions: document.querySelector("#searchSuggestions"),
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
  quickAddCard: document.querySelector("#quickAddCard"),
  quickAddToggle: document.querySelector("#quickAddToggle"),
  quickAddTitle: document.querySelector("#quickAddTitle"),
  quickAddForm: document.querySelector("#quickAddForm"),
  quickAddInput: document.querySelector("#quickAddInput"),
  quickAddSuggestions: document.querySelector("#quickAddSuggestions"),
  quickAddStatus: document.querySelector("#quickAddStatus"),
  quickAddCancel: document.querySelector("#quickAddCancel"),
  quickAddSave: document.querySelector("#quickAddSave"),
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
  const query = nodes.search.value.trim();
  return state.rows.filter((row) => {
    if (state.selectedTag && !(row.tags || []).includes(state.selectedTag)) return false;
    if (!query) return true;
    return searchMatchScore(row, query) < Number.POSITIVE_INFINITY;
  }).sort((left, right) => {
    const leftAmount = Number(state.quotes.get(left.code)?.amount) || 0;
    const rightAmount = Number(state.quotes.get(right.code)?.amount) || 0;
    return rightAmount - leftAmount || String(left.code).localeCompare(String(right.code));
  });
}

function normalizeSearchValue(value) {
  const replacements = new Map([
    ["升", "声"], ["生", "声"],
    ["讯", "迅"], ["训", "迅"], ["汛", "迅"],
    ["在", "债"], ["载", "债"], ["寨", "债"],
  ]);
  return [...String(value || "").toLowerCase().replace(/[^0-9a-z\u3400-\u9fff]/g, "")]
    .map((character) => replacements.get(character) || character)
    .join("");
}

function editDistance(left, right) {
  const source = [...left];
  const target = [...right];
  let previous = target.map((_, index) => index + 1);
  previous.unshift(0);
  for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
    const current = [sourceIndex + 1];
    for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
      current.push(Math.min(
        current[targetIndex] + 1,
        previous[targetIndex + 1] + 1,
        previous[targetIndex] + (source[sourceIndex] === target[targetIndex] ? 0 : 1),
      ));
    }
    previous = current;
  }
  return previous[target.length];
}

function rowSearchValues(row) {
  return [row.code, row.name, row.stockCode, row.stockName, row.industry1, row.industry2, row.industry3]
    .map(normalizeSearchValue)
    .filter(Boolean);
}

function searchMatchScore(row, query) {
  const normalized = normalizeSearchValue(query);
  if (!normalized) return 0;
  const values = rowSearchValues(row);
  if (values.some((value) => value === normalized)) return 0;
  if (values.some((value) => value.startsWith(normalized))) return 1;
  if (values.some((value) => value.includes(normalized))) return 2;
  if (normalized.length < 3) return Number.POSITIVE_INFINITY;
  const names = [row.name, row.stockName].map(normalizeSearchValue).filter(Boolean);
  const distance = Math.min(...names.map((value) => editDistance(normalized, value)));
  const allowedDistance = Math.max(1, Math.floor(normalized.length * 0.3));
  return distance <= allowedDistance ? 10 + distance : Number.POSITIVE_INFINITY;
}

function suggestedRows(query, options = {}) {
  const normalized = normalizeSearchValue(query);
  if (!normalized && !options.allowEmpty) return [];
  return state.rows
    .filter((row) => !options.excludeTag || !(row.tags || []).includes(options.excludeTag))
    .map((row) => ({ row, score: normalized ? searchMatchScore(row, normalized) : 0 }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => {
      const leftPreferred = options.preferredTag && (left.row.tags || []).includes(options.preferredTag) ? 1 : 0;
      const rightPreferred = options.preferredTag && (right.row.tags || []).includes(options.preferredTag) ? 1 : 0;
      const leftAmount = Number(state.quotes.get(left.row.code)?.amount) || 0;
      const rightAmount = Number(state.quotes.get(right.row.code)?.amount) || 0;
      return left.score - right.score || rightPreferred - leftPreferred || rightAmount - leftAmount;
    })
    .slice(0, 8)
    .map((item) => item.row);
}

function renderSuggestions(container, query, onSelect, options = {}) {
  const rows = suggestedRows(query, options);
  container.replaceChildren();
  container.hidden = rows.length === 0;
  for (const row of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "option");
    const bond = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = row.name;
    const code = document.createElement("small");
    code.textContent = row.code;
    bond.append(name, code);
    const stock = document.createElement("span");
    stock.className = "suggestion-stock";
    stock.textContent = `${row.stockName || "-"} ${row.stockCode || ""}`;
    button.append(bond, stock);
    button.addEventListener("click", () => {
      container.hidden = true;
      onSelect(row);
    });
    container.append(button);
  }
  return rows;
}

function selectTopSearchRow(row) {
  if (state.selectedTag && !(row.tags || []).includes(state.selectedTag)) {
    nodes.search.value = "";
    nodes.searchSuggestions.hidden = true;
    renderTable();
    nodes.quickAddForm.hidden = false;
    selectQuickAddRow(row);
    nodes.quickAddCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  nodes.search.value = row.name;
  nodes.searchSuggestions.hidden = true;
  renderTable();
}

function setSelectedTag(tag) {
  state.selectedTag = state.tagOrder.includes(tag) ? tag : "";
  const url = new URL(window.location.href);
  if (state.selectedTag) url.searchParams.set("tag", state.selectedTag);
  else url.searchParams.delete("tag");
  window.history.replaceState(window.history.state, "", url);
  renderFilters();
  renderTable();
  renderQuickAdd();
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

function resetQuickAdd() {
  state.quickAddRow = null;
  nodes.quickAddInput.value = "";
  nodes.quickAddSuggestions.hidden = true;
  nodes.quickAddSave.disabled = true;
  nodes.quickAddStatus.textContent = "请选择一只尚未属于该标签的转债";
}

function renderQuickAdd() {
  nodes.quickAddCard.hidden = !state.selectedTag;
  if (!state.selectedTag) {
    nodes.quickAddForm.hidden = true;
    resetQuickAdd();
    return;
  }
  nodes.quickAddTitle.textContent = `添加转债到“${state.selectedTag}”`;
}

function selectQuickAddRow(row) {
  state.quickAddRow = row;
  nodes.quickAddInput.value = `${row.name} ${row.code}`;
  nodes.quickAddSave.disabled = false;
  nodes.quickAddStatus.textContent = `将 ${row.name} 添加到“${state.selectedTag}”`;
}

async function saveQuickAdd() {
  const row = state.quickAddRow;
  const tag = state.selectedTag;
  if (!row || !tag) return;
  nodes.quickAddSave.disabled = true;
  nodes.quickAddCancel.disabled = true;
  nodes.quickAddStatus.textContent = "正在添加";
  try {
    const tags = new Set(row.tags || []);
    tags.add(tag);
    const payload = await fetchJson("/api/miniqmt/tags", {
      method: "POST",
      body: {
        code: row.code,
        tags: state.tagOrder.filter((value) => tags.has(value)),
      },
    });
    row.tags = payload.tags || [];
    recalculateCounts();
    renderFilters();
    renderTable();
    nodes.quickAddStatus.textContent = `已将 ${row.name} 添加到“${tag}”`;
    state.quickAddRow = null;
    nodes.quickAddInput.value = "";
    nodes.quickAddSuggestions.hidden = true;
    window.setTimeout(() => {
      nodes.quickAddForm.hidden = true;
      nodes.quickAddSave.disabled = true;
    }, 500);
  } catch (error) {
    nodes.quickAddStatus.textContent = error.message || "添加失败";
    nodes.quickAddSave.disabled = false;
  } finally {
    nodes.quickAddCancel.disabled = false;
  }
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
    renderQuickAdd();
    await loadQuotes();
  } catch (error) {
    nodes.status.textContent = `标签读取失败：${error.message}`;
    nodes.empty.hidden = false;
    nodes.empty.textContent = error.message || "标签读取失败";
  }
}

nodes.search.addEventListener("input", () => {
  renderTable();
  renderSuggestions(
    nodes.searchSuggestions,
    nodes.search.value,
    selectTopSearchRow,
    { preferredTag: state.selectedTag },
  );
});
nodes.search.addEventListener("focus", () => {
  renderSuggestions(
    nodes.searchSuggestions,
    nodes.search.value,
    selectTopSearchRow,
    { preferredTag: state.selectedTag },
  );
});
nodes.search.addEventListener("keydown", (event) => {
  if (event.key === "Escape") nodes.searchSuggestions.hidden = true;
  if (event.key === "Enter") {
    const first = suggestedRows(nodes.search.value, { preferredTag: state.selectedTag })[0];
    if (!first) return;
    event.preventDefault();
    selectTopSearchRow(first);
  }
});
nodes.refresh.addEventListener("click", loadQuotes);
nodes.closeEditor.addEventListener("click", closeEditor);
nodes.cancelEdit.addEventListener("click", closeEditor);
nodes.saveEdit.addEventListener("click", saveEditor);
nodes.quickAddToggle.addEventListener("click", () => {
  nodes.quickAddForm.hidden = !nodes.quickAddForm.hidden;
  if (!nodes.quickAddForm.hidden) {
    resetQuickAdd();
    nodes.quickAddInput.focus();
    renderSuggestions(
      nodes.quickAddSuggestions,
      "",
      selectQuickAddRow,
      { excludeTag: state.selectedTag, allowEmpty: true },
    );
  }
});
nodes.quickAddInput.addEventListener("input", () => {
  state.quickAddRow = null;
  nodes.quickAddSave.disabled = true;
  nodes.quickAddStatus.textContent = "请选择联想结果中的转债";
  renderSuggestions(
    nodes.quickAddSuggestions,
    nodes.quickAddInput.value,
    selectQuickAddRow,
    { excludeTag: state.selectedTag, allowEmpty: true },
  );
});
nodes.quickAddInput.addEventListener("focus", () => {
  renderSuggestions(
    nodes.quickAddSuggestions,
    nodes.quickAddInput.value,
    selectQuickAddRow,
    { excludeTag: state.selectedTag, allowEmpty: true },
  );
});
nodes.quickAddCancel.addEventListener("click", () => {
  nodes.quickAddForm.hidden = true;
  resetQuickAdd();
});
nodes.quickAddSave.addEventListener("click", saveQuickAdd);
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".tag-search")) nodes.searchSuggestions.hidden = true;
  if (!event.target.closest(".quick-add-form")) nodes.quickAddSuggestions.hidden = true;
});

void initialize();
