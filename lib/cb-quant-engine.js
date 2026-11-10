"use strict";

const LOT_SIZE = 10;
const TRADING_DAYS_PER_YEAR = 252;
const MAX_HISTORY_ROWS = 500;

function finiteNumber(value, fallback = null) {
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

function normalizeConvertibleBondCode(value) {
  const text = String(value || "").trim().toUpperCase();
  const marketCode = text.match(/^(\d{6})\.(SH|SZ)$/);
  if (marketCode) return `${marketCode[1]}.${marketCode[2]}`;
  const prefixed = text.match(/^(SH|SZ)(\d{6})$/);
  if (prefixed) return `${prefixed[2]}.${prefixed[1]}`;
  const bare = text.match(/^(\d{6})$/);
  if (!bare) throw new Error(`无效的可转债代码: ${text || "空"}`);
  const code = bare[1];
  if (/^(110|111|113|118)/.test(code)) return `${code}.SH`;
  if (/^(123|127|128)/.test(code)) return `${code}.SZ`;
  throw new Error(`无法判断可转债市场: ${code}`);
}

function normalizeBars(rows) {
  if (!Array.isArray(rows)) return [];
  const byDate = new Map();
  for (const raw of rows.slice(-MAX_HISTORY_ROWS)) {
    const date = normalizeDate(raw?.date || raw?.index || raw?.time);
    const open = finiteNumber(raw?.open);
    const high = finiteNumber(raw?.high);
    const low = finiteNumber(raw?.low);
    const close = finiteNumber(raw?.close);
    if (!date || ![open, high, low, close].every((item) => item > 0)) continue;
    byDate.set(date, {
      date,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      volume: Math.max(0, finiteNumber(raw?.volume, 0)),
      amount: Math.max(0, finiteNumber(raw?.amount, 0)),
      suspend: Number(raw?.suspend || raw?.suspendFlag || 0),
    });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function rollingMean(values, period) {
  const output = [];
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    total += values[index];
    if (index >= period) total -= values[index - period];
    output.push(index + 1 >= period ? total / period : null);
  }
  return output;
}

function rollingStd(values, period, means = rollingMean(values, period)) {
  return values.map((_value, index) => {
    const mean = means[index];
    if (mean === null) return null;
    let variance = 0;
    for (let cursor = index + 1 - period; cursor <= index; cursor += 1) {
      variance += (values[cursor] - mean) ** 2;
    }
    return Math.sqrt(variance / period);
  });
}

function ema(values, period) {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  const output = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    output.push(alpha * values[index] + (1 - alpha) * output[index - 1]);
  }
  return output;
}

function crossSignal(previousLeft, currentLeft, previousRight, currentRight) {
  if (![previousLeft, currentLeft, previousRight, currentRight].every(Number.isFinite)) {
    return "hold";
  }
  if (previousLeft <= previousRight && currentLeft > currentRight) return "buy";
  if (previousLeft >= previousRight && currentLeft < currentRight) return "sell";
  return "hold";
}

function strategyResult(side, reason, values = {}) {
  return { side, reason, values };
}

const STRATEGIES = {
  ma20_cross: {
    label: "MA20 持有法",
    group: "趋势",
    minBars: 22,
    description: "收盘向上突破 MA20 买入，向下跌破 MA20 卖出。",
    evaluate(bars) {
      if (bars.length < 22) return strategyResult("hold", "日K不足22根");
      const close = bars.map((bar) => bar.close);
      const ma20 = rollingMean(close, 20);
      const index = close.length - 1;
      const side = crossSignal(close[index - 1], close[index], ma20[index - 1], ma20[index]);
      return strategyResult(
        side,
        side === "buy" ? "收盘向上突破MA20" : side === "sell" ? "收盘向下跌破MA20" : "收盘未穿越MA20",
        { close: close[index], ma20: ma20[index] },
      );
    },
  },
  macd_daily: {
    label: "MACD 日线 12/26/9",
    group: "趋势",
    minBars: 30,
    description: "日线 DIF 上穿 DEA 买入，下穿卖出。",
    evaluate(bars) {
      if (bars.length < 30) return strategyResult("hold", "日K不足30根");
      const close = bars.map((bar) => bar.close);
      const fast = ema(close, 12);
      const slow = ema(close, 26);
      const dif = fast.map((value, index) => value - slow[index]);
      const dea = ema(dif, 9);
      const index = close.length - 1;
      const side = crossSignal(dif[index - 1], dif[index], dea[index - 1], dea[index]);
      return strategyResult(
        side,
        side === "buy" ? "DIF上穿DEA" : side === "sell" ? "DIF下穿DEA" : "MACD无交叉",
        { dif: dif[index], dea: dea[index] },
      );
    },
  },
  ema_5_20: {
    label: "EMA 5/20 双均线",
    group: "趋势",
    minBars: 25,
    description: "5日 EMA 上穿20日 EMA 买入，下穿卖出。",
    evaluate(bars) {
      if (bars.length < 25) return strategyResult("hold", "日K不足25根");
      const close = bars.map((bar) => bar.close);
      const fast = ema(close, 5);
      const slow = ema(close, 20);
      const index = close.length - 1;
      const side = crossSignal(fast[index - 1], fast[index], slow[index - 1], slow[index]);
      return strategyResult(
        side,
        side === "buy" ? "EMA5上穿EMA20" : side === "sell" ? "EMA5下穿EMA20" : "双均线无交叉",
        { ema5: fast[index], ema20: slow[index] },
      );
    },
  },
  purple_cross: {
    label: "紫线穿越（日线适配）",
    group: "现有指标",
    minBars: 30,
    description: "复用看板紫线公式：EMA4/7/28/56/112 均值；收盘上穿买入、下穿卖出。",
    evaluate(bars) {
      if (bars.length < 30) return strategyResult("hold", "日K不足30根");
      const close = bars.map((bar) => bar.close);
      const parts = [4, 7, 28, 56, 112].map((period) => ema(close, period));
      const purple = close.map((_value, index) => (
        parts.reduce((total, values) => total + values[index], 0) / parts.length
      ));
      const index = close.length - 1;
      const side = crossSignal(
        close[index - 1],
        close[index],
        purple[index - 1],
        purple[index],
      );
      return strategyResult(
        side,
        side === "buy" ? "收盘上穿紫线" : side === "sell" ? "收盘下穿紫线" : "收盘未穿越紫线",
        { close: close[index], purple: purple[index] },
      );
    },
  },
  bollinger_revert: {
    label: "布林回归",
    group: "均值回归",
    minBars: 25,
    description: "价格从下轨外收回时买入，向上穿越中轨时卖出。",
    evaluate(bars) {
      if (bars.length < 25) return strategyResult("hold", "日K不足25根");
      const close = bars.map((bar) => bar.close);
      const middle = rollingMean(close, 20);
      const deviation = rollingStd(close, 20, middle);
      const lower = middle.map((value, index) => (
        value === null ? null : value - 2 * deviation[index]
      ));
      const index = close.length - 1;
      let side = "hold";
      let reason = "价格位于布林带内";
      if (close[index - 1] <= lower[index - 1] && close[index] > lower[index]) {
        side = "buy";
        reason = "价格从布林下轨外收回";
      } else if (close[index - 1] <= middle[index - 1] && close[index] > middle[index]) {
        side = "sell";
        reason = "价格向上穿越布林中轨";
      }
      return strategyResult(side, reason, {
        close: close[index],
        middle: middle[index],
        lower: lower[index],
      });
    },
  },
  donchian_breakout: {
    label: "唐奇安突破 20/10",
    group: "突破",
    minBars: 22,
    description: "突破此前20日最高价买入，跌破此前10日最低价卖出。",
    evaluate(bars) {
      if (bars.length < 22) return strategyResult("hold", "日K不足22根");
      const current = bars.at(-1);
      const previous20 = bars.slice(-21, -1);
      const previous10 = bars.slice(-11, -1);
      const upper = Math.max(...previous20.map((bar) => bar.high));
      const lower = Math.min(...previous10.map((bar) => bar.low));
      if (current.close > upper) {
        return strategyResult("buy", "收盘突破此前20日最高价", { upper, lower });
      }
      if (current.close < lower) {
        return strategyResult("sell", "收盘跌破此前10日最低价", { upper, lower });
      }
      return strategyResult("hold", "未突破唐奇安通道", { upper, lower });
    },
  },
};

function listStrategies() {
  return Object.entries(STRATEGIES).map(([name, strategy]) => ({
    name,
    label: strategy.label,
    group: strategy.group,
    min_bars: strategy.minBars,
    description: strategy.description,
  }));
}

function evaluateStrategy(strategyName, bars) {
  const strategy = STRATEGIES[strategyName];
  if (!strategy) throw new Error(`未知策略: ${strategyName}`);
  return { strategy: strategyName, ...strategy.evaluate(normalizeBars(bars)) };
}

function computeMetrics(initialCash, trades, equityCurve) {
  const values = equityCurve.map((point) => point.total_asset);
  const finalValue = values.at(-1) ?? initialCash;
  const totalReturn = initialCash > 0 ? finalValue / initialCash - 1 : 0;
  const tradingDays = equityCurve.length;
  const years = tradingDays / TRADING_DAYS_PER_YEAR;
  const annualReturn = years > 0 && totalReturn > -1
    ? (1 + totalReturn) ** (1 / years) - 1
    : totalReturn;

  let peak = values[0] ?? initialCash;
  let maxDrawdown = 0;
  let maxDrawdownDays = 0;
  let drawdownDays = 0;
  for (const value of values) {
    if (value >= peak) {
      peak = value;
      drawdownDays = 0;
    } else {
      drawdownDays += 1;
      maxDrawdown = Math.max(maxDrawdown, peak > 0 ? 1 - value / peak : 0);
      maxDrawdownDays = Math.max(maxDrawdownDays, drawdownDays);
    }
  }

  const returns = [];
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] > 0) returns.push(values[index] / values[index - 1] - 1);
  }
  const mean = returns.length
    ? returns.reduce((total, value) => total + value, 0) / returns.length
    : 0;
  const variance = returns.length
    ? returns.reduce((total, value) => total + (value - mean) ** 2, 0) / returns.length
    : 0;
  const volatility = Math.sqrt(variance);
  const sharpe = volatility > 1e-12 ? (mean / volatility) * Math.sqrt(252) : 0;

  const closed = trades.filter((trade) => trade.side === "sell");
  const wins = closed.filter((trade) => trade.realized_pnl > 0);
  const losses = closed.filter((trade) => trade.realized_pnl <= 0);
  const grossProfit = wins.reduce((total, trade) => total + trade.realized_pnl, 0);
  const grossLoss = losses.reduce((total, trade) => total + trade.realized_pnl, 0);
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  return {
    initial_cash: round(initialCash, 2),
    final_value: round(finalValue, 2),
    net_profit: round(finalValue - initialCash, 2),
    total_return: round(totalReturn, 6),
    annual_return: round(annualReturn, 6),
    max_drawdown: round(maxDrawdown, 6),
    max_drawdown_days: maxDrawdownDays,
    sharpe_ratio: round(sharpe, 4),
    calmar_ratio: maxDrawdown > 0 ? round(annualReturn / maxDrawdown, 4) : 0,
    closed_trades: closed.length,
    won_trades: wins.length,
    lost_trades: losses.length,
    win_rate: closed.length ? round(wins.length / closed.length, 4) : 0,
    average_win: round(avgWin, 2),
    average_loss: round(avgLoss, 2),
    profit_loss_ratio: avgLoss < 0 ? round(Math.abs(avgWin / avgLoss), 2) : 0,
    profit_factor: grossLoss < 0 ? round(Math.abs(grossProfit / grossLoss), 2) : 0,
    trading_days: tradingDays,
    years: round(years, 3),
  };
}

