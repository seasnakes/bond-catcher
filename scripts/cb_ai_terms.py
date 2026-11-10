"""Dated terms for AI research, extracted from issuer announcements, never today's quote date."""
from __future__ import annotations

import hashlib
import re
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

from cb_announcement import DATE, announcement_facts, compact_chinese_date

_CACHE = {}


def date_key(value):
    digits = re.sub(r"\D", "", str(value or ""))
    return digits[:8] if len(digits) >= 8 else ""


def listing_facts(content):
    """Only explicit facts; issue amount is deliberately not remaining balance."""
    text = re.sub(r"\s+", "", str(content or ""))
    facts = {}
    match = re.search(r"初始转股价(?:格)?(?:为|[：:])([\d.]+)元[/／]股", text)
    if match:
        facts["conversion_price"] = float(match[1])
    match = re.search(r"可转换公司债券上市时间[：:](" + DATE + ")", text)
    if match:
        facts["listing_date"] = compact_chinese_date(match[1])
    match = re.search(r"存续的起止日期[：:][^。]{0,100}?自(" + DATE + r")[^。]{0,25}?至(" + DATE + ")", text)
    if match:
        facts["issue_date"] = compact_chinese_date(match[1])
        facts["maturity_date"] = compact_chinese_date(match[2])
    match = re.search(r"转股的起止日期[：:][^。]{0,140}?第一个交易日[（(]?(" + DATE + ")", text)
    if match:
        facts["conversion_start_date"] = compact_chinese_date(match[1])
    match = re.search(r"到期赎回条款[^。]{0,120}?(?:债券|票面)面值的([\d.]+)%", text)
    if match:
        facts["maturity_redemption_price"] = float(match[1])
    match = re.search(r"本次可(?:转换公司债券|转债)信用等级为([ABC]+[+\-]?)", text)
    if match:
        facts["rating"] = match[1]
        facts["rating_kind"] = "发行时债项评级"
    match = re.search(r"可转换公司债券上市数量[：:]([\d,.]+)[（(]?万元", text)
    if match:
        facts["issue_scale_billion"] = float(match[1].replace(",", "")) / 10000
    for field, pattern in [
        ("redeem_trigger_ratio_pct", r"有条件赎回条款[^。]{0,350}?转股价格的([\d.]+)%"),
        ("put_trigger_ratio_pct", r"有条件回售条款[^。]{0,200}?转股价格的([\d.]+)%"),
    ]:
        match = re.search(pattern, text)
        if match:
            facts[field] = float(match[1])
    return facts


def _url(base, params):
    return base + "?" + urllib.parse.urlencode(params)


def read_notice(notice, stock, loader):
    art = str(notice.get("art_code") or "")
    def page(index):
        url = _url("https://np-cnotice-stock.eastmoney.com/api/content/ann", {
            "art_code": art, "client_source": "web", "page_index": str(index),
        })
        return loader(url).get("data") or {}
    first = page(1)
    count = max(1, int(first.get("page_size") or 1))
    parts = [str(first.get("notice_content") or "")]
    # A listing announcement commonly spans nine text pages; the old five-page
    # redemption reader cannot verify its terms. Bound both work and completeness.
    with ThreadPoolExecutor(max_workers=3) as pool:
        for payload in pool.map(page, range(2, min(count, 15) + 1)):
            part = str(payload.get("notice_content") or "")
            if part and part not in parts:
                parts.append(part)
    content = re.sub(r"\s+", "", "".join(parts))
    return {
        "title": notice.get("title"), "notice_date": date_key(notice.get("notice_date")),
        "url": first.get("attach_url") or f"https://data.eastmoney.com/notices/detail/{stock}/{art}.html",
        "article_code": art, "content_complete": len(parts) == count and bool(content),
        "content_pages": len(parts), "total_pages": count,
        "content_sha256": hashlib.sha256(content.encode()).hexdigest(),
        "text": content,
    }


def dated_bond_terms(code, stock_code, as_of, loader):
    """Read listing/price-change notices published by as_of, with a bounded history scan."""
    key = (code, stock_code, as_of)
    cached = _CACHE.get(key)
    if cached and time.monotonic() - cached[0] < (30 if cached[1].get("errors") else 3600):
        return cached[1]
    result = {"source": "上市公司公告正文（东方财富公告接口）", "as_of": None,
              "announcements": [], "facts": {}, "errors": []}
    try:
        stock = stock_code.split(".")[0]
        notices = []
        for index in range(1, 4):
            payload = loader(_url("https://np-anotice-stock.eastmoney.com/api/security/ann", {
                "sr": "-1", "page_size": "100", "page_index": str(index),
                "ann_type": "A", "client_source": "web", "stock_list": stock,
            }))
            rows = list((payload.get("data") or {}).get("list") or [])
            notices.extend(n for n in rows if date_key(n.get("notice_date")) and date_key(n.get("notice_date")) <= as_of)
            if any("可转换公司债券上市公告书" in str(n.get("title")) for n in notices) or len(rows) < 100:
                break
        notices.sort(key=lambda n: (date_key(n.get("notice_date")), str(n.get("art_code"))), reverse=True)
        listing = next((n for n in notices if "可转换公司债券上市公告书" in str(n.get("title"))), None)
        base_date = date_key(listing.get("notice_date")) if listing else ""
        changes = [n for n in notices if date_key(n.get("notice_date")) >= base_date
                   and re.search(r"(?:调整|修正).*转股价|转股价.*(?:调整|修正)", str(n.get("title")))
                   and not re.search(r"不(?:向下)?修正|不调整|预计|可能|提议|提案", str(n.get("title")))]
        chosen = ([listing] if listing else []) + list(reversed(changes[:5]))
        verified = bool(listing) and len(changes) <= 5
        unresolved = len(changes) > 5
        conversion = {}
        for notice in chosen:
            record = read_notice(notice, stock, loader)
            content = record.pop("text")
            if code.split(".")[0] not in content or not record["content_complete"]:
                verified = False
                unresolved = True
                result["errors"].append(f"公告正文未完整核验或债券代码不匹配：{record['title']}")
                continue
            facts = listing_facts(content) if notice is listing else announcement_facts(content, as_of)
            record["facts"] = facts
            result["announcements"].append(record)
            if notice is listing:
                result["facts"].update(facts)
                result["as_of"] = record["notice_date"]
                effective = facts.get("issue_date")
            else:
                effective = facts.get("conversion_effective_from")
            if facts.get("conversion_price") and effective and effective <= as_of:
                conversion = {"price": facts["conversion_price"], "as_of": record["notice_date"],
                              "effective_from": effective, "url": record["url"], "verified_by_announcement": True,
                              "source": result["source"]}
            else:
                # An unparsed change must prevent the initial price being treated
                # as current, even if a listing notice was read successfully.
                verified = False
                unresolved = True
        if conversion:
            conversion["verified_through"] = as_of if verified else None
            conversion["supersession_checked"] = verified
            conversion["verification_incomplete"] = unresolved
            result["conversion_price_reference"] = conversion
        if not chosen:
            result["errors"].append("本次公告检索范围未找到可核验的上市或转股价变更公告")
    except Exception as error:
        result["errors"].append(f"条款公告补充失败：{type(error).__name__}")
    _CACHE[key] = (time.monotonic(), result)
    return result
