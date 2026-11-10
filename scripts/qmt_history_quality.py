"""Quality checks for QMT history; zero-volume bars alone are not invalid."""

from __future__ import annotations

import math
from typing import Any


def suspended_placeholder(row: dict[str, Any]) -> bool:
    """Reject explicitly suspended, flat, empty bars, never real flat trading."""
    try:
        prices = [float(row[key]) for key in ("open", "high", "low", "close")]
        return (
            int(row.get("suspendFlag") or 0) == 1
            and float(row["volume"]) == 0
            and float(row["amount"]) == 0
            and all(math.isfinite(value) and value >= 0 for value in prices)
            and max(prices) - min(prices) < 1e-8
        )
    except (KeyError, TypeError, ValueError, OverflowError):
        return False