function executionPrice(open, side, slippageBps) {
  const direction = side === "buy" ? 1 : -1;
  return open * (1 + direction * slippageBps / 10_000);
}

function runBacktest(options = {}) {
  const code = normalizeConvertibleBondCode(options.code);
  const strategyName = String(options.strategy || "ma20_cross");
  const strategy = STRATEGIES[strategyName];
  if (!strategy) throw new Error(`未知策略: ${strategyName}`);
  const bars = normalizeBars(options.bars);
  if (bars.length < strategy.minBars + 2) {
    throw new Error(`${code} 日K不足，${strategy.label}至少需要${strategy.minBars + 2}根`);
  }

  const initialCash = clamp(options.initialCash, 10_000, 1_000_000_000, 1_000_000);
  const commissionRate = clamp(options.commissionRate, 0, 0.01, 0.0001);
  const slippageBps = clamp(options.slippageBps, 0, 100, 2);
  const positionPct = clamp(options.positionPct, 1, 100, 95);
  const startDate = normalizeDate(options.startDate) || bars[0].date;
  const endDate = normalizeDate(options.endDate) || bars.at(-1).date;
  if (startDate > endDate) throw new Error("回测开始日期不能晚于结束日期");

  const firstIndex = bars.findIndex((bar) => bar.date >= startDate);
  let lastIndex = -1;
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    if (bars[index].date <= endDate) {
      lastIndex = index;
      break;
    }
  }
  if (firstIndex < 0 || lastIndex < firstIndex) throw new Error("所选区间没有可用日K");

  let cash = initialCash;
  let quantity = 0;
  let costBasis = 0;
  let totalFees = 0;
  let pendingOrder = null;
  const signals = [];
  const trades = [];
  const equityCurve = [];

  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const bar = bars[index];
    if (pendingOrder) {
      const side = pendingOrder.side;
      const price = executionPrice(bar.open, side, slippageBps);
      const tradeable = bar.suspend === 0 && price > 0 && (bar.amount > 0 || bar.volume > 0);
      if (!tradeable) {
        signals.push({
          date: bar.date,
          side,
          status: "unfilled",
          reason: "下一根K线停牌或无成交量/成交额",
          signal_date: pendingOrder.signal_date,
        });
      } else if (side === "buy" && quantity === 0) {
        const budget = cash * (positionPct / 100);
        const units = Math.floor(budget / (price * (1 + commissionRate)) / LOT_SIZE) * LOT_SIZE;
        if (units >= LOT_SIZE) {
          const gross = units * price;
          const fee = gross * commissionRate;
          if (gross + fee <= cash + 1e-6) {
            cash -= gross + fee;
            quantity = units;
            costBasis = gross + fee;
            totalFees += fee;
            trades.push({
              date: bar.date,
              signal_date: pendingOrder.signal_date,
              side,
              price: round(price, 4),
              quantity: units,
              gross_amount: round(gross, 2),
              fee: round(fee, 2),
              realized_pnl: 0,
              reason: pendingOrder.reason,
            });
          }
        }
      } else if (side === "sell" && quantity > 0) {
        const soldQuantity = quantity;
        const gross = soldQuantity * price;
        const fee = gross * commissionRate;
        const realizedPnl = gross - fee - costBasis;
        cash += gross - fee;
        totalFees += fee;
        trades.push({
          date: bar.date,
          signal_date: pendingOrder.signal_date,
          side,
          price: round(price, 4),
          quantity: soldQuantity,
          gross_amount: round(gross, 2),
          fee: round(fee, 2),
          realized_pnl: round(realizedPnl, 2),
          reason: pendingOrder.reason,
        });
        quantity = 0;
        costBasis = 0;
      }
      pendingOrder = null;
    }

    const visibleBars = bars.slice(0, index + 1);
    const signal = strategy.evaluate(visibleBars);
    if (signal.side === "buy" || signal.side === "sell") {
      signals.push({
        date: bar.date,
        side: signal.side,
        status: "generated",
        reason: signal.reason,
        values: Object.fromEntries(
          Object.entries(signal.values || {}).map(([key, value]) => [key, round(value, 6)]),
        ),
      });
      const eligible = signal.side === "buy" ? quantity === 0 : quantity > 0;
      if (eligible) {
        pendingOrder = {
          side: signal.side,
          reason: signal.reason,
          signal_date: bar.date,
        };
      }
    }

    const marketValue = quantity * bar.close;
    equityCurve.push({
      date: bar.date,
      cash: round(cash, 2),
      market_value: round(marketValue, 2),
      total_asset: round(cash + marketValue, 2),
      position_quantity: quantity,
    });
  }

  const firstBar = bars[firstIndex];
  const lastBar = bars[lastIndex];
  const benchmarkPrice = executionPrice(firstBar.open, "buy", slippageBps);
  const benchmarkBudget = initialCash * (positionPct / 100);
  const benchmarkQuantity = Math.floor(
    benchmarkBudget / (benchmarkPrice * (1 + commissionRate)) / LOT_SIZE,
  ) * LOT_SIZE;
  const benchmarkFee = benchmarkQuantity * benchmarkPrice * commissionRate;
  const benchmarkCash = initialCash - benchmarkQuantity * benchmarkPrice - benchmarkFee;
  const benchmarkCurve = bars.slice(firstIndex, lastIndex + 1).map((bar) => ({
    date: bar.date,
    nav: round(benchmarkCash + benchmarkQuantity * bar.close, 2),
  }));
  const metrics = computeMetrics(initialCash, trades, equityCurve);

  return {
    ok: true,
    mode: "historical_backtest",
    code,
    strategy: strategyName,
    strategy_label: strategy.label,
    params: {
      start_date: firstBar.date,
      end_date: lastBar.date,
      initial_cash: initialCash,
      commission_rate: commissionRate,
      slippage_bps: slippageBps,
      position_pct: positionPct,
      lot_size: LOT_SIZE,
      settlement: "T+0",
    },
    execution_model: "第T日收盘出信号，第T+1根日K开盘价叠加滑点成交",
    fee_model: "可转债双边佣金，无印花税",
    signals,
    trades,
    equity_curve: equityCurve,
    benchmark_curve: benchmarkCurve,
    benchmark: {
      label: `同期${positionPct}%仓位买入持有`,
      total_return: round((benchmarkCurve.at(-1).nav / initialCash) - 1, 6),
      final_value: benchmarkCurve.at(-1).nav,
    },
    metrics: {
      ...metrics,
      total_fees: round(totalFees, 2),
      exposure_days: equityCurve.filter((point) => point.position_quantity > 0).length,
    },
    open_position: quantity > 0 ? {
      quantity,
      cost_basis: round(costBasis, 2),
      last_price: lastBar.close,
      market_value: round(quantity * lastBar.close, 2),
      unrealized_pnl: round(quantity * lastBar.close - costBasis, 2),
    } : null,
    pending_order: pendingOrder,
    bars: bars.slice(firstIndex, lastIndex + 1),
  };
}

