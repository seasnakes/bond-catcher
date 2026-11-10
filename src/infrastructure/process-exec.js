"use strict";

const { execFile } = require("node:child_process");

function execFileAsync(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message || "").trim();
        reject(new Error(detail || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseLastJsonObject(output) {
  const text = String(output || "").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return {};
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return {};
    }
  }
}

module.exports = {
  execFileAsync,
  parseLastJsonObject,
};
