import sys
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import cb_ai_terms as terms

TEXT = """转债代码123283。可转换公司债券上市数量：60,752.98（万元）。
可转换公司债券上市时间：2026年09月09日。
可转换公司债券存续的起止日期：自发行之日起六年，即自2026年08月18日（T日）至2032年08月17日。
可转换公司债券转股的起止日期：发行结束之日起满六个月后的第一个交易日2027年02月24日起。
本次可转债信用等级为AA-。初始转股价格为35.59元/股。
到期赎回条款：按债券面值的110%赎回。有条件赎回条款：转股价格的130%。有条件回售条款：转股价格的70%。"""


class DatedTermsTests(unittest.TestCase):
    def setUp(self):
        terms._CACHE.clear()

    def loader(self, change=None, duplicate=False):
        self.pages = []
        def fetch(url):
            q = parse_qs(urlparse(url).query)
            if "/security/ann" in url:
                rows = [{"notice_date": "2026-09-11", "title": "调整转股价格", "art_code": "future"},
                        {"notice_date": "2026-09-07", "title": "向不特定对象发行可转换公司债券上市公告书", "art_code": "listing"}]
                if change:
                    rows.insert(1, {"notice_date": "2026-09-09", "title": "调整转股价格的公告", "art_code": "change"})
                return {"data": {"list": rows}}
            art, index = q["art_code"][0], int(q["page_index"][0])
            self.assertNotEqual(art, "future")
            self.pages.append((art, index))
            if art == "change":
                return {"data": {"page_size": 1, "notice_content": change}}
            return {"data": {"page_size": 9, "notice_content": TEXT if index == 9 else "重复正文" if duplicate else f"第{index}页其他内容"}}
        return fetch

    def test_full_listing_pages_and_future_filter(self):
        result = terms.dated_bond_terms("123283.SZ", "301459.SZ", "20260910", self.loader())
        self.assertEqual(len(self.pages), 9)
        self.assertEqual(result["facts"]["maturity_date"], "20320817")
        self.assertEqual(result["facts"]["conversion_start_date"], "20270224")
        self.assertEqual(result["facts"]["maturity_redemption_price"], 110)
        self.assertEqual(result["facts"]["rating"], "AA-")
        self.assertEqual(result["facts"]["issue_scale_billion"], 6.075298)
        self.assertNotIn("remaining_face_value_yuan", result["facts"])
        self.assertEqual(result["conversion_price_reference"]["price"], 35.59)
        self.assertEqual(result["conversion_price_reference"]["verified_through"], "20260910")

    def test_newer_dated_change_wins_but_unparsed_change_blocks_initial_price(self):
        for change, expected in [("转债代码123283。转股价调整为30元/股，自2026年9月10日起生效。", 30),
                                 ("转债代码123283。转股价调整为30元/股。", None)]:
            terms._CACHE.clear()
            result = terms.dated_bond_terms("123283.SZ", "301459.SZ", "20260910", self.loader(change))
            ref = result["conversion_price_reference"]
            if expected:
                self.assertEqual(ref["price"], expected)
                self.assertEqual(ref["effective_from"], "20260910")
            else:
                self.assertTrue(ref["verification_incomplete"])
                self.assertIsNone(ref["verified_through"])

    def test_repeated_pages_are_not_complete(self):
        result = terms.dated_bond_terms("123283.SZ", "301459.SZ", "20260910", self.loader(duplicate=True))
        self.assertFalse(result["facts"])
        self.assertTrue(result["errors"])


if __name__ == "__main__":
    unittest.main()
