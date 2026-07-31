#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DAY_RECORD_BYTES = 32;
const DEFAULT_START = "20260618";
const DEFAULT_END = "20260729";
const DEFAULT_THRESHOLD = 200_000_000;

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith("--") ? argv[++index] : true;
  }
  return result;
}

function requirePath(value, flag) {
  if (!value) throw new Error(`missing ${flag}`);
  return path.resolve(String(value));
}

function formatDate(value) {
  const text = String(value);
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function nextWeekday(value) {
  const text = String(value);
  const date = new Date(
    Date.UTC(
      Number(text.slice(0, 4)),
      Number(text.slice(4, 6)) - 1,
      Number(text.slice(6, 8)),
    ),
  );
  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while ([0, 6].includes(date.getUTCDay()));
  return Number(date.toISOString().slice(0, 10).replaceAll("-", ""));
}

function parseDayFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length % DAY_RECORD_BYTES !== 0) {
    throw new Error(`${filePath} is not a valid 32-byte TDX .day file`);
  }

  const rows = [];
  for (let offset = 0; offset < buffer.length; offset += DAY_RECORD_BYTES) {
    rows.push({
      date: buffer.readInt32LE(offset),
      open: buffer.readInt32LE(offset + 4),
      high: buffer.readInt32LE(offset + 8),
      low: buffer.readInt32LE(offset + 12),
      close: buffer.readInt32LE(offset + 16),
      amount: buffer.readFloatLE(offset + 20),
      volume: buffer.readInt32LE(offset + 24),
    });
  }
  return rows;
}

function codeFromFilename(filename) {
  const match = filename.match(/^(sh|sz)(\d{6})\.day$/i);
  if (!match) return "";
  return `${match[2]}.${match[1].toUpperCase()}`;
}

