"use strict";

function localBoardUrl(value) {
  const url = new URL(value || "http://127.0.0.1:5173");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new Error("board mutations are limited to a loopback URL");
  }
  return url;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readBoardState(baseUrl) {
  const url = new URL("/api/state", localBoardUrl(baseUrl));
  const response = await fetchWithTimeout(url, {}, 5000);
  if (!response.ok) throw new Error(`board state read failed with HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload?.exists || !Array.isArray(payload.sectors)) {
    throw new Error("board state does not exist or is invalid");
  }
  return payload;
}

async function writeBoardState(baseUrl, state, baseUpdatedAt) {
  const url = new URL("/api/state", localBoardUrl(baseUrl));
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...state, baseUpdatedAt }),
  }, 10_000);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text || `HTTP ${response.status}` };
  }
  if (!response.ok) {
    throw new Error(payload.error || `board state write failed with HTTP ${response.status}`);
  }
  return payload;
}

module.exports = {
  localBoardUrl,
  readBoardState,
  writeBoardState,
};
