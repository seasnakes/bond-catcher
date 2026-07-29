#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_STATE_PATH = path.join(ROOT, "data", "board-state.json");
const DEFAULT_TDX_ENDPOINT = "http://127.0.0.1:17709/";

process.env.NO_PROXY = appendNoProxy(process.env.NO_PROXY);
process.env.no_proxy = appendNoProxy(process.env.no_proxy);

const args = parseArgs(process.argv.slice(2));
const statePath = path.resolve(args.state || DEFAULT_STATE_PATH);
const endpoint = args.endpoint || DEFAULT_TDX_ENDPOINT;
const includeStacks = Boolean(args["include-stacks"]);
const apply = Boolean(args.apply);
const show = Boolean(args.show);
const timeoutMs = Number(args["timeout-ms"] || 15000);

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main() {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const groups = filterGroups(buildGroups(state, { includeStacks }), args.only);

  console.log(`${apply ? "Applying" : "Dry run"} ${groups.length} TDX sector groups`);
  console.log(`State: ${statePath}`);
  console.log(`Endpoint: ${endpoint}`);
  console.log("");

  for (const group of groups) {
    const skippedText = group.skipped.length ? `, skipped ${group.skipped.length}` : "";
    console.log(`${group.blockCode}\t${group.name}\t${group.stocks.length} stocks${skippedText}`);
    if (group.skipped.length && args.verbose) {
      for (const item of group.skipped) {
        console.log(`  skip ${item.name || ""} ${item.secid || ""}`.trim());
      }
    }
  }

  if (!apply) {
    console.log("");
    console.log("No changes made. Re-run with --apply after starting the TdxQuant-enabled TongDaXin client.");
    return;
  }

  for (const group of groups) {
    console.log(`\n${group.blockCode} ${group.name}`);
    await callTdx(endpoint, "create_sector", {
      block_code: group.blockCode,
      block_name: group.name,
    }, timeoutMs);
    await callTdx(endpoint, "rename_sector", {
      block_code: group.blockCode,
      block_name: group.name,
    }, timeoutMs);
    await callTdx(endpoint, "clear_sector", {
      block_code: group.blockCode,
    }, timeoutMs);
    await callTdx(endpoint, "send_user_block", {
      block_code: group.blockCode,
      stock_list: group.stocks,
      show,
    }, timeoutMs);
    console.log(`  synced ${group.stocks.length}`);
  }
}

function filterGroups(groups, only) {
  if (!only) return groups;
  const needle = String(only).trim().toLowerCase();
  return groups.filter(
    (group) =>
      group.blockCode.toLowerCase() === needle ||
      group.name.toLowerCase() === needle ||
      `${group.blockCode} ${group.name}`.toLowerCase().includes(needle),
  );
}

function buildGroups(state, options) {
  const sectors = Array.isArray(state.sectors) ? state.sectors : [];
  const groups = sectors.map((sector) =>
    buildGroup({
      prefix: "FB",
      name: sector.name,
      stocks: Array.isArray(sector.stocks) ? sector.stocks : [],
    }),
  );

  if (!options.includeStacks) return groups;

  const sectorByName = new Map(sectors.map((sector) => [sector.name, sector]));
  const stacks = Array.isArray(state.stackGroups) ? state.stackGroups : [];
  for (const stack of stacks) {
    const seen = new Set();
    const stocks = [];
    const sectorNames = stack.expandedSectorNames || stack.sectorNames || [];
    for (const sectorName of sectorNames) {
      const sector = sectorByName.get(sectorName);
      if (!sector || !Array.isArray(sector.stocks)) continue;
      for (const stock of sector.stocks) {
        if (!stock?.secid || seen.has(stock.secid)) continue;
        seen.add(stock.secid);
        stocks.push(stock);
      }
    }
    groups.push(buildGroup({ prefix: "FG", name: stack.name, stocks }));
  }

  return groups;
}

function buildGroup({ prefix, name, stocks }) {
  const converted = [];
  const skipped = [];
  const seen = new Set();

  for (const stock of stocks) {
    const code = secidToTdxCode(stock?.secid);
    if (!code) {
      skipped.push(stock || {});
      continue;
    }
    if (seen.has(code)) continue;
    seen.add(code);
    converted.push(code);
  }

  return {
    name: String(name || "").trim(),
    blockCode: `${prefix}${stableCode(name)}`,
    stocks: converted,
    skipped,
  };
}

function secidToTdxCode(secid) {
  const [market, code] = String(secid || "").split(".");
  if (!market || !code) return "";
  if (market === "1") return `${code}.SH`;
  if (market === "0") return `${code}.SZ`;
  if (market === "116") return `${code.padStart(5, "0")}.HK`;
  return "";
}

function stableCode(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
}

async function callTdx(endpoint, method, params, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: Date.now(), method, params }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!response.ok) {
      throw new Error(`${method} failed with HTTP ${response.status}`);
    }

    const payload = await response.json();
    const result = normalizeTdxResult(payload.result);
    if (result?.ErrorId && result.ErrorId !== "0") {
      const message = result.Error || result.msg || JSON.stringify(result);
      console.warn(`  ${method}: ${message}`);
      return payload;
    }

    console.log(`  ${method}: ok`);
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${method} timed out after ${timeout}ms`);
    }
    throw error;
  }
}

function normalizeTdxResult(result) {
  if (typeof result === "string") {
    try {
      return JSON.parse(result);
    } catch {
      return { ErrorId: "0", Value: result };
    }
  }
  return result;
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

function appendNoProxy(value = "") {
  const entries = new Set(
    String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  for (const item of ["127.0.0.1", "localhost", "::1"]) entries.add(item);
  return [...entries].join(",");
}
