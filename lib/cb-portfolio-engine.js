"use strict";

const { LOT_SIZE, computeMetrics } = require("./cb-quant-engine.js");

const STRATEGIES = {
  cb_double_low: {
    label: "可转债双低轮动",
    group: "EasyXT 组合轮动",
    description: "价格 + 转股溢价率；均线多头过滤，持仓跌出前3N后轮出。",
    bufferMultiple: 3,
  },
  cb_three_low: {
    label: "可转债三低轮动",
    group: "EasyXT 组合轮动",
    description: "价格、转股溢价率与历史剩余余额排名加权；均线多头过滤。",
    bufferMultiple: 3,
  },
  cb_factor_rotation: {
    label: "可转债六因子轮动",
    group: "EasyXT 组合轮动",
    description: "低价、低溢价、低余额、趋势、5日动量与20日波动率加权排名。",
    bufferMultiple: 2,
  },
};

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

function clamp(value, minimum, maximum, fallback) {
  const number = finiteNumber(value, fallback);
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeDate(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  return /^\d{8}$/.test(digits) ? digits : "";
}

function normalizeCode(value) {
  const text = String(value || "").trim().toUpperCase();
  const matched = text.match(/^(\d{6})(?:\.(SH|SZ))?$/);
  if (!matched) return "";
  if (matched[2]) {
    const valid = matched[2] === "SH"
      ? /^(110|111|113|118)/.test(matched[1])
      : /^(123|127|128)/.test(matched[1]);
    return valid ? `${matched[1]}.${matched[2]}` : "";
  }
  if (/^(110|111|113|118)/.test(matched[1])) return `${matched[1]}.SH`;
  if (/^(123|127|128)/.test(matched[1])) return `${matched[1]}.SZ`;
  return "";
}

function listPortfolioStrategies() {
  return Object.entries(STRATEGIES).map(([name, strategy]) => ({
    name,
    label: strategy.label,
    group: strategy.group,
    description: strategy.description,
    mode: "portfolio",
  }));
}

function mean(values) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;
}

function rankRows(rows, value, ascending = true) {
  const sorted = [...rows].sort((left, right) => {
    const difference = Number(value(left)) - Number(value(right));
    return (ascending ? difference : -difference) || left.code.localeCompare(right.code);
  });
  const ranks = new Map();
  let previous = null;
  let previousRank = 0;
  sorted.forEach((row, index) => {
    const current = Number(value(row));
    const rank = previous !== null && Math.abs(current - previous) < 1e-12
      ? previousRank
      : index + 1;
    ranks.set(row.code, rank);
    previous = current;
    previousRank = rank;
  });
  return ranks;
}

