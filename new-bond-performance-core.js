(function exposeNewBondPerformance(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NewBondPerformance = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createNewBondPerformance() {
  "use strict";

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function median(values) {
    const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function chooseDefaultCodes(universe, limit = 12) {
    return (Array.isArray(universe) ? universe : [])
      .slice()
      .sort((left, right) => String(right.listing_date || "").localeCompare(String(left.listing_date || "")))
      .slice(0, Math.max(1, limit))
      .map((row) => String(row.code || ""))
      .filter(Boolean);
  }

  function nearestPoint(points, progress) {
    const rows = Array.isArray(points) ? points : [];
    if (!rows.length) return null;
    const target = Math.max(0, Math.min(1, finiteNumber(progress)));
    let low = 0;
    let high = rows.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (finiteNumber(rows[middle].progress) < target) low = middle + 1;
      else high = middle;
    }
    if (low === 0) return rows[0];
    const current = rows[low];
    const previous = rows[low - 1];
    return Math.abs(finiteNumber(current.progress) - target)
      < Math.abs(finiteNumber(previous.progress) - target)
      ? current
      : previous;
  }

  function sortTooltipRows(rows, field = "close") {
    return (Array.isArray(rows) ? rows : [])
      .slice()
      .sort((left, right) => {
        const leftValue = Number(left?.point?.[field]);
        const rightValue = Number(right?.point?.[field]);
        if (Number.isFinite(leftValue) && Number.isFinite(rightValue) && leftValue !== rightValue) {
          return rightValue - leftValue;
        }
        if (Number.isFinite(leftValue) !== Number.isFinite(rightValue)) {
          return Number.isFinite(leftValue) ? -1 : 1;
        }
        return String(left?.item?.name || left?.item?.code || "")
          .localeCompare(String(right?.item?.name || right?.item?.code || ""), "zh-CN");
      });
  }

  function chartDomain(series, field = "return_pct") {
    const values = (Array.isArray(series) ? series : [])
      .flatMap((item) => item.points || [])
      .map((point) => Number(point[field]))
      .filter(Number.isFinite);
    if (!values.length) return { minimum: -1, maximum: 1 };
    const includeZero = field === "return_pct";
    const minimum = includeZero ? Math.min(0, ...values) : Math.min(...values);
    const maximum = includeZero ? Math.max(0, ...values) : Math.max(...values);
    const padding = Math.max(field === "close" ? 0.5 : 0.8, (maximum - minimum) * 0.08);
    return { minimum: minimum - padding, maximum: maximum + padding };
  }

  function monotoneBezierSegments(points) {
    const rows = (Array.isArray(points) ? points : [])
      .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .sort((left, right) => left.x - right.x);
    if (rows.length < 2) return [];
    const slopes = rows.slice(0, -1).map((point, index) => {
      const width = rows[index + 1].x - point.x;
      return width > 0 ? (rows[index + 1].y - point.y) / width : 0;
    });
    const tangents = rows.map((_point, index) => {
      if (index === 0) return slopes[0];
      if (index === rows.length - 1) return slopes.at(-1);
      return slopes[index - 1] * slopes[index] <= 0
        ? 0
        : (slopes[index - 1] + slopes[index]) / 2;
    });
    slopes.forEach((slope, index) => {
      if (slope === 0) {
        tangents[index] = 0;
        tangents[index + 1] = 0;
        return;
      }
      const left = tangents[index] / slope;
      const right = tangents[index + 1] / slope;
      const magnitude = Math.hypot(left, right);
      if (magnitude > 3) {
        const scale = 3 / magnitude;
        tangents[index] = scale * left * slope;
        tangents[index + 1] = scale * right * slope;
      }
    });
    return rows.slice(0, -1).map((from, index) => {
      const to = rows[index + 1];
      const width = to.x - from.x;
      return {
        from,
        to,
        control1: {
          x: from.x + width / 3,
          y: from.y + tangents[index] * width / 3,
        },
        control2: {
          x: to.x - width / 3,
          y: to.y - tangents[index + 1] * width / 3,
        },
      };
    });
  }

  function summarizeSeries(series) {
    const rows = Array.isArray(series) ? series : [];
    const returns = rows.map((row) => Number(row.return_pct)).filter(Number.isFinite);
    return {
      count: rows.length,
      medianReturn: median(returns),
      risingCount: returns.filter((value) => value > 0).length,
      completeStartCount: rows.filter((row) => row.listing_day_complete === true).length,
    };
  }

  return {
    chartDomain,
    chooseDefaultCodes,
    median,
    monotoneBezierSegments,
    nearestPoint,
    sortTooltipRows,
    summarizeSeries,
  };
});
