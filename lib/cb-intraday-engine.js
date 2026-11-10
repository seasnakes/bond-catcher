"use strict";

const LOT_SIZE = 10;

const SETUP_EVENTS = new Set([
  "purple_line_pullback_reclaim",
  "intraday_average_pullback_reclaim",
]);
const CONFIRMATION_FAMILIES = {
  accelerate_up: "momentum",
  interval_volume: "volume",
  macd_above_water_golden_cross: "macd",
  macd_underwater_golden_cross: "macd",
  underwater_golden_cross_purple_confirmed: "macd",
  dark_funds_inflow_start: "dark_funds",
  dark_funds_inflow_accelerating: "dark_funds",
  visible_funds_inflow_start: "visible_funds",
  visible_funds_strong_inflow: "visible_funds",
  visible_book_support: "order_book_l1",
};
function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

function clamp(value, minimum, maximum, fallback) {
  const number = finiteNumber(value, fallback);
  return Math.min(maximum, Math.max(minimum, number));
}

function clockText(value) {
  const match = String(value || "").match(/(\d{2}:\d{2})(?::(\d{2}))?/);
  return match ? `${match[1]}:${match[2] || "00"}` : "";
}

function minuteText(value) {
  return clockText(value).slice(0, 5);
}

function minuteNumber(value) {
  const match = minuteText(value).match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

function normalizeMinuteRows(rows) {
  const byMinute = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const time = minuteText(raw?.time || raw?.minute_time || raw?.timetag);
    const open = finiteNumber(raw?.open);
    const high = finiteNumber(raw?.high);
    const low = finiteNumber(raw?.low);
    const close = finiteNumber(raw?.close);
    if (!time || ![open, high, low, close].every((value) => value > 0)) continue;
    byMinute.set(time, {
      ...raw,
      time,
      open,
      high: Math.max(open, close, high),
      low: Math.min(open, close, low),
      close,
      amount: Math.max(0, finiteNumber(raw?.amount, 0)),
      purple: finiteNumber(raw?.purple),
      purple_ma27: finiteNumber(raw?.purple_ma27),
      intraday_average: finiteNumber(raw?.intraday_average),
      macd: finiteNumber(raw?.macd),
      dark_state: String(raw?.dark_state || ""),
    });
  }
  return [...byMinute.values()].sort((left, right) => left.time.localeCompare(right.time));
}

function normalizeEvents(events) {
  return (Array.isArray(events) ? events : [])
    .map((event) => ({
      ...event,
      event_type: String(event?.event_type || ""),
      event_clock: clockText(event?.event_time),
      event_minute: minuteText(event?.event_time),
      source_minute: minuteText(event?.source_bar_time),
    }))
    .filter((event) => event.event_clock && event.event_type)
    .sort((left, right) => (
      left.event_clock.localeCompare(right.event_clock)
      || Number(left.id || 0) - Number(right.id || 0)
    ));
}

function latestAuctionSample(series) {
  const samples = (Array.isArray(series?.samples) ? series.samples : [])
    .filter((sample) => minuteNumber(sample?.time) <= 9 * 60 + 25)
    .sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0));
  const latest = samples.at(-1);
  if (!latest) return null;
  return {
    secid: series.secid,
    previous_close: finiteNumber(series.previousClose),
    time: minuteText(latest.time),
    price: finiteNumber(latest.price),
    change_pct: finiteNumber(latest.change, 0),
    amount: Math.max(0, finiteNumber(latest.amount, 0)),
    sample_count: samples.length,
  };
}

