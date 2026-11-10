"use strict";

const CONTEXT_VERSION = "cb-ai-context-2026-09-11.2";
const OBSERVATION_RULES = Object.freeze({ tolerance_pct: 0.1, confirm_bars: 2, amount_lookback_bars: 20, amount_ratio_threshold: 1.5 });

function number(value) {
  if (value === null || value === undefined || typeof value === "boolean" || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function rounded(value, digits = 6) { const v = number(value); return v === null ? null : Number(v.toFixed(digits)); }
function dateKey(value) {
  const text = String(value || "").replaceAll("-", "").slice(0, 8);
  if (!/^\d{8}$/.test(text)) return "";
  const date = new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10).replaceAll("-", "") === text ? text : "";
}
function chinaClock(now = Date.now()) {
  const shifted = new Date(now + 8 * 3600_000).toISOString();
  return { date: shifted.slice(0, 10).replaceAll("-", ""), time: shifted.slice(11, 19) };
}
function normalizeCode(value) {
  let text = String(value || "").trim().toUpperCase();
  text = text.replace(/^[01]\.(\d{6})$/, "$1").replace(/^(SH|SZ)(\d{6})$/, "$2.$1");
  const match = text.match(/^((?:110|111|113|118|123|127|128)\d{3})(?:\.(SH|SZ))?$/);
  if (!match) throw new Error("请输入六位沪深可转债代码");
  const market = /^(110|111|113|118)/.test(match[1]) ? "SH" : "SZ";
  if (match[2] && match[2] !== market) throw new Error("可转债代码与市场不匹配");
  return `${match[1]}.${market}`;
}
function changePct(price, anchor) {
  return number(price) !== null && number(anchor) > 0 ? rounded((price / anchor - 1) * 100, 4) : null;
}
function mean(values) { return values.length && values.every(v => number(v) !== null) ? values.reduce((a, b) => a + Number(b), 0) / values.length : null; }
function normalizeDaily(rows, date, now = Date.now()) {
  const clock = chinaClock(now);
  const byDate = new Map();
  for (const raw of rows || []) {
    const d = dateKey(raw.date);
    if (!d || d > date || ![raw.open, raw.high, raw.low, raw.close].every(v => number(v) > 0)) continue;
    byDate.set(d, { ...raw, date: d, open: number(raw.open), high: number(raw.high), low: number(raw.low), close: number(raw.close),
      amount_yuan: number(raw.amount_yuan ?? raw.amount), volume_lots: number(raw.volume_lots),
      completed: d < clock.date || (d === clock.date && clock.time >= "15:05:00"),
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function referenceLevels(rows, date) {
  const prior = rows.filter(r => r.date < date).sort((a, b) => a.date.localeCompare(b.date));
  const recent = prior.slice(-5);
  const average = p => prior.length >= p ? rounded(mean(prior.slice(-p).map(r => r.close))) : null;
  return {
    as_of_before: date, source: "与个债分时页相同：本地监控分钟聚合日线，严格排除分析日",
    source_dates: prior.slice(-10).map(r => r.date), ma5: average(5), ma10: average(10),
    support5: recent.length === 5 ? rounded(Math.min(...recent.map(r => r.low))) : null,
    resistance5: recent.length === 5 ? rounded(Math.max(...recent.map(r => r.high))) : null,
    partial_source_dates: prior.slice(-10).filter(r => number(r.missing_bars) > 0 || (number(r.missing_bars) === null && number(r.bar_count) !== null && r.bar_count < 240)).map(r => r.date),
  };
}
function withDailyIndicators(rows) {
  return rows.map((row, index) => {
    const result = { ...row };
    for (const period of [5, 10, 20, 60]) {
      result[`ma${period}`] = index + 1 >= period ? rounded(mean(rows.slice(index + 1 - period, index + 1).map(r => r.close))) : null;
    }
    const previous = number(row.previous_close) || number(rows[index - 1]?.close);
    result.change_pct = changePct(row.close, previous);
    const previousAmounts = rows.slice(Math.max(0, index - 5), index).map(r => r.amount_yuan);
    const baseline = previousAmounts.length === 5 ? mean(previousAmounts) : null;
    result.amount_vs_prior5 = baseline > 0 && row.amount_yuan !== null ? rounded(row.amount_yuan / baseline, 4) : null;
    return result;
  });
}
function minuteClock(value) { const match = String(value || "").match(/(\d{2}):(\d{2})/); return match ? Number(match[1]) * 60 + Number(match[2]) : null; }
function inSession(clock) { return clock !== null && ((clock >= 570 && clock <= 690) || (clock >= 780 && clock <= 900)); }
function contiguous(a, b) { return b?.minute_ms - a?.minute_ms === 60_000; }
function normalRows(rows, date, now) {
  const byTime = new Map();
  const cutoff = Math.floor(now / 60_000) * 60_000;
  for (const row of rows || []) {
    const ms = number(row.minute_ms);
    if (ms === null || ms >= cutoff || chinaClock(ms).date !== date || !inSession(minuteClock(row.time))) continue;
    if (![row.open, row.high, row.low, row.close].every(v => number(v) > 0)) continue;
    const result = { time: String(row.time), minute_ms: ms };
    for (const key of ["open", "high", "low", "close", "amount_yuan", "average_approx", "purple", "purple_ma27", "dif", "dea", "macd"]) result[key] = rounded(row[key]);
    byTime.set(ms, result);
  }
  return [...byTime.values()].sort((a, b) => a.minute_ms - b.minute_ms);
}
function coverageFor(rows, date, now) {
  const clock = chinaClock(now);
  const lastExpected = date < clock.date || clock.time >= "15:01:00" ? 900 : minuteClock(clock.time) - 1;
  const expected = [];
  for (let m = 571; m <= Math.min(900, lastExpected); m++) if ((m <= 690) || m >= 781) expected.push(m);
  const present = new Set(rows.map(r => minuteClock(r.time)));
  const missing = expected.filter(m => !present.has(m));
  return { bars: rows.length, expected_completed_bars: expected.length, missing_bars: missing.length,
    coverage_pct: expected.length ? rounded((expected.length - missing.length) / expected.length * 100, 1) : null,
    missing_times: missing.slice(0, 20).map(m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`),
    first_time: rows[0]?.time || null, last_time: rows.at(-1)?.time || null,
  };
}
function periodSummary(rows) {
  if (!rows.length) return null;
  return { first_time: rows[0].time, last_time: rows.at(-1).time, open: rows[0].open, close: rows.at(-1).close,
    high: Math.max(...rows.map(r => r.high)), low: Math.min(...rows.map(r => r.low)),
    change_from_open_pct: changePct(rows.at(-1).close, rows[0].open),
    amount_yuan: rows.every(r => number(r.amount_yuan) !== null) ? rounded(rows.reduce((sum, r) => sum + r.amount_yuan, 0), 2) : null,
    missing_amount_bars: rows.filter(r => number(r.amount_yuan) === null).length,
  };
}
function repeatedNodes(rows, field) {
  const clusters = [];
  for (let i = 1; i < rows.length - 1; i++) {
    if (!contiguous(rows[i - 1], rows[i]) || !contiguous(rows[i], rows[i + 1])) continue;
    const value = rows[i][field];
    const pivot = field === "high" ? value > rows[i - 1][field] && value >= rows[i + 1][field] : value < rows[i - 1][field] && value <= rows[i + 1][field];
    if (!pivot) continue;
    let cluster = clusters.find(c => Math.abs(value / c.price - 1) <= 0.001);
    if (!cluster) { cluster = { price: value, times: [], last_ms: 0 }; clusters.push(cluster); }
    if (rows[i].minute_ms - cluster.last_ms >= 5 * 60_000) { cluster.times.push(rows[i].time); cluster.last_ms = rows[i].minute_ms; }
  }
  return clusters.filter(c => c.times.length >= 2).sort((a, b) => b.times.length - a.times.length).slice(0, 3)
    .map(c => ({ price: rounded(c.price, 3), confirmed_pivot_count: c.times.length, times: c.times.slice(-6) }));
}
function observeLevels(rows, levels) {
  const events = [];
  const tolerance = OBSERVATION_RULES.tolerance_pct / 100;
  for (let i = 1; i < rows.length - 1; i++) {
    const previous = rows[i - 1], row = rows[i], next = rows[i + 1];
    if (!contiguous(previous, row) || !contiguous(row, next)) continue;
    for (const [key, label] of [["support5", "五日支撑参考"], ["resistance5", "五日压力参考"], ["ma5", "MA5参考"], ["ma10", "MA10参考"]]) {
      const level = number(levels[key]);
      if (!(level > 0)) continue;
      let type = "";
      if (previous.close <= level && row.close > level * (1 + tolerance) && next.close > level * (1 + tolerance)) type = "连续两分钟站上";
      else if (previous.close >= level && row.close < level * (1 - tolerance) && next.close < level * (1 - tolerance)) type = "连续两分钟失守";
      else if (previous.close > level * (1 + tolerance) && row.low <= level * (1 + tolerance) && row.low >= level * (1 - tolerance)
        && row.close > level && next.close > level * (1 + tolerance)) type = "触及后收回";
      if (!type) continue;
      const prior = rows.slice(Math.max(0, i - 20), i);
      const baseline = prior.length === 20 && prior.every((r, j) => !j || contiguous(prior[j - 1], r)) ? mean(prior.map(r => r.amount_yuan)) : null;
      const ratio = baseline > 0 && row.amount_yuan !== null ? rounded(row.amount_yuan / baseline, 3) : null;
      events.push({ type, level_name: label, level: rounded(level, 3), time: row.time, confirmed_at: next.time,
        price: next.close, amount_vs_prior20: ratio, amount_confirmation: ratio === null ? "基准不足" : ratio >= 1.5 ? "相对成交额放大" : "未见相对成交额放大",
        interpretation: "程序观察条件；不等于完整战法确认或交易指令",
      });
    }
  }
  return events.slice(-24);
}
function fiveMinuteBars(rows) {
  const buckets = new Map();
  for (const r of rows) {
    const key = Math.floor(minuteClock(r.time) / 5);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { start: r.time, end: r.time, open: r.open, high: r.high, low: r.low, close: r.close, amount_yuan: 0, bars: 0 }; buckets.set(key, bucket); }
    bucket.end = r.time; bucket.high = Math.max(bucket.high, r.high); bucket.low = Math.min(bucket.low, r.low); bucket.close = r.close;
    bucket.amount_yuan = bucket.amount_yuan === null || number(r.amount_yuan) === null ? null : rounded(bucket.amount_yuan + r.amount_yuan, 2); bucket.bars++;
  }
  return [...buckets.values()];
}
function eligibleQuote(raw, date, now) {
  if (dateKey(raw?.date) !== date || !(number(raw?.price) > 0)) return null;
  const timestamp = number(raw.timestamp);
  if (timestamp === null || timestamp > now || chinaClock(timestamp).date !== date) return null;
  const fetched = raw.fetchedAt ? new Date(raw.fetchedAt) : null;
  return { price: number(raw.price), change_pct: number(raw.change), previous_close: number(raw.previousClose), amount_yuan: number(raw.amount),
    date, time: raw.time, timestamp, source: raw.source || "看板报价快照", quote_backend: raw.quoteBackend || "unknown",
    source_age_seconds: Math.max(0, Math.round((now - timestamp) / 1000)), fetched_at: fetched && Number.isFinite(fetched.getTime()) ? fetched.toISOString() : null,
    quality: raw.quality || "saved_quote_snapshot",
  };
}
function daysBetween(a, b) {
  if (!dateKey(a) || !dateKey(b)) return null;
  const utc = s => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6)));
  return Math.round((utc(a) - utc(b)) / 86400_000);
}

function metadataQuote(tick, meta, kind) {
  const digits = String(tick?.timetag || "").replace(/\D/g, "");
  const date = dateKey(digits), time = digits.length >= 14 ? `${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}` : null;
  if (!date || !time) return null;
  const timestamp = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T${time}+08:00`);
  const price = number(tick.lastPrice), previous = number(tick.lastClose);
  return { date, time, timestamp, price, previousClose: previous, change: changePct(price, previous), amount: number(tick.amount),
    source: tick._source || "QMT gateway full_tick", quoteBackend: tick._backend || "qmt_gateway", fetchedAt: meta.generated_at,
    quality: /1m/.test(tick._source || "") ? "qmt_historical_minute" : tick._source ? "qmt_historical_daily" : "qmt_quote", kind };
}

function mergeMetadata(raw, meta, now = Date.now()) {
  if (!meta || meta.ok !== true || normalizeCode(meta.monitor_code || meta.code) !== normalizeCode(raw.code)) throw new Error("个债资料返回的代码不匹配");
  const date = dateKey(raw.date);
  const result = { ...raw, terms: { ...raw.terms }, errors: [...(raw.errors || [])], enrichment: { source: meta.source, fetched_at: meta.generated_at, status: "loaded" } };
  result.name = meta.name || raw.name;
  const nativeDaily = normalizeDaily(meta.bond_daily || [], date, now);
  result.daily = [...new Map([...(raw.daily || []), ...nativeDaily].map(row => [row.date, row])).values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-120);
  for (const [kind, field] of [["bond", "quote"], ["stock", "stock_quote"]]) {
    const candidate = metadataQuote(meta[`${kind}_tick`], meta, kind);
    if (eligibleQuote(candidate, date, now)) result[field] = candidate;
  }
  result.stock_code = meta.stock_code || raw.stock_code;
  result.stock_name = meta.stock_name || raw.stock_name;
  const stockMinutes = (meta.stock_intraday || []).filter(r => dateKey(r.date) === date);
  result.stock_intraday = stockMinutes.length ? stockMinutes : raw.stock_intraday || [];
  result.stock_intraday_source = meta.stock_intraday_source || raw.stock_intraday_source || "QMT gateway market_data_ex 1m";
  const supplement = meta.ai_terms || {}, supplementDate = dateKey(supplement.as_of);
  if (supplementDate && supplementDate <= date && (!dateKey(raw.terms?.as_of) || dateKey(raw.terms.as_of) > date || supplementDate >= dateKey(raw.terms.as_of))) {
    const base = dateKey(raw.terms?.as_of) > date ? {} : result.terms;
    result.terms = { ...base, ...supplement.facts, source: supplement.source, as_of: supplementDate,
      verified_by_announcement: true, announcements: (supplement.announcements || []).filter(n => dateKey(n.notice_date) && dateKey(n.notice_date) <= date) };
  }
  const reference = supplement.conversion_price_reference || meta.conversion_price_reference || {};
  const conversionPrice = number(supplement.conversion_price_reference?.price ?? meta.conversion_price);
  if (dateKey(reference.as_of) && dateKey(reference.as_of) <= date && (!dateKey(result.terms?.as_of) || dateKey(reference.as_of) >= dateKey(result.terms.as_of)) && conversionPrice > 0) {
    result.terms.conversion_price = conversionPrice;
    result.terms.conversion_price_reference = { ...reference };
  }
  for (const [field, ratio] of [["redeem_trigger_price", "redeem_trigger_ratio_pct"], ["put_trigger_price", "put_trigger_ratio_pct"]]) {
    if (number(result.terms.conversion_price) > 0 && number(result.terms[ratio]) > 0) result.terms[field] = rounded(result.terms.conversion_price * result.terms[ratio] / 100, 4);
  }
  result.errors.push(...(supplement.errors || []));
  // Instrument detail has no historical effective date. Keep it separately so a later balance cannot enter historical turnover.
  if (number(meta.circulating_face_value) > 0 && !/回退/.test(meta.circulating_source || "")) result.capital_observation = {
    face_value_yuan: number(meta.circulating_face_value), source: meta.circulating_source, fetched_at: meta.generated_at,
    source_date: null, historical_usable: false, is_issue_fallback: /回退/.test(meta.circulating_source || ""),
    note: "当前接口观察，源数据未给余额生效日；不能视为分析日余额或计算历史换手率",
  };
  const source = meta.redeem || {}, notice = source.announcement;
  const announcement = dateKey(notice?.notice_date) && dateKey(notice.notice_date) <= date ? notice : null;
  const recordDate = dateKey(source.record?.trade_date);
  const datedRecord = recordDate && recordDate <= date;
  if (datedRecord || announcement) {
    const observation = datedRecord ? { ...source, trade_date: recordDate } : { status: announcement.status, risk: /^(redeem|redeeming|redeem_finished)$/.test(announcement.type) ? "triggered" : "unknown", trade_date: announcement.notice_date };
    result.redeem = { ...observation, announcement, announcement_as_of: announcement?.notice_date || null,
      ...(announcement?.facts || {}) };
    delete result.redeem.record?.path;
  }
  if (meta.quote_error) result.errors.push("已有个债接口本次未取得QMT报价，继续使用有效的本地报价");
  if (notice?.error) result.errors.push("公司公告接口本次读取失败，强赎观察仍保留；公告正文待核对");
  return result;
}

function buildContext(raw, knowledge, now = Date.now()) {
  const date = dateKey(raw.date);
  const clock = chinaClock(now);
  if (!date || date > clock.date) throw new Error("分析日期无效");
  const code = normalizeCode(raw.code);
  const daily = withDailyIndicators(normalizeDaily(raw.daily, date, now));
  const referenceDaily = normalizeDaily(raw.reference_daily, date, now);
  const levels = referenceLevels(referenceDaily, date);
  const sessions = (raw.sessions || []).filter(s => dateKey(s.date) && s.date <= date).sort((a, b) => a.date.localeCompare(b.date)).slice(-5).map(s => {
    const rows = normalRows(s.rows, s.date, now);
    const references = referenceLevels(referenceDaily, s.date);
    return { date: s.date, source: s.source, rows, reference_levels: references, coverage: coverageFor(rows, s.date, now),
      summary: periodSummary(rows), morning: periodSummary(rows.filter(r => r.time < "12:00")), afternoon: periodSummary(rows.filter(r => r.time >= "13:00")),
      repeated_highs: repeatedNodes(rows, "high"), repeated_lows: repeatedNodes(rows, "low"),
      observations: observeLevels(rows, references), indicator_source: s.indicator_source, indicator_warmup: s.indicator_warmup, average_quality: s.average_quality,
      events: (s.events || []).filter(e => number(e.event_time_ms) !== null && e.event_time_ms <= now && chinaClock(e.event_time_ms).date === s.date).slice(-20),
    };
  }).filter(s => s.rows.length);
  const latestSession = sessions.find(s => s.date === date);
  const latestMinute = latestSession?.rows.at(-1) || null;
  const latestDaily = daily.at(-1) || null;
  const localDaily = latestDaily?.date === date && latestDaily.completed && latestDaily.quality !== "minute_aggregate" ? latestDaily : null;
  const localTime = localDaily ? "15:00" : latestMinute?.time;
  const localPrice = localDaily?.close ?? latestMinute?.close;
  const previousClose = daily.filter(r => r.date < date && r.completed).at(-1)?.close;
  const localQuote = localTime ? { date, time: `${localTime}:00`, price: localPrice, previousClose,
    change: changePct(localPrice, previousClose), timestamp: Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T${localTime}:00+08:00`),
    source: localDaily?.source || latestSession.source, quality: localDaily ? "qmt_historical_daily" : "local_completed_minute", quoteBackend: "local_cache" } : null;
  const quote = eligibleQuote(raw.quote, date, now) || eligibleQuote(localQuote, date, now);
  const stockIntraday = (raw.stock_intraday || []).filter(r => dateKey(r.date) === date && inSession(minuteClock(r.time)) && number(r.price) > 0 && number(r.timestamp) !== null && r.timestamp < Math.floor(now / 60000) * 60000 && chinaClock(r.timestamp).date === date).sort((a, b) => a.timestamp - b.timestamp);
  const lastStock = stockIntraday.at(-1);
  const stockQuote = eligibleQuote(raw.stock_quote, date, now) || (lastStock ? eligibleQuote({ ...lastStock, source: raw.stock_intraday_source, quality: "local_completed_minute", quoteBackend: "local_cache" }, date, now) : null);
  const price = quote?.price ?? latestMinute?.close ?? (latestDaily?.date === date ? latestDaily.close : null);
  let terms = { ...raw.terms };
  const termsDate = dateKey(terms.as_of);
  const termsAge = daysBetween(date, termsDate);
  const conversionReference = terms.conversion_price_reference || {};
  const conversionDate = dateKey(conversionReference.as_of) || termsDate;
  const conversionAge = daysBetween(date, conversionDate);
  const conversionEffective = dateKey(conversionReference.effective_from);
  const announcedConversion = conversionReference.verified_by_announcement === true && conversionEffective && conversionEffective <= date;
  // A dated notice verifies its own publication date, not every later trading date.
  const checkedThrough = dateKey(conversionReference.verified_through);
  const verifiedThroughDate = announcedConversion && conversionReference.supersession_checked === true && checkedThrough === date && conversionDate <= date;
  const termsUsable = !conversionReference.verification_incomplete && conversionAge !== null && conversionAge >= 0 && (conversionAge <= 7 || verifiedThroughDate) && (!conversionEffective || conversionEffective <= date);
  if (termsAge < 0) terms = { source: terms.source, as_of: terms.as_of, excluded: "条款观察晚于分析日，具体数值不进入历史分析" };
  const valuationUsable = Boolean(quote && stockQuote && termsUsable && number(terms.conversion_price) > 0);
  const conversionValue = valuationUsable ? stockQuote.price / terms.conversion_price * 100 : null;
  const redeemDate = dateKey(raw.redeem?.trade_date);
  let redeem = redeemDate && redeemDate <= date ? { ...raw.redeem, age_days: daysBetween(date, redeemDate) } : null;
  const conversionStart = dateKey(terms.conversion_start_date);
  if (conversionStart) terms.days_to_conversion_start = daysBetween(conversionStart, date);
  if (!redeem && terms.verified_by_announcement && conversionStart > date) redeem = {
    risk: "inactive", status: "未进入转股期", trade_date: date, age_days: 0, conversion_start_date: conversionStart,
    countdown: `距开始转股 ${daysBetween(conversionStart, date)} 天`, price_hit_count: null,
    quality: "依据上市公告中的转股开始日判断；没有提供历史强赎计数", announcement: null,
  };
  const warnings = [...(raw.errors || [])];
  if (raw.monitor_status !== "running") warnings.push(raw.enrichment?.status === "loaded" ? "行情监控当前未运行；本地分时与日线保留，并已查询已有个债接口补充正股及公告" : "行情监控当前未运行，本次读取已保存的数据");
  const listingDate = dateKey(terms.listing_date);
  const newListing = listingDate && listingDate <= date && daysBetween(date, listingDate) < 60;
  if (daily.length < 60) warnings.push(`${newListing ? `该券${listingDate}上市；` : ""}日线只有${daily.length}根，较长周期指标可能不足`);
  const aggregatedDates = daily.filter(r => r.quality === "minute_aggregate").map(r => r.date);
  if (aggregatedDates.length) warnings.push(`${aggregatedDates.length}个日期使用本地分钟聚合日线，可能不含完整集合竞价或遗漏分钟`);
  if (levels.partial_source_dates.length) warnings.push(`参考位涉及分钟覆盖不足的日期：${levels.partial_source_dates.join("、")}`);
  if (levels.ma10 === null) warnings.push("前十个有数据的交易日不足，MA10参考位不可用");
  if (!latestSession) warnings.push("分析日缺少可用分时，不能确认日内突破或回踩");
  if (sessions.length < Number(raw.requested_days || 5)) warnings.push(`请求${raw.requested_days || 5}日分时，实际取得${sessions.length}日${newListing ? `；上市日${listingDate}之前没有该券交易数据` : ""}`);
  for (const s of sessions) if (s.coverage.missing_bars) warnings.push(`${s.date}缺少${s.coverage.missing_bars}根应有的已完成分钟，不能跨缺口确认`);
  for (const s of sessions) if (s.summary.missing_amount_bars) warnings.push(`${s.date}有${s.summary.missing_amount_bars}根分钟缺少成交额，不据此确认放量`);
  if (!stockQuote) warnings.push("缺少与分析日一致的正股报价，股债联动无法完整验证");
  if (!valuationUsable) warnings.push("缺少同日股债报价或有效日期的转股价，本次不输出可靠转股估值");
  if (!termsUsable) warnings.push(`转股价观察日期${conversionDate || "未知"}，需要更新核对`);
  if (!terms.verified_by_announcement && (termsAge === null || termsAge > 7)) warnings.push(`评级、合同到期等基础条款仍来自${termsDate || "未知日期"}快照，未全部重新核验；转股价按独立日期记录`);
  if (!redeem || (redeem.age_days > 3 && !redeem.announcement)) warnings.push("强赎观察缺失或过旧，不能判断分析日的强赎进度");
  if (raw.capital_observation) warnings.push("已取得当前剩余面值接口观察，但源数据没有生效日期，不能回填为历史余额");
  if (raw.lifecycle?.isActive === false) warnings.push("该券当前已退出存续列表，本次仅可作历史复盘");
  warnings.push("本次未提供综合新闻、财务报表和Level-2逐笔；强赎公告另列，不推断其他公司利好或真实主力资金");
  if (latestDaily && latestDaily.date < date) warnings.push(`最新日K截至${latestDaily.date}，早于分析日`);
  const nodes = Object.entries({ ma5: "MA5", ma10: "MA10", support5: "五日支撑参考", resistance5: "五日压力参考" }).map(([key, label]) => ({
    key, label, price: levels[key], distance_pct: changePct(price, levels[key]),
  }));
  return {
    context_version: CONTEXT_VERSION, code, name: String(raw.name || code), date, requested_days: Number(raw.requested_days || 5), generated_at: new Date(now).toISOString(),
    snapshot_mode: date < clock.date ? "历史快照" : clock.time >= "15:05:00" ? "盘后快照" : clock.time < "09:30:00" ? "盘前快照" : "盘中快照",
    as_of_time: quote?.time || latestMinute?.time || (latestDaily?.date === date ? "日线收盘" : "无当日数据"),
    available_dates: (raw.available_dates || []).filter(d => dateKey(d) && d <= clock.date).slice(0, 125),
    price, quote, stock: { code: raw.stock_code, name: raw.stock_name, quote: stockQuote,
      intraday: stockIntraday, intraday_source: raw.stock_intraday_source },
    daily, reference_levels: levels, nodes, sessions, latest_minute: latestMinute,
    valuation: { calculation_usable: valuationUsable, conversion_value: rounded(conversionValue, 4),
      premium_rate_pct: conversionValue > 0 ? changePct(quote.price, conversionValue) : null,
      terms_date: conversionDate || null, terms_age_days: conversionAge, terms_usable: termsUsable, conversion_price: number(terms.conversion_price),
      conversion_price_reference: conversionReference, base_terms_date: termsDate || null,
      reason: valuationUsable ? announcedConversion ? "同日股债报价，转股价由分析日及之前的正式公告正文核验" : "同日股债快照与近七日转股价观察；仍须核对正式公告" : "缺少同日行情或条款版本不能确认",
    },
    terms, redeem, capital_observation: raw.capital_observation || null, enrichment: raw.enrichment || null,
    lifecycle: raw.lifecycle || {}, tags: dateKey(raw.tags_as_of) && dateKey(raw.tags_as_of) <= date ? raw.tags || [] : [], tags_as_of: raw.tags_as_of,
    quality: { status: price === null ? "unavailable" : warnings.length ? "limited" : "ready", warnings: [...new Set(warnings)],
      daily_count: daily.length, official_daily_count: daily.length - aggregatedDates.length, aggregated_dates: aggregatedDates,
      daily_start: daily[0]?.date || null, daily_end: latestDaily?.date || null, intraday_days: sessions.length,
      news: "not_provided", financials: "not_provided", level2: "not_provided", monitor_status: raw.monitor_status,
    },
    units: { price: "元/张", amount_yuan: "元", volume_lots: "手（1手=10张），仅在原始日线有成交量时提供", percent: "%", average_approx: "分钟成交额/分钟收盘价估算的分时均价，非逐笔VWAP" },
    observation_rules: OBSERVATION_RULES, knowledge_version: knowledge.version, theory_sources: knowledge.sources,
  };
}

function modelContext(context) {
  const { daily, sessions, ...rest } = context;
  // The legacy source uses "billion" for 亿元 (100 million), which prompted
  // the model to multiply an issue amount by ten. Never send that ambiguous key.
  const namedRest = JSON.parse(JSON.stringify(rest, (key, value) => {
    if (value && typeof value === "object" && Object.hasOwn(value, "issue_scale_billion")) {
      const { issue_scale_billion: scale, ...fields } = value;
      return { ...fields, issue_amount_yuan: number(scale) === null ? null : rounded(scale * 100_000_000, 2),
        issue_scale_text: number(scale) === null ? null : `${scale}亿元` };
    }
    return value;
  }));
  const priceFields = ["date", "open", "high", "low", "close", "amount_yuan", "volume_lots", "ma5", "ma10", "ma20", "ma60", "change_pct", "completed", "quality", "bar_count"];
  return { ...namedRest, available_dates: undefined, lifecycle: { is_active_now: context.lifecycle.isActive, reason: context.lifecycle.reason, checked_at: context.lifecycle.checkedAt,
    note: "当前观察，仅提示当前存续；历史复盘不把它视作当时已知信息" },
    daily: daily.slice(-90).map(r => Object.fromEntries(priceFields.map(k => [k, r[k] ?? null]))),
    sessions: sessions.map((s, i) => {
      const { rows, ...summary } = s;
      return { ...summary, five_minute_bars: fiveMinuteBars(rows), last_completed_minutes: i === sessions.length - 1 ? rows.slice(-60) : undefined };
    }),
  };
}

module.exports = { CONTEXT_VERSION, OBSERVATION_RULES, number, rounded, dateKey, chinaClock, normalizeCode, referenceLevels,
  normalizeDaily, normalRows, coverageFor, observeLevels, fiveMinuteBars, buildContext, modelContext, eligibleQuote, mergeMetadata };
