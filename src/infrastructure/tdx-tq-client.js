"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function normalizeTqResult(payload) {
  let result = payload?.result ?? payload;
  if (typeof result === "string") {
    try {
      result = JSON.parse(result);
    } catch {
      return result;
    }
  }
  const errorId = String(result?.ErrorId ?? result?.error_id ?? "0");
  if (errorId !== "0") {
    const message = result?.Error || result?.msg || `TQ error ${errorId}`;
    throw new Error(String(message));
  }
  let value = result?.Value ?? result?.value ?? result;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      // A scalar string is a valid TQ result, although sector queries should return arrays.
    }
  }
  return value;
}

async function callTqDirect(endpoint, method, params, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: Date.now(), method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`TQ HTTP ${response.status}`);
    return normalizeTqResult(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

async function callTqInVm(options, method, params, timeoutMs) {
  const endpoint = new URL(options.endpoint || "http://127.0.0.1:17709/");
  if (!/^https?:$/.test(endpoint.protocol)) throw new Error("TQ endpoint must use HTTP or HTTPS");
  const bodyBase64 = Buffer.from(
    JSON.stringify({ id: Date.now(), method, params }),
    "utf8",
  ).toString("base64");
  const endpointBase64 = Buffer.from(endpoint.toString(), "utf8").toString("base64");
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const script = [
    "$ProgressPreference = 'SilentlyContinue'",
    "$utf8 = New-Object System.Text.UTF8Encoding($false)",
    "[Console]::OutputEncoding = $utf8",
    "$OutputEncoding = $utf8",
    `$uri = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${endpointBase64}'))`,
    `$body = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${bodyBase64}'))`,
    `$result = Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec ${timeoutSeconds}`,
    "$result | ConvertTo-Json -Depth 30 -Compress",
  ].join("\n");

  const { stdout } = await execFileAsync(
    options.prlctlPath || "/usr/local/bin/prlctl",
    ["exec", options.vm || "Windows 11", "--current-user", "powershell", "-NoProfile", "-Command", script],
    {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: timeoutMs + 10_000,
    },
  );
  return normalizeTqResult(JSON.parse(stdout));
}

async function callTq(options, method, params) {
  const timeoutMs = Number(options.timeoutMs || 15_000);
  if (options.transport === "direct" || (!options.transport && process.platform === "win32")) {
    return callTqDirect(options.endpoint || "http://127.0.0.1:17709/", method, params, timeoutMs);
  }
  return callTqInVm(options, method, params, timeoutMs);
}

async function fetchTdxSector(options) {
  const blockCode = String(options.blockCode || "").trim();
  if (!blockCode) throw new Error("TDX sector code or name is required");
  const blockType = Number(options.blockType ?? 1);
  const baseParams = { block_code: blockCode, block_type: blockType };
  let rows = await callTq(options, "get_stock_list_in_sector", {
    ...baseParams,
    list_type: 1,
  });
  if (!Array.isArray(rows) || rows.length === 0) {
    rows = await callTq(options, "get_stock_list_in_sector", {
      ...baseParams,
      list_type: 0,
    });
  }
  if (!Array.isArray(rows)) throw new Error("TDX sector response is not a list");
  return rows;
}

module.exports = {
  callTq,
  fetchTdxSector,
  normalizeTqResult,
};
