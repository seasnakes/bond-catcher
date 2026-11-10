"use strict";

const fs = require("node:fs");
const { randomUUID } = require("node:crypto");

async function readJsonFile(filePath) {
  return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
}

async function writeJsonAtomic(filePath, payload) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fs.promises.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = {
  readJsonFile,
  writeJsonAtomic,
};
