const fs = require("node:fs");
const path = require("node:path");

// This is a persisted display snapshot, never a live trading-price cache.
class QuoteSnapshotStore {
  constructor(filename) {
    this.filename = filename;
    this.quotes = new Map();
    this.backend = null;
    this.writes = Promise.resolve();
    try {
      const saved = JSON.parse(fs.readFileSync(filename, "utf8"));
      if (saved.version === 1 && Array.isArray(saved.quotes)) {
        for (const quote of saved.quotes) {
          if (this.valid(quote)) this.quotes.set(quote.secid, quote);
        }
        this.backend = saved.quote_backend || null;
      }
    } catch { /* No snapshot yet, or an interrupted/corrupt older file. */ }
  }

  valid(quote) {
    return quote && /^(?:[01]\.\d{6}|116\.\d{5})$/.test(quote.secid)
      && Number.isFinite(quote.price) && quote.price > 0
      && /^\d{4}-?\d{2}-?\d{2}$/.test(quote.date || "");
  }

  stamp(quote) {
    return `${String(quote.date || "").replaceAll("-", "")}${quote.time || ""}`;
  }

  async update(rows, backend = null) {
    let changed = false;
    for (const row of rows || []) {
      if (!this.valid(row)) continue;
      const previous = this.quotes.get(row.secid);
      // Late responses must not replace newer quotes with an older session.
      if (previous && this.stamp(row) < this.stamp(previous)) continue;
      this.quotes.set(row.secid, {
        ...row,
        cached: true,
        fetchedAt: Date.now(),
        quoteBackend: backend?.active || (row.secid.startsWith("116.") ? "sina" : "unknown"),
      });
      changed = true;
    }
    if (!changed) return;
    if (backend) this.backend = backend;
    const data = JSON.stringify(this.payload());
    this.writes = this.writes.catch(() => {}).then(async () => {
      await fs.promises.mkdir(path.dirname(this.filename), { recursive: true });
      const temporary = `${this.filename}.tmp`;
      await fs.promises.writeFile(temporary, data);
      await fs.promises.rename(temporary, this.filename);
    });
    await this.writes;
  }

  payload() {
    return { version: 1, quote_backend: this.backend, quotes: [...this.quotes.values()] };
  }
}

module.exports = { QuoteSnapshotStore };
