"""Explainable filtering for 快讯八合一; raw messages are always retained."""
import re

VERSION = 'news-v5-placeholder-cleanup'
NEWS_LABELS={'快讯','要闻','早报','午报','收评','公告','突发','独家','更新','数据','提醒','财联社','新华社','央视新闻'}
DISCLAIMER = '免责声明：信息来源于官方媒体/网络新闻等，仅信息分享，不作为投资建议！'
DISCLAIMER_PATTERN = re.compile(r'免责声明\s*[:：]\s*信息来源于官方媒体\s*[/／]\s*网络新闻等\s*[,，]\s*仅信息分享\s*[,，]\s*不作为投资建议\s*[!！]?')
BROKER = r'(?:招商|天风|中泰|中金|财通|华安|华福|申万|中邮|华创|国盛|国金|国信|中信建投|中信证券|开源|东吴|浙商|民生|海通|兴业|光大|广发|高盛|瑞银|摩根士丹利|美银|GLMS|HDYZ)'
EMOJI_BRACKETS = re.compile(r'\[(?:捂脸|破涕为笑)\]')


def format_news_body(body):
    """Remove repeated channel boilerplate for display, retaining raw archive text."""
    body=DISCLAIMER_PATTERN.sub('',body).replace('\r\n','\n')
    # The source sometimes serializes an image-only row as "4:\n\\n".
    body=re.sub(r'(?m)^[ \t]*(?:\\[nr][ \t]*)+$','',body)
    body=re.sub(r'[\t\u00a0]+',' ',body)
    body=re.sub(r' *\n *','\n',body)
    body=re.sub(r'\n{3,}','\n\n',body).strip()
    if re.fullmatch(r'[1-8]\s*[:：](?:\s|\\[nr])*',body):return ''
    return body


def split_forward_body(body,limit=2400):
    text=format_news_body(body)
    if not text:return []
    chunks=[]
    while len(text)>limit:
        cut=0
        for separator in ('\n\n','\n','。','；','！','？'):
            position=text.rfind(separator,int(limit*0.55),limit)
            if position>=0:
                cut=position+len(separator)
                break
        cut=cut or limit
        chunks.append(text[:cut])
        text=text[cut:]
    if text:chunks.append(text)
    if len(chunks)>1:
        return [f'（{i}/{len(chunks)}）\n{part}' for i,part in enumerate(chunks,1)]
    return chunks


def clean_body(body):
    return re.sub(r'^\s*1\s*[:：]\s*','',format_news_body(body)).strip()


def classify(body, images=()):
    text=clean_body(body)
    reasons=[]
    if re.search(r'[\[\]［］]',EMOJI_BRACKETS.sub('',text)):reasons.append('square_bracket')
    short_labels=[re.sub(r'\s+','',v) for v in re.findall(r'【([^】]{1,100})】',text)]
    if any(1<=len(v)<=6 and v not in NEWS_LABELS for v in short_labels):reasons.append('short_bracket_label')
    if re.search(r'【\s*'+BROKER+r'\s*(?:电子|机械|电新|通信|港股|新材料|有色|化工|计算机|非银|医药|策略|军工|汽车|建筑|家电|传媒|食品饮料|HL)[^】:：，。！？\n]{0,18}】',text):reasons.append('broker_heading')
    if re.search(r'(?:重点|坚定|强烈|持续|继续)推荐|推荐\s*[:：]|核心推荐|强烈看好',text):reasons.append('explicit_recommendation')
    if re.search(r'派点|请支持.{0,12}(?:团队|电子|机械|电新)|欢迎(?:联系|交流)|各位领导',text) and re.search(BROKER+r'|调研|推荐|估值',text):reasons.append('broker_marketing')
    if re.search(r'目标市值|目标价|买入评级|增持评级|确信买入',text) and re.search(BROKER+r'|估值|市盈率|盈利预测|我们认为|投资建议',text):reasons.append('valuation_pitch')
    if re.search(r'^.{0,12}'+BROKER+r'.{0,10}(?:周观点|调研更新|观点更新)',text):reasons.append('research_update')
    if re.search(r'腾讯会议|会议号',text) and re.search(r'路演|调研|报名|汇报',text):reasons.append('roadshow_invitation')
    if reasons:return {'action':'filter','reasons':reasons,'version':VERSION}
    if not text and not images:return {'action':'filter','reasons':['empty_or_disclaimer'],'version':VERSION}
    if re.search(r'【[^】]{0,20}(?:收评观点|盘中观点|盘后观点)[^】]{0,20}】|把握.{0,12}做多|指数有望冲击\d{3,5}点',text):
        return {'action':'review','reasons':['possible_investment_commentary'],'version':VERSION}
    weak=[bool(re.search(pattern,text)) for pattern in (r'建议关注|建议布局|看好|上车|捞点',r'估值|市值|低估|利润弹性|配置性价比',r'我们认为|我们觉得|我自己认为|刚聊了一圈|调研|策略观点')]
    if sum(weak)>=2:return {'action':'review','reasons':['possible_investment_commentary'],'version':VERSION}
    return {'action':'allow','reasons':[],'version':VERSION}
