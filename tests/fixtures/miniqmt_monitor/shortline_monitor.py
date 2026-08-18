"""Minimal monitor contract used by finance-board unit tests.

Production loads the real shortline monitor through MINIQMT_MONITOR_ROOT. Tests
only need the small API surface below and must not depend on another checkout.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any


CB_VOLUME_MULTIPLIER = 10.0


@dataclass
class MinuteBucket:
    minute_ms: int
    amount: float = 0.0
    open: float = 0.0
    close: float = 0.0
    high: float = 0.0
    low: float = math.inf


class BridgeClient:
    """Contract placeholder; individual tests replace this class with a fake."""

    def __init__(self, base_url: str, timeout: float = 10.0):
        self.base_url = base_url
        self.timeout = timeout

    def _unexpected(self, *_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("test BridgeClient must be replaced with a scenario fake")

    get = _unexpected
    post = _unexpected
    health = _unexpected
    convertible_bonds = _unexpected
    full_tick = _unexpected
    details = _unexpected
    minute_bars = _unexpected
    download_minute_bars = _unexpected


def _ema(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    alpha = 2.0 / (period + 1.0)
    output = [float(values[0])]
    for value in values[1:]:
        output.append(alpha * float(value) + (1.0 - alpha) * output[-1])
    return output


def _rolling_mean(values: list[float], period: int) -> list[float]:
    return [
        sum(values[max(0, index + 1 - period) : index + 1])
        / len(values[max(0, index + 1 - period) : index + 1])
        for index in range(len(values))
    ]


def compute_indicator_series(minutes: list[MinuteBucket]) -> dict[str, list[float]]:
    close = [float(item.close) for item in minutes]
    ema12 = _ema(close, 12)
    ema26 = _ema(close, 26)
    dif = [left - right for left, right in zip(ema12, ema26)]
    dea = _ema(dif, 9)
    macd = [2.0 * (left - right) for left, right in zip(dif, dea)]

    intraday_average: list[float] = []
    cumulative_amount = 0.0
    cumulative_units = 0.0
    for minute in minutes:
        amount = max(0.0, float(minute.amount))
        price = float(minute.close)
        cumulative_amount += amount
        if amount > 0 and price > 0:
            cumulative_units += amount / price
        intraday_average.append(
            cumulative_amount / cumulative_units if cumulative_units else price
        )

    purple_parts = [_ema(close, period) for period in (4, 7, 28, 56, 112)]
    purple = [
        sum(part[index] for part in purple_parts) / len(purple_parts)
        for index in range(len(close))
    ]
    zeros = [0.0] * len(close)
    nan_values = [math.nan] * len(close)
    return {
        "dif": dif,
        "dea": dea,
        "macd": macd,
        "purple": purple,
        "purple_ma27": _rolling_mean(purple, 27),
        "intraday_average": intraday_average,
        "sy02": zeros,
        "dark_buy": nan_values.copy(),
        "dark_sell": nan_values.copy(),
        "visible_funds": zeros.copy(),
    }


def compute_pullback_support_counts(
    _minutes: list[MinuteBucket],
    _series: dict[str, list[float]] | None = None,
) -> dict[str, int]:
    return {
        "purple_support_count": 0,
        "intraday_average_support_count": 0,
        "support_confirmation_count": 0,
        "purple_support_last_ms": 0,
        "intraday_average_support_last_ms": 0,
    }
