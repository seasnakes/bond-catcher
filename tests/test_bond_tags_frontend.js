"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const frontend = fs.readFileSync(path.join(__dirname, "..", "bond-tags.js"), "utf8");
const heatmapFrontend = fs.readFileSync(path.join(__dirname, "..", "bond-heatmap.js"), "utf8");
const bondFrontend = fs.readFileSync(path.join(__dirname, "..", "bond.js"), "utf8");

test("标签管理页提供未打标签转债筛选并保留URL状态", () => {
  assert.match(frontend, /FILTER_UNTAGGED = "__untagged__"/);
  assert.match(frontend, /params\.get\("filter"\) === "untagged"/);
  assert.match(frontend, /\[FILTER_UNTAGGED, "未打标签", untaggedCount\]/);
  assert.match(frontend, /url\.searchParams\.set\("filter", "untagged"\)/);
});

test("未打标签忽略系统属性标签并在保存题材标签后重新计数", () => {
  assert.match(frontend, /function rowIsUntagged\(row\)/);
  assert.match(frontend, /ATTRIBUTE_TAGS = new Set\(\["次新债", "小盘", "ST"\]\)/);
  assert.match(frontend, /!ATTRIBUTE_TAGS\.has\(normalized\)/);
  assert.match(frontend, /state\.showUntagged && !rowIsUntagged\(row\)/);
  assert.match(frontend, /保存题材标签后会自动移出/);
  assert.match(frontend, /recalculateCounts\(\);\s*renderFilters\(\);\s*renderTable\(\);/s);
});

test("标签管理页按需补齐自动新债的正股映射", () => {
  assert.match(frontend, /function enrichSupplementalRows\(\)/);
  assert.match(frontend, /row\.supplemental/);
  assert.match(frontend, /api\/miniqmt\/bond-meta\?code=/);
  assert.match(frontend, /void enrichSupplementalRows\(\)/);
});