function summarizeAuctionPair(input = {}) {
  const bond = latestAuctionSample(input.bondSeries);
  const stock = latestAuctionSample(input.stockSeries);
  const complete = Boolean(
    bond && stock
    && bond.time === "09:25"
    && stock.time === "09:25"
    && bond.amount > 0
    && stock.amount > 0
  );
  if (!complete) {
    return {
      status: "unavailable",
      label: "竞价数据不完整",
      allow_long: false,
      bias_score: -2,
      quality: "missing_0925_amount_confirmed_pair",
      bond,
      stock,
      reason_codes: ["AUCTION_0925_PAIR_MISSING"],
    };
  }

  const leadGap = stock.change_pct - bond.change_pct;
  let status = "neutral";
  let label = "竞价中性，等待盘中确认";
  let allowLong = true;
  let biasScore = 0;
  const reasonCodes = ["AUCTION_NEUTRAL"];
  if (stock.change_pct <= -1 || bond.change_pct <= -1.5) {
    status = "risk_off";
    label = "竞价偏弱，禁止自动开多";
    allowLong = false;
    biasScore = -2;
    reasonCodes.splice(0, 1, "AUCTION_RISK_OFF");
  } else if (stock.change_pct >= 0.5 && bond.change_pct >= 0.3) {
    status = "paired_support";
    label = "正股与转债竞价同步支持";
    biasScore = 2;
    reasonCodes.splice(0, 1, "AUCTION_PAIRED_SUPPORT");
  } else if (stock.change_pct >= 0.5 && leadGap >= 0.4) {
    status = "stock_lead";
    label = "正股竞价领先，等待转债响应";
    biasScore = 1;
    reasonCodes.splice(0, 1, "AUCTION_STOCK_LEAD");
  } else if (bond.change_pct >= 0.8 && stock.change_pct >= 0) {
    status = "bond_support";
    label = "转债竞价自身偏强";
    biasScore = 1;
    reasonCodes.splice(0, 1, "AUCTION_BOND_SUPPORT");
  }
  return {
    status,
    label,
    allow_long: allowLong,
    bias_score: biasScore,
    quality: "amount_confirmed_0925_l1",
    lead_gap_pct: round(leadGap, 3),
    bond,
    stock,
    reason_codes: reasonCodes,
  };
}

function structureSnapshot(row) {
  const closeAbovePurple = row?.purple > 0 && row.close > row.purple;
  const closeAboveAverage = row?.intraday_average > 0 && row.close > row.intraday_average;
  const purpleRising = row?.purple > 0
    && row?.purple_ma27 > 0
    && row.purple > row.purple_ma27
    && row.purple_rising !== false;
  const darkInflow = row?.dark_state === "inflow";
  const macdPositive = row?.macd > 0;
  return {
    pass: Boolean(closeAbovePurple && closeAboveAverage && purpleRising && darkInflow && macdPositive),
    close_above_purple: closeAbovePurple,
    close_above_intraday_average: closeAboveAverage,
    purple_rising: purpleRising,
    dark_funds_inflow: darkInflow,
    macd_positive: macdPositive,
  };
}

