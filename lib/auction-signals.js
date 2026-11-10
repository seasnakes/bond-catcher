// Amount is cumulative CNY from QMT. Pre-09:25 L1 amount is not an
// indicative matched amount; only a final auction sample confirms turnover.
const RULES = Object.freeze({
  stockChangeMin: 1.2,
  bondChangeMin: 0.8,
  stockAmountMin: 5_000_000,
  bondAmountMin: 500_000,
  trendMoveMin: 0.6,
  trendMinSamples: 3,
  trendMinSpanSeconds: 30,
  staleAfterMs: 45_000,
  leadStrengthGapMin: 15,
});

const finite = (value) => value !== null && value !== undefined && value !== ""
  && Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const chinaParts = (timestamp) => {
  const date = new Date(timestamp + 8 * 3600_000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
};

function analyzeTrajectory(points) {
  const late = points.filter((point) => point.time >= "09:20:00");
  // Once the second half starts, do not borrow early strength while the
  // post-09:20 trajectory is still incomplete.
  const selected = late.length ? late : points;
  const first = selected[0];
  const last = selected.at(-1);
  const spanSeconds = first && last ? (last.timestamp - first.timestamp) / 1000 : 0;
  const enough = selected.length >= RULES.trendMinSamples && spanSeconds >= RULES.trendMinSpanSeconds;
  const changes = selected.map((point) => point.change);
  const netChange = first && last ? last.change - first.change : 0;
  const peakChange = changes.length ? Math.max(...changes) : null;
  const troughChange = changes.length ? Math.min(...changes) : null;
  const drawdown = last ? peakChange - last.change : 0;
  const steps = selected.slice(1).map((point, index) => point.change - selected[index].change);
  const distance = steps.reduce((sum, step) => sum + Math.abs(step), 0);
  const efficiency = distance ? netChange / distance : 0;
  const maxGapSeconds = selected.slice(1).reduce((gap, point, index) =>
    Math.max(gap, (point.timestamp - selected[index].timestamp) / 1000), 0);
  let kind = "insufficient";
  let label = "走势待积累";
  let score = 0;
  if (enough) {
    if (netChange <= -RULES.trendMoveMin && efficiency <= -0.35) {
      kind = "falling"; label = "持续回落"; score = -25;
    } else if (drawdown >= 0.8 && drawdown >= Math.max(0.8, netChange)) {
      kind = "fade"; label = "冲高回落"; score = -20;
    } else if (first.change <= -0.3 && last.change >= 0.2 && netChange >= 0.8 && efficiency >= 0.35) {
      kind = "recovery"; label = "水下拉起"; score = 30;
    } else if (netChange >= RULES.trendMoveMin && efficiency >= 0.35) {
      kind = "rising"; label = last.change < 0 ? "水下回升" : "持续抬升"; score = 20;
    } else {
      kind = "flat"; label = "横向震荡";
    }
  }
  return {
    kind, label, score, sufficient: enough,
    strong: score > 0, weakening: score < 0,
    window: late.length ? "09:20后" : "09:15起",
    startTime: first?.time || null, endTime: last?.time || null,
    firstChange: first?.change ?? null, lastChange: last?.change ?? null,
    netChange, peakChange, troughChange, drawdown,
    sampleCount: selected.length, spanSeconds, maxGapSeconds,
    sparse: maxGapSeconds > 120,
  };
}

function appendAuctionSample(series, sample, maxSamples = 210) {
  const last = series.samples.at(-1);
  if (last && last.timestamp > sample.timestamp) return false;
  const replacing = last?.timestamp === sample.timestamp;
  if (replacing && last.price === sample.price && last.amount === sample.amount && last.change === sample.change
    && last.volume === sample.volume) return false;
  const previous = replacing ? series.samples.at(-2) : last;
  sample.deltaAmount = previous ? Math.max(0, sample.amount - (previous.amount || 0)) : 0;
  if (replacing) series.samples[series.samples.length - 1] = sample;
  else series.samples.push(sample);
  if (series.samples.length > maxSamples) series.samples.splice(0, series.samples.length - maxSamples);
  return true;
}

function summarizeAuctionSeries(series, tradingDate, options = {}) {
  if (!series || series.date !== tradingDate || !Array.isArray(series.samples)) return null;
  const previousClose = finite(series.previousClose);
  const byTime = new Map();
  for (const sample of series.samples) {
    const timestamp = finite(sample?.timestamp);
    const price = finite(sample?.price);
    if (!(timestamp > 0) || !(price > 0) || sample.date !== tradingDate) continue;
    const dateTime = chinaParts(timestamp);
    const time = dateTime.slice(11, 19);
    if (dateTime.slice(0, 10).replaceAll("-", "") !== tradingDate
      || time < "09:15:00" || time >= "09:25:30" || sample.time !== time) continue;
    const capturedAt = finite(sample.capturedAt) ?? timestamp;
    if (options.asOf && (timestamp > options.asOf || capturedAt > options.asOf)) continue;
    const change = previousClose > 0 ? (price / previousClose - 1) * 100 : finite(sample.change);
    if (change === null) continue;
    byTime.set(timestamp, { ...sample, timestamp, capturedAt, price, change, time });
  }
  const samples = [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
  const latest = samples.at(-1);
  if (!latest) return null;
  const final = latest.time >= "09:25:00";
  const rawAmount = finite(latest.amount);
  const amount = final && rawAmount > 0 ? rawAmount : null;
  const nowTime = options.asOf ? chinaParts(options.asOf).slice(11, 19) : "";
  const live = nowTime >= "09:15:00" && nowTime < "09:25:30";
  const stale = live && options.asOf - latest.timestamp > RULES.staleAfterMs;
  const points = samples.map(({ timestamp, time, change }) => ({ timestamp, time, change }));
  return {
    time: latest.time, timestamp: latest.timestamp, capturedAt: latest.capturedAt,
    price: latest.price, change: latest.change, amount,
    auctionVolume: final && finite(latest.volume) > 0 ? Number(latest.volume) : null,
    // Retained for API consumers; final turnover no longer disappears when
    // five subsequent snapshots have zero amount increments.
    recentAmount: amount,
    amountStatus: amount !== null ? "final" : final ? "unavailable" : "pending",
    stage: final ? "final" : "indicative", stale,
    source: series.source || "QMT竞价采样",
    previousClose, sampleCount: samples.length,
    trajectory: analyzeTrajectory(points),
    points,
  };
}

function percentileRank(values, value) {
  if (!values.length || value === null) return null;
  if (values.length === 1) return 1;
  return (values.filter((item) => item <= value).length - 1) / (values.length - 1);
}

function snapshotStrength(snapshot, amountMin) {
  if (!snapshot || snapshot.stale) return 0;
  const price = clamp(snapshot.change / 4, -1, 1) * 45;
  const amount = snapshot.amount ? clamp(snapshot.amount / amountMin, 0, 3) * 10 : 0;
  return Math.round(price + amount + snapshot.trajectory.score);
}

function buildAuctionSignalRows(pairs, seriesBySecid, tradingDate, options = {}) {
  const seen = new Set();
  const uniquePairs = (Array.isArray(pairs) ? pairs : []).filter((pair) => {
    const key = `${pair?.bondSecid}:${pair?.stockSecid}`;
    if (!pair?.bondSecid || !pair?.stockSecid || seen.has(key)) return false;
    seen.add(key); return true;
  });
  const summaries = uniquePairs.map((pair) => ({
    pair,
    stock: summarizeAuctionSeries(seriesBySecid.get(pair.stockSecid), tradingDate, options),
    bond: summarizeAuctionSeries(seriesBySecid.get(pair.bondSecid), tradingDate, options),
  }));
  const sampledPairs = summaries.filter(({ stock, bond }) => stock && bond).length;
  const stockAmounts = summaries.map(({ stock }) => stock?.amount).filter((amount) => amount > 0);
  const bondAmounts = summaries.map(({ bond }) => bond?.amount).filter((amount) => amount > 0);
  const amountCoverage = {
    stock: uniquePairs.length ? stockAmounts.length / uniquePairs.length : 0,
    bond: uniquePairs.length ? bondAmounts.length / uniquePairs.length : 0,
  };
  const signals = [];
  let latestTimestamp = 0;
  let stalePairs = 0;
  for (const { pair, stock, bond } of summaries) {
    latestTimestamp = Math.max(latestTimestamp, stock?.timestamp || 0, bond?.timestamp || 0);
    if (stock?.stale || bond?.stale) stalePairs += 1;
    if (stock) {
      stock.amountPercentile = percentileRank(stockAmounts, stock.amount);
      stock.strength = snapshotStrength(stock, RULES.stockAmountMin);
    }
    if (bond) {
      bond.amountPercentile = percentileRank(bondAmounts, bond.amount);
      bond.strength = snapshotStrength(bond, RULES.bondAmountMin);
    }
    const stockPrice = stock && !stock.stale && (stock.change >= RULES.stockChangeMin || stock.trajectory.strong);
    const bondPrice = bond && !bond.stale && (bond.change >= RULES.bondChangeMin || bond.trajectory.strong);
    const stockWeak = stock && !stock.stale && stock.trajectory.weakening;
    const bondWeak = bond && !bond.stale && bond.trajectory.weakening;
    const stockAmount = stockPrice && stock.amount >= RULES.stockAmountMin;
    const bondAmount = bondPrice && bond.amount >= RULES.bondAmountMin;
    const isFinal = stock?.stage === "final" && bond?.stage === "final";
    let signalType = "";
    let priority = 0;
    let status = "watch";
    let reason = "";
    if (stockWeak || bondWeak) {
      signalType = "price_fading"; status = "weakening";
      reason = "竞价后段走弱，降低关注优先级";
    } else if (stockAmount && bondAmount && isFinal) {
      signalType = "paired_confirmed"; priority = 4; status = "confirmed";
      reason = "股债涨幅或走势与成交额同时达到观察条件";
    } else if (stockAmount) {
      signalType = !bondPrice || stock.strength - bond.strength >= RULES.leadStrengthGapMin
        ? "stock_lead" : "stock_watch"; priority = 3; status = "stock_lead";
      reason = "正股竞价成交额达到观察条件，转债尚未同步确认";
    } else if (bondAmount) {
      signalType = "bond_spike"; priority = 2; status = "bond_spike";
      reason = "转债竞价成交额达到观察条件";
    } else if (stockPrice && bondPrice) {
      signalType = "price_paired"; priority = 3;
      reason = isFinal && stock.amount && bond.amount
        ? "正股与转债价格同步走强，成交额未同时达到观察门槛"
        : "正股与转债价格同步走强，成交额尚未确认";
    } else if (stockPrice) {
      signalType = "price_stock_lead"; priority = 2; status = "stock_lead";
      reason = "正股价格领先，关注转债响应";
    } else if (bondPrice) {
      signalType = "price_bond"; priority = 1;
      reason = "转债价格走强，关注正股响应";
    }
    if (!signalType) continue;
    const snapshots = [stock, bond].filter(Boolean);
    const timestamp = Math.max(...snapshots.map((snapshot) => snapshot.timestamp));
    const capturedAt = Math.max(...snapshots.map((snapshot) => snapshot.capturedAt));
    const stage = isFinal ? "final" : timestamp < Date.parse(`${tradingDate.slice(0, 4)}-${tradingDate.slice(4, 6)}-${tradingDate.slice(6, 8)}T09:25:00+08:00`)
      ? "indicative" : "incomplete";
    const evidence = snapshots.map((snapshot) => {
      const name = snapshot === stock ? "正股" : "转债";
      return `${name}${snapshot.trajectory.window}${snapshot.trajectory.label}${snapshot.stale ? "（报价滞后）" : ""}`;
    });
    if (!stock || !bond) evidence.push(`${!stock ? "正股" : "转债"}缺少采样`);
    signals.push({
      ...pair, id: `${tradingDate}:${pair.bondSecid}:${signalType}`,
      tradingDate, eventTime: chinaParts(timestamp).slice(11, 19), capturedAt,
      signalType, priority, status, stage,
      stock, bond,
      leadGap: stock && bond ? stock.strength - bond.strength : null,
      rankScore: Math.max(stock?.strength || 0, bond?.strength || 0)
        + (stock?.trajectory.score || 0) + (bond?.trajectory.score || 0),
      reason: `${reason}；${evidence.join("；")}`,
      source: [...new Set(snapshots.map((snapshot) => snapshot.source))].join(" / "),
    });
  }
  signals.sort((a, b) => b.priority - a.priority || b.rankScore - a.rankScore
    || (b.stock?.amount || 0) - (a.stock?.amount || 0) || a.bondSecid.localeCompare(b.bondSecid));
  return {
    sampledPairs,
    coverage: {
      requested: uniquePairs.length, sampled: sampledPairs,
      partial: summaries.filter(({ stock, bond }) => Boolean(stock) !== Boolean(bond)).length,
      stale: stalePairs,
      ratio: uniquePairs.length ? sampledPairs / uniquePairs.length : 0,
    },
    latestQuoteTime: latestTimestamp ? chinaParts(latestTimestamp).slice(11, 19) : null,
    amountCoverage,
    amountReady: amountCoverage.stock >= 0.6 && amountCoverage.bond >= 0.6,
    rules: RULES, signals,
  };
}

module.exports = { RULES, analyzeTrajectory, appendAuctionSample, summarizeAuctionSeries, buildAuctionSignalRows };
