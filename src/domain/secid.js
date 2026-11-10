"use strict";

function codeFromInput(input) {
  return String(input || "")
    .trim()
    .replace(/^[a-z]+/i, "")
    .split(".")
    .pop()
    .replace(/\D/g, "");
}

function marketNameForCode(code) {
  if (isConvertibleBondCode(code)) return "转债";
  if (code.startsWith("688")) return "科创板";
  if (code.startsWith("300") || code.startsWith("301")) return "创业板";
  if (code.startsWith("8") || code.startsWith("9")) return "北交所";
  if (code.startsWith("6")) return "沪A";
  return "深A";
}

function marketNameForSecid(secid) {
  if (isHongKongSecid(secid)) return "港股";
  const code = String(secid || "").split(".").pop() || "";
  if (isFundCode(code)) return "ETF";
  return marketNameForCode(code);
}

function typeForSecid(secid) {
  const code = String(secid || "").split(".").pop() || "";
  if (isHongKongSecid(secid)) return "HKStock";
  if (isConvertibleBondCode(code)) return "Bond";
  if (isFundCode(code)) return "Fund";
  return "AStock";
}

function isSupportedSecid(secid) {
  return /^[01]\.\d{6}$/.test(secid) || isHongKongSecid(secid);
}

function isHongKongSecid(secid) {
  return /^116\.\d{5}$/.test(String(secid || ""));
}

function isFundCode(code) {
  return /^(15|16|50|51|52|56|58)\d{4}$/.test(String(code || ""));
}

function isConvertibleBondCode(code) {
  return /^(110|111|113|118|123|127|128)\d{3}$/.test(code);
}

function secidToSinaSymbol(secid) {
  const [market, code] = secid.split(".");
  if (!code) return secid;
  if (market === "116") return `rt_hk${code.padStart(5, "0")}`;
  if (market === "1") return `sh${code}`;
  if (code.startsWith("8") || code.startsWith("9")) return `bj${code}`;
  return `sz${code}`;
}

function secidToTencentSymbol(secid) {
  const [market, code] = secid.split(".");
  if (!code) return secid;
  if (market === "116") return `hk${code.padStart(5, "0")}`;
  return secidToSinaSymbol(secid);
}

function secidToTdxStockCode(secid) {
  const [market, code] = String(secid || "").split(".");
  if (!code) return secid;
  if (/^[489]/.test(code)) return `${code}.BJ`;
  if (market === "1") return `${code}.SH`;
  return `${code}.SZ`;
}

function normalizeSecidInput(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const hkPrefixed = text.replace(/^rt_hk/i, "116.").replace(/^hk/i, "116.");
  if (/^116\.\d{1,5}$/.test(hkPrefixed)) {
    const code = hkPrefixed.split(".")[1].padStart(5, "0");
    return `116.${code}`;
  }
  if (/^\d{5}$/.test(hkPrefixed)) return `116.${hkPrefixed}`;

  const prefixed = hkPrefixed.replace(/^sh/i, "1.").replace(/^(sz|bj)/i, "0.");
  if (/^[01]\.\d{6}$/.test(prefixed)) return prefixed;
  if (/^\d{6}$/.test(prefixed)) return `${marketFromCode(prefixed)}.${prefixed}`;
  return prefixed;
}

function normalizeTagSecid(value) {
  const text = String(value || "").trim();
  const suffixMatch = text.match(/^(\d{6})\.(SH|SZ)$/i);
  if (suffixMatch) {
    return `${suffixMatch[2].toUpperCase() === "SH" ? "1" : "0"}.${suffixMatch[1]}`;
  }
  return normalizeSecidInput(text);
}

function secidToMiniQmtMarketCode(secid) {
  const normalized = normalizeSecidInput(secid);
  const match = normalized.match(/^([01])\.(\d{6})$/);
  if (!match || /^[89]/.test(match[2])) return "";
  return `${match[2]}.${match[1] === "1" ? "SH" : "SZ"}`;
}

function marketFromCode(code) {
  if (/^(5|6|110|111|113|118)/.test(code)) return "1";
  return "0";
}

module.exports = {
  codeFromInput,
  isConvertibleBondCode,
  isFundCode,
  isHongKongSecid,
  isSupportedSecid,
  marketFromCode,
  marketNameForCode,
  marketNameForSecid,
  normalizeSecidInput,
  normalizeTagSecid,
  secidToMiniQmtMarketCode,
  secidToSinaSymbol,
  secidToTdxStockCode,
  secidToTencentSymbol,
  typeForSecid,
};
