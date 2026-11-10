#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Offline preview of news deduplication and optional Codex extraction; never sends."""
import argparse
import hashlib
import json
import re
import sqlite3
import subprocess
import sys
import tempfile
import unicodedata
from datetime import datetime, timezone, timedelta
from pathlib import Path

from news_filter import classify, format_news_body

ROOT = Path(__file__).resolve().parent
DEFAULT_DB = Path.home() / 'Library/Application Support/finance-prince/messages.sqlite3'
SCHEMA = ROOT / 'news_ai_schema.json'


def canonical_text(body):
    text = format_news_body(body)
    text = re.sub(r'^\s*\d{1,2}:\d{2}(?::\d{2})?\s*', '', text)
    return ' '.join(unicodedata.normalize('NFKC', text).split())


def fingerprint(body, images):
    value = [canonical_text(body), [url.split('?')[0] for url in images]]
    return hashlib.sha256(json.dumps(value, ensure_ascii=False).encode()).hexdigest()


def preview_rows(db_path, date, limit=20):
    start = datetime.fromisoformat(date).replace(tzinfo=timezone(timedelta(hours=8))).astimezone(timezone.utc)
    end = start + timedelta(days=1)
    db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    rows = db.execute('''SELECT id,published_at,body,images,mode FROM messages
        WHERE source='news' AND published_at>=? AND published_at<?
        ORDER BY published_at,id''', (start.isoformat(), end.isoformat())).fetchall()
    first_by_fingerprint = {}
    preview = []
    for row in rows:
        images = json.loads(row['images'])
        cleaned = format_news_body(row['body'])
        key = fingerprint(row['body'], images)
        duplicate_of = first_by_fingerprint.get(key)
        if cleaned or images:
            first_by_fingerprint.setdefault(key, row['id'])
        preview.append({
            'source_id': row['id'], 'published_at': row['published_at'],
            'mode': row['mode'], 'filter': classify(row['body'], images)['action'],
            'characters': len(cleaned), 'image_count': len(images),
            'duplicate_of': duplicate_of, 'body': cleaned,
        })
    return {'date': date, 'total': len(preview), 'exact_duplicate_count': sum(bool(row['duplicate_of']) for row in preview),
            'items': preview[-limit:]}


def verify_analysis(item, result):
    text = item['body']
    if result.get('source_id') != item['source_id']:
        raise ValueError('AI 返回的消息 ID 不匹配')
    if len(result.get('headline', '')) > 50 or len(result.get('summary', '')) > 220 or len(result.get('key_facts', [])) > 5:
        raise ValueError('AI 摘要超过长度限制')
    if len(result.get('mentioned_assets', [])) > 5:
        raise ValueError('AI 提取的标的过多，未完成精简')
    if item['filter']!='allow' and not result.get('needs_review'):
        raise ValueError('原规则未通过的消息必须人工核对')
    if not result.get('key_facts'):
        raise ValueError('AI 没有提供逐项原文证据')
    for fact in result['key_facts']:
        if not fact['evidence'] or fact['evidence'] not in text:
            raise ValueError('AI 证据片段无法在原文定位')
    for asset in result['mentioned_assets']:
        if asset not in text:
            raise ValueError('AI 标的名称无法在原文定位')
    source_numbers = set(re.findall(r'\d+(?:\.\d+)?', text))
    generated = ' '.join([result['headline'], result['summary']] + [fact['fact'] for fact in result['key_facts']])
    if set(re.findall(r'\d+(?:\.\d+)?', generated)) - source_numbers:
        raise ValueError('AI 输出含原文没有的数字')
    if result['kind'] in ('research', 'promotion') and re.search(r'目标价|买入评级|跑赢大盘|强推|荐股|推荐|增持评级', generated):
        raise ValueError('AI 精简结果仍包含研报推荐或评级措辞')
    return result


def analyze_with_codex(item, model='gpt-5.6-terra', timeout=180):
    if not item['body'] or item['duplicate_of']:
        raise ValueError('只分析有正文且非精确重复的消息')
    prompt = f'''你是只读的中文金融快讯编辑。只分析下方一条原文，不查询外部资料，不运行工具，不做投资建议。\n\n消息 ID：{item['source_id']}\n原文：\n{item['body']}\n\n要求：\n1. 判断 news/research/commentary/promotion；券商研报、预测与推荐必须归于 research 或 promotion，并标记 needs_review=true。\n2. headline 最多 28 个汉字；summary 最多 160 个汉字。只复述原文，不使用比原文更强的确定性或时间措辞；原文说“仍需三至五年”，不得写“临近商业化”。明确区分事实与作者/机构观点。\n3. 提取最多 5 条重要信息，每条 evidence 必须是原文中连续且完全一致的短片段。不要编造数字、标的、因果或涨跌结果。\n4. mentioned_assets 最多 5 个，只列要点直接涉及且原文明确出现的证券/公司/指数名称；来源券商、作者和泛泛罗列的公司不算标的。没有则空数组。\n5. 研报正文中的评级、目标价、强推和营销口号不要写进 headline、summary 或 key_facts；仅可在 source_caveat 说明原文含推广/评级。提取可核查的业务信息、预测假设和风险。\n6. source_caveat 说明来源性质和最关键的数据缺口；不出现“建议买入/卖出”等交易指令。\n7. 仅返回符合给定 JSON Schema 的对象。'''
    with tempfile.TemporaryDirectory(prefix='prince-news-ai-') as directory:
        command = ['codex', 'exec', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only',
                   '--skip-git-repo-check', '-C', directory, '-m', model, '--output-schema', str(SCHEMA), '-']
        run = subprocess.run(command, input=prompt, capture_output=True, text=True, timeout=timeout)
        if run.returncode:
            raise RuntimeError('Codex CLI 失败：' + run.stderr[-500:])
        return verify_analysis(item, json.loads(run.stdout))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=DEFAULT_DB)
    parser.add_argument('--date', default=datetime.now(timezone(timedelta(hours=8))).date().isoformat())
    parser.add_argument('--limit', type=int, default=20)
    parser.add_argument('--codex-id', help='仅对这条已存档消息运行一次 Codex 预览')
    parser.add_argument('--model', default='gpt-5.6-terra')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if not 1 <= args.limit <= 1000:parser.error('--limit 必须在 1 到 1000 之间')
    report = preview_rows(args.db, args.date, args.limit)
    if args.codex_id:
        item = next((row for row in report['items'] if row['source_id'] == args.codex_id), None)
        if item is None:parser.error('指定消息不在当前日期和最近 limit 范围内')
        report['analysis'] = analyze_with_codex(item, args.model)
    content = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content)
        print(args.output)
    else:
        print(content)


if __name__ == '__main__':main()
