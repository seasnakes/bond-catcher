"use strict";

const LOT_SIZE = 10;

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 4) {
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

function minuteText(value) {
  const match = String(value || "").match(/(\d{2}:\d{2})(?::\d{2})?/);
  return match ? match[1] : "";
}

function normalizeDailyBars(rows) {
  const byDate = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const date = normalizeDate(row?.date || row?.time || row?.timetag);
    const high = finiteNumber(row?.high);
    const low = finiteNumber(row?.low);
    const close = finiteNumber(row?.close);
    if (!date || ![high, low, close].every((value) => value > 0)) continue;
    byDate.set(date, {
      date,
      high: Math.max(high, low, close),
      low: Math.min(high, low, close),
      close,
    });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function normalizeMinuteBars(rows) {
  const byMinute = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const time = minuteText(row?.time || row?.minute_time || row?.timetag);
    const open = finiteNumber(row?.open);
    const high = finiteNumber(row?.high);
    const low = finiteNumber(row?.low);
    const close = finiteNumber(row?.close);
    if (!time || ![open, high, low, close].every((value) => value > 0)) continue;
    byMinute.set(time, {
      ...row,
      time,
      open,
      high: Math.max(open, close, high),
      low: Math.min(open, close, low),
      close,
      ask1: finiteNumber(row?.ask1),
      bid1: finiteNumber(row?.bid1),
      limit_up: finiteNumber(row?.limit_up),
      limit_down: finiteNumber(row?.limit_down),
    });
  }
  return [...byMinute.values()].sort((left, right) => left.time.localeCompare(right.time));
}

function calculatePriorDailyAtr(rows, tradingDate, period = 14) {
  const normalizedPeriod = Math.max(2, Math.min(120, Math.floor(finiteNumber(period, 14))));
  const bars = normalizeDailyBars(rows).filter((row) => row.date < tradingDate);
  const trueRanges = [];
  for (let index = 1; index < bars.length; index += 1) {
    const row = bars[index];
    const previousClose = bars[index - 1].close;
    trueRanges.push(Math.max(
      row.high - row.low,
      Math.abs(row.high - previousClose),
      Math.abs(row.low - previousClose),
    ));
  }
  const samples = trueRanges.slice(-normalizedPeriod);
  return {
    value: samples.length >= normalizedPeriod
      ? round(samples.reduce((total, value) => total + value, 0) / samples.length, 6)
      : null,
    period: normalizedPeriod,
    sample_count: samples.length,
    complete: samples.length >= normalizedPeriod,
    prior_bar_count: bars.length,
    last_completed_date: bars.at(-1)?.date || null,
  };
}

function inContinuousSession(value) {
  const time = minuteText(value);
  return (time >= "09:30" && time < "11:30") || (time >= "13:00" && time < "15:00");
}

function roundLot(value, lotSize = LOT_SIZE) {
  return Math.max(0, Math.floor(Math.max(0, finiteNumber(value, 0)) / lotSize) * lotSize);
}

function runAtrGridBacktest(options = {}) {
  const tradingDate = normalizeDate(options.tradingDate || options.date);
  if (!tradingDate) throw new Error("ATR网格回测缺少有效交易日");
  const minuteBars = normalizeMinuteBars(options.minuteBars || options.rows);
  if (!minuteBars.length) throw new Error("ATR网格回测没有有效分钟K线");

  const initialCash = clamp(options.initialCash, 10_000, 1_000_000_000, 80_000);
  const lotSize = LOT_SIZE;
  const positionSize = roundLot(clamp(options.positionSize, lotSize, 100_000, 40), lotSize);
  const maxPosition = roundLot(clamp(options.maxPosition, positionSize, 10_000_000, 240), lotSize);
  const initialPosition = roundLot(clamp(options.initialPosition, 0, maxPosition, 0), lotSize);
  const atrPeriod = Math.max(2, Math.min(120, Math.floor(finiteNumber(options.atrPeriod, 14))));
  const atrMultiplier = clamp(options.atrMultiplier, 0.01, 10, 0.5);
  const minGridSpacingPct = clamp(options.minGridSpacingPct, 0.01, 10, 0.1);
  const maxGridSpacingPct = Math.max(
    minGridSpacingPct,
    clamp(options.maxGridSpacingPct, minGridSpacingPct, 20, 0.8),
  );
  const maPeriod = Math.max(2, Math.min(500, Math.floor(finiteNumber(options.maPeriod, 20))));
  const trendThresholdPct = clamp(options.trendThresholdPct, 0, 20, 0.3);
  const commissionRate = clamp(options.commissionRate, 0, 0.01, 0.00005);
  const slippageBps = clamp(options.slippageBps, 0, 100, 2);
  const priceTick = clamp(options.priceTick, 0.001, 1, 0.001);
  const atr = calculatePriorDailyAtr(options.dailyBars, tradingDate, atrPeriod);

  const initialPrice = minuteBars[0].close;
  const initialCost = initialPosition * initialPrice;
  if (initialCost > initialCash) throw new Error("初始资金不足以覆盖ATR网格底仓");

  let cash = initialCash - initialCost;
  let position = initialPosition;
  let averageCost = position > 0 ? initialPrice : 0;
  let basePrice = initialPrice;
  let lastTriggerPrice = null;
  let pendingSignal = null;
  let totalFees = 0;
  let turnover = 0;
  let realizedPnl = 0;
  let generatedSignals = 0;
  const priceHistory = [];
  const spacingValues = [];
  const trades = [];
  const equityCurve = [];

  const executePending = (row) => {
    if (!pendingSignal) return;
    const signal = pendingSignal;
    pendingSignal = null;
    let rawPrice = signal.side === "buy" ? row.ask1 : row.bid1;
    let quoteSource = signal.side === "buy" ? "ask1" : "bid1";
    if (!(rawPrice > 0)) {
      rawPrice = row.open;
      quoteSource = "next_minute_open_fallback";
    }
    const slip = slippageBps / 10_000;
    const slipped = rawPrice * (signal.side === "buy" ? 1 + slip : 1 - slip);
    const executionPrice = round(Math.round(slipped / priceTick) * priceTick, 4);
    if ((row.limit_up > 0 && executionPrice > row.limit_up)
      || (row.limit_down > 0 && executionPrice < row.limit_down)) return;

    if (signal.side === "buy") {
      const maxByCash = cash / (executionPrice * (1 + commissionRate));
      const quantity = roundLot(Math.min(positionSize, maxPosition - position, maxByCash), lotSize);
      if (quantity < lotSize) return;
      const notional = quantity * executionPrice;
      const fee = notional * commissionRate;
      const oldPosition = position;
      cash -= notional + fee;
      position += quantity;
      averageCost = ((averageCost * oldPosition) + notional + fee) / position;
      totalFees += fee;
      turnover += notional;
      lastTriggerPrice = executionPrice;
      trades.push({
        signal_time: signal.signalTime,
        execution_time: row.time,
        side: "buy",
        quantity,
        signal_price: round(signal.signalPrice, 4),
        execution_price: executionPrice,
        quote_source: quoteSource,
        fee: round(fee, 2),
        realized_pnl: 0,
        position_after: position,
        spacing_pct: round(signal.spacingPct, 4),
        reference_price: round(signal.referencePrice, 4),
        reason: `价格下穿参考价一个ATR网格（${round(signal.spacingPct, 3)}%）`,
      });
      return;
    }

    const quantity = roundLot(Math.min(positionSize, position), lotSize);
    if (quantity < lotSize) return;
    const notional = quantity * executionPrice;
    const fee = notional * commissionRate;
    const pnl = notional - fee - quantity * averageCost;
    cash += notional - fee;
    position -= quantity;
    if (position === 0) averageCost = 0;
    totalFees += fee;
    turnover += notional;
    realizedPnl += pnl;
    lastTriggerPrice = executionPrice;
    trades.push({
      signal_time: signal.signalTime,
      execution_time: row.time,
      side: "sell",
      quantity,
      signal_price: round(signal.signalPrice, 4),
      execution_price: executionPrice,
      quote_source: quoteSource,
      fee: round(fee, 2),
      realized_pnl: round(pnl, 2),
      position_after: position,
      spacing_pct: round(signal.spacingPct, 4),
      reference_price: round(signal.referencePrice, 4),
      reason: `价格上穿参考价一个ATR网格（${round(signal.spacingPct, 3)}%）`,
    });
  };

  for (let index = 0; index < minuteBars.length; index += 1) {
    const row = minuteBars[index];
    executePending(row);
    priceHistory.push(row.close);
    const maValues = priceHistory.slice(-maPeriod);
    const ma = maValues.reduce((total, value) => total + value, 0) / maValues.length;
    if (ma > 0 && Math.abs(row.close - ma) / ma * 100 > trendThresholdPct) basePrice = ma;

    const rawSpacing = atr.value > 0
      ? atr.value / row.close * 100 * atrMultiplier
      : minGridSpacingPct;
    const spacingPct = Math.max(minGridSpacingPct, Math.min(maxGridSpacingPct, rawSpacing));
    spacingValues.push(spacingPct);

    const referencePrice = lastTriggerPrice || basePrice;
    const nextRow = minuteBars[index + 1];
    if (nextRow && inContinuousSession(row.time) && inContinuousSession(nextRow.time)) {
      let side = null;
      if (referencePrice > 0 && row.close <= referencePrice * (1 - spacingPct / 100)) side = "buy";
      else if (referencePrice > 0 && row.close >= referencePrice * (1 + spacingPct / 100)) side = "sell";
      if (side) {
        generatedSignals += 1;
        pendingSignal = {
          side,
          signalTime: row.time,
          signalPrice: row.close,
          spacingPct,
          referencePrice,
        };
      }
    }

    equityCurve.push({
      time: row.time,
      close: round(row.close, 4),
      cash: round(cash, 2),
      position,
      total_asset: round(cash + position * row.close, 2),
      base_price: round(basePrice, 4),
      reference_price: round(referencePrice, 4),
      lower_trigger_price: round(referencePrice * (1 - spacingPct / 100), 4),
      upper_trigger_price: round(referencePrice * (1 + spacingPct / 100), 4),
      grid_spacing_pct: round(spacingPct, 4),
    });
  }

  let peak = initialCash;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.total_asset);
    maxDrawdown = Math.min(maxDrawdown, point.total_asset / peak - 1);
  }
  const finalValue = equityCurve.at(-1).total_asset;
  const averageSpacing = spacingValues.reduce((total, value) => total + value, 0) / spacingValues.length;

  return {
    ok: true,
    mode: "atr_grid_backtest",
    code: String(options.code || ""),
    name: options.name || options.code || "",
    trading_date: tradingDate,
    strategy: "atr_dynamic_grid",
    strategy_label: "ATR动态网格（日内）",
    atr,
    params: {
      initial_cash: initialCash,
      initial_position: initialPosition,
      position_size: positionSize,
      max_position: maxPosition,
      lot_size: lotSize,
      atr_period: atrPeriod,
      atr_multiplier: atrMultiplier,
      min_grid_spacing_pct: minGridSpacingPct,
      max_grid_spacing_pct: maxGridSpacingPct,
      ma_period: maPeriod,
      trend_threshold_pct: trendThresholdPct,
      commission_rate: commissionRate,
      slippage_bps: slippageBps,
      price_tick: priceTick,
    },
    metrics: {
      initial_cash: round(initialCash, 2),
      final_value: round(finalValue, 2),
      net_profit: round(finalValue - initialCash, 2),
      total_return: round(finalValue / initialCash - 1, 6),
      max_drawdown: round(maxDrawdown, 6),
      trade_count: trades.length,
      generated_signal_count: generatedSignals,
      buy_count: trades.filter((trade) => trade.side === "buy").length,
      sell_count: trades.filter((trade) => trade.side === "sell").length,
      turnover: round(turnover, 2),
      total_fees: round(totalFees, 2),
      realized_pnl: round(realizedPnl, 2),
      ending_cash: round(cash, 2),
      ending_position: position,
      average_grid_spacing_pct: round(averageSpacing, 4),
      minimum_grid_spacing_pct: round(Math.min(...spacingValues), 4),
      maximum_grid_spacing_pct: round(Math.max(...spacingValues), 4),
      minute_bar_count: minuteBars.length,
    },
    trades,
    equity_curve: equityCurve,
    execution_model: "当前分钟收盘产生网格信号，下一分钟ask1/bid1成交；盘口缺失时回退下一分钟开盘价。单边滑点按不利方向修正：买入价上调、卖出价下调。",
    fee_model: "可转债10张整手，双边佣金、无印花税；初始底仓按首根分钟收盘价建立。",
    indicator_model: "ATR只使用交易日前已经完成的日K；当现价相对日内MA的偏离绝对值超过趋势阈值时更新MA基准，有成交后仍优先以上一笔成交价作为下一格参考。",
  };
}

module.exports = {
  LOT_SIZE,
  calculatePriorDailyAtr,
  normalizeDailyBars,
  normalizeMinuteBars,
  runAtrGridBacktest,
};