function findIntradayEntry(options = {}) {
  const rows = normalizeMinuteRows(options.rows);
  const events = normalizeEvents(options.events);
  const auction = options.auction?.status ? options.auction : summarizeAuctionPair(options.auction);
  const rejected = [];
  if (!auction.allow_long) {
    return { rows, events, auction, entry_signal: null, rejected_candidates: [{
      time: "09:25",
      reason_codes: auction.reason_codes,
    }] };
  }

  const setups = [];
  for (const event of events) {
    const eventMinuteNumber = minuteNumber(event.event_minute);
    if (eventMinuteNumber < 9 * 60 + 35 || eventMinuteNumber > 14 * 60 + 35) continue;
    if (SETUP_EVENTS.has(event.event_type)) setups.push(event);
    const confirmationFamily = CONFIRMATION_FAMILIES[event.event_type];
    if (!confirmationFamily) continue;

    const setup = [...setups].reverse().find((candidate) => {
      const age = eventMinuteNumber - minuteNumber(candidate.event_minute);
      return age >= 0 && age <= 15;
    });
    if (!setup) continue;
    const structureBar = [...rows].reverse().find((row) => row.time < event.event_minute);
    if (!structureBar) continue;
    const structure = structureSnapshot(structureBar);
    const confirmingEvents = events.filter((candidate) => {
      const candidateMinute = minuteNumber(candidate.event_minute);
      return candidateMinute >= minuteNumber(setup.event_minute)
        && candidateMinute <= eventMinuteNumber
        && CONFIRMATION_FAMILIES[candidate.event_type];
    });
    const families = [...new Set(confirmingEvents.map(
      (candidate) => CONFIRMATION_FAMILIES[candidate.event_type],
    ))];
    const positiveSpeed = confirmingEvents.some((candidate) => (
      finiteNumber(candidate.speed_3m, 0) > 0
      && finiteNumber(candidate.speed_5m, 0) > 0
    ));
    const reasonCodes = [
      "PURPLE_OR_VWAP_RECLAIM_SETUP",
      ...(structure.close_above_purple ? ["CLOSE_ABOVE_PURPLE"] : []),
      ...(structure.close_above_intraday_average ? ["CLOSE_ABOVE_VWAP"] : []),
      ...(structure.purple_rising ? ["PURPLE_TREND_UP"] : []),
      ...(structure.dark_funds_inflow ? ["DARK_FUNDS_INFLOW_L1_APPROX"] : []),
      ...(structure.macd_positive ? ["MACD_POSITIVE"] : []),
      ...(positiveSpeed ? ["POSITIVE_3M_5M_SPEED"] : []),
      ...families.map((family) => `CONFIRM_${family.toUpperCase()}`),
    ];
    const score = auction.bias_score
      + Number(structure.close_above_purple)
      + Number(structure.close_above_intraday_average)
      + Number(structure.purple_rising) * 2
      + Number(structure.dark_funds_inflow)
      + Number(structure.macd_positive)
      + Number(positiveSpeed)
      + families.length;
    if (!structure.pass || !positiveSpeed || families.length < 2 || score < 8) {
      rejected.push({
        time: event.event_clock,
        setup_time: setup.event_clock,
        event_type: event.event_type,
        score,
        reason_codes: [
          ...(!structure.pass ? ["STRUCTURE_GATE_FAILED"] : []),
          ...(!positiveSpeed ? ["MOMENTUM_GATE_FAILED"] : []),
          ...(families.length < 2 ? ["CONFIRMATION_FAMILIES_INSUFFICIENT"] : []),
        ],
      });
      continue;
    }
    return {
      rows,
      events,
      auction,
      entry_signal: {
        key: `${options.date || ""}|${options.code || ""}|${event.event_clock}|intraday_confluence`,
        setup_time: setup.event_clock,
        signal_time: event.event_clock,
        signal_minute: event.event_minute,
        source_bar_time: structureBar.time,
        score,
        reason_codes: reasonCodes,
        confirmation_events: confirmingEvents.map((candidate) => ({
          time: candidate.event_clock,
          event_type: candidate.event_type,
          family: CONFIRMATION_FAMILIES[candidate.event_type],
          confidence: candidate.confidence || null,
        })),
        structure: {
          time: structureBar.time,
          close: round(structureBar.close),
          purple: round(structureBar.purple),
          purple_ma27: round(structureBar.purple_ma27),
          intraday_average: round(structureBar.intraday_average),
          ...structure,
        },
      },
      rejected_candidates: rejected.slice(-20),
    };
  }
  return { rows, events, auction, entry_signal: null, rejected_candidates: rejected.slice(-20) };
}

