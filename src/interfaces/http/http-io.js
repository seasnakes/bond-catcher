"use strict";

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request, limitBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        request.destroy(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw.trim() ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function isLoopbackRequest(request) {
  const address = String(request.socket?.remoteAddress || "").toLowerCase();
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function isSameOriginRequest(request) {
  const origin = String(request.headers.origin || "");
  const host = String(request.headers.host || "");
  return Boolean(origin && host && (origin === `http://${host}` || origin === `https://${host}`));
}

module.exports = {
  isLoopbackRequest,
  isSameOriginRequest,
  readJsonBody,
  sendJson,
};