function compareStrategies(options = {}) {
  const results = [];
  const failed = [];
  for (const strategy of Object.keys(STRATEGIES)) {
    try {
      const result = runBacktest({ ...options, strategy });
      results.push({
        strategy,
        strategy_label: result.strategy_label,
        params: result.params,
        metrics: result.metrics,
        benchmark: result.benchmark,
        equity_curve: result.equity_curve,
        benchmark_curve: result.benchmark_curve,
        trades: result.trades.length,
      });
    } catch (error) {
      failed.push({ strategy, error: error.message });
    }
  }
  results.sort((left, right) => (
    right.metrics.annual_return - left.metrics.annual_return
    || right.metrics.sharpe_ratio - left.metrics.sharpe_ratio
  ));
  return {
    ok: results.length > 0,
    mode: "strategy_comparison",
    code: normalizeConvertibleBondCode(options.code),
    execution_model: "所有策略统一使用收盘信号、下一根日K开盘成交",
    results,
    failed,
    best: results[0] || null,
  };
}

function createPaperState(initialCash = 1_000_000) {
  const cash = clamp(initialCash, 10_000, 1_000_000_000, 1_000_000);
  const now = new Date().toISOString();
  return {
    schema_version: 4,
    mode: "paper_only",
    initial_cash: cash,
    cash,
    realized_pnl: 0,
    fees_paid: 0,
    positions: {},
    fills: [],
    signals: [],
    equity_history: [{ time: now, total_asset: cash }],
    processed_signal_keys: [],
    strategy_state: {
      atr_grid: {},
    },
    settings: {
      codes: [],
      strategy: "ma20_cross",
      allocation_pct: 20,
      commission_rate: 0.0001,
      slippage_bps: 2,
      cycle_seconds: 60,
      win_rate: 0.52,
      kelly_discount: 0.25,
      max_risk_pct: 0.005,
      max_position_pct: 0.2,
      take1_r: 1,
      take2_r: 2,
      max_stop_pct: 0.02,
      grid_position_size: 100,
      grid_max_position: 500,
      grid_atr_period: 14,
      grid_atr_multiplier: 0.5,
      grid_min_spacing_pct: 0.1,
      grid_max_spacing_pct: 0.8,
      grid_ma_period: 20,
      grid_trend_threshold_pct: 0.3,
    },
    runtime: {
      running: false,
      cycle_count: 0,
      last_cycle_at: null,
      last_error: null,
      stopped_reason: null,
    },
    created_at: now,
    updated_at: now,
  };
}