function enrichFactorRows(rawRows, names = {}) {
  const byKey = new Map();
  for (const raw of Array.isArray(rawRows) ? rawRows : []) {
    const date = normalizeDate(raw?.date || raw?.DATE);
    const code = normalizeCode(raw?.code || raw?.secucode || raw?.SECUCODE || raw?.ZCODE);
    const close = finiteNumber(raw?.close ?? raw?.FCLOSE);
    const conversionValue = finiteNumber(raw?.conversion_value ?? raw?.SWAPVALUE);
    let premium = finiteNumber(raw?.premium_rate ?? raw?.SWAPOR);
    let premiumDerived = false;
    if (premium === null && close > 0 && conversionValue > 0) {
      premium = (close / conversionValue - 1) * 100;
      premiumDerived = true;
    }
    if (!date || !code || !(close > 0)) continue;
    byKey.set(`${date}|${code}`, {
      date,
      code,
      name: String(raw?.name || names[code] || code),
      close,
      premium_rate: premium,
      premium_derived: premiumDerived,
      conversion_value: conversionValue,
      pure_bond_value: finiteNumber(raw?.pure_bond_value ?? raw?.PUREBONDVALUE),
      remaining_balance_yuan: finiteNumber(raw?.remaining_balance_yuan ?? raw?.SYFE),
    });
  }

  const byCode = new Map();
  for (const row of byKey.values()) {
    if (!byCode.has(row.code)) byCode.set(row.code, []);
    byCode.get(row.code).push(row);
  }
  for (const rows of byCode.values()) {
    rows.sort((left, right) => left.date.localeCompare(right.date));
    const closes = [];
    let carriedBalance = null;
    let balanceSourceDate = null;
    for (const row of rows) {
      closes.push(row.close);
      if (row.remaining_balance_yuan > 0) {
        carriedBalance = row.remaining_balance_yuan;
        balanceSourceDate = row.date;
      }
      row.remaining_balance_yuan = carriedBalance;
      row.remaining_balance_billion = carriedBalance > 0 ? carriedBalance / 100_000_000 : null;
      row.balance_source_date = balanceSourceDate;
      if (closes.length >= 30) {
        const ma5 = mean(closes.slice(-5));
        const ma10 = mean(closes.slice(-10));
        const ma20 = mean(closes.slice(-20));
        const ma30 = mean(closes.slice(-30));
        row.ma_score = 25 * Number(ma5 > ma10)
          + 25 * Number(ma10 > ma20)
          + 25 * Number(ma20 > ma30)
          + 25 * Number(ma5 > ma30);
        row.momentum_5d = (closes.at(-1) / closes.at(-5) - 1) * 100;
        const logReturns = [];
        const last20 = closes.slice(-20);
        for (let index = 1; index < last20.length; index += 1) {
          logReturns.push(Math.log(last20[index] / last20[index - 1]));
        }
        const average = mean(logReturns);
        const variance = mean(logReturns.map((value) => (value - average) ** 2));
        row.volatility_20d = Math.sqrt(variance) * Math.sqrt(252) * 100;
      } else {
        row.ma_score = null;
        row.momentum_5d = null;
        row.volatility_20d = null;
      }
    }
  }
  return [...byKey.values()].sort((left, right) => (
    left.date.localeCompare(right.date) || left.code.localeCompare(right.code)
  ));
}

function scoreDateRows(rows, strategyName, params) {
  const maxPrice = clamp(params.maxPrice, 80, 500, 130);
  const maxPremium = clamp(params.maxPremium, -10, 500, 50);
  const minPrice = clamp(params.minPrice, 0, maxPrice, 80);
  const minPremium = clamp(params.minPremium, -100, maxPremium, -10);
  let eligible = rows.filter((row) => (
    row.close >= minPrice
    && row.close <= maxPrice
    && Number.isFinite(row.premium_rate)
    && row.premium_rate >= minPremium
    && row.premium_rate <= maxPremium
  ));

  if (strategyName === "cb_double_low") {
    const minMaScore = clamp(params.minMaScore, 0, 100, 50);
    const maxScore = clamp(params.maxDoubleLow, 50, 500, 150);
    eligible = eligible
      .map((row) => ({ ...row, score: row.close + row.premium_rate }))
      .filter((row) => row.ma_score !== null && row.ma_score >= minMaScore && row.score <= maxScore);
  } else if (strategyName === "cb_three_low") {
    const minMaScore = clamp(params.minMaScore, 0, 100, 40);
    const maxBalance = clamp(params.maxBalanceBillion, 0.01, 1000, 100);
    eligible = eligible.filter((row) => (
      row.remaining_balance_billion > 0
      && row.remaining_balance_billion <= maxBalance
    ));
    const priceRank = rankRows(eligible, (row) => row.close);
    const premiumRank = rankRows(eligible, (row) => row.premium_rate);
    const balanceRank = rankRows(eligible, (row) => row.remaining_balance_billion);
    eligible = eligible.map((row) => ({
      ...row,
      score: priceRank.get(row.code) + premiumRank.get(row.code) + balanceRank.get(row.code) * 0.5,
    })).filter((row) => row.ma_score !== null && row.ma_score >= minMaScore);
  } else if (strategyName === "cb_factor_rotation") {
    eligible = eligible.filter((row) => (
      row.remaining_balance_billion > 0
      && Number.isFinite(row.ma_score)
      && Number.isFinite(row.momentum_5d)
      && Number.isFinite(row.volatility_20d)
    ));
    const priceRank = rankRows(eligible, (row) => row.close);
    const premiumRank = rankRows(eligible, (row) => row.premium_rate);
    const balanceRank = rankRows(eligible, (row) => row.remaining_balance_billion);
    const trendRank = rankRows(eligible, (row) => row.ma_score, false);
    const momentumRank = rankRows(eligible, (row) => row.momentum_5d, false);
    const volatilityRank = rankRows(eligible, (row) => row.volatility_20d);
    eligible = eligible.map((row) => ({
      ...row,
      score: priceRank.get(row.code) * clamp(params.wPrice, 0, 10, 1)
        + premiumRank.get(row.code) * clamp(params.wPremium, 0, 10, 1)
        + balanceRank.get(row.code) * clamp(params.wBalance, 0, 10, 0.3)
        + trendRank.get(row.code) * clamp(params.wTrend, 0, 10, 0.5)
        + momentumRank.get(row.code) * clamp(params.wMomentum, 0, 10, 0.3)
        + volatilityRank.get(row.code) * clamp(params.wVolatility, 0, 10, 0.3),
    }));
  }

  return eligible.sort((left, right) => (
    left.score - right.score || left.code.localeCompare(right.code)
  )).map((row, index) => ({ ...row, rank: index + 1 }));
}