test("转债星图读取合并标签池并把自动新债的人工标签带入向量", () => {
  assert.match(heatmapFrontend, /TAG_DATA_URL = "\.\/api\/miniqmt\/tags"/);
  assert.match(heatmapFrontend, /supplementalRowsFromUniverse\(bonds, existingCodes, tagByCode = new Map\(\)\)/);
  assert.match(heatmapFrontend, /const tagInfo = tagByCode\.get\(code\) \|\| \{\}/);
  assert.match(heatmapFrontend, /const topicTags = tags\.filter\(\(tag\) => !ATTRIBUTE_TAGS\.has\(tag\)\)/);
  assert.match(heatmapFrontend, /const supplementalCandidates = \(tagPayload\.rows \|\| \[\]\)\.filter\(\(row\) => row\.supplemental\)/);
  assert.match(heatmapFrontend, /supplementalRowsFromUniverse\(\s*supplementalCandidates,\s*existingCodes,\s*tagByCode,/s);
  assert.match(heatmapFrontend, /lifecycleSupplemental: Boolean\(row\.lifecycleSupplemental\)/);
});

test("转债星图直接展示自动新债并在后台缓存动态条款", () => {
  assert.match(heatmapFrontend, /SUPPLEMENTAL_METADATA_CACHE_KEY/);
  assert.match(heatmapFrontend, /function applyCachedSupplementalMetadata\(rows\)/);
  assert.match(heatmapFrontend, /void refreshSupplementalMetadata\(supplementalRows\)/);
  assert.doesNotMatch(heatmapFrontend, /正在补齐 \$\{supplementalRows\.length\} 只自动记录的新债资料/);
  assert.doesNotMatch(heatmapFrontend, /await enrichSupplementalRows\(supplementalRows\)/);
});

test("3D拖拽旋转采用抓住模型跟随手势的方向", () => {
  assert.match(heatmapFrontend, /state\.camera\.yaw - deltaX \* 0\.008/);
  assert.match(heatmapFrontend, /state\.camera\.pitch \+ deltaY \* 0\.006/);
});

test("标签保存后通知已打开的星图重新分析", () => {
  assert.match(frontend, /function announceTagUpdate\(reason, details = \{\}\)/);
  assert.match(frontend, /tagUpdateChannel\?\.postMessage\(message\)/);
  assert.match(frontend, /localStorage\.setItem\(TAG_UPDATE_STORAGE_KEY/);
  assert.match(frontend, /announceTagUpdate\("保存转债标签", \{ rows: \[state\.editingRow\] \}\)/);
  assert.match(frontend, /announceTagUpdate\("快捷添加标签", \{ rows: \[row\] \}\)/);
  assert.match(frontend, /announceTagUpdate\("批量移除标签", \{ rows: payload\.rows \|\| \[\] \}\)/);
  assert.match(bondFrontend, /announceTagUpdate\("分时页保存转债标签", \[payload\]\)/);
});

test("星图收到标签通知后重新拉取标签并计算向量坐标", () => {
  assert.match(heatmapFrontend, /async function refreshTagAnalysis\(\)/);
  assert.match(heatmapFrontend, /applyTagPayload\(tagPayload\)/);
  assert.match(heatmapFrontend, /state\.rows = state\.rows\.filter\(\(row\) => tagByCode\.has\(row\.code\)\)/);
  assert.match(heatmapFrontend, /payload\.rows\.filter\(\(row\) => tagByCode\.has\(row\.code\)\)/);
  assert.match(heatmapFrontend, /return tagByCode\.has\(code\) && !existingCodes\.has\(code\)/);
  assert.match(heatmapFrontend, /function recomputeLandscapePositions\(groupKey = nodes\.group\.value\)/);
  assert.match(heatmapFrontend, /computeEmbedding\(state\.rows, \{\s*groupFor:/s);
  assert.match(heatmapFrontend, /nodes\.group\.addEventListener\("change", \(\) => \{\s*updateSectorOptions\(\);\s*recomputeLandscapePositions\(\);/s);
  assert.match(heatmapFrontend, /tagUpdateChannel\?\.addEventListener\("message"/);
  assert.match(heatmapFrontend, /window\.addEventListener\("storage"/);
  assert.match(heatmapFrontend, /window\.addEventListener\("pageshow"/);
  assert.match(heatmapFrontend, /document\.addEventListener\("visibilitychange"/);
});

test("单券标签变更携带行数据并走星图增量分析", () => {
  assert.match(frontend, /codes: rows\.map\(\(row\) => row\.code\)/);
  assert.match(heatmapFrontend, /pendingTagRows: new Map\(\)/);
  assert.match(heatmapFrontend, /function applyInlineTagRows\(rows\)/);
  assert.match(heatmapFrontend, /const inlineRows = Array\.isArray\(message\?\.rows\) \? message\.rows : \[\]/);
  assert.match(heatmapFrontend, /applyInlineTagRows\(inlineRows\) !== inlineRows\.length/);
  assert.match(heatmapFrontend, /\$\{needsFetch \? "全量" : "增量"\}分析 \$\{elapsed\}ms/);
});

test("星图异动标注可以直接选中对应转债圆点", () => {
  assert.match(heatmapFrontend, /"data-attention-code": row\.code/);
  assert.match(heatmapFrontend, /"aria-label": `选中\$\{row\.name\}/);
  assert.match(heatmapFrontend, /group\.addEventListener\("pointerdown", \(event\) => \{\s*event\.stopPropagation\(\);/s);
  assert.match(heatmapFrontend, /group\.addEventListener\("click", \(event\) => \{\s*event\.stopPropagation\(\);\s*selectBond\(row\);/s);
  assert.match(heatmapFrontend, /group\.addEventListener\("dblclick", \(event\) => \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*openBond\(row\);/s);
  assert.match(heatmapFrontend, /attentionLabel\?\.classList\.add\("is-selected"\)/);
  assert.match(heatmapFrontend, /function appendBondSelectionMarker\(row\)/);
  assert.match(heatmapFrontend, /class: "bond-selection-ring is-outer"/);
  assert.match(heatmapFrontend, /appendBondSelectionMarker\(row\);/);
  assert.match(heatmapFrontend, /closest\("\[data-bond-code\], \.landscape-label, \.attention-label"\)/);
});

test("从带转债参数的星图直达分时返回时会立即关闭弹层并清理URL", () => {
  assert.match(heatmapFrontend, /function clearBondDetailUrl\(\)/);
  assert.match(heatmapFrontend, /url\.searchParams\.delete\("bond"\);/);
  assert.match(heatmapFrontend, /url\.searchParams\.delete\("name"\);/);
  assert.match(heatmapFrontend, /delete currentState\.bondHeatmapOverlay;/);
  assert.match(heatmapFrontend, /window\.history\.replaceState\(nextState, "", url\);/);
  assert.match(
    heatmapFrontend,
    /function closeBondDetail\(\) \{\s*hideBondDetail\(\);\s*clearBondDetailUrl\(\);\s*\}/s,
  );
});