function normalizePaperState(raw) {
  const base = createPaperState(raw?.initial_cash);
  const state = {
    ...base,
    ...(raw && typeof raw === "object" ? raw : {}),
    positions: raw?.positions && typeof raw.positions === "object" ? raw.positions : {},
    fills: Array.isArray(raw?.fills) ? raw.fills.slice(-500) : [],
    signals: Array.isArray(raw?.signals) ? raw.signals.slice(-500) : [],
    equity_history: Array.isArray(raw?.equity_history)
      ? raw.equity_history.slice(-1000)
      : base.equity_history,
    processed_signal_keys: Array.isArray(raw?.processed_signal_keys)
      ? raw.processed_signal_keys.slice(-1000)
      : [],
    strategy_state: {
      ...base.strategy_state,
      ...(raw?.strategy_state || {}),
      atr_grid: raw?.strategy_state?.atr_grid && typeof raw.strategy_state.atr_grid === "object"
        ? raw.strategy_state.atr_grid
        : {},
    },
    settings: { ...base.settings, ...(raw?.settings || {}) },
    runtime: { ...base.runtime, ...(raw?.runtime || {}) },
  };
  state.mode = "paper_only";
  return snapshotPaperState(state);
}

function snapshotPaperState(raw) {
  const state = raw;
  let marketValue = 0;
  let unrealizedPnl = 0;
  for (const position of Object.values(state.positions || {})) {
    const price = finiteNumber(position.market_price, position.average_cost);
    position.market_price = price;
    position.market_value = round(position.quantity * price, 2);
    position.unrealized_pnl = round(
      position.quantity * price - finiteNumber(position.cost_basis, 0),
      2,
    );
    position.unrealized_pnl_pct = position.cost_basis > 0
      ? round(position.unrealized_pnl / position.cost_basis, 6)
      : 0;
    marketValue += position.market_value;
    unrealizedPnl += position.unrealized_pnl;
  }
  state.cash = round(state.cash, 2);
  state.market_value = round(marketValue, 2);
  state.unrealized_pnl = round(unrealizedPnl, 2);
  state.total_asset = round(state.cash + marketValue, 2);
  state.total_pnl = round(state.total_asset - state.initial_cash, 2);
  state.total_return = state.initial_cash > 0
    ? round(state.total_pnl / state.initial_cash, 6)
    : 0;
  state.position_count = Object.keys(state.positions || {}).length;
  return state;
}

