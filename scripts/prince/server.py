#!/usr/bin/env python3
import argparse
import json
import os
import threading
import time
import hashlib
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit,parse_qs
from store import Store
from notifier import Notifier
from news_filter import VERSION as NEWS_FILTER_VERSION

ALLOWED_ORIGINS = {'http://103.120.91.153:81', 'https://mx.2026.naaifu.cn', 'chrome-extension://igjllgjjlddmfeihbbcjinikfldkgalk'}

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA = Path.home() / 'Library/Application Support/finance-prince'

def serve(port=5188, directory=DEFAULT_DATA):
    store = Store(directory)
    store.reclassify_news()
    notifier = Notifier(store)
    news_notifier = Notifier(store,config_name='news-feishu.json',sources=('news',))
    def deliver(worker):
        while True:
            try:
                worker.tick()
            except Exception as exc:
                print('Notification worker:',type(exc).__name__,str(exc)[:160],flush=True)
            time.sleep(2)
    threading.Thread(target=deliver,args=(notifier,),daemon=True).start()
    threading.Thread(target=deliver,args=(news_notifier,),daemon=True).start()
    heartbeat = {}
    source_heartbeats = {}
    observers = {}
    def current_heartbeat(source):
        entries = [entry for (name, _), entry in observers.items() if name == source]
        if not entries:
            return source_heartbeats.get(source, {})
        fresh = [entry for entry in entries if time.time() - entry['received'] < 20]
        # A tab viewing another room must not mask a healthy target-room tab.
        selected = max(fresh or entries, key=lambda e: (e['status'] in ('observing_page','observing_api'), e['received']))
        return {key: value for key, value in selected.items() if key != 'received'}
    media = {}
    media_dir = Path(directory)/'media'
    media_dir.mkdir(exist_ok=True)
    def archive_media():
        while True:
            try:
                config=news_notifier.config()
                image_since=config.get('image_enabled_at',config['enabled_at']) if config.get('enabled') else None
                recent_since=datetime.fromtimestamp(time.time()-1800,timezone.utc).isoformat()
                with store.connect() as db:
                    image_rows = [dict(r) for r in db.execute('''SELECT images FROM messages
                        WHERE images!='[]' AND (source!='news' OR
                        (source='news' AND mode='observed' AND first_seen>=? AND published_at>=?))
                        ORDER BY CASE WHEN source='news' THEN 0 ELSE 1 END, published_at DESC''',
                        (image_since or '9999',recent_since))]
                for row in image_rows:
                    row['images'] = json.loads(row['images'])
                    for url in row['images']:
                        key = url.split('?')[0]
                        name = hashlib.sha256(key.encode()).hexdigest()+'.img'
                        dest = media_dir/name
                        if dest.exists():
                            media[key] = name
                            continue
                        class NoRedirect(urllib.request.HTTPRedirectHandler):
                            def redirect_request(self, *args, **kwargs):
                                return None
                        opener = urllib.request.build_opener(NoRedirect())
                        try:
                            with opener.open(url, timeout=10) as r:
                                if r.headers.get_content_type() not in ('image/png','image/jpeg','image/webp','image/gif'):
                                    continue
                                data = r.read(20_000_001)
                                if len(data)>20_000_000 or not data:
                                    continue
                                tmp=dest.with_suffix('.tmp')
                                tmp.write_bytes(data)
                                tmp.replace(dest)
                                media[key]=name
                        except Exception:
                            pass
            except Exception:
                pass
            time.sleep(15)
    threading.Thread(target=archive_media,daemon=True).start()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def headers_for(self, code, mime='application/json; charset=utf-8'):
            self.send_response(code)
            self.send_header('Content-Type', mime)
            self.send_header('Cache-Control', 'no-store')
            origin = self.headers.get('Origin', '')
            if origin in ALLOWED_ORIGINS:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Access-Control-Allow-Private-Network', 'true')
                self.send_header('Vary','Origin')
            self.end_headers()
        def do_OPTIONS(self):
            self.send_response(204)
            if self.headers.get('Origin') in ALLOWED_ORIGINS:
                self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
                self.send_header('Access-Control-Allow-Methods','POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers','Content-Type')
                self.send_header('Access-Control-Allow-Private-Network','true')
            self.end_headers()
        def do_GET(self):
            if self.headers.get('Host') not in (f'127.0.0.1:{port}',f'localhost:{port}'):
                self.headers_for(403); return
            path = urlsplit(self.path).path
            if path == '/api/known':
                source=parse_qs(urlsplit(self.path).query).get('source',[''])[0]
                if source not in ('mx','news'):
                    self.headers_for(400);return
                with store.connect() as db:
                    ids=[row['id'] for row in db.execute('SELECT id FROM messages WHERE source=? ORDER BY published_at DESC,id DESC LIMIT 1000',(source,))]
                self.headers_for(200)
                self.wfile.write(json.dumps({'ids':ids},ensure_ascii=False).encode())
                return
            if path == '/api/news':
                with store.connect() as db:
                    counts={r['action']:r['n'] for r in db.execute('SELECT d.action,COUNT(*) n FROM news_decisions d JOIN messages m ON d.id=m.id AND d.digest=m.digest WHERE d.version=? GROUP BY d.action',(NEWS_FILTER_VERSION,))}
                self.headers_for(200)
                self.wfile.write(json.dumps(dict(store.snapshot(('news',)),heartbeat=current_heartbeat('news'),media=media.copy(),notifications=news_notifier.status(),filterCounts=counts),ensure_ascii=False).encode())
                return
            if path == '/api/messages':
                self.headers_for(200)
                self.wfile.write(json.dumps(dict(store.snapshot(),heartbeat=current_heartbeat('yiliao'),sourceHeartbeats={source:current_heartbeat(source) for source in source_heartbeats},media=media.copy(),notifications=notifier.status()),ensure_ascii=False).encode())
                return
            if path.startswith('/media/'):
                import re
                name=path.removeprefix('/media/')
                if not re.fullmatch(r'[a-f0-9]{64}\.img',name) or not (media_dir/name).exists():
                    self.headers_for(404); return
                data=(media_dir/name).read_bytes()
                mime='image/png' if data.startswith(b'\x89PNG') else 'image/jpeg' if data.startswith(b'\xff\xd8') else 'image/gif' if data.startswith(b'GIF') else 'image/webp'
                self.headers_for(200,mime); self.wfile.write(data); return
            files = {'/':'index.html','/app.js':'app.js','/collector.js':'collector.js','/news-collector.js':'news-collector.js','/news':'news.html','/news-app.js':'news-app.js'}
            if path not in files:
                self.headers_for(404); return
            mime = 'text/html; charset=utf-8' if path in ('/','/news') else 'application/javascript; charset=utf-8'
            self.headers_for(200,mime)
            self.wfile.write((ROOT/'web/prince'/files[path]).read_bytes())
        def do_POST(self):
            if self.headers.get('Host') not in (f'127.0.0.1:{port}',f'localhost:{port}'):
                self.headers_for(403); return
            if self.path not in ('/api/ingest','/api/heartbeat') or self.headers.get('Origin') not in (None, *ALLOWED_ORIGINS):
                self.headers_for(403); return
            try:
                size = int(self.headers.get('Content-Length','0'))
                if size < 1 or size > 4000000:
                    raise ValueError('请求大小无效')
                payload=json.loads(self.rfile.read(size))
                if not isinstance(payload,dict):
                    raise ValueError('请求必须为对象')
                if self.path == '/api/heartbeat':
                    from store import now
                    status=payload.get('status')
                    if status not in ('observing_page','observing_api','wrong_channel','missing_messages','captcha_blocked',
                                      'auth_required','missing_room','source_error','gap_truncated'):
                        raise ValueError('状态无效')
                    source = payload.get('source', 'yiliao')
                    if source not in ('yiliao','mx','news'):
                        raise ValueError('来源无效')
                    entry=dict(at=now(),status=status,visibleCount=payload.get('visibleCount',0),
                               transport=payload.get('transport','temporary'))
                    if payload.get('transport') == 'mx_api':
                        entry['latestMessageMs'] = payload.get('latestMessageMs',0)
                        entry['newestId'] = payload.get('newestId',0)
                        entry['error'] = payload.get('error')
                    source_heartbeats[source]=entry
                    observer_id=payload.get('startedAt')
                    if not isinstance(observer_id,str) or len(observer_id)>80:
                        raise ValueError('观察器标识无效')
                    observers[(source,observer_id)]=dict(entry,received=time.time())
                    if len(observers)>200:
                        cutoff=time.time()-120
                        for key in list(observers):
                            if observers[key]['received'] < cutoff:del observers[key]
                    if source == 'yiliao': heartbeat.update(entry)
                    result={'ok':True}
                else:
                    result = store.ingest(payload)
                self.headers_for(200)
                self.wfile.write(json.dumps(result).encode())
            except (ValueError,TypeError,KeyError,OverflowError) as exc:
                self.headers_for(400)
                self.wfile.write(json.dumps({'error':str(exc)},ensure_ascii=False).encode())
    print(f'Prince archive: http://127.0.0.1:{port}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',port),Handler).serve_forever()

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=5188)
    parser.add_argument('--data',type=Path,default=DEFAULT_DATA)
    args=parser.parse_args()
    serve(args.port,args.data)
