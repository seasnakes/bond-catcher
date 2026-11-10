import json
import sys
import tempfile
import time
import unittest
from datetime import datetime,timezone,timedelta
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/prince'))
from store import Store,CHANNEL,AUTHOR
from notifier import Notifier

class NotifierTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.store=Store(self.tmp.name)
        self.calls=[]
        self.n=Notifier(self.store,lambda row:self.calls.append(row['key']) or 'om_test')
        self.n.config_path.write_text(json.dumps(dict(enabled=True,chat_id='oc_test',profile='test',enabled_at=(datetime.now(timezone.utc)-timedelta(seconds=10)).isoformat())))
    def tearDown(self):self.tmp.cleanup()
    def ingest(self,mode='observed',age=0):
        row=dict(id=f'tui-1-{int(time.time())-age}-2',author=AUTHOR,body='测试',images=[])
        self.store.ingest(dict(channel=CHANNEL,mode=mode,messages=[row]));return row
    def test_history_and_pre_activation_not_sent(self):
        self.ingest('history');self.ingest(age=100)
        self.n.tick();self.assertEqual(self.calls,[])
    def test_mx_never_forwarded_even_if_observed(self):
        self.store.ingest(dict(source='mx',channel='转债小王子',mode='observed',messages=[dict(id='mx-123',author=AUTHOR,body='测试',images=[],timestampMs=int(time.time()*1000))]))
        self.n.tick(); self.assertEqual(self.calls,[])
        self.ingest(); self.n.tick(); self.assertEqual(len(self.calls),1)
    def test_dedup_after_restart(self):
        self.ingest();self.n.tick();self.n=Notifier(self.store,lambda r:self.calls.append(r['key']) or 'om_test');self.n.tick()
        self.assertEqual(len(self.calls),1)
    def test_retry_uses_same_key(self):
        self.ingest()
        def fail(r):self.calls.append(r['key']);raise TimeoutError('ambiguous')
        self.n.send=fail;self.n.tick()
        with self.store.connect() as db:db.execute('UPDATE delivery_outbox SET next_attempt=0')
        self.n.send=lambda r:self.calls.append(r['key']) or 'om_test';self.n.tick()
        self.assertEqual(len(self.calls),2);self.assertEqual(self.calls[0],self.calls[1])
    def test_expired_ambiguous_send_requires_review(self):
        self.ingest();self.n.enqueue()
        with self.store.connect() as db:db.execute('UPDATE delivery_outbox SET attempted=?',(time.time()-2800,))
        self.n.tick();self.assertEqual(self.calls,[]);self.assertEqual(self.n.status()['counts']['needs_review'],1)
    def test_permission_gate_not_retried(self):
        self.ingest()
        def gate(r):raise PermissionError('requires user')
        self.n.send=gate;self.n.tick();self.assertEqual(self.n.status()['counts']['needs_review'],1)
    def test_invisible_text_is_not_queued(self):
        row=self.ingest()
        row['body']='\u200b\n　\\n'
        self.store.ingest(dict(channel=CHANNEL,mode='observed',messages=[row]))
        self.n.tick()
        self.assertEqual(self.calls,[])
        self.assertEqual(self.n.status()['counts'],{})


class DualSourceTests(NotifierTests):
    def setUp(self):
        super().setUp()
        config=json.loads(self.n.config_path.read_text())
        config['enabled_at']=(datetime.now(timezone.utc)-timedelta(hours=1)).isoformat()
        config['mx_enabled_at']=config['enabled_at']
        self.n.config_path.write_text(json.dumps(config))
        self.ts=int(time.time())-1
    def mx(self,id=123,body='测试',delta=0,images=None,mode='observed'):
        row=dict(id=f'mx-{id}',author=AUTHOR,body=body,images=images or [],timestampMs=(self.ts+delta)*1000)
        self.store.ingest(dict(source='mx',channel='转债小王子',mode=mode,messages=[row]))
        return row
    def test_mx_never_forwarded_even_if_observed(self):
        # Override old single-source fixture: without an explicit source activation MX stays off.
        config=json.loads(self.n.config_path.read_text());config.pop('mx_enabled_at');self.n.config_path.write_text(json.dumps(config))
        self.mx(); self.n.tick();self.assertEqual(self.calls,[])
    def test_history_and_pre_activation_not_sent(self):
        self.mx(mode='history');self.n.tick();self.assertEqual(self.calls,[])
    def test_mx_first_then_yiliao_then_mx_duplicate(self):
        self.mx();self.n.tick();self.ingest();self.mx(124);self.n.tick()
        self.assertEqual(len(self.calls),1)
        self.assertEqual(self.n.status()['counts']['sent'],1)
    def test_old_outbox_seeded_before_mx(self):
        self.ingest();self.n.tick()
        with self.store.connect() as db:db.execute('DELETE FROM delivery_content')
        self.mx();self.n.tick();self.assertEqual(len(self.calls),1)
    def test_both_pending_before_first_send(self):
        self.mx();self.ingest();self.n.tick();self.assertEqual(len(self.calls),1)
    def test_mx_duplicate_after_restart(self):
        self.mx();self.n.tick();self.n=Notifier(self.store,lambda r:self.calls.append(r['key']) or 'om_test')
        self.mx(124);self.n.tick();self.assertEqual(len(self.calls),1)
    def test_different_text_and_later_repeat_survive(self):
        self.mx(122,delta=-200);self.mx(123);self.mx(124,body='微芯减仓');self.n.tick()
        self.assertEqual(len(self.calls),3)
    def test_images_dedup_by_pixels_and_wait_for_file(self):
        import hashlib
        from PIL import Image,PngImagePlugin
        urls=['https://wework.qpic.cn/wwpic3az/a/0','https://wework.qpic.cn/wwpic3az/b/0']
        self.mx(123,body='',images=urls[:1]);self.n.tick();self.assertEqual(len(self.calls),0)
        media=Path(self.tmp.name)/'media';media.mkdir()
        for i,url in enumerate(urls):
            info=PngImagePlugin.PngInfo();info.add_text('test',str(i))
            Image.new('RGB',(10,10),'red').save(media/(hashlib.sha256(url.encode()).hexdigest()+'.img'),format='PNG',pnginfo=info)
        self.mx(124,body='',images=urls[1:]);self.n.tick();self.assertEqual(len(self.calls),1)
        with self.store.connect() as db:self.assertEqual(db.execute('SELECT kind FROM delivery_outbox').fetchone()[0],'image')
    def test_text_does_not_wait_for_image(self):
        self.mx(images=['https://wework.qpic.cn/wwpic3az/missing/0']);self.n.tick();self.n.tick()
        self.assertEqual(len(self.calls),1)
    def test_mx_cutover_excludes_earlier_records(self):
        config=json.loads(self.n.config_path.read_text());config['mx_enabled_at']=datetime.fromtimestamp(self.ts,timezone.utc).isoformat();self.n.config_path.write_text(json.dumps(config))
        self.mx(122,delta=-100,body='早于启用');self.mx(123,body='启用后');self.n.tick()
        self.assertEqual(len(self.calls),1)

if __name__=='__main__':unittest.main()
