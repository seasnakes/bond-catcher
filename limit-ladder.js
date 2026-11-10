(() => {
  const { percent, summarize, buildGroups } = window.LimitLadder;
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const tone = (value) => value > 0 ? "up" : value < 0 ? "down" : "flat";
  const statusText = (stock) => stock.status === "auction_final" ? "09:25 竞价结果" : stock.status === "auction" ? "竞价指示报价" : stock.status === "tracking" ? "盘中报价 · 晋级待确认" : stock.status === "pending" ? "等待当日报价" : stock.status === "limit_up" ? stock.oneWord ? "一字涨停" : "涨停" : stock.status === "broken" ? "炸板" : "未触板断板";
  let data = null;
  let view = "promotion";
  let selectedDate = "";
  let dataKey = null;
  let generation = 0;
  let controller = null;
  let timer = null;
  let lastError = "";
  let dialogSymbol = null;
  const expanded = new Set();
  const chinaDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const localTime = (iso) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  $("dateInput").max = chinaDate();

  function renderMetrics() {
    const live = !!data?.live;
    const ids = ["heightMetric", "consecutiveMetric", "limitMetric", "promotionMetric", "performanceMetric"];
    const labels = live ? ["昨日最高连板", "昨日涨停候选", "同日报价覆盖", "竞价 / 盘中上涨", "昨日连板表现"] : ["最高连板", "连板家数", "涨停 / 炸板", "昨日涨停晋级率", "昨日连板表现"];
    ids.forEach((id, i) => { $(id).previousElementSibling.textContent = labels[i]; });
    if (!data || !data.stocks.length) {
      for (const id of ["heightMetric", "consecutiveMetric", "limitMetric", "promotionMetric", "performanceMetric"]) { $(id).textContent = "—"; $(id).className = ""; }
      $("leaderMetric").textContent = "暂无数据";
      $("promotionDenominator").textContent = "—";
      return;
    }
    if (live) {
      const max = Math.max(0, ...data.stocks.map((s) => s.previousBoards));
      const current = data.stocks.filter((s) => Number.isFinite(s.changePct));
      const high = current.filter((s) => s.previousBoards >= 2);
      $("heightMetric").innerHTML = `${max}<em>板</em>`;
      $("heightMetric").className = "up";
      $("leaderMetric").textContent = data.stocks.filter((s) => s.previousBoards === max).map((s) => s.name).join(" · ");
      $("consecutiveMetric").innerHTML = `${data.stocks.length}<em>只</em>`;
      $("consecutiveMetric").nextElementSibling.textContent = `梯队基准 ${data.baseDate}`;
      $("limitMetric").textContent = `${data.covered} / ${data.stocks.length}`;
      $("limitMetric").nextElementSibling.textContent = `${data.fresh} 只报价未延迟`;
      $("promotionMetric").textContent = `${current.filter((s) => s.changePct > 0).length} ↑ / ${current.filter((s) => s.changePct < 0).length} ↓`;
      $("promotionDenominator").textContent = "竞价涨幅不等于已晋级";
      const avg = high.length ? high.reduce((n, s) => n + s.changePct, 0) / high.length : null;
      $("performanceMetric").textContent = percent(avg);
      $("performanceMetric").className = tone(avg);
      return;
    }
    $("consecutiveMetric").nextElementSibling.textContent = "实际 2 板及以上";
    $("limitMetric").nextElementSibling.textContent = "含首板";
    const s = summarize(data.stocks);
    $("heightMetric").innerHTML = `${s.height}<em>板</em>`;
    $("heightMetric").className = "up";
    $("leaderMetric").textContent = s.leaders.join(" · ") || "无涨停";
    $("leaderMetric").title = s.leaders.join(" · ");
    $("consecutiveMetric").innerHTML = `${s.consecutive}<em>只</em>`;
    $("limitMetric").innerHTML = `<span class="up">${s.limits}</span><em>/</em> ${s.broken}`;
    $("promotionMetric").textContent = s.promotionRate === null ? "—" : `${s.promotionRate.toFixed(1)}%`;
    $("promotionDenominator").textContent = `${s.promoted} 晋级 / ${s.candidates} 昨日涨停候选`;
    $("performanceMetric").textContent = percent(s.priorLeaderChange);
    $("performanceMetric").className = tone(s.priorLeaderChange);
  }

  function chip(stock) {
    const flag = stock.quoteStale ? "迟" : stock.status === "auction_final" ? "定" : stock.status === "auction" ? "竞" : stock.status === "tracking" ? "盘" : stock.status === "pending" ? "待" : stock.status === "limit_up" ? stock.oneWord ? "一" : "涨" : stock.status === "broken" ? "炸" : "断";
    const code = data.live || $("detailToggle").checked ? `<span class="stock-code">${$("detailToggle").checked ? `${escape(stock.symbol)}${data.live ? " · " : ""}` : ""}${data.live ? `行情 ${escape(stock.quoteTime || "暂无当日报价")}${stock.quoteStale ? " · 延迟" : ""}` : ""}</span>` : "";
    const title = `${stock.name} ${stock.symbol} · ${percent(stock.changePct)} · ${statusText(stock)} · 昨${stock.previousBoards}板 → 目标${stock.targetBoards}板 · ${data.asOf}`;
    return `<button class="stock-chip ${stock.status}" type="button" data-symbol="${escape(stock.symbol)}" title="${escape(title)}" aria-label="${escape(title)}"><span class="stock-name">${escape(stock.name)}</span><span class="stock-pct ${tone(stock.changePct)}">${percent(stock.changePct)}</span><span class="stock-flag" aria-hidden="true">${flag}</span>${code}</button>`;
  }

  function render() {
    renderMetrics();
    const notice = lastError || (data?.refreshFailed ? "来源刷新失败，当前保留上次快照；数据日期与获取时间见下方。" : "");
    $("notice").textContent = notice;
    $("notice").hidden = !notice;
    $("statusFilter").disabled = view === "height" || !!data?.live;
    $("statusFilter").hidden = !!data?.live;
    $("latestButton").setAttribute("aria-pressed", String(!selectedDate));
    document.querySelector('.overview-label small').textContent = data?.live ? "昨日涨停跟踪池" : "所选日全池";
    document.querySelector('.legend').innerHTML = data?.live
      ? '<span><i class="limit-dot"></i>竞 / 定 / 盘</span><span><i class="broken-dot"></i>迟：延迟</span><span><i class="failed-dot"></i>待：缺报价</span>'
      : '<span><i class="limit-dot"></i>涨停</span><span><i class="broken-dot"></i>炸板</span><span><i class="failed-dot"></i>断板</span>';
    document.querySelector('[data-view="promotion"]').textContent = data?.live ? "实时晋级跟踪" : "今昨晋级";
    document.querySelector('[data-view="height"]').textContent = data?.live ? "昨日高度" : "今日高度";
    $("viewHint").textContent = data?.live ? `${data.phaseLabel} · 昨日梯队固定，涨幅每${(data.refreshIntervalMs || 3000) / 1000}秒刷新；${data.phase === "auction_final" ? "09:25结果保留至开盘。" : "今日晋级待确认。"}` : view === "promotion"
      ? "左侧看晋级目标，同一梯队按涨停 → 炸板 → 断板排列，组内涨幅降序。"
      : "仅显示今日实际涨停高度；没有股票的中间板高合并为空档提示。";
    if (!data) {
      $("ladderContent").innerHTML = '<div class="empty-state"><strong>暂时无法读取连板天梯</strong>涨停池暂不可用，请稍后刷新。</div>';
      $("visibleCount").textContent = "暂无快照";
      $("dataStatus").textContent = "来源：东方财富涨停池 · 数据暂不可用";
      return;
    }
    const options = { view, live: !!data.live, search: $("searchInput").value, status: view === "height" || data.live ? "all" : $("statusFilter").value, hideSt: $("hideSt").checked };
    const groups = buildGroups(data.stocks, options);
    const filtered = !!options.search.trim() || options.status !== "all" || options.hideSt;
    let visible = 0;
    let matches = 0;
    let previousHeight = null;
    const focusedSymbol = document.activeElement?.dataset?.symbol;
    const html = groups.map((group) => {
      matches += group.stocks.length;
      const isFirst = group.boards === 1;
      const isFirstBroken = group.key === "first-broken";
      const limit = !data.live && !filtered && isFirst && !expanded.has(group.key) ? isFirstBroken ? 0 : 12 : group.stocks.length;
      const shown = group.stocks.slice(0, limit);
      visible += shown.length;
      const rate = group.all.length ? group.promoted / group.all.length * 100 : 0;
      let gap = "";
      if (view === "height" && !filtered && previousHeight !== null && previousHeight - group.boards > 1) {
        const levels = Array.from({ length: Math.min(50, previousHeight - group.boards - 1) }, (_, i) => previousHeight - i - 1);
        gap = `<div class="empty-gap">${levels.join(" / ")} 板空档</div>`;
      }
      previousHeight = group.boards;
      const title = isFirst
        ? `<strong>${isFirstBroken ? "首炸" : "首板"}</strong>`
        : view === "promotion"
          ? `<strong>${group.boards - 1}</strong><span class="arrow">→</span><strong class="target">${group.boards}</strong><small>板</small>`
          : `<strong class="target">${group.boards}</strong><small>板</small>`;
      const sub = data.live ? `${group.all.length} 只 · ${data.phase === "auction" ? "竞价中" : "跟踪中"}` : isFirst ? `${group.all.length} 只${isFirstBroken ? "摸板未封" : "新晋涨停"}` : view === "promotion" ? `<b>${group.promoted}</b> / ${group.all.length} 晋级` : `${group.all.length} 只涨停`;
      const rateHtml = !data.live && !isFirst && view === "promotion" ? `<span class="tier-rate" title="晋级率 ${rate.toFixed(1)}%">${rate.toFixed(0)}%</span>` : "";
      let expand = "";
      if (!data.live && !filtered && isFirst && (group.stocks.length > 12 || isFirstBroken)) {
        expand = `<button class="tier-expand" type="button" data-expand="${group.key}" aria-expanded="${expanded.has(group.key)}">${expanded.has(group.key) ? "收起 ↑" : isFirstBroken ? `展开 ${group.stocks.length} 只首板炸板 ↓` : `展开其余 ${group.stocks.length - shown.length} 只 ↓`}</button>`;
      }
      return `${gap}<section class="tier ${isFirst ? "first-tier" : ""}" aria-label="${isFirst ? isFirstBroken ? "首板炸板" : "首板" : view === "promotion" ? `${group.boards - 1}进${group.boards}` : `${group.boards}板`}"><div class="tier-label"><div class="tier-title">${title}</div><span class="tier-detail"><span class="tier-sub">${sub}</span>${rateHtml}</span></div><div class="tier-cells"><div class="stock-grid">${shown.map(chip).join("")}</div>${expand}</div></section>`;
    }).join("");
    $("ladderContent").innerHTML = html || `<div class="empty-state"><strong>${data.stocks.length ? "没有符合条件的股票" : `${escape(data.asOf)} 暂无连板数据`}</strong>${data.stocks.length ? "调整搜索词或筛选条件后再试。" : "可选择其他日期，或点击“实时”跟踪昨日涨停池。"}</div>`;
    if (focusedSymbol) [...document.querySelectorAll("[data-symbol]")].find((el) => el.dataset.symbol === focusedSymbol)?.focus({ preventScroll: true });
    $("visibleCount").textContent = `显示 ${visible} / ${matches} 只${visible < matches ? " · 首板已折叠" : ""}`;
    const precision = data.sealedReady ? "封单信息已就绪" : "未提供五档封单确认";
    $("dataStatus").textContent = `来源：${data.source} · 数据 ${data.asOf} · 获取 ${localTime(data.fetchedAt)} · 行情时间未提供 · ${precision}${!selectedDate ? " · 每30秒检查更新" : ""}`;
    if (data.live) $("dataStatus").textContent = `${data.source} · 今日 ${data.asOf} · 昨日底表 ${data.baseDate} · 行情 ${data.oldestQuoteTime || "—"}～${data.quoteTime || "—"} · 获取 ${localTime(data.fetchedAt)} · 每${(data.refreshIntervalMs || 3000) / 1000}秒刷新`;
    if (dialogSymbol && $("stockDialog").open) showStock(dialogSymbol);
  }

  async function refresh() {
    const startedAt = Date.now();
    clearTimeout(timer);
    controller?.abort();
    controller = new AbortController();
    const currentController = controller;
    const current = ++generation;
    const key = selectedDate;
    const switched = dataKey !== key;
    lastError = "";
    if (switched) {
      data = null;
      $("stockDialog").close();
      renderMetrics();
      $("ladderContent").innerHTML = '<div class="empty-state">正在读取所选日期…</div>';
      $("visibleCount").textContent = "读取中";
      $("dataStatus").textContent = key ? "正在读取 东方财富涨停池 历史快照…" : "正在读取昨日梯队与 QMT 当日报价…";
      $("notice").hidden = true;
    }
    $("ladderContent").setAttribute("aria-busy", "true");
    $("refreshButton").disabled = true;
    $("refreshButton").textContent = "读取中…";
    const timeout = setTimeout(() => currentController.abort(), 12_000);
    try {
      const response = await fetch(`/api/limit-ladder${key ? `?date=${encodeURIComponent(key)}` : "/live"}`, { signal: currentController.signal, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "连板数据暂不可用");
      if (!Array.isArray(payload.stocks) || !payload.asOf || (key && payload.asOf !== key)) throw new Error("连板数据日期不一致");
      if (current !== generation) return;
      data = payload;
      dataKey = key;
      $("dateInput").value = payload.asOf;
      render();
    } catch (error) {
      if (current !== generation) return;
      lastError = `${error.name === "AbortError" ? "读取超时，请重试" : error.message}${data ? "；当前保留上次快照。" : ""}`;
      if (data?.live) data = { ...data, refreshFailed: true, fresh: 0, stocks: data.stocks.map((s) => ({ ...s, quoteStale: !!s.quoteTime })) };
      render();
    } finally {
      clearTimeout(timeout);
      if (current === generation) {
        $("ladderContent").setAttribute("aria-busy", "false");
        $("refreshButton").disabled = false;
        $("refreshButton").textContent = "↻ 刷新";
        if (!document.hidden && !selectedDate) timer = setTimeout(refresh, Math.max(500, (data?.refreshIntervalMs || 3000) - (Date.now() - startedAt)));
      }
    }
  }

  function showStock(symbol) {
    const stock = data?.stocks.find((s) => s.symbol === symbol);
    if (!stock) return;
    dialogSymbol = symbol;
    $("stockDialogTitle").textContent = stock.name;
    $("dialogCode").textContent = `${stock.symbol} · ${data.asOf}`;
    const values = [
      ["当日状态", statusText(stock)], ["实际连板", data.live ? "待确认" : stock.actualBoards ? `${stock.actualBoards} 板` : "未晋级"],
      ["昨日高度", stock.previousBoards ? `${stock.previousBoards} 板` : "非涨停"], ["今日目标", `${stock.targetBoards} 板`],
    ];
    const stale = lastError || data.refreshFailed ? "刷新失败，以下为上次快照。" : "";
    $("dialogContent").innerHTML = `<div class="dialog-quote"><strong class="${tone(stock.changePct)}">${percent(stock.changePct)}</strong></div><dl class="dialog-data">${values.map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl><p class="dialog-note">${escape(stale)}数据日 ${escape(data.asOf)} · ${escape(data.source)}<br>获取 ${localTime(data.fetchedAt)}；来源未提供精确行情时间。${stock.sealedStatus === "real" ? "来源已确认封单。" : "未确认五档封单。"}</p>`;
    if (data.live) {
      const price = document.createElement('span');
      price.textContent = stock.price === null ? "暂无当日报价" : `${stock.price.toFixed(2)} 元`;
      $("dialogContent").querySelector('.dialog-quote').append(price);
      $("dialogContent").querySelector('.dialog-note').textContent = `${stale}今日 ${data.asOf} · ${stock.quoteSource} · 行情 ${stock.quoteTime || "暂无"} · 获取 ${localTime(data.fetchedAt)}。昨日梯队 ${data.baseDate}。${stock.quoteStale ? "报价延迟。" : ""}`;
    }
    if (!$("stockDialog").open) $("stockDialog").showModal();
  }

  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
    view = button.dataset.view;
    document.querySelectorAll("[data-view]").forEach((tab) => tab.setAttribute("aria-pressed", String(tab === button)));
    expanded.clear();
    render();
  }));
  for (const id of ["searchInput", "statusFilter", "hideSt", "detailToggle"]) $(id).addEventListener(id === "searchInput" ? "input" : "change", render);
  $("dateInput").addEventListener("change", () => {
    if (!$("dateInput").checkValidity()) return;
    selectedDate = $("dateInput").value === chinaDate() ? "" : $("dateInput").value;
    expanded.clear();
    void refresh();
  });
  $("latestButton").addEventListener("click", () => { selectedDate = ""; expanded.clear(); void refresh(); });
  $("refreshButton").addEventListener("click", () => void refresh());
  $("ladderContent").addEventListener("click", (event) => {
    const expand = event.target.closest("[data-expand]");
    if (expand) { const key = expand.dataset.expand; expanded.has(key) ? expanded.delete(key) : expanded.add(key); render(); return; }
    const button = event.target.closest("[data-symbol]");
    if (button) showStock(button.dataset.symbol);
  });
  $("dialogClose").addEventListener("click", () => $("stockDialog").close());
  $("stockDialog").addEventListener("click", (event) => { if (event.target === $("stockDialog")) { const rect = $("stockDialog").getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $("stockDialog").close(); } });
  document.addEventListener("visibilitychange", () => { clearTimeout(timer); if (!document.hidden && !selectedDate) void refresh(); });
  window.addEventListener("pagehide", () => { clearTimeout(timer); controller?.abort(); });
  void refresh();
})();
