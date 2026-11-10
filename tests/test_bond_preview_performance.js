const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const APP_SOURCE = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const STYLE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing source markers: ${startMarker}`);
  return APP_SOURCE.slice(start, end);
}

function fakeElement({ hidden = false } = {}) {
  const attributes = new Map();
  const attributeWrites = [];
  return {
    hidden,
    title: "",
    textContent: "",
    dataset: {},
    attributeWrites,
    classList: { add() {}, remove() {}, toggle() {} },
    contentWindow: {
      messages: [],
      postMessage(message, origin) {
        this.messages.push({ message, origin });
      },
    },
    getAttribute(name) {
      return attributes.get(name) || null;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
      attributeWrites.push([name, String(value)]);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
  };
}

function previewContext() {
  const bondMarketPreview = fakeElement({ hidden: true });
  const bondOverlay = fakeElement({ hidden: true });
  const bondMarketPreviewFrame = fakeElement();
  const bondOverlayFrame = fakeElement();
  const bondPreviewLoading = fakeElement({ hidden: true });
  const bondPreviewLoadingTitle = fakeElement();
  const bondPreviewLoadingHint = fakeElement();
  const externalMarketGrid = fakeElement();
  const bondPreviewReset = fakeElement({ hidden: true });
  const refreshButton = { disabled: true };
  const state = {
    bondPreviewCode: "",
    bondPreviewUrl: "",
    boardUpdatesPaused: false,
    boardRenderPending: false,
    quoteRequestId: 4,
    bondQuoteRequestId: 7,
    loading: true,
    bondLoading: true,
    mainRefreshTimer: 21,
    bondRefreshTimer: 22,
  };
  const calls = { refresh: 0, mainSchedule: 0, bondSchedule: 0, status: 0 };
  const window = {
    location: {
      href: "http://127.0.0.1:5173/index.html",
      origin: "http://127.0.0.1:5173",
      pathname: "/index.html",
      search: "",
    },
    history: {
      state: {},
      pushState() {},
      replaceState() {},
    },
    requestAnimationFrame(callback) {
      callback();
    },
    clearTimeout() {},
  };
  const context = vm.createContext({
    URL,
    console: { warn() {} },
    document: { hidden: false, body: { classList: fakeElement().classList } },
    window,
    state,
    bondMarketPreview,
    bondMarketPreviewFrame,
    bondPreviewLoading,
    bondPreviewLoadingTitle,
    bondPreviewLoadingHint,
    bondPreviewReset,
    bondOverlay,
    bondOverlayFrame,
    externalMarketGrid,
    tvMarketPanel: { open: false },
    marketPanelTitle: fakeElement(),
    marketPanelSubtitle: fakeElement(),
    marketMonitorRow: fakeElement(),
    refreshButton,
    panelBondUrl(raw) {
      const target = new URL(raw);
      target.searchParams.set("embedded", "1");
      target.searchParams.set("panel", "1");
      return target.href;
    },
    embeddedBondUrl: (raw) => raw,
    updateStatus() { calls.status += 1; },
    scheduleMainRefresh() { calls.mainSchedule += 1; },
    scheduleBondRefresh() { calls.bondSchedule += 1; },
    refreshQuotes() { calls.refresh += 1; return Promise.resolve(); },
    renderAfterBackgroundUpdate() {},
    saveBoardViewState() {},
    restoreBoardViewport() {},
    restoreBoardViewState() { return null; },
  });
  vm.runInContext(
    sourceBetween("function hasActiveBoardPause()", "\nfunction saveBoardViewState()"),
    context,
  );
  return {
    context,
    calls,
    state,
    bondMarketPreview,
    bondMarketPreviewFrame,
    bondPreviewLoading,
    bondPreviewLoadingTitle,
    bondPreviewLoadingHint,
    bondOverlay,
  };
}

test("bond preview preserves the monitor height so board targets do not move", () => {
  const previewRule = STYLE_SOURCE.match(/\.bond-market-preview\s*\{(?<body>[^}]+)\}/)?.groups?.body || "";

  assert.match(
    previewRule,
    /height:\s*calc\(var\(--market-panel-body-height,\s*176px\)\s*\+\s*31px\)/,
  );
  assert.doesNotMatch(STYLE_SOURCE, /\.market-monitor-row\.is-bond-preview\s+\.signal-feed/);
});

test("preview paints a loading shell immediately and keeps the board live", () => {
  const fixture = previewContext();
  fixture.context.showBondMarketPreview("./bond.html?code=123065&name=宝莱转债");

  assert.equal(fixture.bondMarketPreview.hidden, false);
  assert.equal(fixture.bondPreviewLoading.hidden, false);
  assert.equal(fixture.state.boardUpdatesPaused, false);
  assert.equal(fixture.state.quoteRequestId, 4);
  assert.equal(fixture.state.bondQuoteRequestId, 7);
  assert.match(fixture.bondMarketPreviewFrame.getAttribute("src"), /code=123065/);
  assert.equal(fixture.calls.refresh, 0);
});

test("only the requested iframe load clears the shell and marks it reusable", () => {
  const fixture = previewContext();
  fixture.context.showBondMarketPreview("./bond.html?code=123065&name=宝莱转债");
  const requested = fixture.bondMarketPreviewFrame.dataset.requestedUrl;

  fixture.bondMarketPreviewFrame.setAttribute("src", `${requested}&stale=1`);
  fixture.context.handleBondPreviewLoad();
  assert.equal(fixture.bondPreviewLoading.hidden, false);
  assert.equal(fixture.bondMarketPreviewFrame.dataset.loadedUrl, undefined);

  fixture.bondMarketPreviewFrame.setAttribute("src", requested);
  fixture.context.handleBondPreviewLoad();
  assert.equal(fixture.bondPreviewLoading.hidden, true);
  assert.equal(fixture.bondMarketPreviewFrame.dataset.loadedUrl, requested);
  assert.equal(
    fixture.bondMarketPreviewFrame.contentWindow.messages.at(-1).message.active,
    true,
  );
});

test("iframe error leaves a retry affordance and a repeated click retries", () => {
  const fixture = previewContext();
  fixture.context.showBondMarketPreview("./bond.html?code=123065&name=宝莱转债");
  fixture.bondMarketPreviewFrame.dataset.loadedUrl =
    fixture.bondMarketPreviewFrame.dataset.requestedUrl;
  const writesBefore = fixture.bondMarketPreviewFrame.attributeWrites.length;

  fixture.context.handleBondPreviewError();
  assert.equal(fixture.bondPreviewLoading.hidden, false);
  assert.equal(fixture.bondMarketPreviewFrame.dataset.loadedUrl, undefined);
  assert.match(fixture.bondPreviewLoadingHint.textContent, /再次点击/);

  fixture.context.showBondMarketPreview("./bond.html?code=123065&name=宝莱转债");
  assert.ok(fixture.bondMarketPreviewFrame.attributeWrites.length > writesBefore);
});

test("closing preview preserves the iframe without restarting the live board", () => {
  const fixture = previewContext();
  fixture.context.showBondMarketPreview("./bond.html?code=123065&name=宝莱转债");
  const source = fixture.bondMarketPreviewFrame.getAttribute("src");
  fixture.bondMarketPreviewFrame.dataset.loadedUrl = source;
  fixture.context.showExternalMarkets();

  assert.equal(fixture.bondMarketPreview.hidden, true);
  assert.equal(fixture.bondMarketPreviewFrame.getAttribute("src"), source);
  assert.equal(fixture.state.boardUpdatesPaused, false);
  assert.equal(fixture.calls.refresh, 0);

  const writesBefore = fixture.bondMarketPreviewFrame.attributeWrites.length;
  fixture.context.showBondMarketPreview("./bond.html?code=123065&name=宝莱转债");
  assert.equal(fixture.bondMarketPreviewFrame.attributeWrites.length, writesBefore);
  assert.equal(fixture.bondPreviewLoading.hidden, true);
});

test("only the overlay pauses the board and resumes after it closes", () => {
  const fixture = previewContext();
  const url = "./bond.html?code=123065&name=宝莱转债";
  fixture.context.showBondMarketPreview(url);
  fixture.context.showBondOverlay(url, false);
  fixture.context.showExternalMarkets();
  assert.equal(fixture.calls.refresh, 0);
  assert.equal(fixture.state.boardUpdatesPaused, true);

  fixture.context.hideBondOverlay();
  assert.equal(fixture.calls.refresh, 1);
  assert.equal(fixture.state.boardUpdatesPaused, false);
});

test("background renders are coalesced while the overlay is active", () => {
  const state = { boardUpdatesPaused: true, boardRenderPending: false, needsRenderAfterRename: false };
  let renders = 0;
  const context = vm.createContext({
    state,
    isRenaming: () => false,
    render: () => { renders += 1; },
  });
  vm.runInContext(
    sourceBetween("function renderAfterBackgroundUpdate()", "\nfunction removeSector"),
    context,
  );
  vm.runInContext("renderAfterBackgroundUpdate()", context);
  assert.equal(renders, 0);
  assert.equal(state.boardRenderPending, true);
});
