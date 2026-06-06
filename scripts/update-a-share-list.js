const fs = require("node:fs/promises");
const https = require("node:https");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT, "data", "a-share-list.json");
const PAGE_SIZE = 100;
const SINA_REFERER = "https://finance.sina.com.cn/";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const total = Number(
    JSON.parse(await fetchText("/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount?node=hs_a")),
  );
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error(`Invalid stock count: ${total}`);
  }

  const pageCount = Math.ceil(total / PAGE_SIZE);
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  const rows = [];

  for (const group of chunk(pages, 8)) {
    const pageRows = await Promise.all(group.map(fetchStockPage));
    rows.push(...pageRows.flat());
  }

  const stockBySecid = new Map();
  rows.forEach((row) => {
    const symbol = String(row?.symbol || "").trim();
    const code = String(row?.code || "").trim();
    const name = String(row?.name || "").trim();
    const marketPrefix = symbol.slice(0, 2);
    if (!/^\d{6}$/.test(code) || !name || !["sh", "sz"].includes(marketPrefix)) return;

    const marketId = marketPrefix === "sh" ? "1" : "0";
    const secid = `${marketId}.${code}`;
    if (stockBySecid.has(secid)) return;

    stockBySecid.set(secid, {
      name,
      code,
      secid,
      market: marketNameForCode(code),
      type: "AStock",
    });
  });

  const stocks = [...stockBySecid.values()].sort((left, right) => left.code.localeCompare(right.code));
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(
    OUTPUT_PATH,
    `${JSON.stringify(
      {
        source: "新浪财经 hs_a",
        updatedAt: new Date().toISOString(),
        count: stocks.length,
        stocks,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`Saved ${stocks.length} Shanghai/Shenzhen A-share symbols to ${OUTPUT_PATH}`);
}

async function fetchStockPage(page) {
  const raw = await fetchText(
    "/quotes_service/api/json_v2.php/Market_Center.getHQNodeData" +
      `?page=${page}&num=${PAGE_SIZE}&sort=symbol&asc=1&node=hs_a&symbol=&_s_r_a=init`,
  );
  const rows = JSON.parse(raw);
  return Array.isArray(rows) ? rows : [];
}

function fetchText(requestPath) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: "vip.stock.finance.sina.com.cn",
        path: requestPath,
        headers: {
          Referer: SINA_REFERER,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        },
        timeout: 10000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }

          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      },
    );

    req.setTimeout(10000);
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
  });
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function marketNameForCode(code) {
  if (code.startsWith("688")) return "科创板";
  if (code.startsWith("300") || code.startsWith("301")) return "创业板";
  if (code.startsWith("6")) return "沪A";
  return "深A";
}
