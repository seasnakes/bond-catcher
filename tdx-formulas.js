"use strict";

const runSummary = document.querySelector("#runSummary");
const runMeta = document.querySelector("#runMeta");
const formulaGrid = document.querySelector("#formulaGrid");
const formulaSearch = document.querySelector("#formulaSearch");
const refreshButton = document.querySelector("#refreshFormulaResults");
let snapshot = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  if (!value) return "尚未运行";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function statusText(status) {
  return ({ complete: "已完成", running: "运行中", failed: "失败", partial: "部分完成", pending: "等待中" })[status] || "未运行";
}

function render() {
  if (!snapshot?.exists) {
    runSummary.textContent = "还没有公式选股快照，请先运行一次数据更新。";
    runMeta.innerHTML = "";
    formulaGrid.innerHTML = '<div class="empty-state">暂无结果。运行项目里的“通达信公式选股”更新后，这里会显示单针、异动和 ZX 的命中转债。</div>';
    return;
  }

  const query = formulaSearch.value.trim().toLowerCase();
  runSummary.textContent = `${statusText(snapshot.status)} · 数据更新于 ${formatDateTime(snapshot.updatedAt)}`;
  runMeta.innerHTML = [
    ["数据来源", snapshot.source?.system || "通达信 TQ"],
    ["选股范围", `${snapshot.universe?.label || "可转债"} ${snapshot.universe?.count || 0} 只`],
    ["K线口径", `${snapshot.settings?.period || "1d"} · 前复权 · ${snapshot.settings?.historyCount || "-"} 根`],
    ["运行状态", statusText(snapshot.status)],
  ].map(([label, value]) => `<article class="meta-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");

  formulaGrid.innerHTML = (snapshot.formulas || []).map((formula) => {
    const selected = (formula.selected || []).filter((row) => !query
      || String(row.name || "").toLowerCase().includes(query)
      || String(row.code || "").toLowerCase().includes(query));
    const rows = selected.length
      ? selected.map((row) => `
          <div class="stock-row">
            <div class="stock-name"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.code)}</span></div>
            <span class="stock-date">${escapeHtml(row.date || formula.asOf || "")}</span>
          </div>`).join("")
      : `<div class="card-empty">${query ? "没有匹配转债" : "本次没有命中"}</div>`;
    return `
      <article class="formula-card">
        <header>
          <div class="formula-title"><strong>${escapeHtml(formula.code)}</strong><small>${escapeHtml(formula.lineNames?.join(", ") || "条件选股")}</small></div>
          <span class="status-pill status-${escapeHtml(formula.status)}">${statusText(formula.status)}</span>
        </header>
        <div class="formula-stats">
          <div class="formula-stat"><span>命中</span><strong>${formula.selectedCount || 0}</strong></div>
          <div class="formula-stat"><span>有效覆盖</span><strong>${formula.returnedCount || 0}/${snapshot.universe?.count || 0}</strong></div>
          <div class="formula-stat"><span>交易日</span><strong>${escapeHtml(formula.asOf || "-")}</strong></div>
        </div>
        <div class="stock-list">${rows}</div>
      </article>`;
  }).join("");
}

async function loadSnapshot() {
  refreshButton.disabled = true;
  try {
    const response = await fetch("/api/tdx-formula-selections", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    snapshot = await response.json();
    render();
  } catch (error) {
    runSummary.textContent = `读取失败：${error.message}`;
    formulaGrid.innerHTML = '<div class="empty-state">暂时无法读取公式选股结果。</div>';
  } finally {
    refreshButton.disabled = false;
  }
}

formulaSearch.addEventListener("input", render);
refreshButton.addEventListener("click", loadSnapshot);
loadSnapshot();
setInterval(() => {
  if (snapshot?.status === "running") loadSnapshot();
}, 15000);