function markPaperState(raw, quotes, timestamp = new Date().toISOString()) {
  const state = normalizePaperState(raw);
  const quoteMap = new Map();
  for (const quote of Array.isArray(quotes) ? quotes : []) {
    try {
      quoteMap.set(normalizeConvertibleBondCode(quote.code || quote.monitor_code), quote);
    } catch {
      // Ignore unrelated market rows.
    }
  }
  for (const [code, position] of Object.entries(state.positions)) {
    const quote = quoteMap.get(code);
    const price = finiteNumber(quote?.price);
    if (price > 0) {
      position.market_price = price;
      position.last_mark_at = quote.timetag || timestamp;
      position.quote_source = quote.source || "MiniQMT full_tick";
    }
  }
  state.updated_at = timestamp;
  snapshotPaperState(state);
  const lastPoint = state.equity_history.at(-1);
  if (!lastPoint || lastPoint.time !== timestamp) {
    state.equity_history.push({ time: timestamp, total_asset: state.total_asset });
    state.equity_history = state.equity_history.slice(-1000);
  }
  return state;
}

function executePaperOrder(raw, order = {}) {
  const state = normalizePaperState(raw);
  const code = normalizeConvertibleBondCode(order.code);
  const side = String(order.side || "").toLowerCase();
  if (!['buy', 'sell'].includes(side)) throw new Error("模拟订单方向必须是 buy 或 sell");
  const quotePrice = finiteNumber(order.price);
  if (!(quotePrice > 0)) throw new Error("模拟订单缺少有效价格");
  const commissionRate = clamp(
    order.commissionRate,
    0,
    0.01,
    state.settings.commission_rate,
  );
  const slippageBps = clamp(order.slippageBps, 0, 100, state.settings.slippage_bps);
  const price = executionPrice(quotePrice, side, slippageBps);
  const timestamp = order.timestamp || new Date().toISOString();
  const existing = state.positions[code];
  let quantity = Math.floor(finiteNumber(order.quantity, 0) / LOT_SIZE) * LOT_SIZE;

  if (side === "buy") {
    if (quantity < LOT_SIZE) {
      const allocationPct = clamp(
        order.allocationPct,
        1,
        100,
        state.settings.allocation_pct,
      );
      const budget = state.total_asset * allocationPct / 100;
      quantity = Math.floor(
        Math.min(state.cash, budget) / (price * (1 + commissionRate)) / LOT_SIZE,
      ) * LOT_SIZE;
    }
    if (quantity < LOT_SIZE) throw new Error("模拟账户可用资金不足一手（10张）");
    const gross = quantity * price;
    const fee = gross * commissionRate;
    if (gross + fee > state.cash + 1e-6) throw new Error("模拟账户可用资金不足");
    const previousQuantity = existing?.quantity || 0;
    const previousCost = existing?.cost_basis || 0;
    const costBasis = previousCost + gross + fee;
    state.cash -= gross + fee;
    state.fees_paid += fee;
    state.positions[code] = {
      code,
      name: order.name || existing?.name || code,
      quantity: previousQuantity + quantity,
      available_quantity: previousQuantity + quantity,
      cost_basis: round(costBasis, 2),
      average_cost: round(costBasis / (previousQuantity + quantity), 4),
      market_price: quotePrice,
      opened_at: existing?.opened_at || timestamp,
      last_trade_at: timestamp,
      last_mark_at: timestamp,
      quote_source: order.quoteSource || "MiniQMT full_tick",
      risk_plan: order.riskPlan || existing?.risk_plan || null,
      entry_signal_key: order.entrySignalKey || existing?.entry_signal_key || null,
    };
    state.fills.push({
      id: `paper-${Date.now()}-${state.fills.length + 1}`,
      time: timestamp,
      code,
      name: state.positions[code].name,
      side,
      quantity,
      price: round(price, 4),
      quote_price: quotePrice,
      quote_quality: order.quoteQuality || "unknown",
      gross_amount: round(gross, 2),
      fee: round(fee, 2),
      realized_pnl: 0,
      strategy: order.strategy || "manual",
      reason: order.reason || "手工模拟买入",
      settlement: "T+0",
      status: "filled",
      risk_plan: order.riskPlan || null,
    });
  } else {
    if (!existing || existing.quantity < LOT_SIZE) throw new Error(`${code} 没有可卖模拟持仓`);
    if (quantity < LOT_SIZE) quantity = existing.available_quantity;
    quantity = Math.min(quantity, existing.available_quantity);
    quantity = Math.floor(quantity / LOT_SIZE) * LOT_SIZE;
    if (quantity < LOT_SIZE) throw new Error(`${code} 模拟可卖数量不足一手`);
    const gross = quantity * price;
    const fee = gross * commissionRate;
    const allocatedCost = existing.cost_basis * (quantity / existing.quantity);
    const realizedPnl = gross - fee - allocatedCost;
    state.cash += gross - fee;
    state.realized_pnl += realizedPnl;
    state.fees_paid += fee;
    const remaining = existing.quantity - quantity;
    if (remaining === 0) {
      delete state.positions[code];
    } else {
      existing.quantity = remaining;
      existing.available_quantity = remaining;
      existing.cost_basis = round(existing.cost_basis - allocatedCost, 2);
      existing.average_cost = round(existing.cost_basis / remaining, 4);
      existing.market_price = quotePrice;
      existing.last_trade_at = timestamp;
    }
    state.fills.push({
      id: `paper-${Date.now()}-${state.fills.length + 1}`,
      time: timestamp,
      code,
      name: order.name || existing.name || code,
      side,
      quantity,
      price: round(price, 4),
      quote_price: quotePrice,
      quote_quality: order.quoteQuality || "unknown",
      gross_amount: round(gross, 2),
      fee: round(fee, 2),
      realized_pnl: round(realizedPnl, 2),
      strategy: order.strategy || "manual",
      reason: order.reason || "手工模拟卖出",
      settlement: "T+0",
      status: "filled",
    });
  }

  state.fills = state.fills.slice(-500);
  state.updated_at = timestamp;
  snapshotPaperState(state);
  state.equity_history.push({ time: timestamp, total_asset: state.total_asset });
  state.equity_history = state.equity_history.slice(-1000);
  return state;
}

module.exports = {
  LOT_SIZE,
  compareStrategies,
  computeMetrics,
  createPaperState,
  evaluateStrategy,
  executePaperOrder,
  listStrategies,
  markPaperState,
  normalizeBars,
  normalizeConvertibleBondCode,
  normalizePaperState,
  runBacktest,
  snapshotPaperState,
};
