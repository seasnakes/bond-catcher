"use strict";

const https = require("node:https");

function fetchText(options, encoding = "utf8") {
  return new Promise((resolve, reject) => {
    const req = https.get(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        resolve(Buffer.concat(chunks).toString(encoding));
      });
    });

    if (options.timeout) {
      req.setTimeout(options.timeout);
    }
    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
    req.on("error", reject);
  });
}

module.exports = { fetchText };
