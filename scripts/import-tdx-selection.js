#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { TextDecoder } = require("node:util");
const { parseSelectionText, resolveSelectionRows } = require("../src/application/import-tdx-selection");
const { planBoardSelectionImport, verifyBoardSelection } = require("../src/domain/board-state");
const { readBoardState, writeBoardState } = require("../src/infrastructure/board-api-client");
const { loadInstrumentCatalog } = require("../src/infrastructure/instrument-catalog");
const { fetchTdxSector } = require("../src/infrastructure/tdx-tq-client");

const ROOT = path.resolve(__dirname, "..");

if (require.main === module) {
  main().catch((error) => {
    console.error(`TDX selection import failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const sourceCount = Number(Boolean(args.file)) + Number(Boolean(args["tdx-sector"]));
  if (sourceCount !== 1) throw new Error("choose exactly one source: --tdx-sector or --file");

  const mode = String(args.mode || "merge").toLowerCase();
  if (!["merge", "replace"].includes(mode)) throw new Error("--mode must be merge or replace");
  const targetSector = String(args.target || "通达信选股").trim();
  const boardUrl = args["board-url"] || "http://127.0.0.1:5173";
  const boardState = await readBoardState(boardUrl);
  const rows = args.file
    ? parseSelectionText(decodeSelectionFile(await fs.promises.readFile(path.resolve(args.file))))
    : await fetchTdxSector({
        blockCode: args["tdx-sector"],
        blockType: Number(args["block-type"] ?? 1),
        transport: args.transport || (args.endpoint ? "direct" : "vm"),
        endpoint: args.endpoint || "http://127.0.0.1:17709/",
        vm: args.vm || "Windows 11",
        prlctlPath: args.prlctl || "/usr/local/bin/prlctl",
        timeoutMs: Number(args["timeout-ms"] || 15_000),
      });

  const catalog = loadInstrumentCatalog(ROOT, boardState);
  const resolution = resolveSelectionRows(rows, catalog);
  if (resolution.stocks.length === 0) throw new Error("selection source returned no valid market codes");
  const plan = planBoardSelectionImport(boardState, {
    targetSector,
    stocks: resolution.stocks,
    mode,
  });
  const report = reportFromPlan(plan, resolution, {
    applied: false,
    source: args.file ? path.resolve(args.file) : `TDX:${args["tdx-sector"]}`,
  });

  if (!args.apply) {
    printReport(report, args.json);
    if (resolution.unresolved.length) {
      console.warn("Dry run only: unresolved names must be fixed or explicitly allowed before apply.");
    }
    return;
  }

  if (resolution.unresolved.length && !args["allow-unknown-names"]) {
    throw new Error(
      `${resolution.unresolved.length} instrument name(s) unresolved; update the local catalog or use --allow-unknown-names`,
    );
  }
  await writeBoardState(boardUrl, plan.nextState, boardState.updatedAt);
  const persisted = await readBoardState(boardUrl);
  const verification = verifyBoardSelection(persisted, plan);
  if (!verification.ok) throw new Error(`apply verification failed: ${verification.reason}`);
  printReport({ ...report, applied: true, verification }, args.json);
}

function decodeSelectionFile(buffer) {
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8;
  try {
    return new TextDecoder("gb18030").decode(buffer);
  } catch {
    return utf8;
  }
}

function reportFromPlan(plan, resolution, extra) {
  return {
    ...extra,
    mode: plan.mode,
    targetSector: plan.targetSector,
    targetSectorExisted: plan.targetSectorExisted,
    sourceCount: resolution.stocks.length,
    unresolved: resolution.unresolved.map((stock) => stock.tdxCode),
    beforeCount: plan.beforeCount,
    afterCount: plan.afterCount,
    added: plan.added,
    removed: plan.removed,
    unchangedCount: plan.unchanged.length,
  };
}

function printReport(report, asJson) {
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`${report.applied ? "Applied" : "Dry run"}: ${report.source}`);
  console.log(`Target: ${report.targetSector} (${report.mode})`);
  console.log(`Selection: ${report.sourceCount}, before: ${report.beforeCount}, after: ${report.afterCount}`);
  console.log(`Added: ${report.added.length}, removed: ${report.removed.length}, unchanged: ${report.unchangedCount}`);
  if (report.unresolved.length) console.log(`Unresolved names: ${report.unresolved.join(", ")}`);
  if (report.added.length) {
    console.log("Added instruments:");
    for (const stock of report.added.slice(0, 50)) {
      console.log(`  ${stock.name}\t${stock.secid}`);
    }
    if (report.added.length > 50) console.log(`  ... and ${report.added.length - 50} more`);
  }
  if (report.removed.length) {
    console.log("Removed instruments:");
    for (const stock of report.removed.slice(0, 50)) {
      console.log(`  ${stock.name}\t${stock.secid}`);
    }
    if (report.removed.length > 50) console.log(`  ... and ${report.removed.length - 50} more`);
  }
  if (!report.applied) console.log("No board data was changed. Re-run with --apply after reviewing this plan.");
  if (report.applied) console.log(`Verification: ${report.verification?.ok ? "passed" : "failed"}`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  node scripts/import-tdx-selection.js --tdx-sector CODE --target NAME [options]
  node scripts/import-tdx-selection.js --file selection.blk --target NAME [options]

Sources:
  --tdx-sector VALUE       Read a TQ/TdxQuant sector code or name
  --block-type 1           0=ordinary sector code/name, 1=custom sector abbreviation
  --file PATH              Read .blk, CSV, TSV, or plain-text exported selections

Board update:
  --target NAME            Target board sector (default: 通达信选股)
  --mode merge|replace     Merge new rows or mirror the selection exactly (default: merge)
  --apply                  Apply after the default dry run has been reviewed
  --allow-unknown-names    Permit unresolved codes to use the six-digit code as name
  --board-url URL          Local finance board URL (default: http://127.0.0.1:5173)

TQ transport:
  --vm NAME                Parallels VM name (default: Windows 11)
  --prlctl PATH            prlctl executable path
  --endpoint URL           Direct TQ endpoint; also selects direct transport by default
  --transport vm|direct    Force a transport
  --timeout-ms N           TQ request timeout

Output:
  --json                   Print a machine-readable report
  --help                   Show this help`);
}

module.exports = {
  decodeSelectionFile,
  parseArgs,
  reportFromPlan,
};
