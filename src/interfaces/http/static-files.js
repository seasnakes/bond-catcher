"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MIME_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
});

// The server listens on every interface by default, so only browser assets are
// public; runtime data, logs, scripts, tests and the git directory stay private.
const PUBLIC_ROOT_EXTENSIONS = new Set([".html", ".css", ".js", ".png", ".svg"]);
const PRIVATE_ROOT_FILES = new Set(["server.js"]);
const PUBLIC_DIRECTORIES = Object.freeze({
  data: { extensions: new Set([".json"]), maxDepth: 1 },
  docs: { extensions: new Set([".md", ".png", ".svg"]), maxDepth: Infinity },
});
const PRIVATE_FILES = new Set(["data/board-state.json"]);

function resolvePublicStaticPath(root, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : String(pathname || "");
  const relative = path.posix.normalize(cleanPath).replace(/^\/+/, "");
  const segments = relative.split("/");
  if (!relative || segments.some((segment) => !segment || segment.startsWith("."))) return null;

  const extension = path.posix.extname(relative).toLowerCase();
  if (segments.length === 1) {
    if (!PUBLIC_ROOT_EXTENSIONS.has(extension) || PRIVATE_ROOT_FILES.has(relative)) return null;
  } else {
    const directory = PUBLIC_DIRECTORIES[segments[0]];
    if (!directory || !directory.extensions.has(extension)) return null;
    if (segments.length - 1 > directory.maxDepth || PRIVATE_FILES.has(relative)) return null;
  }

  const rootPath = path.resolve(root);
  const filePath = path.join(rootPath, ...segments);
  return filePath.startsWith(rootPath + path.sep) ? filePath : null;
}

function createStaticFileServer({ root }) {
  return function serveStatic(pathname, response) {
    return new Promise((resolve) => {
      const filePath = resolvePublicStaticPath(root, pathname);
      if (!filePath) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        resolve();
        return;
      }

      fs.readFile(filePath, (error, content) => {
        if (error) {
          const missing = error.code === "ENOENT" || error.code === "EISDIR";
          response.writeHead(missing ? 404 : 500, {
            "Content-Type": "text/plain; charset=utf-8",
          });
          response.end(missing ? "Not found" : "Server error");
          resolve();
          return;
        }

        response.writeHead(200, {
          "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(content);
        resolve();
      });
    });
  };
}

module.exports = {
  MIME_TYPES,
  createStaticFileServer,
  resolvePublicStaticPath,
};
