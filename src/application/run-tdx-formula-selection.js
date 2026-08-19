"use strict";

const {
  DEFAULT_TDX_FORMULAS,
  formulaUniverseSignature,
  mergeDateCounts,
  mergeSelectedRows,
  normalizeFormulaBatchResult,
  normalizeTdxUniverse,
  partitionOrdinaryConvertibleBonds,
} = require("../domain/tdx-formula-selection");
const { callTq } = require("../infrastructure/tdx-tq-client");
const {
  readFormulaSelectionSnapshot,
  writeFormulaSelectionSnapshot,
} = require("../infrastructure/tdx-formula-selection-store");

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function latestDate(dates) {
  return Object.keys(dates || {}).sort().at(-1) || "";
}

function marketLabel(market) {
  return ({
    "5": "全部A股",
    "32": "可转债",
  })[String(market)] || `通达信市场 ${market}`;
}

function newFormulaState(code, info, totalBatches) {
  return {
    code,
    name: info?.acName || code,
    lineNames: (info?.Line || []).map((line) => line?.LineName).filter(Boolean),
    parameterCount: Number(info?.ParaNum || 0),
    status: "pending",
    nextBatchIndex: 0,
    totalBatches,
    processedCount: 0,
    returnedCount: 0,
    evaluatedCodes: [],
    missingCount: 0,
    missingCodes: [],
    asOf: "",
    dates: {},
    selectedCount: 0,
    selected: [],
    errors: [],
  };
}

function initialSnapshot(options) {
  const now = new Date().toISOString();
  const totalBatches = Math.ceil(options.universe.length / options.batchSize);
  return {
    schemaVersion: 1,
    status: "running",
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    source: {
      system: "TongDaXin TQ",
      transport: options.transport,
      vm: options.transport === "vm" ? options.vm : null,
      endpoint: options.endpoint,
      method: "formula_process_mul_xg",
      readOnly: true,
    },
    universe: {
      market: options.market,
      label: marketLabel(options.market),
      count: options.universe.length,
      rawCount: options.rawUniverseCount,
      excludedCount: options.excludedUniverse.length,
      excluded: options.excludedUniverse,
      scope: options.market === "32" ? "沪深公开发行可转债" : "通达信市场原始范围",
      signature: options.signature,
    },
    settings: {
      formulas: options.formulas,
      period: options.period,
      historyCount: options.historyCount,
      dividendType: options.dividendType,
      batchSize: options.batchSize,
      totalBatches,
    },
    formulas: options.formulas.map((code) => newFormulaState(code, options.formulaInfo[code], totalBatches)),
  };
}

function canResume(snapshot, signature, formulas) {
  return Boolean(
    snapshot
      && snapshot.schemaVersion === 1
      && snapshot.universe?.signature === signature
      && JSON.stringify(snapshot.settings?.formulas) === JSON.stringify(formulas)
      && snapshot.status !== "complete",
  );
}

