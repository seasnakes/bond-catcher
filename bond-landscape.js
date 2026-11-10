(function exposeBondLandscape(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BondLandscape = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createBondLandscape() {
  "use strict";

  const NUMERIC_DIMENSIONS = 5;
  const HASHED_DIMENSIONS = 48;
  const FEATURE_DIMENSIONS = NUMERIC_DIMENSIONS + HASHED_DIMENSIONS;
  const NON_SEMANTIC_TOKENS = new Set([
    "新上市转债",
    "待分类",
    "未分类",
    "待补",
    "待补正股",
    "次新债",
    "小盘",
    "ST",
  ]);

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum = 0, maximum = 1) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function quantile(values, percentile) {
    const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
    if (sorted.length === 0) return 0;
    const position = (sorted.length - 1) * clamp(percentile);
    const index = Math.floor(position);
    const fraction = position - index;
    const next = sorted[Math.min(index + 1, sorted.length - 1)];
    return sorted[index] + (next - sorted[index]) * fraction;
  }

  function median(values) {
    return quantile(values, 0.5);
  }

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function ratingValue(value) {
    const rating = String(value || "").toUpperCase().replace(/STI|\s/g, "");
    const scores = {
      "AAA": 1,
      "AA+": 0.88,
      "AA": 0.76,
      "AA-": 0.64,
      "A+": 0.52,
      "A": 0.4,
      "A-": 0.28,
      "BBB+": 0.2,
      "BBB": 0.13,
      "BBB-": 0.08,
      "BB": 0.04,
      "B": 0.02,
      "CC": 0,
    };
    return scores[rating] ?? 0.34;
  }

  function percentileRanks(rows, accessor) {
    const ranked = rows
      .map((row, index) => ({ index, value: Number(accessor(row)) }))
      .filter((item) => Number.isFinite(item.value))
      .sort((left, right) => left.value - right.value);
    const output = new Array(rows.length).fill(0.5);
    const denominator = Math.max(1, ranked.length - 1);
    ranked.forEach((item, rank) => {
      output[item.index] = rank / denominator;
    });
    return output;
  }

  function addHashedFeature(vector, namespace, value, weight) {
    const token = String(value || "").trim();
    if (!token || NON_SEMANTIC_TOKENS.has(token)) return;
    const hash = hashString(`${namespace}:${token}`);
    const index = NUMERIC_DIMENSIONS + (hash % HASHED_DIMENSIONS);
    const sign = (hash & 0x100) === 0 ? 1 : -1;
    vector[index] += sign * weight;
  }

  function normalizeVector(vector) {
    const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => value / length);
  }

  function buildFeatureMatrix(rows) {
    const priceRanks = percentileRanks(rows, (row) => row.price);
    const premiumRanks = percentileRanks(rows, (row) => row.premium);
    const issueRanks = percentileRanks(rows, (row) => row.issue);
    const ratingRanks = percentileRanks(rows, (row) => ratingValue(row.rating));
    const conversionRanks = percentileRanks(rows, (row) => row.conversionValue ?? row.price / (1 + finiteNumber(row.premium) / 100));

    const matrix = rows.map((row, rowIndex) => {
      const vector = new Array(FEATURE_DIMENSIONS).fill(0);
      vector[0] = (priceRanks[rowIndex] - 0.5) * 1.2;
      vector[1] = (premiumRanks[rowIndex] - 0.5) * 1.45;
      vector[2] = (issueRanks[rowIndex] - 0.5) * 0.85;
      vector[3] = (ratingRanks[rowIndex] - 0.5) * 0.8;
      vector[4] = (conversionRanks[rowIndex] - 0.5) * 0.65;

      addHashedFeature(vector, "industry1", row.industry1, 1.15);
      addHashedFeature(vector, "industry2", row.industry2, 1.4);
      addHashedFeature(vector, "industry3", row.industry3, 1.55);
      addHashedFeature(vector, "theme", row.theme, 0.95);
      for (const tag of (row.tags || []).slice(0, 8)) addHashedFeature(vector, "tag", tag, 0.62);
      for (const topic of (row.topics || []).slice(0, 12)) addHashedFeature(vector, "topic", topic, 0.22);
      return normalizeVector(vector);
    });

    for (let dimension = 0; dimension < FEATURE_DIMENSIONS; dimension += 1) {
      const mean = matrix.reduce((sum, vector) => sum + vector[dimension], 0) / Math.max(1, matrix.length);
      for (const vector of matrix) vector[dimension] -= mean;
    }
    return matrix;
  }

  function dot(left, right) {
    let value = 0;
    for (let index = 0; index < left.length; index += 1) value += left[index] * right[index];
    return value;
  }

  function normalizeInPlace(vector) {
    const length = Math.sqrt(dot(vector, vector)) || 1;
    for (let index = 0; index < vector.length; index += 1) vector[index] /= length;
    return vector;
  }

  function principalDirection(matrix, previousDirections, seed) {
    const dimensions = matrix[0]?.length || FEATURE_DIMENSIONS;
    const direction = Array.from({ length: dimensions }, (_value, index) =>
      Math.sin((index + 1) * (seed + 1) * 1.61803398875) + Math.cos((index + 3) * (seed + 2)),
    );
    normalizeInPlace(direction);

    for (let iteration = 0; iteration < 72; iteration += 1) {
      const next = new Array(dimensions).fill(0);
      for (const row of matrix) {
        const score = dot(row, direction);
        for (let dimension = 0; dimension < dimensions; dimension += 1) {
          next[dimension] += row[dimension] * score;
        }
      }
      for (const previous of previousDirections) {
        const projection = dot(next, previous);
        for (let dimension = 0; dimension < dimensions; dimension += 1) {
          next[dimension] -= previous[dimension] * projection;
        }
      }
      normalizeInPlace(next);
      for (let dimension = 0; dimension < dimensions; dimension += 1) direction[dimension] = next[dimension];
    }
    return direction;
  }

  function orientScores(scores) {
    let maximumIndex = 0;
    for (let index = 1; index < scores.length; index += 1) {
      if (Math.abs(scores[index]) > Math.abs(scores[maximumIndex])) maximumIndex = index;
    }
    if (scores[maximumIndex] < 0) return scores.map((value) => -value);
    return scores;
  }

  function scaleScores(scores) {
    const minimum = quantile(scores, 0.025);
    const maximum = quantile(scores, 0.975);
    const range = maximum - minimum || 1;
    return scores.map((value) => 0.055 + clamp((value - minimum) / range) * 0.89);
  }

  function computeBaseEmbedding(rows) {
    const positions = new Map();
    if (!Array.isArray(rows) || rows.length === 0) return positions;
    if (rows.length === 1) {
      positions.set(rows[0].code, { x: 0.5, y: 0.5 });
      return positions;
    }
    const matrix = buildFeatureMatrix(rows);
    const first = principalDirection(matrix, [], 1);
    const second = principalDirection(matrix, [first], 7);
    const xScores = scaleScores(orientScores(matrix.map((row) => dot(row, first))));
    const yScores = scaleScores(orientScores(matrix.map((row) => dot(row, second))));
    rows.forEach((row, index) => positions.set(row.code, { x: xScores[index], y: yScores[index] }));
    return positions;
  }

  function computeGroupedEmbedding(rows, basePositions, groupFor) {
    const buckets = new Map();
    for (const row of rows) {
      const group = String(groupFor(row) || "未分类");
      if (!buckets.has(group)) buckets.set(group, []);
      buckets.get(group).push(row);
    }
    if (buckets.size <= 1) return basePositions;

    const largestGroup = Math.max(...[...buckets.values()].map((members) => members.length), 1);
    const groups = [...buckets].map(([name, members]) => {
      const sourceX = members.reduce((sum, row) => sum + (basePositions.get(row.code)?.x ?? 0.5), 0) / members.length;
      const sourceY = members.reduce((sum, row) => sum + (basePositions.get(row.code)?.y ?? 0.5), 0) / members.length;
      const radius = 0.028 + Math.sqrt(members.length / largestGroup) * 0.055;
      const jitterAngle = hashString(`group-anchor:${name}`) / 0xffffffff * Math.PI * 2;
      return {
        name,
        members,
        sourceX,
        sourceY,
        radius,
        x: clamp(sourceX + Math.cos(jitterAngle) * 0.004, 0.08, 0.92),
        y: clamp(sourceY + Math.sin(jitterAngle) * 0.004, 0.08, 0.92),
      };
    });

    for (let iteration = 0; iteration < 180; iteration += 1) {
      for (const item of groups) {
        item.x += (item.sourceX - item.x) * 0.012;
        item.y += (item.sourceY - item.y) * 0.012;
      }
      for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
        const left = groups[leftIndex];
        for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex += 1) {
          const right = groups[rightIndex];
          let dx = right.x - left.x;
          let dy = right.y - left.y;
          let distance = Math.hypot(dx, dy);
          const minimumDistance = left.radius + right.radius + 0.022;
          if (distance >= minimumDistance) continue;
          if (distance < 1e-6) {
            const angle = hashString(`${left.name}:${right.name}`) / 0xffffffff * Math.PI * 2;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            distance = 1;
          }
          const push = (minimumDistance - distance) * 0.24;
          const ux = dx / distance;
          const uy = dy / distance;
          left.x -= ux * push;
          left.y -= uy * push;
          right.x += ux * push;
          right.y += uy * push;
        }
      }
      for (const item of groups) {
        item.x = clamp(item.x, item.radius + 0.035, 0.965 - item.radius);
        item.y = clamp(item.y, item.radius + 0.035, 0.965 - item.radius);
      }
    }

    const output = new Map();
    for (const item of groups) {
      const distances = item.members.map((row) => {
        const position = basePositions.get(row.code) || { x: item.sourceX, y: item.sourceY };
        return Math.hypot(position.x - item.sourceX, position.y - item.sourceY);
      });
      const localScale = quantile(distances, 0.9) || 1;
      const localRadius = item.radius * 0.78;
      for (const row of item.members) {
        const position = basePositions.get(row.code) || { x: item.sourceX, y: item.sourceY };
        const dx = position.x - item.sourceX;
        const dy = position.y - item.sourceY;
        const distance = Math.hypot(dx, dy);
        const ratio = Math.min(1, distance / localScale);
        let offsetX = distance ? dx / distance * ratio * localRadius : 0;
        let offsetY = distance ? dy / distance * ratio * localRadius : 0;
        if (item.members.length > 1) {
          const angle = hashString(`group-member:${row.code}`) / 0xffffffff * Math.PI * 2;
          offsetX += Math.cos(angle) * item.radius * 0.035;
          offsetY += Math.sin(angle) * item.radius * 0.035;
        }
        output.set(row.code, {
          x: clamp(item.x + offsetX, 0.035, 0.965),
          y: clamp(item.y + offsetY, 0.035, 0.965),
        });
      }
    }
    return output;
  }

  function computeEmbedding(rows, options = {}) {
    const positions = computeBaseEmbedding(rows);
    if (typeof options.groupFor !== "function" || !Array.isArray(rows) || rows.length < 2) return positions;
    return computeGroupedEmbedding(rows, positions, options.groupFor);
  }

  function computeGroupStats(rows, groupFor) {
    const buckets = new Map();
    for (const row of rows) {
      const group = String(groupFor(row) || "未分类");
      if (!buckets.has(group)) buckets.set(group, new Map());
      const memberKey = row.stockCode || row.stock || row.code;
      const hasStockChange = row.stockChange !== null
        && row.stockChange !== undefined
        && Number.isFinite(Number(row.stockChange));
      const value = hasStockChange ? Number(row.stockChange) : Number(row.change);
      if (Number.isFinite(value) && !buckets.get(group).has(memberKey)) buckets.get(group).set(memberKey, value);
    }

    const rawStats = [...buckets].map(([name, members]) => {
      const changes = [...members.values()];
      const middle = median(changes);
      const advanceRatio = changes.length
        ? changes.filter((value) => value > 0).length / changes.length
        : 0.5;
      return {
        name,
        memberCount: changes.length,
        medianChange: middle,
        advanceRatio,
        rawStrength: middle + (advanceRatio - 0.5) * 1.6,
      };
    });
    const center = median(rawStats.map((item) => item.rawStrength));
    const deviation = median(rawStats.map((item) => Math.abs(item.rawStrength - center))) || 0.6;
    const output = new Map();
    for (const item of rawStats) {
      output.set(item.name, {
        ...item,
        strength: Math.tanh((item.rawStrength - center) / Math.max(0.35, deviation * 2.2)),
      });
    }
    return output;
  }

  function normalizedActivities(rows, field) {
    const values = rows.map((row) => Math.log1p(Math.max(0, finiteNumber(row[field]))));
    const maximum = quantile(values, 0.96) || 1;
    return values.map((value) => clamp(value / maximum));
  }

  function sampleGrid(values, columns, rows, x, y) {
    const px = clamp(x) * (columns - 1);
    const py = clamp(y) * (rows - 1);
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const x1 = Math.min(columns - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const tx = px - x0;
    const ty = py - y0;
    const top = values[y0 * columns + x0] * (1 - tx) + values[y0 * columns + x1] * tx;
    const bottom = values[y1 * columns + x0] * (1 - tx) + values[y1 * columns + x1] * tx;
    return top * (1 - ty) + bottom * ty;
  }

  function buildTerrain(rows, positions, options = {}) {
    const columns = Math.max(16, Number(options.columns) || 64);
    const gridRows = Math.max(12, Number(options.rows) || 44);
    const sigma = clamp(Number(options.sigma) || 0.067, 0.025, 0.2);
    const heightMode = options.heightMode || "groupStrength";
    const groupFor = options.groupFor || (() => "全部");
    const groupStats = computeGroupStats(rows, groupFor);
    const activities = normalizedActivities(rows, options.sizeField || "amount");
    const points = rows.map((row, index) => {
      const position = positions.get(row.code) || { x: 0.5, y: 0.5 };
      const group = String(groupFor(row) || "未分类");
      const groupStat = groupStats.get(group) || { strength: 0, medianChange: 0 };
      let weight = 1;
      if (heightMode === "groupStrength") weight = 0.48 + (groupStat.strength + 1) * 0.47;
      if (heightMode === "activity") weight = 0.28 + activities[index] * 1.2;
      return {
        row,
        group,
        x: position.x,
        y: position.y,
        activity: activities[index],
        weight,
        tone: heightMode === "groupStrength"
          ? groupStat.strength
          : Math.tanh(finiteNumber(row.change) / 3),
      };
    });

    const values = new Array(columns * gridRows).fill(0);
    const toneSums = new Array(columns * gridRows).fill(0);
    const toneWeights = new Array(columns * gridRows).fill(0);
    const terrainSources = heightMode === "groupPeak"
      ? [...new Set(points.map((point) => point.group))].map((group) => {
          const members = points.filter((point) => point.group === group);
          const x = members.reduce((sum, point) => sum + point.x, 0) / members.length;
          const y = members.reduce((sum, point) => sum + point.y, 0) / members.length;
          const spread = quantile(members.map((point) => Math.hypot(point.x - x, point.y - y)), 0.9);
          const stat = groupStats.get(group) || { strength: 0 };
          return {
            group,
            x,
            y,
            sigma: clamp(Math.max(sigma * 0.72, spread * 1.55), 0.038, 0.14),
            weight: 0.08 + (clamp(stat.strength, -1, 1) + 1) * 0.46,
            tone: stat.strength,
          };
        })
      : points.map((point) => ({ ...point, sigma }));
    let maximum = 0;

    for (let gy = 0; gy < gridRows; gy += 1) {
      const y = gy / (gridRows - 1);
      for (let gx = 0; gx < columns; gx += 1) {
        const x = gx / (columns - 1);
        const index = gy * columns + gx;
        for (const source of terrainSources) {
          const dx = x - source.x;
          const dy = y - source.y;
          const distanceSquared = dx * dx + dy * dy;
          const radiusSquared = (source.sigma * 3.25) ** 2;
          if (distanceSquared > radiusSquared) continue;
          const denominator = 2 * source.sigma * source.sigma;
          const kernel = Math.exp(-distanceSquared / denominator) * source.weight;
          if (heightMode === "groupPeak") {
            if (kernel > values[index]) {
              values[index] = kernel;
              toneSums[index] = source.tone;
              toneWeights[index] = 1;
            }
          } else {
            values[index] += kernel;
            toneSums[index] += kernel * source.tone;
            toneWeights[index] += kernel;
          }
        }
        maximum = Math.max(maximum, values[index]);
      }
    }

    const scale = maximum || 1;
    for (let index = 0; index < values.length; index += 1) {
      values[index] = clamp(values[index] / scale);
      if (heightMode !== "groupPeak") {
        toneSums[index] = toneWeights[index] ? clamp(toneSums[index] / toneWeights[index], -1, 1) : 0;
      }
    }
    const groupHeights = new Map(
      terrainSources.map((source) => [source.group, clamp(source.weight / scale)]),
    );
    for (const point of points) {
      point.z = heightMode === "groupPeak"
        ? (groupHeights.get(point.group) ?? 0)
        : sampleGrid(values, columns, gridRows, point.x, point.y);
    }
    return { columns, rows: gridRows, values, tones: toneSums, points, groupStats };
  }

  const MARCHING_CASES = {
    1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]],
    5: [[3, 2], [0, 1]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]],
    9: [[0, 2]], 10: [[0, 3], [1, 2]], 11: [[1, 2]], 12: [[1, 3]],
    13: [[0, 1]], 14: [[3, 0]],
  };

  function edgePoint(edge, gx, gy, cornerValues, threshold) {
    const corners = [
      { x: gx, y: gy },
      { x: gx + 1, y: gy },
      { x: gx + 1, y: gy + 1 },
      { x: gx, y: gy + 1 },
    ];
    const edgeCorners = [[0, 1], [1, 2], [2, 3], [3, 0]];
    const [fromIndex, toIndex] = edgeCorners[edge];
    const fromValue = cornerValues[fromIndex];
    const toValue = cornerValues[toIndex];
    const ratio = clamp((threshold - fromValue) / ((toValue - fromValue) || 1));
    return {
      x: corners[fromIndex].x + (corners[toIndex].x - corners[fromIndex].x) * ratio,
      y: corners[fromIndex].y + (corners[toIndex].y - corners[fromIndex].y) * ratio,
    };
  }

  function marchingSquares(grid, thresholds, pixelWidth = 1, pixelHeight = 1) {
    const output = [];
    for (const threshold of thresholds) {
      const segments = [];
      for (let gy = 0; gy < grid.rows - 1; gy += 1) {
        for (let gx = 0; gx < grid.columns - 1; gx += 1) {
          const topLeft = grid.values[gy * grid.columns + gx];
          const topRight = grid.values[gy * grid.columns + gx + 1];
          const bottomRight = grid.values[(gy + 1) * grid.columns + gx + 1];
          const bottomLeft = grid.values[(gy + 1) * grid.columns + gx];
          const cornerValues = [topLeft, topRight, bottomRight, bottomLeft];
          const caseIndex = cornerValues.reduce(
            (value, corner, index) => value | (corner >= threshold ? 1 << index : 0),
            0,
          );
          for (const [fromEdge, toEdge] of MARCHING_CASES[caseIndex] || []) {
            const from = edgePoint(fromEdge, gx, gy, cornerValues, threshold);
            const to = edgePoint(toEdge, gx, gy, cornerValues, threshold);
            segments.push([
              { x: from.x / (grid.columns - 1) * pixelWidth, y: from.y / (grid.rows - 1) * pixelHeight },
              { x: to.x / (grid.columns - 1) * pixelWidth, y: to.y / (grid.rows - 1) * pixelHeight },
            ]);
          }
        }
      }
      output.push({ threshold, segments });
    }
    return output;
  }

  function project3D(x, y, z, width, height, camera = {}) {
    const yaw = finiteNumber(camera.yaw, -10 * Math.PI / 180);
    const pitch = clamp(finiteNumber(camera.pitch, 50 * Math.PI / 180), 18 * Math.PI / 180, 72 * Math.PI / 180);
    const zoom = clamp(finiteNumber(camera.zoom, 1), 0.75, 1.8);
    const panX = clamp(finiteNumber(camera.panX), -0.45, 0.45);
    const panY = clamp(finiteNumber(camera.panY), -0.45, 0.45);
    const centeredX = finiteNumber(x, 0.5) - 0.5;
    const centeredY = finiteNumber(y, 0.5) - 0.5;
    const rotatedX = centeredX * Math.cos(yaw) - centeredY * Math.sin(yaw);
    const rotatedY = centeredX * Math.sin(yaw) + centeredY * Math.cos(yaw);
    const elevation = Math.max(0, finiteNumber(z));
    return {
      x: width * (0.5 + panX + rotatedX * 0.62 * zoom),
      y: height * (
        0.61
        + panY
        + rotatedY * 0.5 * Math.sin(pitch) * zoom
        - elevation * 0.36 * Math.cos(pitch) * zoom
      ),
      depth: rotatedY * Math.cos(pitch) + elevation * Math.sin(pitch),
    };
  }

  function selectAttentionPoints(points, threshold = 2, limit = 18) {
    const minimum = Math.max(0, finiteNumber(threshold, 2));
    if (minimum <= 0 || !Array.isArray(points)) return [];
    return points
      .filter((point) => {
        const change = Number(point?.row?.change);
        return Number.isFinite(change) && Math.abs(change) >= minimum;
      })
      .sort((left, right) => {
        const changeDifference = Math.abs(Number(right.row.change)) - Math.abs(Number(left.row.change));
        if (changeDifference) return changeDifference;
        return finiteNumber(right.row.amount) - finiteNumber(left.row.amount);
      })
      .slice(0, Math.max(0, Math.floor(finiteNumber(limit, 18))));
  }

  return {
    buildFeatureMatrix,
    buildTerrain,
    computeEmbedding,
    computeGroupStats,
    marchingSquares,
    project3D,
    quantile,
    sampleGrid,
    selectAttentionPoints,
  };
});
