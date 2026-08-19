"""Small, auditable translations of the three TongDaXin selection formulas."""

from __future__ import annotations

import math
from typing import Any, Callable, Optional


Number = Optional[float]


def number(value: Any) -> Number:
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def ref(values: list[Any], periods: int = 1) -> list[Any]:
    return [None] * periods + list(values[:-periods] if periods else values)


def rolling(values: list[Number], window: int, fn: Callable[[list[float]], float]) -> list[Number]:
    result: list[Number] = []
    for index in range(len(values)):
        available = [
            value
            for value in values[max(0, index - window + 1) : index + 1]
            if value is not None
        ]
        result.append(fn(available) if available else None)
    return result


def hhv(values: list[Number], window: int) -> list[Number]:
    return rolling(values, window, max)


def llv(values: list[Number], window: int) -> list[Number]:
    return rolling(values, window, min)


def ma(values: list[Number], window: int) -> list[Number]:
    return rolling(values, window, lambda rows: sum(rows) / len(rows))


def ema(values: list[Number], window: int) -> list[Number]:
    alpha = 2.0 / (window + 1.0)
    result: list[Number] = []
    previous: Number = None
    for value in values:
        if value is None:
            result.append(previous)
            continue
        previous = value if previous is None else alpha * value + (1.0 - alpha) * previous
        result.append(previous)
    return result


def sma(values: list[Number], window: int, weight: int = 1) -> list[Number]:
    result: list[Number] = []
    previous: Number = None
    for value in values:
        if value is None:
            result.append(previous)
            continue
        previous = (
            value
            if previous is None
            else (weight * value + (window - weight) * previous) / window
        )
        result.append(previous)
    return result


def safe_div(numerator: Number, denominator: Number, scale: float = 1.0) -> Number:
    if numerator is None or denominator is None or abs(denominator) < 1e-12:
        return None
    return numerator / denominator * scale


def binary(
    left: list[Number], right: list[Number], operation: Callable[[float, float], float]
) -> list[Number]:
    return [
        operation(a, b) if a is not None and b is not None else None
        for a, b in zip(left, right)
    ]


def cross(left: list[Number], right: list[Number]) -> list[bool]:
    result = [False] * len(left)
    for index in range(1, len(left)):
        values = (left[index], right[index], left[index - 1], right[index - 1])
        if all(value is not None for value in values):
            result[index] = bool(left[index] > right[index] and left[index - 1] <= right[index - 1])
    return result


def barslast(values: list[bool]) -> list[int]:
    result: list[int] = []
    last_true: int | None = None
    for index, value in enumerate(values):
        if value:
            last_true = index
        result.append(index - last_true if last_true is not None else index + 1)
    return result


def count(values: list[bool], window: int) -> list[int]:
    result: list[int] = []
    for index in range(len(values)):
        start = 0 if window <= 0 else max(0, index - window + 1)
        result.append(sum(1 for value in values[start : index + 1] if value))
    return result


def dynamic_count(values: list[bool], windows: list[int]) -> list[int]:
    result = []
    for index, window in enumerate(windows):
        start = 0 if window <= 0 else max(0, index - window + 1)
        result.append(sum(1 for value in values[start : index + 1] if value))
    return result


def _series(rows: list[dict[str, Any]], key: str) -> list[Number]:
    return [number(row.get(key)) for row in rows]


def single_needle(rows: list[dict[str, Any]]) -> list[bool]:
    close = _series(rows, "close")
    low = _series(rows, "low")
    low3, low21 = llv(low, 3), llv(low, 21)
    high3, high21 = hhv(close, 3), hhv(close, 21)
    result = []
    for index in range(len(rows)):
        short = safe_div(
            None if close[index] is None or low3[index] is None else close[index] - low3[index],
            None if high3[index] is None or low3[index] is None else high3[index] - low3[index],
            100,
        )
        long = safe_div(
            None if close[index] is None or low21[index] is None else close[index] - low21[index],
            None if high21[index] is None or low21[index] is None else high21[index] - low21[index],
            100,
        )
        result.append(bool(long is not None and short is not None and long >= 70 and short <= 30))
    return result


