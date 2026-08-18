"use strict";

const fs = require("node:fs");
const path = require("node:path");

async function readFormulaSelectionSnapshot(filePath) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeFormulaSelectionSnapshot(filePath, snapshot) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await fs.promises.rename(temporaryPath, filePath);
}

module.exports = {
  readFormulaSelectionSnapshot,
  writeFormulaSelectionSnapshot,
};