function kellyRiskPlan(options = {}) {
  const winRate = clamp(options.winRate, 0.01, 0.99, 0.52);
  const payoffRatio = clamp(options.payoffRatio, 0.2, 10, 2);
  const discount = clamp(options.discount, 0, 1, 0.25);
  const maxRiskPct = clamp(options.maxRiskPct, 0.0005, 0.03, 0.005);
  const maxPositionPct = clamp(options.maxPositionPct, 0.01, 1, 0.2);
  const stopPct = clamp(options.stopPct, 0.001, 0.1, 0.01);
  const fullKelly = Math.max(0, winRate - (1 - winRate) / payoffRatio);
  const discountedKelly = fullKelly * discount;
  const riskBudgetPct = Math.min(discountedKelly, maxRiskPct);
  const positionPct = Math.min(maxPositionPct, riskBudgetPct / stopPct);
  const sampleSize = Math.max(0, Math.floor(finiteNumber(options.sampleSize, 0)));
  return {
    formula: "f*=p-(1-p)/b",
    win_rate: round(winRate, 4),
    payoff_ratio: round(payoffRatio, 3),
    full_kelly_fraction: round(fullKelly, 6),
    kelly_discount: round(discount, 3),
    discounted_kelly_fraction: round(discountedKelly, 6),
    max_risk_fraction: round(maxRiskPct, 6),
    risk_budget_fraction: round(riskBudgetPct, 6),
    stop_fraction: round(stopPct, 6),
    max_position_fraction: round(maxPositionPct, 6),
    position_fraction: round(positionPct, 6),
    calibration_sample_size: sampleSize,
    calibration_quality: sampleSize >= 30 ? "historical_sample" : "manual_assumption_insufficient_sample",
    note: "凯利只决定风险预算；止损来自盘中结构，止盈来自R倍数。",
  };
}

function executionPrice(price, side, slippageBps) {
  const direction = side === "buy" ? 1 : -1;
  return price * (1 + direction * slippageBps / 10_000);
}

function buildTradePlan(options = {}) {
  const rows = normalizeMinuteRows(options.rows);
  const signal = options.entrySignal;
  if (!signal) return null;
  const entryIndex = rows.findIndex((row) => row.time > signal.signal_minute);
  if (entryIndex < 0) return null;
  const entryBar = rows[entryIndex];
  const slippageBps = clamp(options.slippageBps, 0, 100, 2);
  const entryPrice = executionPrice(entryBar.open, "buy", slippageBps);
  const structureRows = rows
    .filter((row) => row.time <= signal.source_bar_time)
    .slice(-5);
  const structureLow = Math.min(...structureRows.map((row) => row.low));
  const stopBufferPct = clamp(options.stopBufferPct, 0, 0.01, 0.001);
  const minStopPct = clamp(options.minStopPct, 0.002, 0.02, 0.005);
  const maxStopPct = clamp(options.maxStopPct, minStopPct, 0.03, 0.02);
  let stopPrice = Math.max(structureLow * (1 - stopBufferPct), entryPrice * (1 - maxStopPct));
  if ((entryPrice - stopPrice) / entryPrice < minStopPct) {
    stopPrice = entryPrice * (1 - minStopPct);
  }
  const riskPerBond = entryPrice - stopPrice;
  const take1R = clamp(options.take1R, 0.5, 3, 1);
  const take2R = clamp(options.take2R, take1R, 6, 2);
  const initialCash = clamp(options.initialCash, 10_000, 1_000_000_000, 100_000);
  const commissionRate = clamp(options.commissionRate, 0, 0.01, 0.0001);
  const kelly = kellyRiskPlan({
    winRate: options.winRate,
    payoffRatio: take2R,
    discount: options.kellyDiscount,
    maxRiskPct: options.maxRiskPct,
    maxPositionPct: options.maxPositionPct,
    stopPct: riskPerBond / entryPrice,
    sampleSize: options.calibrationSampleSize,
  });
  const budget = initialCash * kelly.position_fraction;
  const quantity = Math.floor(
    budget / (entryPrice * (1 + commissionRate)) / LOT_SIZE,
  ) * LOT_SIZE;
  return {
    signal_key: signal.key,
    setup_time: signal.setup_time,
    signal_time: signal.signal_time,
    fill_time: entryBar.time,
    entry_bar_index: entryIndex,
    entry_price: round(entryPrice, 4),
    structure_low: round(structureLow, 4),
    stop_price: round(stopPrice, 4),
    stop_pct: round(riskPerBond / entryPrice, 6),
    take1_price: round(entryPrice + riskPerBond * take1R, 4),
    take2_price: round(entryPrice + riskPerBond * take2R, 4),
    take1_r: take1R,
    take2_r: take2R,
    quantity,
    notional: round(quantity * entryPrice, 2),
    planned_risk_amount: round(quantity * riskPerBond, 2),
    kelly,
  };
}