function buildPortfolioRankings(options = {}) {
  const strategyName = String(options.strategy || "cb_double_low");
  const strategy = STRATEGIES[strategyName];
  if (!strategy) throw new Error(`未知组合策略: ${strategyName}`);
  const startDate = normalizeDate(options.startDate);
  const endDate = normalizeDate(options.endDate);
  if (!startDate || !endDate || startDate > endDate) throw new Error("组合回测日期无效");
  const rows = enrichFactorRows(options.factorRows, options.names);
  const grouped = new Map();
  for (const row of rows) {
    if (row.date < startDate || row.date > endDate) continue;
    if (!grouped.has(row.date)) grouped.set(row.date, []);
    grouped.get(row.date).push(row);
  }
  const byDate = new Map();
  const candidateCodes = new Set();
  const topN = Math.round(clamp(options.topN, 1, 50, 10));
  for (const [date, dateRows] of [...grouped.entries()].sort()) {
    const ranked = scoreDateRows(dateRows, strategyName, options);
    byDate.set(date, ranked);
    for (const row of ranked.slice(0, topN * strategy.bufferMultiple)) candidateCodes.add(row.code);
  }
  return {
    strategy: strategyName,
    strategyLabel: strategy.label,
    bufferMultiple: strategy.bufferMultiple,
    topN,
    rows,
    dates: [...byDate.keys()],
    byDate,
    candidateCodes: [...candidateCodes],
  };
}

function normalizeOpenRows(rows) {
  const byKey = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const date = normalizeDate(raw?.date);
    const code = normalizeCode(raw?.code);
    const open = finiteNumber(raw?.open);
    if (!date || !code || !(open > 0)) continue;
    byKey.set(`${date}|${code}`, {
      date,
      code,
      open,
      volume: Math.max(0, finiteNumber(raw?.volume, 0)),
      amount: Math.max(0, finiteNumber(raw?.amount, 0)),
      suspend: Number(raw?.suspend || 0),
      source: raw?.source || "historical_daily",
    });
  }
  return byKey;
}

