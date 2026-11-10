import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/prince'))
from store import Store,CHANNEL,AUTHOR

class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.store=Store(self.tmp.name)
        self.row=dict(id='tui-144115247748237825-1789699223-80310540',author=AUTHOR,body='原文',images=[])
    def tearDown(self): self.tmp.cleanup()
    def ingest(self,rows=None,**kw):
        return self.store.ingest(dict(channel=CHANNEL,messages=rows or [self.row],mode='history',**kw))
    def test_mx_archive_and_source_validation(self):
        row=dict(id='mx-123',author=AUTHOR,body='MX原文',images=['https://wework.qpic.cn/wwpic3az/example/0'],timestampMs=1789955169206)
        payload=dict(source='mx',channel='转债小王子',mode='history',messages=[row])
        self.assertEqual(self.store.ingest(payload)['inserted'],1)
        self.assertEqual(self.store.ingest(payload)['duplicates'],1)
        self.assertEqual(self.store.snapshot()['messages'][0]['source'],'mx')
        with self.assertRaises(ValueError): self.store.ingest(dict(payload,source='yiliao'))
        with self.assertRaises(ValueError): self.store.ingest(dict(payload,messages=[dict(row,timestampMs=0)]))
    def test_restart_dedup(self):
        self.assertEqual(self.ingest()['inserted'],1)
        at=self.store.snapshot()['messages'][0]['first_seen']
        self.store=Store(self.tmp.name)
        self.assertEqual(self.ingest()['duplicates'],1)
        self.assertEqual(self.store.snapshot()['messages'][0]['first_seen'],at)
    def test_revision_preserves_original(self):
        self.ingest(); self.row['body']='更正'
        self.assertEqual(self.ingest()['revised'],1)
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM versions').fetchone()[0],2)
    def test_atomic_reject(self):
        bad=dict(self.row,id='bad')
        with self.assertRaises(ValueError): self.ingest([self.row,bad])
        self.assertEqual(self.store.snapshot()['total'],0)
    def test_reject_other_channel_and_media(self):
        with self.assertRaises(ValueError): self.store.ingest(dict(channel='其他群',messages=[self.row]))
        self.row['images']=['http://127.0.0.1/secret']
        with self.assertRaises(ValueError): self.ingest()
    def test_other_author_ignored(self):
        self.row['author']='其他作者'
        self.assertEqual(self.ingest()['accepted'],0)
    def test_history_never_becomes_live(self):
        self.ingest()
        self.store.ingest(dict(channel=CHANNEL,messages=[self.row],mode='observed'))
        self.assertEqual(self.store.snapshot()['messages'][0]['mode'],'history')

if __name__=='__main__': unittest.main()
