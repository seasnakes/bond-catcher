"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPortfolioRankings,
  enrichFactorRows,
  listPortfolioStrategies,
  runPortfolioBacktest,
} = require("../lib/cb-portfolio-engine.js");

function dateAt(index) {
  const date = new Date(Date.UTC(2026, 0, 1 + index));
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function factorSeries(code, base, premium, balance = 500_000_000) {
  return Array.from({ length: 36 }, (_value, index) => ({
    date: dateAt(index),
    code,
    close: base + index * 0.1,
    premium_rate: premium,
    conversion_value: 100,
    remaining_balance_yuan: index === 0 ? balance : null,
  }));
}

test("组合策略注册表保留双低、三低和六因子", () => {
  assert.deepEqual(listPortfolioStrategies().map((item) => item.name), [
    "cb_double_low",
    "cb_three_low",
    "cb_factor_rotation",
  ]);
});

test("历史余额只向未来结转，不用后来的余额倒填过去", () => {
  const rows = enrichFactorRows([
    { date: "20260101", code: "123001.SZ", close: 100, premium_rate: 10 },
    { date: "20260102", code: "123001.SZ", close: 101, premium_rate: 10, remaining_balance_yuan: 300_000_000 },
  ]);
  assert.equal(rows[0].remaining_balance_billion, null);
  assert.equal(rows[1].remaining_balance_billion, 3);
});

test("历史截面排除定向债等非普通可转债代码", () => {
  const rows = enrichFactorRows([
    { date: "20260101", code: "137194.SH", close: 90, premium_rate: 1 },
    { date: "20260101", code: "123001.SZ", close: 100, premium_rate: 10 },
  ]);
  assert.deepEqual(rows.map((row) => row.code), ["123001.SZ"]);
});

test("三低和六因子不会用缺失余额或中性常数静默降级", () => {
  const complete = factorSeries("123001.SZ", 100, 10);
  const missingBalance = factorSeries("123002.SZ", 99, 8, null);
  const options = {
    factorRows: [...complete, ...missingBalance],
    startDate: dateAt(30),
    endDate: dateAt(35),
    topN: 10,
  };
  for (const strategy of ["cb_three_low", "cb_factor_rotation"]) {
    const ranking = buildPortfolioRankings({ ...options, strategy });
    assert.ok(ranking.dates.length > 0);
    assert.equal(ranking.byDate.get(ranking.dates[0]).some((row) => row.code === "123002.SZ"), false);
  }
});

test("组合回测按T日收盘排名、T+1开盘成交且数量为10张整数倍", () => {
  const factorRows = [
    ...factorSeries("123001.SZ", 100, 5),
    ...factorSeries("123002.SZ", 110, 20),
  ];
  const startDate = dateAt(30);
  const endDate = dateAt(35);
  const ranking = buildPortfolioRankings({
    strategy: "cb_double_low",
    factorRows,
    startDate,
    endDate,
    topN: 1,
  });
  const openRows = ranking.dates.flatMap((date) => [
    { date, code: "123001.SZ", open: 105, volume: 1000, amount: 100000 },
    { date, code: "123002.SZ", open: 115, volume: 1000, amount: 100000 },
  ]);
  const result = runPortfolioBacktest({
    ranking,
    openRows,
    initialCash: 100_000,
    commissionRate: 0,
    slippageBps: 0,
  });
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].side, "buy");
  assert.equal(result.trades[0].signal_date, ranking.dates[0]);
  assert.equal(result.trades[0].date, ranking.dates[1]);
  assert.equal(result.trades[0].quantity % 10, 0);
  assert.equal(result.params.settlement, "T+0");
});
