"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { normalizeMarketCode } = require("../domain/market-code");

function validName(value) {
  const name = String(value || "").trim();
  return name && !name.includes("\uFFFD") ? name : "";
}

function addCatalogRow(catalog, rawCode, rawName, options = {}) {
  const normalized = normalizeMarketCode(rawCode);
  const name = validName(rawName);
  if (!normalized || !name) return;
  if (options.overwrite || !catalog.has(normalized.secid)) {
    catalog.set(normalized.secid, name);
  }
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function loadInstrumentCatalog(root, boardState = null) {
  const catalog = new Map();
  const aShares = readJsonIfExists(path.join(root, "data", "a-share-list.json"));
  for (const stock of aShares?.stocks || []) {
    addCatalogRow(catalog, stock.secid || stock.code, stock.name);
  }

  const bonds = readJsonIfExists(path.join(root, "data", "convertible-bond-tags.json"));
  for (const bond of bonds?.rows || []) {
    addCatalogRow(catalog, bond.code, bond.name);
  }

  // 看板中的人工名称优先级最高，避免静态目录尚未更新时回退成旧名称。
  for (const sector of boardState?.sectors || []) {
    for (const stock of sector?.stocks || []) {
      addCatalogRow(catalog, stock.secid, stock.name, { overwrite: true });
    }
  }
  return catalog;
}

module.exports = {
  addCatalogRow,
  loadInstrumentCatalog,
  validName,
};