def unusual_move(rows: list[dict[str, Any]]) -> list[bool]:
    close = _series(rows, "close")
    high = _series(rows, "high")
    low = _series(rows, "low")
    volume = _series(rows, "volume")
    low9, high9 = llv(low, 9), hhv(high, 9)
    rsv = [
        safe_div(
            None if close[i] is None or low9[i] is None else close[i] - low9[i],
            None if high9[i] is None or low9[i] is None else high9[i] - low9[i],
            100,
        )
        for i in range(len(rows))
    ]
    k = sma(rsv, 3, 1)
    d = sma(k, 3, 1)
    j = [
        3 * k_value - 2 * d_value
        if k_value is not None and d_value is not None
        else None
        for k_value, d_value in zip(k, d)
    ]
    ema12, ema26 = ema(close, 12), ema(close, 26)
    dif = binary(ema12, ema26, lambda left, right: left - right)

    vh1 = hhv(volume, 30)
    vh2_source = [
        value if value is not None and limit is not None and value < limit else 0.0
        for value, limit in zip(volume, vh1)
    ]
    vh2 = hhv(vh2_source, 30)
    vh3_source = [
        value if value is not None and limit is not None and value < limit else 0.0
        for value, limit in zip(volume, vh2)
    ]
    vh3 = hhv(vh3_source, 30)

    vl1 = llv(volume, 30)
    vl2_source = [
        value if value is not None and limit is not None and value > limit else 9_999_999.0
        for value, limit in zip(volume, vl1)
    ]
    vl2 = llv(vl2_source, 30)
    vl3_source = [
        value if value is not None and limit is not None and value > limit else 9_999_999.0
        for value, limit in zip(volume, vl2)
    ]
    vl3 = llv(vl3_source, 30)

    result = []
    for i in range(len(rows)):
        high_values = (vh1[i], vh2[i], vh3[i])
        low_values = (vl1[i], vl2[i], vl3[i])
        if j[i] is None or dif[i] is None or any(value is None for value in high_values + low_values):
            result.append(False)
            continue
        avg_high = sum(high_values) / 3  # type: ignore[arg-type]
        avg_low = sum(low_values) / 3  # type: ignore[arg-type]
        result.append(bool(j[i] < 13 and dif[i] > 0 and avg_high > 3.5 * avg_low))
    return result