function readNames(filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (Array.isArray(payload)) {
    return Object.fromEntries(
      payload
        .map((row) => [
          String(row.code || row["转债代码"] || ""),
          String(row.name || row["转债名称"] || ""),
        ])
        .filter(([code, name]) => code && name),
    );
  }
  return Object.fromEntries(
    Object.entries(payload).map(([code, value]) => [
      code,
      String(value?.InstrumentName || value?.name || code),
    ]),
  );
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function compound(values) {
  return values.reduce((result, value) => result * (1 + value), 1) - 1;
}

function correlation(left, right) {
  const leftMean = mean(left);
  const rightMean = mean(right);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  return covariance / Math.sqrt(leftVariance * rightVariance);
}

function normalizeSeries(returns) {
  let value = 100;
  return returns.map((dailyReturn) => {
    value *= 1 + dailyReturn;
    return round(value, 4);
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const indexPath = requirePath(args.index, "--index");
  const bondsDir = requirePath(args["bonds-dir"], "--bonds-dir");
  const namesPath = requirePath(args.names, "--names");
  const outputPath = requirePath(args.output, "--output");
  const start = Number(String(args.start || DEFAULT_START).replaceAll("-", ""));
  const end = Number(String(args.end || DEFAULT_END).replaceAll("-", ""));
  const threshold = Number(args.threshold || DEFAULT_THRESHOLD);
  const auditTolerance = Number(args["audit-tolerance"] || 0.001);
  const names = readNames(namesPath);

  const indexRows = parseDayFile(indexPath);
  const indexByDate = new Map(indexRows.map((row, index) => [
    row.date,
    { ...row, prevClose: indexRows[index - 1]?.close },
  ]));

  const bondRows = [];
  const allBondRowsByCode = new Map();
  for (const filename of fs.readdirSync(bondsDir).sort()) {
    const code = codeFromFilename(filename);
    if (!code) continue;
    const rows = parseDayFile(path.join(bondsDir, filename));
    allBondRowsByCode.set(code, rows);
    rows.forEach((row, index) => {
      const previous = rows[index - 1];
      if (!previous?.close) return;
      bondRows.push({
        ...row,
        code,
        name: names[code] || code,
        prevAmount: previous.amount,
        prevClose: previous.close,
        return: row.close / previous.close - 1,
      });
    });
  }

  const rowsByDate = new Map();
  for (const row of bondRows) {
    if (!rowsByDate.has(row.date)) rowsByDate.set(row.date, []);
    rowsByDate.get(row.date).push(row);
  }

  const auditedDates = [];
  const excludedDates = [];
  for (const date of [...indexByDate.keys()].sort((a, b) => a - b)) {
    if (date < start || date > end) continue;
    const indexRow = indexByDate.get(date);
    const candidates = (rowsByDate.get(date) || []).filter(
      (row) => row.prevAmount > threshold,
    );
    const reproducedAmount = candidates.reduce((sum, row) => sum + row.amount, 0);
    const relativeError = Math.abs(reproducedAmount - indexRow.amount)
      / Math.max(1, indexRow.amount);
    const audit = {
      date: formatDate(date),
      indexAmountYi: round(indexRow.amount / 1e8, 4),
      reproducedAmountYi: round(reproducedAmount / 1e8, 4),
      relativeErrorPct: round(relativeError * 100, 4),
    };
    if (indexRow.prevClose && candidates.length > 0 && relativeError <= auditTolerance) {
      auditedDates.push(date);
    } else {
      excludedDates.push(audit);
    }
  }

  const daily = [];
  const detail = [];
  for (const date of auditedDates) {
    const rows = rowsByDate.get(date) || [];
    const indexRow = indexByDate.get(date);
    const selected2b = rows.filter((row) => row.prevAmount > threshold);
    const selected1b = rows.filter((row) => row.prevAmount > 100_000_000);
    const sameDay2b = rows.filter((row) => row.amount > threshold);
    const actualReturn = indexRow.close / indexRow.prevClose - 1;
    const replicaReturn = mean(selected2b.map((row) => row.return));
    const threshold1bReturn = mean(selected1b.map((row) => row.return));
    const sameDayReturn = mean(sameDay2b.map((row) => row.return));

    daily.push({
      date: formatDate(date),
      actualReturnPct: round(actualReturn * 100, 6),
      replica2bReturnPct: round(replicaReturn * 100, 6),
      replica1bReturnPct: round(threshold1bReturn * 100, 6),
      sameDay2bReturnPct: round(sameDayReturn * 100, 6),
      errorBp: round((replicaReturn - actualReturn) * 10_000, 4),
      constituentCount2b: selected2b.length,
      constituentCount1b: selected1b.length,
      indexAmountYi: round(indexRow.amount / 1e8, 4),
      reproducedAmountYi: round(
        selected2b.reduce((sum, row) => sum + row.amount, 0) / 1e8,
        4,
      ),
    });

    for (const row of selected2b.sort((left, right) => right.prevAmount - left.prevAmount)) {
      detail.push({
        date: formatDate(date),
        code: row.code,
        name: row.name,
        previousAmountYi: round(row.prevAmount / 1e8, 4),
        returnPct: round(row.return * 100, 4),
        close: round(row.close / 10_000, 4),
      });
    }
  }

  const summary = [];
  const detailsByCode = new Map();
  for (const row of detail) {
    if (!detailsByCode.has(row.code)) detailsByCode.set(row.code, []);
    detailsByCode.get(row.code).push(row);
  }
  for (const [code, rows] of detailsByCode) {
    const returns = rows.map((row) => row.returnPct / 100);
    const best = [...rows].sort((left, right) => right.returnPct - left.returnPct)[0];
    const worst = [...rows].sort((left, right) => left.returnPct - right.returnPct)[0];
    const upDays = rows.filter((row) => row.returnPct > 0).length;
    const downDays = rows.filter((row) => row.returnPct < 0).length;
    summary.push({
      code,
      name: rows[0].name,
      selectedDays: rows.length,
      firstSelected: rows[0].date,
      lastSelected: rows.at(-1).date,
      selectedDayCompoundReturnPct: round(compound(returns) * 100, 4),
      selectedDayAverageReturnPct: round(mean(returns) * 100, 4),
      upDays,
      downDays,
      winRatePct: round((upDays / rows.length) * 100, 4),
      bestDate: best.date,
      bestReturnPct: best.returnPct,
      worstDate: worst.date,
      worstReturnPct: worst.returnPct,
      averagePreviousAmountYi: round(mean(rows.map((row) => row.previousAmountYi)), 4),
    });
  }
  summary.sort(
    (left, right) =>
      right.selectedDays - left.selectedDays
      || right.selectedDayCompoundReturnPct - left.selectedDayCompoundReturnPct,
  );

  const actualReturns = daily.map((row) => row.actualReturnPct / 100);
  const replica2bReturns = daily.map((row) => row.replica2bReturnPct / 100);
  const replica1bReturns = daily.map((row) => row.replica1bReturnPct / 100);
  const sameDay2bReturns = daily.map((row) => row.sameDay2bReturnPct / 100);
  const actualNormalized = normalizeSeries(actualReturns);
  const replica2bNormalized = normalizeSeries(replica2bReturns);
  const replica1bNormalized = normalizeSeries(replica1bReturns);
  const sameDay2bNormalized = normalizeSeries(sameDay2bReturns);
  daily.forEach((row, index) => {
    row.actualNormalized = actualNormalized[index];
    row.replica2bNormalized = replica2bNormalized[index];
    row.replica1bNormalized = replica1bNormalized[index];
    row.sameDay2bNormalized = sameDay2bNormalized[index];
  });

  const payload = {
    metadata: {
      title: "通达信活跃可转债指数 880677 复刻",
      generatedAt: new Date().toISOString(),
      source: "通达信本地 .day 文件",
      period: {
        start: formatDate(auditedDates[0]),
        end: formatDate(auditedDates.at(-1)),
      },
      completeTradingDays: auditedDates.length,
      excludedDates,
      methodology: {
        selection: `前一交易日成交额 > ${threshold / 1e8}亿元`,
        weighting: "当日成分债涨跌幅等权平均",
        rebalance: "每日",
        audit: "成分债当日成交额合计与 880677 当日成交额核对",
        sameDaySelectionWarning: "当日成交额筛选含未来信息，仅用于偏差诊断",
      },
    },
    metrics: {
      observationCount: detail.length,
      uniqueBondCount: summary.length,
      averageConstituentCount2b: round(mean(daily.map((row) => row.constituentCount2b)), 1),
      averageConstituentCount1b: round(mean(daily.map((row) => row.constituentCount1b)), 1),
      persistentBondCount: summary.filter((row) => row.selectedDays === auditedDates.length).length,
      actualEnd: actualNormalized.at(-1),
      replica2bEnd: replica2bNormalized.at(-1),
      replica1bEnd: replica1bNormalized.at(-1),
      sameDay2bEnd: sameDay2bNormalized.at(-1),
      replica2bCorrelation: round(correlation(actualReturns, replica2bReturns), 6),
      replica1bCorrelation: round(correlation(actualReturns, replica1bReturns), 6),
      replica2bMeanAbsoluteErrorBp: round(
        mean(daily.map((row) => Math.abs(row.errorBp))),
        2,
      ),
      replica1bMeanAbsoluteErrorBp: round(
        mean(
          daily.map(
            (row) => Math.abs(row.replica1bReturnPct - row.actualReturnPct) * 100,
          ),
        ),
        2,
      ),
    },
    indexDailyK: indexRows.slice(-250).map((row) => ({
      date: formatDate(row.date),
      open: round(row.open / 100, 4),
      high: round(row.high / 100, 4),
      low: round(row.low / 100, 4),
      close: round(row.close / 100, 4),
      amount: round(row.amount, 2),
      volume: row.volume,
      source: "通达信 880677",
    })),
    bondCandidates: [...allBondRowsByCode.entries()].map(([code, rows]) => {
      const recent = rows.slice(-6);
      const latest = recent.at(-1);
      const previousFive = recent.slice(-6, -1);
      return {
        code,
        name: names[code] || code,
        latestDate: formatDate(latest.date),
        latestClose: round(latest.close / 10_000, 4),
        latestAmount: round(latest.amount, 2),
        latestVolume: latest.volume,
        average5Volume: round(mean(previousFive.map((row) => row.volume)), 2),
        close3SessionsAgo: recent.length >= 4
          ? round(recent.at(-4).close / 10_000, 4)
          : null,
      };
    }),
    seedUniverse: {
      effectiveDate: formatDate(nextWeekday(end)),
      selectedFromDate: formatDate(end),
      threshold: threshold,
      constituents: bondRows
        .filter((row) => row.date === end && row.amount > threshold)
        .sort((left, right) => right.amount - left.amount)
        .map((row) => ({
          code: row.code,
          name: row.name,
          previousAmount: round(row.amount, 2),
          previousVolume: row.volume,
        })),
    },
    daily,
    summary,
    detail,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    `Wrote ${outputPath}: ${daily.length} days, ${detail.length} observations, ${summary.length} bonds`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
