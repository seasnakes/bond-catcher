const { bridgeRequest, chinaClock } = require("./limit-ladder-live.js");

const HISTORY_BATCH_SIZE = 24;

function marketRows(request, codes, query) {
  const params = new URLSearchParams({ stocks: codes.join(","), fill_data: "false", ...query });
  return request(`/api/market/market_data_ex?${params}`, 15_000).then((payload) => payload.data || {});
}

// Enrich on subsequent polls so historical reads never hold up the live feed.
function createAuctionVolumeComparison(toMarketCode, request = bridgeRequest) {
  let session;
  async function refresh(cache, needed) {
    if (!cache.previousDate) {
      const calendar = await request(`/api/calendar/prev_trading_date?market=SH&date=${cache.date}`);
      if (!(calendar.prev_trading_date > 0)) return;
      const previous = chinaClock(calendar.prev_trading_date).date.replaceAll("-", "");
      if (previous >= cache.date) return;
      cache.previousDate = previous;
    }
    const codes = [...needed.keys()];
    for (let start = 0; start < codes.length; start += HISTORY_BATCH_SIZE) {
      const batch = codes.slice(start, start + HISTORY_BATCH_SIZE);
      try {
        await loadBatch(cache, needed, batch);
      } catch (error) {
        console.warn(`竞价昨比行情读取失败: ${error.message}`);
      }
    }
  }

  async function loadBatch(cache, needed, batch) {
    const missingDaily = batch.filter((code) => !cache.daily.has(code));
    if (missingDaily.length) {
      const rows = await marketRows(request, missingDaily, { period: "1d", fields: "volume",
        start_time: cache.previousDate, end_time: cache.previousDate });
      for (const code of missingDaily) {
        const row = rows[code]?.find((bar) => String(bar.index) === cache.previousDate);
        if (Number(row?.volume) > 0) cache.daily.set(code, Number(row.volume));
      }
    }
    // Archives written before volume was sampled need the matching source tick.
    const legacy = batch.filter((code) => needed.get(code) && !cache.ticks.get(code)?.has(needed.get(code)));
    if (legacy.length) {
      const rows = await marketRows(request, legacy, { period: "tick", fields: "time,volume",
        start_time: cache.date + "092500", end_time: cache.date + "092529" });
      for (const code of legacy) {
        cache.ticks.set(code, new Map((rows[code] || []).filter((row) => Number(row.volume) > 0)
          .map((row) => [Number(row.time), Number(row.volume)])));
      }
    }
  }

  return function enrich(signals, date) {
    if (session?.date !== date) {
      session = { date, previousDate: "", daily: new Map(), ticks: new Map(), retryAt: new Map(), busy: false };
    }
    const cache = session;
    const needed = new Map();
    for (const signal of signals) {
      for (const leg of ["stock", "bond"]) {
        const snapshot = signal[leg];
        if (!snapshot) continue;
        snapshot.auctionVolumePct = null;
        if (snapshot.stage !== "final") continue;
        const code = toMarketCode(signal[`${leg}Secid`]);
        snapshot.previousVolumeDate = cache.previousDate || null;
        snapshot.previousDayVolume = cache.daily.get(code) ?? null;
        snapshot.auctionVolume ??= cache.ticks.get(code)?.get(snapshot.timestamp) ?? null;
        if (snapshot.auctionVolume > 0 && snapshot.previousDayVolume > 0) {
          snapshot.auctionVolumePct = 100 * snapshot.auctionVolume / snapshot.previousDayVolume;
        } else if ((cache.retryAt.get(code) || 0) <= Date.now()) {
          needed.set(code, snapshot.auctionVolume > 0 ? null : snapshot.timestamp);
        }
      }
    }
    if (cache.busy || !needed.size) return;
    cache.busy = true;
    refresh(cache, needed).catch((error) => {
      console.warn(`竞价昨比行情读取失败: ${error.message}`);
    }).finally(() => {
      for (const code of needed.keys()) cache.retryAt.set(code, Date.now() + 60_000);
      cache.busy = false;
    });
  };
}

module.exports = { createAuctionVolumeComparison };
