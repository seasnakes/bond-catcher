const params = new URLSearchParams(window.location.search);
const FILTER_UNTAGGED = "__untagged__";
const ATTRIBUTE_TAGS = new Set(["次新债", "小盘", "ST"]);
const TAG_UPDATE_CHANNEL_NAME = "finance:bond-tags";
const TAG_UPDATE_STORAGE_KEY = "finance:bond-tags-updated";
const initialUntaggedFilter = params.get("filter") === "untagged";
const tagUpdateChannel = typeof window.BroadcastChannel === "function"
  ? new window.BroadcastChannel(TAG_UPDATE_CHANNEL_NAME)
  : null;

const state = {
  rows: [],
  tagOrder: [],
  tagCounts: {},
  selectedTag: initialUntaggedFilter ? "" : params.get("tag") || "",
  showUntagged: initialUntaggedFilter,
  quotes: new Map(),
  searchAliases: new Map(),
  editingRow: null,
  editDraft: new Set(),
  editPrimaryTag: "",
  quickAddRow: null,
  selectedCodes: new Set(),
  bulkSaving: false,
  tagCreating: false,
  quotesLoading: false,
};

const nodes = {
  status: document.querySelector("#dataStatus"),
  quoteStatus: document.querySelector("#quoteStatus"),
  allCount: document.querySelector("#allCount"),
  matchedCount: document.querySelector("#matchedCount"),
  tagCount: document.querySelector("#tagCount"),
  search: document.querySelector("#searchInput"),
  searchSuggestions: document.querySelector("#searchSuggestions"),
  createTagForm: document.querySelector("#createTagForm"),
  createTagInput: document.querySelector("#createTagInput"),
  createTagButton: document.querySelector("#createTagButton"),
  createTagStatus: document.querySelector("#createTagStatus"),
  filters: document.querySelector("#tagFilters"),
  resultTitle: document.querySelector("#resultTitle"),
  resultMeta: document.querySelector("#resultMeta"),
  tableBody: document.querySelector("#tagTableBody"),
  empty: document.querySelector("#emptyState"),
  refresh: document.querySelector("#refreshButton"),
  editor: document.querySelector("#tagEditPanel"),
  editingName: document.querySelector("#editingBondName"),
  editOptions: document.querySelector("#editTagOptions"),
  primaryTagSelect: document.querySelector("#primaryTagSelect"),
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
  bulkActions: document.querySelector("#bulkTagActions"),
  selectionHeader: document.querySelector("#selectionHeader"),
  selectVisible: document.querySelector("#selectVisibleButton"),
  bulkSelectionCount: document.querySelector("#bulkSelectionCount"),
  bulkRemoveTag: document.querySelector("#bulkRemoveTagButton"),
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

function announceTagUpdate(reason, details = {}) {
  const rows = Array.isArray(details.rows)
    ? details.rows.map((row) => ({
        code: String(row.code || "").toUpperCase(),
        tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
        primaryTag: String(row.primaryTag || ""),
      })).filter((row) => row.code)
    : [];
  const message = {
    type: "finance:bond-tags-updated",
    version: Date.now(),
    reason: String(reason || "标签已更新"),
    codes: rows.map((row) => row.code),
    rows,
    ...(Array.isArray(details.tagOrder) ? { tagOrder: details.tagOrder.map(String) } : {}),
  };
  tagUpdateChannel?.postMessage(message);
  try {
    window.localStorage.setItem(TAG_UPDATE_STORAGE_KEY, JSON.stringify(message));
  } catch (_error) {
    // BroadcastChannel remains the primary live notification path.
  }
}

async function enrichSupplementalRows() {
  const rows = state.rows.filter((row) => row.supplemental && (
    !/^\d{6}\.(SH|SZ)$/.test(String(row.stockCode || ""))
    || !row.stockName || row.stockName === "待补正股"
  ));
  for (let index = 0; index < rows.length; index += 5) {
    const group = rows.slice(index, index + 5);
    const metadataRows = await Promise.all(group.map((row) =>
      fetchJson(`/api/miniqmt/bond-meta?code=${encodeURIComponent(row.code)}`, { timeout: 20000 })
        .catch(() => null)));
    metadataRows.forEach((metadata, metadataIndex) => {
      if (!metadata?.ok) return;
      const row = group[metadataIndex];
      if (metadata.name) row.name = String(metadata.name);
      if (metadata.stock_code) row.stockCode = String(metadata.stock_code).toUpperCase();
      if (metadata.stock_name) row.stockName = String(metadata.stock_name);
    });
    renderTable();
  }
}

function filteredRows() {
  const query = nodes.search.value.trim();
  return state.rows.filter((row) => {
    if (state.showUntagged && !rowIsUntagged(row)) return false;
    if (state.selectedTag && !(row.tags || []).includes(state.selectedTag)) return false;
    if (!query) return true;
    return searchMatchScore(row, query) < Number.POSITIVE_INFINITY;
  }).sort((left, right) => {
    const leftPrimary = state.selectedTag && left.primaryTag === state.selectedTag ? 1 : 0;
    const rightPrimary = state.selectedTag && right.primaryTag === state.selectedTag ? 1 : 0;
    const leftAmount = Number(state.quotes.get(left.code)?.amount) || 0;
    const rightAmount = Number(state.quotes.get(right.code)?.amount) || 0;
    return rightPrimary - leftPrimary || rightAmount - leftAmount || String(left.code).localeCompare(String(right.code));
  });
}

function rowIsUntagged(row) {
  return !(Array.isArray(row?.tags) && row.tags.some((tag) => {
    const normalized = String(tag || "").trim();
    return normalized && !ATTRIBUTE_TAGS.has(normalized);
  }));
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
  return [
    row.code,
    row.name,
    row.stockCode,
    row.stockName,
    row.industry1,
    row.industry2,
    row.industry3,
    ...(row.tags || []),
    ...(state.searchAliases.get(row.code) || []),
  ]
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
    .filter((row) => !options.untaggedOnly || rowIsUntagged(row))
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
  state.showUntagged = tag === FILTER_UNTAGGED;
  state.selectedTag = state.showUntagged ? "" : state.tagOrder.includes(tag) ? tag : "";
  state.selectedCodes.clear();
  const url = new URL(window.location.href);
  if (state.selectedTag) url.searchParams.set("tag", state.selectedTag);
  else url.searchParams.delete("tag");
  if (state.showUntagged) url.searchParams.set("filter", "untagged");
  else url.searchParams.delete("filter");
  window.history.replaceState(window.history.state, "", url);
  renderFilters();
  renderTable();
  renderQuickAdd();
}

function renderBulkActions(rows = filteredRows()) {
  const enabled = Boolean(state.selectedTag);
  nodes.bulkActions.hidden = !enabled;
  nodes.selectionHeader.hidden = !enabled;
  if (!enabled) {
    state.selectedCodes.clear();
  } else {
    const available = new Set(rows.map((row) => row.code));
    for (const code of state.selectedCodes) {
      if (!available.has(code)) state.selectedCodes.delete(code);
    }
  }
  nodes.bulkSelectionCount.textContent = `已选 ${state.selectedCodes.size} 只`;
  nodes.bulkRemoveTag.disabled = state.selectedCodes.size === 0 || state.bulkSaving;
  const allVisibleSelected = rows.length > 0 && rows.every((row) => state.selectedCodes.has(row.code));
  nodes.selectVisible.textContent = allVisibleSelected ? "取消全选" : "全选当前结果";
  nodes.bulkRemoveTag.textContent = state.bulkSaving
    ? "正在移除…"
    : `从“${state.selectedTag || "当前"}”移除`;
}

function renderFilters() {
  nodes.filters.replaceChildren();
  const untaggedCount = state.rows.filter(rowIsUntagged).length;
  const entries = [
    ["", "全部", state.rows.length],
    [FILTER_UNTAGGED, "未打标签", untaggedCount],
    ...state.tagOrder.map((tag) => [tag, tag, Number(state.tagCounts[tag]) || 0]),
  ];
  for (const [value, label, count] of entries) {
    const button = document.createElement("button");
    button.type = "button";
    const active = value === FILTER_UNTAGGED
      ? state.showUntagged
      : !state.showUntagged && state.selectedTag === value;
    button.classList.toggle("is-active", active);
    button.classList.toggle("is-untagged-filter", value === FILTER_UNTAGGED);
    button.setAttribute("aria-pressed", String(active));
    if (value === FILTER_UNTAGGED) {
      button.title = "只显示尚未设置题材标签的转债；次新债、小盘、ST 等系统属性不计";
    }
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
  const fragment = document.createDocumentFragment();
  nodes.allCount.textContent = String(state.rows.length);
  nodes.matchedCount.textContent = String(rows.length);
  nodes.tagCount.textContent = String(state.tagOrder.length);
  nodes.resultTitle.textContent = state.showUntagged
    ? "未打题材标签的转债"
    : state.selectedTag ? `${state.selectedTag} 标签` : "全部转债";
  nodes.resultMeta.textContent = state.showUntagged
    ? `共 ${rows.length} 只 · 次新债/小盘/ST 不算题材标签，保存题材标签后会自动移出`
    : state.selectedTag
    ? `共 ${rows.length} 只 · 主标签优先，其次按成交额排序`
    : `共 ${rows.length} 只 · 默认按成交额排序`;
  nodes.empty.hidden = rows.length > 0;
  renderBulkActions(rows);

  for (const row of rows) {
    const quote = state.quotes.get(row.code) || {};
    const tableRow = document.createElement("tr");
    tableRow.classList.toggle("is-selected", state.selectedCodes.has(row.code));

    if (state.selectedTag) {
      const selection = makeCell("selection-column");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selectedCodes.has(row.code);
      checkbox.setAttribute("aria-label", `选择 ${row.name}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.selectedCodes.add(row.code);
        else state.selectedCodes.delete(row.code);
        renderTable();
      });
      selection.append(checkbox);
      tableRow.append(selection);
    }

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
      const isPrimary = row.primaryTag === tag;
      tagButton.textContent = `${isPrimary ? "★ " : ""}${tag}`;
      tagButton.classList.toggle("is-primary-tag", isPrimary);
      tagButton.title = `只看“${tag}”标签`;
      tagButton.addEventListener("click", () => setSelectedTag(tag));
      tagWrap.append(tagButton);
    }
    if (!tagWrap.childElementCount) tagWrap.textContent = "未打标签";
    tags.append(tagWrap);

    const actions = makeCell();
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "edit-button";
    edit.textContent = "编辑标签";
    edit.addEventListener("click", () => openEditor(row));
    actions.append(edit);

    tableRow.append(bond, stock, industry, price, change, amount, tags, actions);
    fragment.append(tableRow);
  }
  nodes.tableBody.replaceChildren(fragment);
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
      if (!state.editDraft.has(state.editPrimaryTag)) state.editPrimaryTag = "";
      button.setAttribute("aria-pressed", String(state.editDraft.has(tag)));
      nodes.editStatus.textContent = "有未保存的修改";
      renderPrimaryTagOptions();
    });
    nodes.editOptions.append(button);
  }
}

function renderPrimaryTagOptions() {
  nodes.primaryTagSelect.replaceChildren();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "未设置主标签";
  nodes.primaryTagSelect.append(empty);
  for (const tag of state.tagOrder.filter((value) => state.editDraft.has(value))) {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = tag;
    option.selected = state.editPrimaryTag === tag;
    nodes.primaryTagSelect.append(option);
  }
  nodes.primaryTagSelect.value = state.editDraft.has(state.editPrimaryTag)
    ? state.editPrimaryTag
    : "";
}

function openEditor(row) {
  state.editingRow = row;
  state.editDraft = new Set(row.tags || []);
  state.editPrimaryTag = state.editDraft.has(row.primaryTag) ? row.primaryTag : "";
  nodes.editingName.textContent = `${row.name} ${row.code}`;
  nodes.editStatus.textContent = "点击标签可选中或取消";
  renderEditOptions();
  renderPrimaryTagOptions();
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

async function createTag(event) {
  event.preventDefault();
  if (state.tagCreating) return;
  const tag = nodes.createTagInput.value.trim();
  if (!tag) {
    nodes.createTagStatus.textContent = "请先输入标签名称";
    nodes.createTagInput.focus();
    return;
  }
  if (state.tagOrder.includes(tag)) {
    nodes.createTagStatus.textContent = `标签“${tag}”已存在`;
    return;
  }
  state.tagCreating = true;
  nodes.createTagButton.disabled = true;
  nodes.createTagStatus.textContent = "正在新增…";
  try {
    const payload = await fetchJson("/api/miniqmt/tags", {
      method: "POST",
      body: { createTag: tag },
    });
    state.tagOrder = payload.tagOrder || [...state.tagOrder, tag];
    state.tagCounts = payload.tagCounts || { ...state.tagCounts, [tag]: 0 };
    nodes.createTagInput.value = "";
    nodes.createTagStatus.textContent = `已新增“${tag}”，可在编辑标签时直接选用`;
    announceTagUpdate("新增标签", { tagOrder: payload.tagOrder || state.tagOrder });
    renderFilters();
    renderTable();
    if (state.editingRow) {
      renderEditOptions();
      renderPrimaryTagOptions();
    }
    setSelectedTag(tag);
  } catch (error) {
    nodes.createTagStatus.textContent = error.message || "新增标签失败";
  } finally {
    state.tagCreating = false;
    nodes.createTagButton.disabled = false;
  }
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
    row.primaryTag = payload.primaryTag || "";
    announceTagUpdate("快捷添加标签", { rows: [row] });
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
        primaryTag: state.editPrimaryTag,
      },
    });
    state.editingRow.tags = payload.tags || [];
    state.editingRow.primaryTag = payload.primaryTag || "";
    announceTagUpdate("保存转债标签", { rows: [state.editingRow] });
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

async function removeSelectedTag() {
  const codes = [...state.selectedCodes];
  const tag = state.selectedTag;
  if (!codes.length || !tag || state.bulkSaving) return;
  if (!window.confirm(`确定从 ${codes.length} 只转债中移除“${tag}”标签吗？`)) return;
  state.bulkSaving = true;
  renderBulkActions();
  try {
    const payload = await fetchJson("/api/miniqmt/tags", {
      method: "POST",
      timeout: 30000,
      body: { codes, removeTag: tag },
    });
    const updated = new Map((payload.rows || []).map((row) => [row.code, row]));
    for (const row of state.rows) {
      const next = updated.get(row.code);
      if (!next) continue;
      row.tags = next.tags || [];
      row.primaryTag = next.primaryTag || "";
    }
    state.selectedCodes.clear();
    announceTagUpdate("批量移除标签", { rows: payload.rows || [] });
    recalculateCounts();
    renderFilters();
    renderTable();
    renderQuickAdd();
    nodes.status.textContent = `已从 ${payload.updated || codes.length} 只转债移除“${tag}”`;
  } catch (error) {
    nodes.status.textContent = `批量移除失败：${error.message}`;
  } finally {
    state.bulkSaving = false;
    renderBulkActions();
  }
}

async function loadQuotes() {
  if (state.quotesLoading || !state.rows.length) return;
  state.quotesLoading = true;
  nodes.refresh.disabled = true;
  nodes.quoteStatus.textContent = "正在后台刷新 QMT 行情，可继续编辑标签…";
  try {
    const query = new URLSearchParams({ codes: state.rows.map((row) => row.code).join(",") });
    const payload = await fetchJson(`/api/miniqmt/quotes?${query}`, { timeout: 30000 });
    state.quotes = new Map((payload.quotes || []).map((quote) => [quote.monitor_code, quote]));
    nodes.quoteStatus.textContent = `${payload.source || "QMT"} · ${String(payload.generated_at || "").replace("T", " ")}`;
    renderTable();
  } catch (error) {
    nodes.quoteStatus.textContent = `行情暂不可用，标签仍可编辑${state.quotes.size ? "；保留上次行情" : ""}：${error.message}`;
  } finally {
    state.quotesLoading = false;
    nodes.refresh.disabled = false;
  }
}

async function loadSearchAliases() {
  try {
    const payload = await fetchJson("./data/convertible-bond-search-aliases.json", { timeout: 20000 });
    state.searchAliases = new Map(Object.entries(payload.aliases || {}));
    if (nodes.search.value.trim()) renderTable();
  } catch (_error) {
    // Names and codes remain searchable without the optional alias index.
  }
}

async function initialize() {
  nodes.refresh.disabled = true;
  void loadSearchAliases();
  try {
    const payload = await fetchJson("/api/miniqmt/tags", { timeout: 20000 });
    state.rows = payload.rows || [];
    state.tagOrder = payload.tagOrder || [];
    state.tagCounts = payload.tagCounts || {};
    if (!state.tagOrder.includes(state.selectedTag)) state.selectedTag = "";
    renderFilters();
    renderTable();
    renderQuickAdd();
    nodes.status.textContent = `标签已就绪 · ${state.rows.length} 只转债，可直接编辑`;
    nodes.refresh.disabled = false;
    void loadQuotes();
    void enrichSupplementalRows();
  } catch (error) {
    nodes.status.textContent = `标签读取失败：${error.message}`;
    nodes.quoteStatus.textContent = "标签尚未就绪，未请求行情";
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
    { preferredTag: state.selectedTag, untaggedOnly: state.showUntagged },
  );
});
nodes.search.addEventListener("focus", () => {
  renderSuggestions(
    nodes.searchSuggestions,
    nodes.search.value,
    selectTopSearchRow,
    { preferredTag: state.selectedTag, untaggedOnly: state.showUntagged },
  );
});
nodes.search.addEventListener("keydown", (event) => {
  if (event.key === "Escape") nodes.searchSuggestions.hidden = true;
  if (event.key === "Enter") {
    const first = suggestedRows(nodes.search.value, {
      preferredTag: state.selectedTag,
      untaggedOnly: state.showUntagged,
    })[0];
    if (!first) return;
    event.preventDefault();
    selectTopSearchRow(first);
  }
});
nodes.refresh.addEventListener("click", loadQuotes);
nodes.createTagForm.addEventListener("submit", createTag);
nodes.closeEditor.addEventListener("click", closeEditor);
nodes.cancelEdit.addEventListener("click", closeEditor);
nodes.saveEdit.addEventListener("click", saveEditor);
nodes.primaryTagSelect.addEventListener("change", (event) => {
  state.editPrimaryTag = state.editDraft.has(event.target.value) ? event.target.value : "";
  nodes.editStatus.textContent = "有未保存的修改";
});
nodes.selectVisible.addEventListener("click", () => {
  const rows = filteredRows();
  const allSelected = rows.length > 0 && rows.every((row) => state.selectedCodes.has(row.code));
  if (allSelected) rows.forEach((row) => state.selectedCodes.delete(row.code));
  else rows.forEach((row) => state.selectedCodes.add(row.code));
  renderTable();
});
nodes.bulkRemoveTag.addEventListener("click", removeSelectedTag);
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