def zx(rows: list[dict[str, Any]]) -> list[bool]:
    close = _series(rows, "close")
    open_ = _series(rows, "open")
    high = _series(rows, "high")
    low = _series(rows, "low")
    volume = _series(rows, "volume")
    size = len(rows)

    st_l = ema(ema(close, 10), 10)
    averages = [ma(close, window) for window in (14, 28, 57, 114)]
    lt_r: list[Number] = []
    for values in zip(*averages):
        lt_r.append(sum(values) / 4 if all(value is not None for value in values) else None)  # type: ignore[arg-type]
    c_days = barslast(cross(st_l, lt_r))
    lt_ref = ref(lt_r)
    lt_dir = [
        1
        if index + 1 <= 114
        or (
            lt_r[index] is not None
            and lt_ref[index] is not None
            and lt_r[index] >= lt_ref[index] * 0.9999
        )
        else -1
        for index in range(size)
    ]
    lt_dir_ref = ref(lt_dir)
    flips = [
        bool(previous is not None and current != previous)
        for current, previous in zip(lt_dir, lt_dir_ref)
    ]
    flip_count = count(flips, 30)

    low9, high9 = llv(low, 9), hhv(high, 9)
    rsv = [
        safe_div(
            None if close[i] is None or low9[i] is None else close[i] - low9[i],
            max((high9[i] or 0) - (low9[i] or 0), 0.01),
            100,
        )
        for i in range(size)
    ]
    k_v = sma(rsv, 3, 1)
    d_v = sma(k_v, 3, 1)
    j_v = [
        3 * k - 2 * d if k is not None and d is not None else None
        for k, d in zip(k_v, d_v)
    ]
    j_ref1, j_ref2 = ref(j_v), ref(j_v, 2)
    j_up = [
        bool(value is not None and previous is not None and value > previous)
        for value, previous in zip(j_v, j_ref1)
    ]
    j_turn_up = [
        bool(up and previous is not None and before is not None and previous <= before)
        for up, previous, before in zip(j_up, j_ref1, j_ref2)
    ]
    up_days = barslast(j_turn_up)

    close_ref = ref(close)
    pct = [
        safe_div(
            None if value is None or previous is None else value - previous,
            previous,
            100,
        )
        for value, previous in zip(close, close_ref)
    ]
    pct_ref = ref(pct)
    volume_ref = ref(volume)
    raw_b2: list[bool] = []
    for i in range(size):
        is_new = i + 1 <= 114
        honeymoon = 0 <= c_days[i] <= 30 and st_l[i] is not None and lt_r[i] is not None and st_l[i] > lt_r[i]
        breakaway = st_l[i] is not None and lt_r[i] is not None and st_l[i] > lt_r[i] * 1.03
        support = close[i] is not None and lt_r[i] is not None and close[i] >= lt_r[i] * 0.95
        tr_ok = is_new or honeymoon or breakaway or bool(
            st_l[i] is not None
            and lt_r[i] is not None
            and close[i] is not None
            and st_l[i] > lt_r[i]
            and close[i] > lt_r[i]
            and flip_count[i] <= 2
            and support
        )
        above_lt = is_new or bool(close[i] is not None and lt_r[i] is not None and close[i] > lt_r[i])
        up_shadow = (
            high[i] - max(close[i], open_[i])
            if high[i] is not None and close[i] is not None and open_[i] is not None
            else None
        )
        ef_body = (
            close[i] - min(open_[i], close_ref[i])
            if close[i] is not None and open_[i] is not None and close_ref[i] is not None
            else None
        )
        k_shape = bool(
            up_shadow is not None
            and ef_body is not None
            and close[i] is not None
            and close_ref[i] is not None
            and up_shadow <= ef_body
            and close[i] > close_ref[i]
        )
        raw_b2.append(bool(
            pct[i] is not None
            and pct_ref[i] is not None
            and volume[i] is not None
            and volume_ref[i] is not None
            and j_ref1[i] is not None
            and pct[i] >= 3.7
            and volume[i] > volume_ref[i]
            and k_shape
            and pct_ref[i] < 3.7
            and j_ref1[i] < 39
            and j_up[i]
            and tr_ok
            and above_lt
        ))

    b2_counts = dynamic_count(raw_b2, [value + 1 for value in up_days])
    b2 = [value and b2_counts[i] == 1 for i, value in enumerate(raw_b2)]
    b2_ref = ref(b2)
    b3: list[bool] = []
    b4: list[bool] = []
    for i in range(size):
        is_new = i + 1 <= 114
        honeymoon = 0 <= c_days[i] <= 30 and st_l[i] is not None and lt_r[i] is not None and st_l[i] > lt_r[i]
        breakaway = st_l[i] is not None and lt_r[i] is not None and st_l[i] > lt_r[i] * 1.03
        support = close[i] is not None and lt_r[i] is not None and close[i] >= lt_r[i] * 0.95
        tr_ok = is_new or honeymoon or breakaway or bool(
            st_l[i] is not None and lt_r[i] is not None and close[i] is not None
            and st_l[i] > lt_r[i] and close[i] > lt_r[i] and flip_count[i] <= 2 and support
        )
        above_lt = is_new or bool(close[i] is not None and lt_r[i] is not None and close[i] > lt_r[i])
        shake = pct[i] is not None and abs(pct[i]) < 5.05
        common = bool(b2_ref[i] and shake and j_up[i] and tr_ok and above_lt)
        b3.append(bool(common and volume[i] is not None and volume_ref[i] is not None and volume[i] <= volume_ref[i] * 0.9))
        b4.append(bool(common and volume[i] is not None and volume_ref[i] is not None and volume[i] > volume_ref[i] * 0.9 and volume[i] <= volume_ref[i] * 1.3))
    b3_ref, b4_ref = ref(b3), ref(b4)
    b5 = []
    for i in range(size):
        is_new = i + 1 <= 114
        honeymoon = 0 <= c_days[i] <= 30 and st_l[i] is not None and lt_r[i] is not None and st_l[i] > lt_r[i]
        breakaway = st_l[i] is not None and lt_r[i] is not None and st_l[i] > lt_r[i] * 1.03
        support = close[i] is not None and lt_r[i] is not None and close[i] >= lt_r[i] * 0.95
        tr_ok = is_new or honeymoon or breakaway or bool(
            st_l[i] is not None and lt_r[i] is not None and close[i] is not None
            and st_l[i] > lt_r[i] and close[i] > lt_r[i] and flip_count[i] <= 2 and support
        )
        above_lt = is_new or bool(close[i] is not None and lt_r[i] is not None and close[i] > lt_r[i])
        shake = pct[i] is not None and abs(pct[i]) < 5.05
        b5.append(bool(
            (b3_ref[i] or b4_ref[i]) and shake and volume[i] is not None
            and volume_ref[i] is not None and volume[i] <= volume_ref[i] * 0.9
            and j_up[i] and tr_ok and above_lt
        ))
    return [bool(a or b or c or d) for a, b, c, d in zip(b2, b3, b4, b5)]


FORMULAS: dict[str, Callable[[list[dict[str, Any]]], list[bool]]] = {
    "单针": single_needle,
    "异动": unusual_move,
    "ZX": zx,
}


def evaluate_latest(rows: list[dict[str, Any]]) -> dict[str, bool]:
    if not rows:
        return {name: False for name in FORMULAS}
    return {name: bool(calculator(rows)[-1]) for name, calculator in FORMULAS.items()}