function replayIntraday(options = {}) {
  const analysis = findIntradayEntry(options);
  const rows = analysis.rows;
  const plan = buildTradePlan({
    ...options,
    rows,
    entrySignal: analysis.entry_signal,
  });
  const initialCash = clamp(options.initialCash, 10_000, 1_000_000_000, 100_000);
  const commissionRate = clamp(options.commissionRate, 0, 0.01, 0.0001);
  const slippageBps = clamp(options.slippageBps, 0, 100, 2);
  const trailingPurpleBufferPct = clamp(options.trailingPurpleBufferPct, 0.001, 0.02, 0.003);
  const fills = [];
  const timeline = [{
    time: "09:25:00",
    state: analysis.auction.status === "risk_off" ? "VETO" : "AUCTION",
    title: analysis.auction.label,
    reason_codes: analysis.auction.reason_codes,
  }];
  if (analysis.entry_signal) {
    timeline.push({
      time: analysis.entry_signal.setup_time,
      state: "SETUP",
      title: "紫线/分时均价收回，进入观察",
      reason_codes: ["PURPLE_OR_VWAP_RECLAIM_SETUP"],
    });
    timeline.push({
      time: analysis.entry_signal.signal_time,
      state: "TRIGGERED",
      title: "趋势、资金与动量完成组合确认",
      reason_codes: analysis.entry_signal.reason_codes,
    });
  }
  if (!plan || plan.quantity < LOT_SIZE) {
    return {
      ok: true,
      mode: "intraday_replay",
      code: options.code,
      name: options.name || options.code,
      trading_date: options.date,
      strategy: "intraday_confluence_kelly",
      auction: analysis.auction,
      entry_signal: analysis.entry_signal,
      rejected_candidates: analysis.rejected_candidates,
      trade_plan: plan,
      timeline,
      fills,
      chart_rows: rows,
      metrics: {
        initial_cash: initialCash,
        final_value: initialCash,
        net_profit: 0,
        total_return: 0,
        closed_trades: 0,
        total_fees: 0,
      },
      execution_model: "已完成分钟与事件组合出信号，下一分钟开盘叠加滑点成交；同分钟止损优先。",
    };
  }

  let cash = initialCash;
  let quantity = plan.quantity;
  let costBasis = quantity * plan.entry_price;
  const entryFee = costBasis * commissionRate;
  costBasis += entryFee;
  cash -= costBasis;
  let fees = entryFee;
  let realizedPnl = 0;
  let take1Done = false;
  let trailingStop = plan.stop_price;
  let maximumHigh = plan.entry_price;
  let minimumLow = plan.entry_price;
  fills.push({
    time: plan.fill_time,
    side: "buy",
    reason: "日内组合确认后下一分钟成交",
    price: plan.entry_price,
    quantity,
    fee: round(entryFee, 2),
    realized_pnl: 0,
  });
  timeline.push({
    time: `${plan.fill_time}:00`,
    state: "POSITION",
    title: `模拟买入 ${quantity} 张`,
    reason_codes: ["NEXT_MINUTE_OPEN_FILL", "KELLY_RISK_SIZED"],
  });

  const sell = (basePrice, sellQuantity, time, reason, state) => {
    const filledQuantity = Math.min(quantity, Math.floor(sellQuantity / LOT_SIZE) * LOT_SIZE);
    if (filledQuantity < LOT_SIZE) return;
    const price = executionPrice(basePrice, "sell", slippageBps);
    const gross = filledQuantity * price;
    const fee = gross * commissionRate;
    const allocatedCost = costBasis * (filledQuantity / quantity);
    const pnl = gross - fee - allocatedCost;
    cash += gross - fee;
    quantity -= filledQuantity;
    costBasis -= allocatedCost;
    fees += fee;
    realizedPnl += pnl;
    fills.push({
      time,
      side: "sell",
      reason,
      price: round(price, 4),
      quantity: filledQuantity,
      fee: round(fee, 2),
      realized_pnl: round(pnl, 2),
    });
    timeline.push({ time: `${time}:00`, state, title: reason, reason_codes: [state] });
  };

  for (let index = plan.entry_bar_index; index < rows.length && quantity > 0; index += 1) {
    const row = rows[index];
    maximumHigh = Math.max(maximumHigh, row.high);
    minimumLow = Math.min(minimumLow, row.low);
    const activeStop = trailingStop;
    if (row.low <= activeStop) {
      const basePrice = row.open < activeStop ? row.open : activeStop;
      sell(basePrice, quantity, row.time, take1Done ? "移动保护止损" : "结构止损", "STOP_EXIT");
      break;
    }
    if (!take1Done && row.high >= plan.take1_price) {
      const partialQuantity = quantity >= LOT_SIZE * 2
        ? Math.floor((quantity / 2) / LOT_SIZE) * LOT_SIZE
        : 0;
      if (partialQuantity > 0) {
        sell(plan.take1_price, partialQuantity, row.time, "达到1R，分步止盈一半", "TAKE1");
        take1Done = true;
        trailingStop = Math.max(trailingStop, plan.entry_price);
      }
    }
    if (quantity > 0 && row.high >= plan.take2_price) {
      sell(plan.take2_price, quantity, row.time, "达到目标R，退出剩余仓位", "TAKE2");
      break;
    }
    if (take1Done && quantity > 0 && row.purple > 0) {
      trailingStop = Math.max(trailingStop, row.purple * (1 - trailingPurpleBufferPct));
    }
    if (row.time >= "14:50" && quantity > 0) {
      sell(row.open, quantity, row.time, "14:50前后清仓，不隔夜", "TIME_EXIT");
      break;
    }
  }

  if (quantity > 0 && rows.length) {
    const last = rows.at(-1);
    sell(last.close, quantity, last.time, "回放结束按最后价格清仓", "SESSION_END_EXIT");
  }
  const finalValue = cash;
  const entryPrice = plan.entry_price;
  const riskAmount = Math.max(1e-9, plan.planned_risk_amount);
  return {
    ok: true,
    mode: "intraday_replay",
    code: options.code,
    name: options.name || options.code,
    trading_date: options.date,
    strategy: "intraday_confluence_kelly",
    strategy_label: "竞价状态 + 紫线/资金/动量组合确认 + 折扣凯利风控",
    auction: analysis.auction,
    entry_signal: analysis.entry_signal,
    rejected_candidates: analysis.rejected_candidates,
    trade_plan: plan,
    timeline,
    fills,
    chart_rows: rows,
    metrics: {
      initial_cash: round(initialCash, 2),
      final_value: round(finalValue, 2),
      net_profit: round(finalValue - initialCash, 2),
      total_return: round(finalValue / initialCash - 1, 6),
      position_return: round(realizedPnl / Math.max(1, plan.notional), 6),
      realized_pnl: round(realizedPnl, 2),
      total_fees: round(fees, 2),
      closed_trades: 1,
      r_multiple_after_cost: round(realizedPnl / riskAmount, 3),
      mae_pct: round(minimumLow / entryPrice - 1, 6),
      mfe_pct: round(maximumHigh / entryPrice - 1, 6),
    },
    execution_model: "已完成分钟与事件组合出信号，下一分钟开盘叠加滑点成交；同分钟止损优先。",
    fee_model: "可转债双边佣金、无印花税；L1主力资金指标仅作近似。",
  };
}

module.exports = {
  LOT_SIZE,
  buildTradePlan,
  findIntradayEntry,
  kellyRiskPlan,
  normalizeEvents,
  normalizeMinuteRows,
  replayIntraday,
  summarizeAuctionPair,
};
