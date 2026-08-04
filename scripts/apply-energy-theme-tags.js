#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_PATH = path.join(ROOT, "data", "convertible-bond-tag-source.json");
const TAGS_PATH = path.join(ROOT, "data", "convertible-bond-tags.json");
const OVERRIDES_PATH = path.join(ROOT, "data", "convertible-bond-tag-overrides.json");

// These businesses are direct but the normalized F10 core-business field is too broad.
const VERIFIED_ADDITIONS = {
  "光伏": ["110099.SH", "123144.SZ", "123165.SZ"],
  "核电": ["118050.SH", "111000.SH", "110099.SH", "123155.SZ", "127093.SZ"],
};

function sourceRows(values) {
  const headers = values[0].map(String);
  return values.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index]])),
  );
}

function directTags(row) {
  const industry2 = String(row["申万二级行业"] || "");
  const industry3 = String(row["申万三级行业"] || "");
  const core = String(row["核心业务标签"] || "");
  const tags = [];
  if (
    industry2 === "光伏设备"
    || industry3 === "光伏发电"
    || /光伏|太阳能/.test(core)
  ) {
    tags.push("光伏");
  }
  if (industry3 === "核力发电" || /核电|核装备|核能/.test(core)) {
    tags.push("核电");
  }
  return tags;
}

function insertEnergyTags(tagOrder) {
  const order = tagOrder.filter((tag) => tag !== "光伏" && tag !== "核电");
  const electricIndex = order.indexOf("电力设备");
  order.splice(electricIndex >= 0 ? electricIndex : order.length, 0, "光伏", "核电");
  return order;
}

function addManualOverride(overridePayload, code, tag, tagOrder) {
  overridePayload.overrides ||= {};
  const existing = overridePayload.overrides[code] || {};
  const add = new Set((existing.add || []).map(String));
  const remove = new Set((existing.remove || []).map(String));
  add.add(tag);
  remove.delete(tag);
  const next = {
    ...existing,
    add: tagOrder.filter((value) => add.has(value)),
    remove: tagOrder.filter((value) => remove.has(value)),
  };
  overridePayload.overrides[code] = next;
}

async function main() {
  const [sourcePayload, tagPayload, overridePayload] = await Promise.all([
    fs.readFile(SOURCE_PATH, "utf8").then(JSON.parse),
    fs.readFile(TAGS_PATH, "utf8").then(JSON.parse),
    fs.readFile(OVERRIDES_PATH, "utf8").then(JSON.parse),
  ]);
  const tagsByCode = new Map();
  for (const row of sourceRows(sourcePayload.values || [])) {
    const code = String(row["转债代码"] || "");
    if (code) tagsByCode.set(code, directTags(row));
  }
  for (const [tag, codes] of Object.entries(VERIFIED_ADDITIONS)) {
    for (const code of codes) {
      const current = new Set(tagsByCode.get(code) || []);
      current.add(tag);
      tagsByCode.set(code, [...current]);
    }
  }

  const tagOrder = insertEnergyTags(Array.isArray(tagPayload.tagOrder) ? tagPayload.tagOrder : []);
  tagPayload.tagOrder = tagOrder;
  tagPayload.definitions ||= {};
  tagPayload.definitions["光伏"] = "光伏设备、组件、辅材、逆变器、电站运营等直接业务";
  tagPayload.definitions["核电"] = "核电运营、参股核电资产或核级设备与部件业务";
  for (const row of tagPayload.rows || []) {
    const desired = new Set([...(row.tags || []), ...(tagsByCode.get(String(row.code)) || [])]);
    row.tags = tagOrder.filter((tag) => desired.has(tag));
  }
  tagPayload.tagCounts = Object.fromEntries(tagOrder.map((tag) => [
    tag,
    (tagPayload.rows || []).filter((row) => (row.tags || []).includes(tag)).length,
  ]));

  overridePayload.customTags ||= [];
  for (const [tag, codes] of Object.entries(VERIFIED_ADDITIONS)) {
    for (const code of codes) addManualOverride(overridePayload, code, tag, tagOrder);
  }

  await Promise.all([
    fs.writeFile(TAGS_PATH, `${JSON.stringify(tagPayload, null, 2)}\n`, "utf8"),
    fs.writeFile(OVERRIDES_PATH, `${JSON.stringify(overridePayload, null, 2)}\n`, "utf8"),
  ]);
  console.log(JSON.stringify({
    光伏: tagPayload.tagCounts["光伏"],
    核电: tagPayload.tagCounts["核电"],
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
