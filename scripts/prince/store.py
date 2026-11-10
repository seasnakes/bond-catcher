"""Local, append-versioned archive. Never treats historical imports as live signals."""
import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

CHANNEL = '可转债技术交流群三群'
AUTHOR = '转债小王子1'
SOURCES = {'yiliao': CHANNEL, 'mx': '转债小王子', 'news':'快讯八合一'}

def now():
    return datetime.now(timezone.utc).isoformat()

class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / 'messages.sqlite3'
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS messages (
                  id TEXT PRIMARY KEY, channel TEXT NOT NULL, author TEXT NOT NULL,
                  published_at TEXT, first_seen TEXT NOT NULL, mode TEXT NOT NULL,
                  body TEXT NOT NULL, images TEXT NOT NULL, digest TEXT NOT NULL,
                  updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS versions (
                  id TEXT NOT NULL, digest TEXT NOT NULL, observed_at TEXT NOT NULL,
                  body TEXT NOT NULL, images TEXT NOT NULL, PRIMARY KEY(id,digest));
                CREATE TABLE IF NOT EXISTS news_decisions (
                  id TEXT NOT NULL,digest TEXT NOT NULL,version TEXT NOT NULL,
                  action TEXT NOT NULL,reasons TEXT NOT NULL,at TEXT NOT NULL,
                  PRIMARY KEY(id,digest,version));
                CREATE TABLE IF NOT EXISTS events (
                  seq INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
            ''')

            if 'source' not in {r[1] for r in db.execute('PRAGMA table_info(messages)')}:
                db.execute("ALTER TABLE messages ADD COLUMN source TEXT NOT NULL DEFAULT 'yiliao'")

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA journal_mode=WAL')
        return db

    def ingest(self, payload):
        if not isinstance(payload, dict):
            raise ValueError('请求必须是对象')
        source = payload.get('source', 'yiliao')
        if source not in SOURCES or payload.get('channel') != SOURCES[source]:
            raise ValueError('目标群不匹配')
        rows = payload.get('messages')
        if not isinstance(rows, list) or len(rows) > 2000:
            raise ValueError('消息列表无效')
        mode = payload.get('mode', 'history')
        if mode not in ('history', 'observed'):
            raise ValueError('采集模式无效')
        at = now()
        normalized = []
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError('消息必须是对象')
            mid = row.get('id', '')
            if not isinstance(mid, str) or not re.fullmatch(r'tui-\d+-\d+-\d+' if source == 'yiliao' else (r'news-\d+' if source=='news' else r'mx-\d+'), mid):
                raise ValueError('消息标识无效')
            expected_author = '快讯八合一' if source=='news' else AUTHOR
            if row.get('author') != expected_author:
                continue
            body = row.get('body', '')
            images = row.get('images', [])
            if not isinstance(body, str) or len(body) > 100000 or not isinstance(images, list) or len(images) > 30:
                raise ValueError('消息内容无效')
            # Only archive URLs from the observed IM media host; never fetch arbitrary URLs.
            from urllib.parse import urlsplit
            for url in images:
                if not isinstance(url, str) or len(url)>10000:
                    raise ValueError('图片地址无效')
                p = urlsplit(url)
                host, prefix = ('1600112844-cn.rich.my-imcloud.com', '/download/') if source == 'yiliao' else ('wework.qpic.cn', '/wwpic')
                allowed_media = p.hostname == host and p.path.startswith(prefix)
                if source == 'mx' and p.hostname == 'pic.guhai888.cn' and p.path.startswith('/view.php/'):
                    allowed_media = True
                if source=='news':
                    allowed_media = p.hostname=='static.dingtalk.com' and p.path.startswith('/media/')
                if p.scheme != 'https' or not allowed_media or p.username or p.port not in (None,443):
                    raise ValueError('图片来源不匹配')
            timestamp = int(mid.split('-')[2]) if source == 'yiliao' else int(row.get('timestampMs', 0))/1000
            if not 946684800 <= timestamp <= 4102444800:
                raise ValueError('消息时间无效')
            published = datetime.fromtimestamp(timestamp, timezone.utc).isoformat()
            # UI ID timestamp is inferred, preserved separately from collection time.
            image_json = json.dumps(images, ensure_ascii=False)
            canonical = [body, [u.split('?')[0] for u in images]]
            digest = hashlib.sha256(json.dumps(canonical, ensure_ascii=False).encode()).hexdigest()
            normalized.append((mid, published, body, image_json, digest))
        counts = dict(inserted=0, duplicates=0, revised=0, accepted=len(normalized))
        with self.connect() as db:
            for mid, published, body, images, digest in normalized:
                if source=='news':
                    from news_filter import classify
                    decision=classify(body,json.loads(images))
                    db.execute('INSERT OR IGNORE INTO news_decisions VALUES(?,?,?,?,?,?)',(mid,digest,decision['version'],decision['action'],json.dumps(decision['reasons']),at))
                old = db.execute('SELECT digest FROM messages WHERE id=?', (mid,)).fetchone()
                if old and old['digest'] == digest:
                    db.execute('UPDATE messages SET images=? WHERE id=?',(images,mid))
                    counts['duplicates'] += 1
                    continue
                db.execute('INSERT OR IGNORE INTO versions VALUES (?,?,?,?,?)', (mid,digest,at,body,images))
                if old:
                    db.execute('UPDATE messages SET body=?,images=?,digest=?,updated_at=? WHERE id=?', (body,images,digest,at,mid))
                    counts['revised'] += 1
                else:
                    db.execute('INSERT INTO messages (id,channel,author,published_at,first_seen,mode,body,images,digest,updated_at,source) VALUES (?,?,?,?,?,?,?,?,?,?,?)', (mid,SOURCES[source],expected_author,published,at,mode,body,images,digest,at,source))
                    counts['inserted'] += 1
            db.execute('INSERT INTO events(at,kind,detail) VALUES (?,?,?)', (at,'ingest',json.dumps(counts)))
        return counts

    def snapshot(self, sources=('yiliao','mx')):
        with self.connect() as db:
            placeholders=','.join('?' for _ in sources)
            total = db.execute(f'SELECT COUNT(*) FROM messages WHERE source IN ({placeholders})',sources).fetchone()[0]
            rows = [dict(r) for r in db.execute(f'SELECT * FROM messages WHERE source IN ({placeholders}) ORDER BY published_at DESC,id DESC LIMIT 300',sources)]
            for row in rows:
                row['images'] = json.loads(row['images'])
                if row['source']=='news':
                    from news_filter import VERSION,format_news_body
                    row['display_body']=format_news_body(row['body'])
                    decision=db.execute('SELECT action,reasons,version FROM news_decisions WHERE id=? AND digest=? AND version=?',(row['id'],row['digest'],VERSION)).fetchone()
                    row['filter']=dict(decision) if decision else {'action':'review','reasons':'["unclassified"]'}
                    row['filter']['reasons']=json.loads(row['filter']['reasons'])
                row.pop('digest')
            news_rows=[row for row in rows if row['source']=='news']
            if news_rows and db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='delivery_outbox'").fetchone():
                ids=[row['id'] for row in news_rows]
                marks=','.join('?' for _ in ids)
                delivery={mid:[] for mid in ids}
                for part in db.execute(f'''SELECT source_id,kind,state,COUNT(*) n FROM delivery_outbox
                    WHERE source_id IN ({marks}) GROUP BY source_id,kind,state''',ids):
                    delivery[part['source_id']].append(dict(kind=part['kind'],state=part['state'],count=part['n']))
                for row in news_rows:row['delivery']=delivery[row['id']]
            latest_by_source = {r['source']:dict(r) for r in db.execute('SELECT source,MAX(published_at) AS published_at,MAX(first_seen) AS first_seen FROM messages GROUP BY source')}
            events = [dict(r) for r in db.execute('SELECT * FROM events ORDER BY seq DESC LIMIT 15')]
        return dict(total=total,messages=rows,events=events,latestBySource=latest_by_source,channel=CHANNEL,author=AUTHOR)

    def reclassify_news(self):
        """Record the current decision for archived messages without changing raw text or delivery state."""
        from news_filter import VERSION,classify
        at=now()
        with self.connect() as db:
            rows=db.execute('''SELECT m.id,m.digest,m.body,m.images FROM messages m
                LEFT JOIN news_decisions d ON d.id=m.id AND d.digest=m.digest AND d.version=?
                WHERE m.source='news' AND d.id IS NULL''',(VERSION,)).fetchall()
            for row in rows:
                decision=classify(row['body'],json.loads(row['images']))
                db.execute('INSERT OR IGNORE INTO news_decisions VALUES(?,?,?,?,?,?)',
                    (row['id'],row['digest'],VERSION,decision['action'],json.dumps(decision['reasons']),at))
        return len(rows)
