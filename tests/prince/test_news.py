import json,sys,tempfile,time,unittest
from pathlib import Path
from datetime import datetime,timezone,timedelta
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/prince'))
from news_filter import classify,DISCLAIMER,VERSION,format_news_body,split_forward_body
from store import Store,CHANNEL,AUTHOR
from notifier import Notifier

class NewsTests(unittest.TestCase):
    def test_short_labels(self):
        for text in ('【招商电新】观点更新','上涨原因【迈为股份】','【天风通信】华工科技','[玫瑰]重点推荐','［礼物］新品'):
            self.assertEqual(classify(text)['action'],'filter',text)
    def test_news_headlines(self):
        for text in ('【三环集团：MLCC原厂价格变化不会像经销商渠道那样快】公司回应','【卡塔尔称美国希望与伊朗达成协议】央视消息','【公告】公司发布三季度业绩','【财联社】工信部发布行业数据','瑞银上调全球AI资本支出预测','公司发布智能推荐算法产品','【招商银行发布季度业绩公告】营收增长','【中信证券：市场成交额有所回升】财联社消息'):
            self.assertEqual(classify(text)['action'],'allow',text)
    def test_promotions_without_brackets(self):
        for text in ('继续重点推荐：金丹科技、海正生材、家联科技','高盛生益科技维持买入评级，目标价249元','腾讯会议：123，调研路演报名','观点更新 推荐：旭创、新易盛','中邮有色周观点 本周重点关注金铜钼钽'):
            self.assertEqual(classify(text)['action'],'filter',text)
    def test_disclaimer_is_not_recommendation(self):
        self.assertEqual(classify('市场成交额增长\n'+DISCLAIMER)['action'],'allow')
        self.assertEqual(classify(DISCLAIMER)['action'],'filter')
    def test_uncertain_images_and_commentary(self):
        self.assertEqual(classify(DISCLAIMER,['image'])['action'],'allow')
        self.assertEqual(classify('我们觉得当下位置捞点已现，估值低，建议关注')['action'],'review')
        self.assertEqual(classify('【9月21日收评观点】指数有望冲击4000点，把握好难得的做多时间窗口。')['action'],'review')
    def test_emoji_brackets_do_not_hide_news(self):
        self.assertEqual(classify('晚上美股涨，明天大a继续高开低走[捂脸]')['action'],'allow')
        self.assertEqual(classify('又到了A股收盘全是利好的环节[破涕为笑]')['action'],'allow')
        self.assertEqual(classify('[玫瑰]重点推荐')['action'],'filter')
    def test_reclassifying_archive_keeps_original_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(tmp)
            body='收盘后市场消息[捂脸]\n'+DISCLAIMER
            store.ingest(dict(source='news',channel='快讯八合一',mode='history',messages=[dict(id='news-125',author='快讯八合一',timestampMs=int(time.time()*1000),body=body,images=[])]))
            with store.connect() as db:db.execute('DELETE FROM news_decisions WHERE version=?',(VERSION,))
            self.assertEqual(store.reclassify_news(),1)
            row=store.snapshot(('news',))['messages'][0]
            self.assertEqual(row['body'],body)
            self.assertEqual(row['display_body'],'收盘后市场消息[捂脸]')
            self.assertEqual(row['filter']['action'],'allow')
    def test_disclaimer_and_long_text(self):
        self.assertEqual(format_news_body('消息\n'+DISCLAIMER),'消息')
        self.assertEqual(format_news_body('4: \t'+DISCLAIMER),'')
        self.assertEqual(format_news_body('4:\n\t\t\\n\n'+DISCLAIMER),'')
        self.assertEqual(format_news_body('4:\\n'+DISCLAIMER),'')
        self.assertEqual(split_forward_body('4:\n\\n\n'+DISCLAIMER),[])
        body=('第一段。'*400)+'\n\n'+('第二段。'*400)+'\n'+DISCLAIMER
        parts=split_forward_body(body)
        self.assertGreater(len(parts),1)
        self.assertTrue(all(len(part)<=2500 for part in parts))
        restored=''.join(part.split('\n',1)[1] for part in parts)
        self.assertEqual(restored,format_news_body(body))
    def test_image_only_news_is_queued_after_cutover(self):
        import hashlib
        from PIL import Image
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(tmp);sent=[]
            since=(datetime.now(timezone.utc)-timedelta(minutes=2)).isoformat()
            (Path(tmp)/'news-feishu.json').write_text(json.dumps(dict(enabled=True,chat_id='oc_news',profile='test',enabled_at=since,image_enabled_at=since)))
            notifier=Notifier(store,lambda row:sent.append((row['kind'],row['payload'])) or 'om_test',config_name='news-feishu.json',sources=('news',))
            url='https://static.dingtalk.com/media/example.png'
            media=Path(tmp)/'media';media.mkdir()
            Image.new('RGB',(10,10),'red').save(media/(hashlib.sha256(url.encode()).hexdigest()+'.img'),format='PNG')
            store.ingest(dict(source='news',channel='快讯八合一',mode='observed',messages=[dict(id='news-123',author='快讯八合一',timestampMs=int(time.time()*1000),body='4:\n\t\\n\n'+DISCLAIMER,images=[url])]))
            notifier.tick()
            self.assertEqual(len(sent),1)
            self.assertEqual(sent[0][0],'image')
    def test_old_image_is_not_backfilled_when_policy_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(tmp);sent=[]
            since=(datetime.now(timezone.utc)-timedelta(minutes=2)).isoformat()
            url='https://static.dingtalk.com/media/old.png'
            store.ingest(dict(source='news',channel='快讯八合一',mode='observed',messages=[dict(id='news-124',author='快讯八合一',timestampMs=int(time.time()*1000),body='此前带图消息',images=[url])]))
            (Path(tmp)/'news-feishu.json').write_text(json.dumps(dict(enabled=True,chat_id='oc_news',profile='test',enabled_at=since,image_enabled_at=datetime.now(timezone.utc).isoformat())))
            notifier=Notifier(store,lambda row:sent.append(row) or 'om_test',config_name='news-feishu.json',sources=('news',))
            notifier.tick()
            self.assertEqual(sent,[])
            self.assertEqual(notifier.status()['counts'],{})
    def test_routing_filter_history_and_audit(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(tmp);calls=[]
            since=(datetime.now(timezone.utc)-timedelta(minutes=2)).isoformat()
            for name,dest in [('feishu.json','oc_prince'),('news-feishu.json','oc_news')]:
                (Path(tmp)/name).write_text(json.dumps(dict(enabled=True,chat_id=dest,profile='test',enabled_at=since)))
            def send(row):calls.append((row['destination'],row['payload']));return 'om_test'
            news=Notifier(store,send,config_name='news-feishu.json',sources=('news',));prince=Notifier(store,send)
            for i,body,mode in [(1,'最新正常新闻','observed'),(2,'【招商电新】推荐','observed'),(3,'历史正常新闻','history')]:
                store.ingest(dict(source='news',channel='快讯八合一',mode=mode,messages=[dict(id=f'news-{i}',author='快讯八合一',timestampMs=int(time.time()*1000),body=body,images=[])]))
            store.ingest(dict(channel=CHANNEL,mode='observed',messages=[dict(id=f'tui-1-{int(time.time())}-2',author=AUTHOR,body='小王子原文',images=[])]))
            news.tick();prince.tick();news.tick()
            self.assertEqual(calls,[('oc_news','最新正常新闻'),('oc_prince','小王子原文')])
            self.assertEqual(store.snapshot()['total'],1);self.assertEqual(store.snapshot(('news',))['total'],3)
            self.assertEqual(news.status()['counts'],{'sent':1});self.assertEqual(prince.status()['counts'],{'sent':1})
            rows=store.snapshot(('news',))['messages'];self.assertTrue(any(r['filter']['action']=='filter' for r in rows))
    def test_revision_to_promotion_cancels_pending(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(tmp);calls=[]
            since=(datetime.now(timezone.utc)-timedelta(minutes=2)).isoformat()
            (Path(tmp)/'news-feishu.json').write_text(json.dumps(dict(enabled=True,chat_id='oc_news',profile='test',enabled_at=since)))
            n=Notifier(store,lambda row:calls.append(row) or 'om_test',config_name='news-feishu.json',sources=('news',))
            row=dict(id='news-1',author='快讯八合一',timestampMs=int(time.time()*1000),body='正常新闻',images=[])
            store.ingest(dict(source='news',channel='快讯八合一',mode='observed',messages=[row]));n.enqueue()
            row['body']='【招商电新】重点推荐'
            store.ingest(dict(source='news',channel='快讯八合一',mode='observed',messages=[row]));n.tick()
            self.assertEqual(calls,[]);self.assertEqual(n.status()['counts'],{'filtered':1})
    def test_news_media_restricted(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(tmp)
            payload=dict(source='news',channel='快讯八合一',messages=[dict(id='news-10',author='快讯八合一',timestampMs=int(time.time()*1000),body='图片',images=['https://static.dingtalk.com/media/example.png'])])
            self.assertEqual(store.ingest(payload)['inserted'],1)
            payload['messages'][0]['images']=['http://127.0.0.1/private']
            with self.assertRaises(ValueError):store.ingest(payload)

if __name__=='__main__':unittest.main()