async function runTdxFormulaSelections(rawOptions = {}) {
  const formulas = rawOptions.formulas?.length ? rawOptions.formulas : [...DEFAULT_TDX_FORMULAS];
  const batchSize = Number(rawOptions.batchSize || 50);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error("batchSize must be an integer between 1 and 100");
  }
  const historyCount = Number(rawOptions.historyCount || 250);
  if (!Number.isInteger(historyCount) || historyCount < 1 || historyCount > 24000) {
    throw new Error("historyCount must be an integer between 1 and 24000");
  }

  const tqOptions = {
    transport: rawOptions.transport || (rawOptions.endpoint ? "direct" : "vm"),
    endpoint: rawOptions.endpoint || "http://127.0.0.1:17709/",
    vm: rawOptions.vm || "Windows 11",
    prlctlPath: rawOptions.prlctlPath || "/usr/local/bin/prlctl",
    timeoutMs: Number(rawOptions.timeoutMs || 30_000),
  };
  const invoke = rawOptions.callTq || callTq;
  const readSnapshot = rawOptions.readSnapshot || readFormulaSelectionSnapshot;
  const writeSnapshot = rawOptions.writeSnapshot || writeFormulaSelectionSnapshot;
  const market = String(rawOptions.market || "32");
  const period = String(rawOptions.period || "1d");
  const dividendType = Number(rawOptions.dividendType ?? 1);

  const availableRows = await invoke(tqOptions, "formula_get_all", { formula_type: 1 });
  const available = new Map((availableRows || []).map((row) => [row?.acCode, row]));
  const missingFormulas = formulas.filter((formula) => !available.has(formula));
  if (missingFormulas.length) {
    throw new Error(`TDX condition formula(s) not found: ${missingFormulas.join(", ")}`);
  }

  const formulaInfo = {};
  for (const formula of formulas) {
    formulaInfo[formula] = await invoke(tqOptions, "formula_get_info", {
      formula_type: 1,
      formula_code: formula,
    });
    if (Number(formulaInfo[formula]?.ParaNum || 0) > 0 && !rawOptions.formulaArgs?.[formula]) {
      throw new Error(`TDX formula ${formula} requires parameters`);
    }
  }

  const rawUniverse = normalizeTdxUniverse(
    await invoke(tqOptions, "get_stock_list", { market, list_type: 1 }),
  );
  const partitionedUniverse = market === "32"
    ? partitionOrdinaryConvertibleBonds(rawUniverse)
    : { included: rawUniverse, excluded: [] };
  let universe = partitionedUniverse.included;
  const limit = Number(rawOptions.limit || 0);
  if (limit > 0) universe = universe.slice(0, limit);
  if (universe.length === 0) throw new Error("TDX A-share universe is empty");

  const signature = formulaUniverseSignature({
    formulas,
    universe,
    period,
    historyCount,
    dividendType,
    batchSize,
  });
  const options = {
    ...tqOptions,
    formulas,
    universe,
    rawUniverseCount: rawUniverse.length,
    excludedUniverse: partitionedUniverse.excluded,
    formulaInfo,
    market,
    period,
    historyCount,
    dividendType,
    batchSize,
    signature,
  };
  const existing = rawOptions.resume === false ? null : await readSnapshot(rawOptions.outputPath);
  const snapshot = canResume(existing, signature, formulas) ? existing : initialSnapshot(options);
  const universeBatches = chunks(universe, batchSize);
  await writeSnapshot(rawOptions.outputPath, snapshot);

  for (const formula of formulas) {
    const state = snapshot.formulas.find((item) => item.code === formula);
    if (!state || state.status === "complete") continue;
    state.status = "running";
    for (let batchIndex = state.nextBatchIndex; batchIndex < universeBatches.length; batchIndex += 1) {
      const batch = universeBatches[batchIndex];
      rawOptions.onProgress?.({ formula, batchIndex, totalBatches: universeBatches.length, batchSize: batch.length });
      try {
        const result = await invoke(tqOptions, "formula_process_mul_xg", {
          formula_name: formula,
          formula_arg: rawOptions.formulaArgs?.[formula] || "",
          return_count: 1,
          return_date: true,
          stock_list: batch.map((row) => row.code),
          stock_period: period,
          count: historyCount,
          dividend_type: dividendType,
        });
        const normalized = normalizeFormulaBatchResult(result, batch);
        state.nextBatchIndex = batchIndex + 1;
        state.processedCount += batch.length;
        state.returnedCount += normalized.returnedCount;
        state.evaluatedCodes = [...new Set([
          ...(state.evaluatedCodes || []),
          ...normalized.returnedCodes,
        ])].sort();
        state.missingCount += normalized.missingCodes.length;
        state.missingCodes = [...new Set([...(state.missingCodes || []), ...normalized.missingCodes])].sort();
        state.selected = mergeSelectedRows(state.selected, normalized.selected);
        state.selectedCount = state.selected.length;
        state.dates = mergeDateCounts(state.dates, normalized.dates);
        state.asOf = latestDate(state.dates);
        state.lineNames = [...new Set([...state.lineNames, ...normalized.lineNames])];
      } catch (error) {
        state.status = "failed";
        state.errors.push({
          batchIndex,
          firstCode: batch[0]?.code || "",
          lastCode: batch.at(-1)?.code || "",
          message: error instanceof Error ? error.message : String(error),
          at: new Date().toISOString(),
        });
        snapshot.status = "partial";
        snapshot.updatedAt = new Date().toISOString();
        await writeSnapshot(rawOptions.outputPath, snapshot);
        throw error;
      }
      snapshot.updatedAt = new Date().toISOString();
      await writeSnapshot(rawOptions.outputPath, snapshot);
    }
    state.status = "complete";
    snapshot.updatedAt = new Date().toISOString();
    await writeSnapshot(rawOptions.outputPath, snapshot);
  }

  snapshot.status = snapshot.formulas.every((formula) => formula.status === "complete")
    ? "complete"
    : "partial";
  snapshot.completedAt = snapshot.status === "complete" ? new Date().toISOString() : null;
  snapshot.updatedAt = new Date().toISOString();
  await writeSnapshot(rawOptions.outputPath, snapshot);
  return snapshot;
}

module.exports = {
  canResume,
  initialSnapshot,
  runTdxFormulaSelections,
};
