"""Extract explicit dated facts from announcement text; never infer trading deadlines."""
from __future__ import annotations

import hashlib
import re

DATE = r"20\d{2}年\d{1,2}月\d{1,2}日"


def compact_chinese_date(value):
    match = re.search(r"(20\d{2})年(\d{1,2})月(\d{1,2})日", value or "")
    return f"{int(match[1]):04d}{int(match[2]):02d}{int(match[3]):02d}" if match else ""


def announcement_facts(content, as_of=""):
    text = re.sub(r"\s+", "", str(content or ""))
    facts = {}
    labels = {
        "redeem_date": r"(?:可转债)?赎回日",
        "stop_trading_date": r"(?:可转债)?停止交易日",
        "last_trade_date": r"(?:可转债)?最后交易日",
        "stop_conversion_date": r"(?:可转债)?停止转股日",
        "record_date": r"(?:可转债)?赎回登记日",
        "funds_arrival_date": r"(?:可转债)?赎回资金到账日",
        "condition_met_date": r"(?:可转债)?赎回条件满足日",
    }
    for field, label in labels.items():
        match = re.search(label + r"[：:]?(?:为)?(" + DATE + ")", text)
        if match:
            facts[field] = compact_chinese_date(match[1])
    match = re.search(r"(?:可转债)?赎回价格[：:]?(?:为)?(\d+(?:\.\d+)?)元[/／]张", text)
    if match:
        facts["redeem_price"] = float(match[1])
    # Pair each explicitly adjusted price with its nearby effective date.
    changes = []
    for match in re.finditer(r"(?:调整|修正|下修)(?:为|至)(\d+(?:\.\d+)?)元[/／]股", text):
        nearby = text[match.end():match.end() + 180]
        effective = re.search(r"(?:自|于)(" + DATE + r")(?:起)?(?:开始)?生效", nearby)
        if effective:
            date = compact_chinese_date(effective[1])
            if not as_of or date <= as_of:
                changes.append({"price": float(match[1]), "effective_from": date})
    if changes:
        latest = sorted(changes, key=lambda item: item["effective_from"])[-1]
        facts["conversion_price"] = latest["price"]
        facts["conversion_effective_from"] = latest["effective_from"]
    facts["content_sha256"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return facts
