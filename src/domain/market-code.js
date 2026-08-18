"use strict";

const EXCHANGE_TO_SECID_MARKET = Object.freeze({
  SH: "1",
  SZ: "0",
  BJ: "0",
});

function inferExchange(code) {
  const normalized = String(code || "").trim();
  if (/^(5|6|110|111|113|118)/.test(normalized)) return "SH";
  if (/^(4|8|92)/.test(normalized)) return "BJ";
  return "SZ";
}

function normalizeMarketCode(value) {
  let text = String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .toUpperCase();
  if (!text) return null;

  let code = "";
  let exchange = "";

  let match = text.match(/^([01])\.(\d{6})$/);
  if (match) {
    exchange = match[1] === "1" ? "SH" : "SZ";
    code = match[2];
  }

  if (!code) {
    match = text.match(/^(\d{6})\.(SH|SZ|BJ)$/);
    if (match) {
      code = match[1];
      exchange = match[2];
    }
  }

  if (!code) {
    match = text.match(/^(SH|SZ|BJ)[._-]?(\d{6})$/);
    if (match) {
      exchange = match[1];
      code = match[2];
    }
  }

  // 通达信 .blk 文件通常以一位市场号加六位代码保存。
  if (!code) {
    match = text.match(/^([01])(\d{6})$/);
    if (match) {
      exchange = match[1] === "1" ? "SH" : "SZ";
      code = match[2];
    }
  }

  if (!code && /^\d{6}$/.test(text)) {
    code = text;
    exchange = inferExchange(code);
  }

  if (!code || !EXCHANGE_TO_SECID_MARKET[exchange]) return null;
  const secidMarket = EXCHANGE_TO_SECID_MARKET[exchange];
  return {
    code,
    exchange,
    secid: `${secidMarket}.${code}`,
    tdxCode: `${code}.${exchange}`,
  };
}

function extractMarketCode(text) {
  const source = String(text || "").toUpperCase();
  const patterns = [
    /(?:^|[^A-Z0-9])((?:SH|SZ|BJ)[._-]?\d{6})(?=$|[^A-Z0-9])/,
    /(?:^|[^A-Z0-9])(\d{6}\.(?:SH|SZ|BJ))(?=$|[^A-Z0-9])/,
    /(?:^|\D)([01]\d{6})(?=$|\D)/,
    /(?:^|\D)(\d{6})(?=$|\D)/,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const normalized = normalizeMarketCode(match?.[1]);
    if (normalized) return normalized;
  }
  return null;
}

module.exports = {
  extractMarketCode,
  inferExchange,
  normalizeMarketCode,
};
