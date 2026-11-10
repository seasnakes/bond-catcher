import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/prince'))
from news_ai_preview import fingerprint, verify_analysis
from news_filter import DISCLAIMER


class NewsAIPreviewTests(unittest.TestCase):
    def test_exact_duplicate_normalizes_clock_and_disclaimer(self):
        self.assertEqual(
            fingerprint('16:52:19 新闻正文\n' + DISCLAIMER, []),
            fingerprint('新闻正文', []),
        )
        self.assertNotEqual(fingerprint('价格 12 元', []), fingerprint('价格 13 元', []))
        self.assertNotEqual(
            fingerprint('同一标题', ['https://static.dingtalk.com/media/one.png']),
            fingerprint('同一标题', ['https://static.dingtalk.com/media/two.png']),
        )

    def test_ai_result_requires_source_evidence_and_no_promotion(self):
        item = {'source_id': 'news-1', 'body': '机构预计 2027 年市场规模 12 亿元。', 'filter': 'filter'}
        result = dict(source_id='news-1', kind='research', headline='机构预计市场规模增长',
                      summary='机构预计 2027 年市场规模为 12 亿元。',
                      key_facts=[{'fact': '预计 2027 年规模 12 亿元', 'evidence': '2027 年市场规模 12 亿元'}],
                      mentioned_assets=[], source_caveat='机构预测，未独立核验', needs_review=True)
        self.assertEqual(verify_analysis(item, result), result)
        with self.assertRaisesRegex(ValueError, '原文没有的数字'):
            verify_analysis(item, dict(result, summary='机构预计 2028 年市场规模为 12 亿元。'))
        with self.assertRaisesRegex(ValueError, '证据片段'):
            verify_analysis(item, dict(result, key_facts=[{'fact': '增长', 'evidence': '原文不存在'}]))
        with self.assertRaisesRegex(ValueError, '评级措辞'):
            verify_analysis(item, dict(result, summary='目标价 12 元'))


if __name__ == '__main__':
    unittest.main()
