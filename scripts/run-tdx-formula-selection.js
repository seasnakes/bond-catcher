#!/usr/bin/env node

"use strict";

const path = require("node:path");
const { runTdxFormulaSelections } = require("../src/application/run-tdx-formula-selection");
const { parseArgs } = require("./import-tdx-selection");

const ROOT = path.resolve(__dirname, "..");

if (require.main === module) {
  main().catch((error) => {
    console.error(`TDX formula selection failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const formulas = String(args.formulas || "单针,异动,ZX")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const outputPath = path.resolve(args.output || path.join(ROOT, "runtime", "tdx-formula-selections.json"));
  const snapshot = await runTdxFormulaSelections({
    formulas,
    outputPath,
    resume: !args.fresh,
    market: args.market || "5",
    period: args.period || "1d",
    historyCount: Number(args["history-count"] || 250),
    dividendType: Number(args["dividend-type"] ?? 1),
    batchSize: Number(args["batch-size"] || 50),
    limit: Number(args.limit || 0),
    transport: args.transport || (args.endpoint ? "direct" : "vm"),
    endpoint: args.endpoint || "http://127.0.0.1:17709/",
    vm: args.vm || "Windows 11",
    prlctlPath: args.prlctl || "/usr/local/bin/prlctl",
    timeoutMs: Number(args["timeout-ms"] || 30_000),
    onProgress({ formula, batchIndex, totalBatches, batchSize }) {
      if (args.json) return;
      console.log(`[${formula}] ${batchIndex + 1}/${totalBatches} (${batchSize} stocks)`);
    },
  });

  if (args.json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }
  console.log(`Snapshot: ${outputPath}`);
  console.log(`Status: ${snapshot.status}; universe: ${snapshot.universe.count}`);
  for (const formula of snapshot.formulas) {
    console.log(`${formula.code}: selected ${formula.selectedCount}, returned ${formula.returnedCount}, as of ${formula.asOf || "-"}`);
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/run-tdx-formula-selection.js [options]

Formula run:
  --formulas 单针,异动,ZX  Condition formulas (default: 单针,异动,ZX)
  --market 5               TDX stock market group (default: 5, all A-shares)
  --period 1d              K-line period (default: 1d)
  --history-count 250      Bars supplied to each formula (default: 250)
  --dividend-type 1        0=none, 1=front, 2=back (default: 1)
  --batch-size 50          Stocks per serial batch; maximum 100 (default: 50)
  --limit N                Limit the universe for validation
  --fresh                  Ignore an unfinished matching snapshot

TQ transport:
  --vm NAME                Parallels VM name (default: Windows 11)
  --prlctl PATH            prlctl executable path
  --endpoint URL           Direct TQ endpoint; also selects direct transport
  --transport vm|direct    Force a transport
  --timeout-ms N           Per-batch timeout (default: 30000)

Output:
  --output PATH            Snapshot path (default: runtime/tdx-formula-selections.json)
  --json                   Print the final snapshot as JSON
  --help                   Show this help`);
}

module.exports = { main };