function runPortfolioBacktest(options = {}) {
  const ranking = options.ranking || buildPortfolioRankings(options);
  if (ranking.dates.length < 2) throw new Error("组合回测至少需要2个有效交易日");
  const initialCash = clamp(options.initialCash, 10_000, 1_000_000_000, 100_000);
  const commissionRate = clamp(options.commissionRate, 0, 0.01, 0.0001);
  const slippageBps = clamp(options.slippageBps, 0, 100, 2);
  const rebalanceEvery = Math.round(clamp(options.rebalanceEvery, 1, 60, 1));
  const openByKey = normalizeOpenRows(options.openRows);
  const closeByKey = new Map(ranking.rows.map((row) => [`${row.date}|${row.code}`, row.close]));
  const rowByKey = new Map(ranking.rows.map((row) => [`${row.date}|${row.code}`, row]));
  const positions = new Map();
  const lastPrices = new Map();
  const trades = [];
  const signals = [];
  const equityCurve = [];
  let cash = initialCash;
  let totalFees = 0;
  let pending = null;

  const markValue = (date, useOpen = false) => {
    let value = cash;
    for (const [code, position] of positions) {
      const open = openByKey.get(`${date}|${code}`)?.open;
      const close = closeByKey.get(`${date}|${code}`);
      const price = useOpen && open > 0 ? open : close > 0 ? close : lastPrices.get(code);
      if (price > 0) {
        lastPrices.set(code, price);
        value += position.quantity * price;
      }
    }
    return value;
  };

  ranking.dates.forEach((date, dateIndex) => {
    if (pending) {
      for (const order of pending.sells) {
        const position = positions.get(order.code);
        if (!position) continue;
        const bar = openByKey.get(`${date}|${order.code}`);
        if (!bar || bar.suspend || !(bar.volume > 0 || bar.amount > 0)) {
          signals.push({ date, signal_date: pending.signalDate, code: order.code, side: "sell", status: "unfilled", reason: "下一交易日无有效开盘成交" });
          continue;
        }
        const price = bar.open * (1 - slippageBps / 10_000);
        const gross = position.quantity * price;
        const fee = gross * commissionRate;
        const realized = gross - fee - position.costBasis;
        cash += gross - fee;
        totalFees += fee;
        positions.delete(order.code);
        trades.push({
          date,
          signal_date: pending.signalDate,
          code: order.code,
          name: order.name,
          side: "sell",
          price: round(price, 4),
          quantity: position.quantity,
          gross_amount: round(gross, 2),
          fee: round(fee, 2),
          realized_pnl: round(realized, 2),
          reason: order.reason,
        });
      }

      const slotBudget = markValue(date, true) / ranking.topN;
      for (const order of pending.buys) {
        if (positions.has(order.code) || positions.size >= ranking.topN) continue;
        const bar = openByKey.get(`${date}|${order.code}`);
        if (!bar || bar.suspend || !(bar.volume > 0 || bar.amount > 0)) {
          signals.push({ date, signal_date: pending.signalDate, code: order.code, side: "buy", status: "unfilled", reason: "下一交易日无有效开盘成交" });
          continue;
        }
        const price = bar.open * (1 + slippageBps / 10_000);
        const budget = Math.min(slotBudget, cash);
        const quantity = Math.floor(budget / (price * (1 + commissionRate)) / LOT_SIZE) * LOT_SIZE;
        if (quantity < LOT_SIZE) continue;
        const gross = quantity * price;
        const fee = gross * commissionRate;
        if (gross + fee > cash + 1e-6) continue;
        cash -= gross + fee;
        totalFees += fee;
        positions.set(order.code, { quantity, costBasis: gross + fee, name: order.name });
        trades.push({
          date,
          signal_date: pending.signalDate,
          code: order.code,
          name: order.name,
          side: "buy",
          price: round(price, 4),
          quantity,
          gross_amount: round(gross, 2),
          fee: round(fee, 2),
          realized_pnl: 0,
          reason: order.reason,
        });
      }
      pending = null;
    }

    const ranked = ranking.byDate.get(date) || [];
    if (dateIndex % rebalanceEvery === 0 && ranked.length) {
      const buffer = new Set(ranked.slice(0, ranking.topN * ranking.bufferMultiple).map((row) => row.code));
      const sells = [];
      const survivors = new Set();
      for (const [code, position] of positions) {
        if (buffer.has(code)) survivors.add(code);
        else sells.push({ code, name: position.name || code, reason: `跌出前${ranking.topN * ranking.bufferMultiple}名或必需因子失效` });
      }
      const buys = [];
      let futureCount = survivors.size;
      for (const row of ranked) {
        if (futureCount >= ranking.topN) break;
        if (survivors.has(row.code)) continue;
        buys.push({ code: row.code, name: row.name, reason: `${ranking.strategyLabel}排名第${row.rank}` });
        futureCount += 1;
      }
      if (sells.length || buys.length) {
        pending = { signalDate: date, sells, buys };
        signals.push(...sells.map((order) => ({ date, code: order.code, side: "sell", status: "generated", reason: order.reason })));
        signals.push(...buys.map((order) => ({ date, code: order.code, side: "buy", status: "generated", reason: order.reason })));
      }
    }

    const marketValue = [...positions.entries()].reduce((total, [code, position]) => {
      const close = closeByKey.get(`${date}|${code}`) || lastPrices.get(code);
      if (close > 0) lastPrices.set(code, close);
      return total + position.quantity * (close || 0);
    }, 0);
    equityCurve.push({
      date,
      cash: round(cash, 2),
      market_value: round(marketValue, 2),
      total_asset: round(cash + marketValue, 2),
      position_count: positions.size,
    });
  });

  const metrics = computeMetrics(initialCash, trades, equityCurve);
  const lastDate = ranking.dates.at(-1);
  const latestRanking = (ranking.byDate.get(lastDate) || []).slice(0, 30).map((row) => ({
    code: row.code,
    name: row.name,
    rank: row.rank,
    close: round(row.close, 3),
    premium_rate: round(row.premium_rate, 3),
    remaining_balance_billion: row.remaining_balance_billion === null ? null : round(row.remaining_balance_billion, 4),
    ma_score: row.ma_score,
    momentum_5d: row.momentum_5d === null ? null : round(row.momentum_5d, 3),
    volatility_20d: row.volatility_20d === null ? null : round(row.volatility_20d, 3),
    score: round(row.score, 4),
  }));
  return {
    ok: true,
    mode: "portfolio_backtest",
    strategy: ranking.strategy,
    strategy_label: ranking.strategyLabel,
    params: {
      start_date: ranking.dates[0],
      end_date: lastDate,
      initial_cash: initialCash,
      top_n: ranking.topN,
      rank_buffer: ranking.topN * ranking.bufferMultiple,
      commission_rate: commissionRate,
      slippage_bps: slippageBps,
      rebalance_every: rebalanceEvery,
      lot_size: LOT_SIZE,
      settlement: "T+0",
    },
    execution_model: "第T日收盘后的全市场截面排名生成信号，第T+1交易日开盘价叠加滑点成交；等权目标仓位，10张整数倍。",
    fee_model: "可转债双边佣金，无印花税。",
    metrics: {
      ...metrics,
      total_fees: round(totalFees, 2),
      trade_count: trades.length,
      turnover: metrics.final_value > 0
        ? round(trades.reduce((total, trade) => total + trade.gross_amount, 0) / metrics.final_value, 4)
        : 0,
      final_position_count: positions.size,
    },
    signals,
    trades,
    equity_curve: equityCurve,
    latest_ranking_date: lastDate,
    latest_ranking: latestRanking,
    open_positions: [...positions.entries()].map(([code, position]) => ({
      code,
      name: position.name,
      quantity: position.quantity,
      cost_basis: round(position.costBasis, 2),
      last_price: lastPrices.get(code) || rowByKey.get(`${lastDate}|${code}`)?.close || null,
    })),
    pending_order: pending,
  };
}

module.exports = {
  STRATEGIES,
  buildPortfolioRankings,
  enrichFactorRows,
  listPortfolioStrategies,
  normalizeOpenRows,
  runPortfolioBacktest,
  scoreDateRows,
};
