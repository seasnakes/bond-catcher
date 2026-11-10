"""Durable Feishu outbox. Only newly observed messages after explicit activation qualify."""
import hashlib
import json
import os
import subprocess
import time
import uuid
import unicodedata
from PIL import Image, ImageOps
from datetime import datetime
from pathlib import Path

CLI = '/opt/homebrew/bin/lark-cli'

def stamp(value):
    return datetime.fromisoformat(value).timestamp()

def has_visible_content(value):
    """Ignore whitespace, format controls and literal escaped line breaks."""
    value=value.replace('\\n','').replace('\\r','')
    return any(not char.isspace() and unicodedata.category(char)[0] not in ('C','Z') for char in value)

def message_id(data):
    if isinstance(data,dict):
        if isinstance(data.get('message_id'),str): return data['message_id']
        for value in data.values():
            result=message_id(value)
            if result:return result
    elif isinstance(data,list):
        for value in data:
            result=message_id(value)
            if result:return result
    return None

class Notifier:
    def __init__(self,store,send=None,config_name='feishu.json',sources=('yiliao','mx')):
        self.store=store
        self.config_path=store.directory/config_name
        self.sources=sources
        self.send=send or self.send_cli
        self._image_signatures={}
        self._media_errors={}
        self._waiting_media=set()
        with store.connect() as db:
            db.executescript('''
              CREATE TABLE IF NOT EXISTS delivery_content (
                key TEXT PRIMARY KEY, destination TEXT NOT NULL, kind TEXT NOT NULL,
                signature TEXT NOT NULL, published REAL NOT NULL, source_id TEXT NOT NULL,
                source TEXT NOT NULL);
              CREATE INDEX IF NOT EXISTS delivery_content_match ON delivery_content(destination,kind,signature,published);
              CREATE TABLE IF NOT EXISTS delivery_part (
                destination TEXT NOT NULL, source_id TEXT NOT NULL, digest TEXT NOT NULL,
                part INTEGER NOT NULL, canonical_key TEXT NOT NULL, duplicate INTEGER NOT NULL,
                PRIMARY KEY(destination,source_id,digest,part));
              CREATE TABLE IF NOT EXISTS delivery_scan (
                destination TEXT NOT NULL, message_id TEXT NOT NULL, digest TEXT NOT NULL,
                PRIMARY KEY(destination,message_id,digest));
              CREATE TABLE IF NOT EXISTS delivery_outbox (
                key TEXT PRIMARY KEY, destination TEXT NOT NULL, source_id TEXT NOT NULL,
                profile TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
                state TEXT NOT NULL DEFAULT 'pending', created REAL NOT NULL,
                attempted REAL, attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt REAL NOT NULL DEFAULT 0, receipt TEXT, error TEXT);
            ''')

    def config(self):
        if not self.config_path.exists():return {}
        config=json.loads(self.config_path.read_text())
        if config.get('enabled'):
            if not str(config.get('chat_id','')).startswith('oc_') or not config.get('profile'):
                raise ValueError('飞书配置无效')
            stamp(config['enabled_at'])
            if config.get('image_enabled_at'):stamp(config['image_enabled_at'])
        return config

    def signature(self,kind,payload):
        if kind == 'text':
            value=' '.join(unicodedata.normalize('NFC',payload).split())
            return hashlib.sha256(value.encode()).hexdigest()
        path=self.store.directory/'media'/payload
        if not path.exists():return None
        stat=path.stat(); cache_key=(payload,stat.st_mtime_ns,stat.st_size)
        if cache_key not in self._image_signatures:
            # Exact decoded pixels ignore URL, container and metadata. Do not merge
            # merely similar charts: a tiny changed number can be a different signal.
            try:
                with Image.open(path) as image:
                    if getattr(image,'n_frames',1)>1:
                        signature=hashlib.sha256(path.read_bytes()).hexdigest()
                    else:
                        image=ImageOps.exif_transpose(image).convert('RGBA')
                        signature=hashlib.sha256(str(image.size).encode()+image.tobytes()).hexdigest()
            except (OSError,ValueError,Image.DecompressionBombError) as exc:
                self._media_errors[payload]=str(exc)[:160]
                return None
            self._media_errors.pop(payload,None)
            self._image_signatures[cache_key]=signature
        return self._image_signatures[cache_key]

    def enqueue(self):
        config=self.config()
        if not config.get('enabled'):return
        since=config['enabled_at'];dest=config['chat_id'];at=time.time()
        mx_since=config.get('mx_enabled_at')
        self._waiting_media=set()
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            # Seed existing sent/pending receipts before opening MX; do not resend
            # messages already delivered by the original-source-only implementation.
            existing=db.execute("""SELECT o.*,m.published_at,m.source FROM delivery_outbox o
                JOIN messages m ON m.id=o.source_id LEFT JOIN delivery_content c ON c.key=o.key
                WHERE c.key IS NULL AND o.destination=?""",(dest,)).fetchall()
            for old in existing:
                signature=self.signature(old['kind'],old['payload'])
                if signature:
                    db.execute('INSERT OR IGNORE INTO delivery_content VALUES(?,?,?,?,?,?,?)',
                        (old['key'],dest,old['kind'],signature,stamp(old['published_at']),old['source_id'],old['source']))
            rows=db.execute("""SELECT * FROM messages WHERE mode=? AND first_seen>=? AND published_at>=?
                ORDER BY first_seen,id""",('observed',since,since)).fetchall()
            for row in rows:
                if row['source'] not in self.sources:continue
                if row['source']=='news':
                    from news_filter import classify,split_forward_body
                    images=json.loads(row['images'])
                    if classify(row['body'],images)['action']!='allow':continue
                    # A new media policy must not turn recently archived, previously
                    # held image posts into a bulk backfill on the first restart.
                    image_since=config.get('image_enabled_at',config['enabled_at'])
                    if images and stamp(row['first_seen'])<stamp(image_since):continue
                if row['source']=='mx' and (not mx_since or stamp(row['published_at'])<stamp(mx_since)):continue
                published=stamp(row['published_at'])
                if at-published>1800 or published>at+30:continue
                if db.execute('SELECT 1 FROM delivery_scan WHERE destination=? AND message_id=? AND digest=?',(dest,row['id'],row['digest'])).fetchone():continue
                body=row['body']
                if row['source']=='news':
                    parts=[('text',part) for part in split_forward_body(body)]
                else:
                    parts=[('text',part) for part in (body[i:i+2500] for i in range(0,len(body),2500)) if has_visible_content(part)]
                for url in json.loads(row['images']):
                    name=hashlib.sha256(url.split('?')[0].encode()).hexdigest()+'.img'
                    parts.append(('image',name))
                complete=True
                for index,(kind,payload) in enumerate(parts):
                    if db.execute('SELECT 1 FROM delivery_part WHERE destination=? AND source_id=? AND digest=? AND part=?',
                                  (dest,row['id'],row['digest'],index)).fetchone():continue
                    signature=self.signature(kind,payload)
                    if signature is None:
                        self._waiting_media.add(row['id'])
                        complete=False;continue
                    duplicate=db.execute("""SELECT key FROM delivery_content
                        WHERE destination=? AND kind=? AND signature=? AND published BETWEEN ? AND ?
                        AND source_id<>? AND (source<>? OR source IN ('mx','news'))
                        ORDER BY published LIMIT 1""",(dest,kind,signature,published-120,published+120,row['id'],row['source'])).fetchone()
                    if duplicate:
                        key=duplicate['key']
                    else:
                        key=str(uuid.uuid5(uuid.NAMESPACE_URL,':'.join([dest,row['id'],row['digest'],str(index)])))
                        db.execute('INSERT OR IGNORE INTO delivery_outbox(key,destination,source_id,profile,kind,payload,created) VALUES(?,?,?,?,?,?,?)',
                            (key,dest,row['id'],config['profile'],kind,payload,at))
                        db.execute('INSERT OR IGNORE INTO delivery_content VALUES(?,?,?,?,?,?,?)',
                            (key,dest,kind,signature,published,row['id'],row['source']))
                    db.execute('INSERT INTO delivery_part VALUES(?,?,?,?,?,?)',(dest,row['id'],row['digest'],index,key,int(bool(duplicate))))
                if complete:
                    db.execute('INSERT INTO delivery_scan VALUES(?,?,?)',(dest,row['id'],row['digest']))

    def send_cli(self,row):
        argv=[CLI,'--profile',row['profile'],'im','+messages-send','--as','bot','--chat-id',row['destination'],'--idempotency-key',row['key']]
        cwd=str(self.store.directory)
        if row['kind']=='text':argv+=['--text',row['payload']]
        else:
            # CLI media needs a recognized file suffix; content is copied locally only.
            data=(self.store.directory/'media'/row['payload']).read_bytes()
            ext='.png' if data.startswith(b'\x89PNG') else '.jpg' if data.startswith(b'\xff\xd8') else '.gif' if data.startswith(b'GIF') else '.webp'
            upload=self.store.directory/'upload';upload.mkdir(exist_ok=True)
            name=Path(row['payload']).stem+ext
            (upload/name).write_bytes(data)
            argv+=['--image','upload/'+name]
        env=os.environ.copy()
        env.update(LARKSUITE_CLI_NO_UPDATE_NOTIFIER='1',LARKSUITE_CLI_NO_SKILLS_NOTIFIER='1',PATH='/opt/homebrew/bin:/usr/bin:/bin')
        result=subprocess.run(argv,cwd=cwd,env=env,capture_output=True,text=True,timeout=45)
        if result.returncode:
            if result.returncode==10:raise PermissionError('CLI 要求显式确认，未自动绕过')
            try:
                detail=json.loads(result.stderr).get('error',{})
                msg=str(detail.get('message','飞书调用失败'))[:250]
            except ValueError:msg='飞书调用失败，退出码 '+str(result.returncode)
            raise RuntimeError(msg)
        payload=json.loads(result.stdout)
        receipt=message_id(payload.get('data'))
        if payload.get('ok') is not True or not receipt:raise RuntimeError('发送结果缺少成功回执')
        return receipt

    def tick(self):
        config=self.config()
        if not config.get('enabled'):return
        self.enqueue()
        at=time.time()
        with self.store.connect() as db:
            rows=[dict(r) for r in db.execute("SELECT * FROM delivery_outbox WHERE state='pending' AND next_attempt<=? AND destination=? ORDER BY created,rowid LIMIT 20",(at,config['chat_id']))]
        for row in rows:
            if row['kind']=='text' and not has_visible_content(row['payload']):
                with self.store.connect() as db:db.execute("UPDATE delivery_outbox SET state='filtered',error='空白文本，取消发送' WHERE key=?",(row['key'],))
                continue
            if row['source_id'].startswith('news-'):
                from news_filter import classify,split_forward_body
                with self.store.connect() as db:
                    current=db.execute('SELECT body,images FROM messages WHERE id=?',(row['source_id'],)).fetchone()
                    if not current or classify(current['body'],json.loads(current['images']))['action']!='allow':
                        db.execute("UPDATE delivery_outbox SET state='filtered',error='消息更新后未通过过滤，取消未发送项' WHERE key=?",(row['key'],))
                        continue
                    if row['kind']=='text' and not split_forward_body(row['payload']):
                        db.execute("UPDATE delivery_outbox SET state='filtered',error='图片占位文字，取消发送' WHERE key=?",(row['key'],))
                        continue
            # API idempotency expires after one hour; stop ambiguous retries well before that.
            if (row['attempted'] and at-row['attempted']>2700) or at-row['created']>3600:
                with self.store.connect() as db:db.execute("UPDATE delivery_outbox SET state='needs_review',error='重试窗口已过，需人工核对，未再次发送' WHERE key=?",(row['key'],))
                continue
            if row['kind']=='image' and not (self.store.directory/'media'/row['payload']).exists():continue
            with self.store.connect() as db:
                db.execute('UPDATE delivery_outbox SET attempted=COALESCE(attempted,?),attempts=attempts+1 WHERE key=?',(at,row['key']))
            try:
                receipt=self.send(row)
                with self.store.connect() as db:db.execute("UPDATE delivery_outbox SET state='sent',receipt=?,error=NULL WHERE key=?",(receipt,row['key']))
            except PermissionError as exc:
                with self.store.connect() as db:db.execute("UPDATE delivery_outbox SET state='needs_review',error=? WHERE key=?",(str(exc),row['key']))
            except Exception as exc:
                with self.store.connect() as db:db.execute('UPDATE delivery_outbox SET error=?,next_attempt=? WHERE key=?',(str(exc)[:250],time.time()+min(300,5*2**min(row['attempts'],6)),row['key']))

    def status(self):
        config=self.config()
        with self.store.connect() as db:
            counts={r['state']:r['n'] for r in db.execute('SELECT state,COUNT(*) n FROM delivery_outbox WHERE destination=? GROUP BY state',(config.get('chat_id',''),))}
            last=db.execute('SELECT state,receipt,error,source_id FROM delivery_outbox WHERE destination=? ORDER BY created DESC,rowid DESC LIMIT 1',(config.get('chat_id',''),)).fetchone()
        return dict(waitingMedia=len(self._waiting_media),mediaErrors=dict(self._media_errors),imageEnabledAt=config.get('image_enabled_at'),dualSource=bool(config.get('mx_enabled_at')),enabled=bool(config.get('enabled')),chat_name=config.get('chat_name'),chat_id=config.get('chat_id'),counts=counts,last=dict(last) if last else None)
